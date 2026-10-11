import {
  type ComponentInternalInstance,
  type ComponentOptions,
  type ConcreteComponent,
  type SetupContext,
  currentInstance,
  getComponentName,
  getCurrentInstance,
} from '../component'
import {
  Comment,
  type VNode,
  type VNodeProps,
  cloneVNode,
  invokeVNodeHook,
  isSameVNodeType,
  isVNode,
} from '../vnode'
import { warn } from '../warning'
import {
  injectHook,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  onUpdated,
} from '../apiLifecycle'
import {
  ShapeFlags,
  invokeArrayFns,
  isArray,
  isRegExp,
  isString,
  remove,
} from '@vue/shared'
import { watch } from '../apiWatch'
import {
  type ElementNamespace,
  MoveType,
  type RendererElement,
  type RendererInternals,
  type RendererNode,
  invalidateMount,
  queuePostRenderEffect,
} from '../renderer'
import { setTransitionHooks } from './BaseTransition'
import type { ComponentRenderContext } from '../componentPublicInstance'
import { devtoolsComponentAdded } from '../devtools'
import { isAsyncWrapper } from '../apiAsyncComponent'
import { isSuspense } from './Suspense'
import { LifecycleHooks } from '../enums'

/** `include`/`exclude` 支持组件名、正则，或二者组成的数组。 */
type MatchPattern = string | RegExp | (string | RegExp)[]

/** `<KeepAlive>` 对外暴露的缓存筛选与容量参数。 */
export interface KeepAliveProps {
  /** 只有名称匹配的组件才进入缓存。 */
  include?: MatchPattern
  /** 名称匹配的组件不进入缓存，优先级高于 include。 */
  exclude?: MatchPattern
  /** 最大缓存实例数；超出后按最近最少使用顺序淘汰。 */
  max?: number | string
}

/** 优先使用用户提供的 VNode key；无 key 时用组件定义本身区分缓存项。 */
type CacheKey = PropertyKey | ConcreteComponent
/** 缓存键到“已实际挂载 VNode”的映射。 */
type Cache = Map<CacheKey, VNode>
/** 按新旧顺序保存缓存键的集合，用于实现简单的 LRU 淘汰。 */
type Keys = Set<CacheKey>

/**
 * KeepAlive 与渲染器交换能力的内部上下文。
 * 渲染器注入底层 patch/move/unmount，KeepAlive 再回填 activate/deactivate；这种
 * 双向约定避免渲染器直接导入组件实现，从而保持 tree-shaking。
 */
export interface KeepAliveContext extends ComponentRenderContext {
  /** renderer 注入的 patch/move/unmount 与宿主操作，供缓存恢复和真正淘汰使用。 */
  renderer: RendererInternals
  /** 渲染器缓存命中入口：恢复宿主位置、patch 最新 VNode，再排队 activated。 */
  activate: (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    namespace: ElementNamespace,
    optimized: boolean,
  ) => void
  /** 渲染器离开保活分支入口：移入 storage，不停止组件作用域，再排队 deactivated。 */
  deactivate: (vnode: VNode) => void
}

/** 通过内置标记判断 VNode 是否为 KeepAlive，避免直接引用组件对象。 */
export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive

/**
 * KeepAlive 的运行时实现。
 *
 * 它不复制组件状态，而是把停用组件的整棵宿主节点移动到隐藏容器；再次命中时
 * 再搬回真实容器并 patch 最新 props。`cache` 保存实例，`keys` 同时维护 LRU 顺序。
 */
const KeepAliveImpl: ComponentOptions = {
  name: `KeepAlive`,

  // 渲染器通过这个标记进入特殊分支。若直接 `=== KeepAlive`，渲染器必须静态导入
  // 此组件，即使应用没使用 KeepAlive 也无法被打包器摇掉。
  __isKeepAlive: true,

  props: {
    include: [String, RegExp, Array],
    exclude: [String, RegExp, Array],
    max: [String, Number],
  },

  /** 为当前 KeepAlive 建立 cache、LRU keys 与离屏容器，并回填 renderer 激活协议。render 只选择 key/复用引用，mounted/updated 缓存最终子树；筛选更新和自身卸载各自清理缓存。 */
  setup(props: KeepAliveProps, { slots }: SetupContext) {
    const instance = getCurrentInstance()!
    // 具体 renderer 把内部方法放进 ctx，KeepAlive 再在 ctx 上实现 activate/deactivate。
    // 这样两边通过运行时上下文通信，不产生妨碍 tree-shaking 的静态循环依赖。
    const sharedContext = instance.ctx as KeepAliveContext

    // SSR 没有可移动的真实宿主节点，也不会注册 renderer；KeepAlive 在服务端只需
    // 透传插槽内容，缓存语义留到客户端挂载后建立。
    if (__SSR__ && !sharedContext.renderer) {
      return () => {
        const children = slots.default && slots.default()
        return children && children.length === 1 ? children[0] : children
      }
    }

    const cache: Cache = new Map()
    const keys: Keys = new Set()
    /** 当前活动 VNode；清理缓存时不能立刻卸载它。 */
    let current: VNode | null = null

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      ;(instance as any).__v_cache = cache
    }

    const parentSuspense = instance.suspense

    const {
      renderer: {
        p: patch,
        m: move,
        um: _unmount,
        o: { createElement },
      },
    } = sharedContext
    const storageContainer = createElement('div')

    // 缓存命中：把旧 DOM 搬回目标容器，再用新 VNode patch 缓存实例，确保停用期间
    // 父级传入的新 props/slots 仍能生效。生命周期统一延迟到渲染提交之后执行。
    /** 缓存命中时先移动已有子树，再 patch 最新 props/slots；post 回调先清 isDeactivated 再触发 activated/VNode mounted，不创建新实例。 */
    sharedContext.activate = (
      vnode,
      container,
      anchor,
      namespace,
      optimized,
    ) => {
      const instance = vnode.component!
      move(vnode, container, anchor, MoveType.ENTER, parentSuspense)
      // VNode 在缓存期间仍可能收到新的 props，因此移动后还需正常 patch 一次。
      patch(
        instance.vnode,
        vnode,
        container,
        anchor,
        instance,
        parentSuspense,
        namespace,
        vnode.slotScopeIds,
        optimized,
      )
      queuePostRenderEffect(() => {
        instance.isDeactivated = false
        if (instance.a) {
          invokeArrayFns(instance.a)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeMounted
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // 通知开发工具刷新组件树中的“已激活”状态。
        devtoolsComponentAdded(instance)
      }
    }

    /** 取消未提交 mounted/activated，将同一子树移入 storage；post 调 deactivated/VNode unmounted 后才标记 isDeactivated，组件作用域继续保留。 */
    sharedContext.deactivate = (vnode: VNode) => {
      const instance = vnode.component!
      // 停用前取消尚未提交的 mounted/activated 钩子，避免组件搬走后又错误触发。
      invalidateMount(instance.m)
      invalidateMount(instance.a)

      move(vnode, storageContainer, null, MoveType.LEAVE, parentSuspense)
      queuePostRenderEffect(() => {
        if (instance.da) {
          invokeArrayFns(instance.da)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
        instance.isDeactivated = true
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // 通知开发工具刷新组件树中的“已停用”状态。
        devtoolsComponentAdded(instance)
      }

      // 仅浏览器开发构建暴露存储容器，供端到端测试检查节点确实被移动而非销毁。
      if (__DEV__ && __BROWSER__) {
        ;(instance as any).__keepAliveStorageContainer = storageContainer
      }
    }

    /** 真正淘汰缓存项：先移除 KeepAlive 标志，让渲染器走普通卸载流程。 */
    function unmount(vnode: VNode) {
      resetShapeFlag(vnode)
      _unmount(vnode, instance, parentSuspense, true)
    }

    /** 按组件名称过滤缓存，未通过过滤器的条目会被淘汰。 */
    function pruneCache(filter: (name: string) => boolean) {
      cache.forEach((vnode, key) => {
        // 异步包装器的名字通常只是 AsyncComponentWrapper；加载完成后应以内部真实
        // 组件名匹配 include/exclude，才符合用户在模板中看到的组件名称。
        const name = getComponentName(
          isAsyncWrapper(vnode)
            ? (vnode.type as ComponentOptions).__asyncResolved || {}
            : (vnode.type as ConcreteComponent),
        )
        if (name && !filter(name)) {
          pruneCacheEntry(key)
        }
      })
    }

    /**
     * 删除单个缓存项。当前仍显示的实例不能当场卸载，只清除标志，让后续正常
     * 切换/父级卸载时销毁；非活动项则可立即走完整卸载流程。
     */
    function pruneCacheEntry(key: CacheKey) {
      const cached = cache.get(key) as VNode
      if (cached && (!current || !isSameVNodeType(cached, current))) {
        unmount(cached)
      } else if (current) {
        // 当前实例仍在页面上，不能立即卸载；先取消 KeepAlive 标志，之后离开时
        // 渲染器就会按普通组件销毁，而不是再次放回缓存。
        resetShapeFlag(current)
      }
      cache.delete(key)
      keys.delete(key)
    }

    // include/exclude 可动态改变；使用 post flush，确保本轮 render 已更新 current，
    // 避免把刚成为活动节点的实例误当成后台缓存直接卸载。deep 用于监听数组原地修改。
    watch(
      () => [props.include, props.exclude],
      ([include, exclude]) => {
        include && pruneCache(name => matches(include, name))
        exclude && pruneCache(name => !matches(exclude, name))
      },
      // render 后清理，此时 current 已指向本轮真正显示的节点。
      { flush: 'post', deep: true },
    )

    // render 阶段只记 key，真正缓存要等 mounted/updated 后读取 instance.subTree。
    let pendingCacheKey: CacheKey | null = null
    /** 将本轮最终规范化、且已挂载的子树写入缓存。 */
    const cacheSubtree = () => {
      // #1621：合法 key 可以是数字 0，不能用 truthy 判断，否则 key=0 永远不缓存。
      if (pendingCacheKey != null) {
        // Suspense 初始 subTree 可能仍是 fallback/未挂载内容，必须等边界 resolve 后再取
        // ssContent，否则缓存会指向没有 component/el 的 VNode，激活时无法复用。
        if (isSuspense(instance.subTree.type)) {
          queuePostRenderEffect(() => {
            cache.set(pendingCacheKey!, getInnerChild(instance.subTree))
          }, instance.subTree.suspense)
        } else {
          cache.set(pendingCacheKey, getInnerChild(instance.subTree))
        }
      }
    }
    onMounted(cacheSubtree)
    onUpdated(cacheSubtree)

    // KeepAlive 自身卸载时，后台缓存项需要真正销毁。当前活动子树会随父组件正常
    // 卸载，只需清除其保活标志并补发 deactivated，避免重复 unmount。
    onBeforeUnmount(() => {
      cache.forEach(cached => {
        const { subTree, suspense } = instance
        const vnode = getInnerChild(subTree)
        if (cached.type === vnode.type && cached.key === vnode.key) {
          // 当前实例会作为 KeepAlive 子树的一部分由渲染器卸载。
          resetShapeFlag(vnode)
          // 但卸载路径不会再走 deactivate，因此在这里补排 deactivated 钩子。
          const da = vnode.component!.da
          da && queuePostRenderEffect(da, suspense)
          return
        }
        unmount(cached)
      })
    })

    return () => {
      // 若本轮没有产生可缓存组件，不应沿用上一轮 key。
      pendingCacheKey = null

      if (!slots.default) {
        return (current = null)
      }

      const children = slots.default()
      const rawVNode = children[0]
      // KeepAlive 只能管理一个有状态组件/Suspense。多根或普通元素直接透传，
      // 否则 activate/deactivate 无法确定该保存哪棵组件实例树。
      if (children.length > 1) {
        if (__DEV__) {
          warn(`KeepAlive should contain exactly one component child.`)
        }
        current = null
        return children
      } else if (
        !isVNode(rawVNode) ||
        (!(rawVNode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) &&
          !(rawVNode.shapeFlag & ShapeFlags.SUSPENSE))
      ) {
        current = null
        return rawVNode
      }

      let vnode = getInnerChild(rawVNode)
      // #6028：Suspense 的 ssContent 在条件分支为空时可能只是注释 VNode。它没有
      // 组件实例可恢复，若写入缓存，后续同 key 的真实组件可能错误命中空占位符。
      if (vnode.type === Comment) {
        current = null
        return vnode
      }

      const comp = vnode.type as ConcreteComponent

      // 异步组件解析后，以真实内部组件名匹配 include/exclude；解析前没有真实名称时，
      // include 会保守地不缓存，exclude 则只有明确命中才排除。
      const name = getComponentName(
        isAsyncWrapper(vnode)
          ? (vnode.type as ComponentOptions).__asyncResolved || {}
          : comp,
      )

      const { include, exclude, max } = props

      if (
        (include && (!name || !matches(include, name))) ||
        (exclude && name && matches(exclude, name))
      ) {
        // #11717：VNode 可能来自上一轮缓存路径并仍带 SHOULD_KEEP_ALIVE。筛选条件
        // 动态变为不匹配时必须显式清掉该位，否则渲染器仍会把它停用而非正常卸载。
        vnode.shapeFlag &= ~ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
        current = vnode
        return rawVNode
      }

      const key = vnode.key == null ? comp : vnode.key
      const cachedVNode = cache.get(key)

      // 下方会修改 el/component/shapeFlag。若这个 VNode 已经挂载，先克隆以免污染
      // 其他位置仍在使用的同一对象；Suspense 还要同步替换其 ssContent 引用。
      if (vnode.el) {
        vnode = cloneVNode(vnode)
        if (rawVNode.shapeFlag & ShapeFlags.SUSPENSE) {
          rawVNode.ssContent = vnode
        }
      }
      // #1511：attrs 透传或 scopeId 处理可能在后续克隆当前 VNode，因此这里拿到的
      // 未必是最终挂载对象。只记录 pending key，等 mounted/updated 后缓存规范化的
      // instance.subTree，才能确保其中 el/component 都是渲染器实际使用的引用。
      pendingCacheKey = key

      if (cachedVNode) {
        // 命中缓存：把真实 DOM 与组件实例引用移交给本轮新 VNode。
        vnode.el = cachedVNode.el
        vnode.component = cachedVNode.component
        if (vnode.transition) {
          // 过渡参数可能已经变化，递归更新缓存组件子树上的钩子。
          setTransitionHooks(vnode, vnode.transition!)
        }
        // 告诉渲染器走 activate，而不是创建一个全新组件实例。
        vnode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
        // Set 的插入顺序即 LRU 顺序；删除后重加，把本项移动到最新端。
        keys.delete(key)
        keys.add(key)
      } else {
        keys.add(key)
        // 新条目导致超限时，淘汰 Set 迭代顺序中的最旧 key。
        if (max && keys.size > parseInt(max as string, 10)) {
          pruneCacheEntry(keys.values().next().value!)
        }
      }
      // 告诉渲染器离开时走 deactivate，而不是普通 unmount。
      vnode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE

      current = vnode
      return isSuspense(rawVNode.type) ? rawVNode : vnode
    }
  },
}

/** 在兼容构建中追加内置组件标记，并保持 PURE 标注便于 tree-shaking。 */
const decorate = (t: typeof KeepAliveImpl) => {
  t.__isBuiltIn = true
  return t
}

/**
 * KeepAlive 的公共构造类型，供 `h()`/TSX 推导 props 和默认插槽；显式声明也能
 * 避免生成的 d.ts 包含内联 `import()` 类型。
 */
export const KeepAlive = (__COMPAT__
  ? /*@__PURE__*/ decorate(KeepAliveImpl)
  : KeepAliveImpl) as any as {
  /** 供 renderer 分派的内置字面量标记，避免静态引用组件实现。 */
  __isKeepAlive: true
  /** h/TSX 的虚拟构造协议，描述 props 与默认插槽，不实际构造实例。 */
  new (): {
    /** VNode 通用属性与 KeepAlive 筛选/容量参数的交集。 */
    $props: VNodeProps & KeepAliveProps
    /** 公开默认插槽类型，运行时只缓存单个有状态组件/Suspense。 */
    $slots: {
      /** 返回候选子节点列表；多根运行时透传且开发警告。 */
      default(): VNode[]
    }
  }
}

/** 判断组件名是否匹配 include/exclude 模式。 */
function matches(pattern: MatchPattern, name: string): boolean {
  if (isArray(pattern)) {
    return pattern.some((p: string | RegExp) => matches(p, name))
  } else if (isString(pattern)) {
    return pattern.split(',').includes(name)
  } else if (isRegExp(pattern)) {
    // 带 g/y 标志的正则 test 会修改 lastIndex；每次归零，避免相同名称时真时假。
    pattern.lastIndex = 0
    return pattern.test(name)
  }
  /* v8 ignore next */
  return false
}

/**
 * 注册组件被 KeepAlive 从缓存恢复时调用的生命周期钩子。
 * 后代组件的钩子也会注入到最近的 KeepAlive 根，以便激活时直接批量触发。
 */
export function onActivated(
  hook: Function,
  target?: ComponentInternalInstance | null,
): void {
  registerKeepAliveHook(hook, LifecycleHooks.ACTIVATED, target)
}

/** 注册组件被 KeepAlive 移入隐藏容器时调用的生命周期钩子。 */
export function onDeactivated(
  hook: Function,
  target?: ComponentInternalInstance | null,
): void {
  registerKeepAliveHook(hook, LifecycleHooks.DEACTIVATED, target)
}

/**
 * 包装并注册 activated/deactivated 钩子。
 * 包装器会检查目标到根之间是否存在已停用祖先，防止嵌套 KeepAlive 中的组件在
 * 外层仍停用时误触发；同一包装器被缓存，也让调度器可以按函数引用去重。
 */
function registerKeepAliveHook(
  hook: Function & {
    /** 带祖先停用检查的用户钩子包装缓存，维持多处注入时的稳定函数身份。 */
    __wdc?: Function
  },
  type: LifecycleHooks,
  target: ComponentInternalInstance | null = currentInstance,
) {
  // 缓存“带停用检查”的包装器（__wdc = with deactivation check），使同一用户钩子
  // 多处注入时仍保持稳定引用，调度器才能正确去重。
  /**
   * 调用前沿目标 parent 链检查停用状态；任一祖先停用便返回，否则调用原钩子。包装缓存维持多处注入身份。
   */
  const wrappedHook =
    hook.__wdc ||
    (hook.__wdc = () => {
      // 只要任一祖先分支处于停用状态，目标实际上仍不可见，不应触发钩子。
      let current: ComponentInternalInstance | null = target
      while (current) {
        if (current.isDeactivated) {
          return
        }
        current = current.parent
      }
      return hook()
    })
  injectHook(type, wrappedHook, target)
  // 除目标实例外，还把钩子预先注入所有 KeepAlive 根。激活/停用时根实例即可直接
  // 执行扁平钩子数组，无需遍历整棵组件树，也无需额外维护后代实例列表。
  if (target) {
    let current = target.parent
    while (current && current.parent) {
      if (isKeepAlive(current.parent.vnode)) {
        injectToKeepAliveRoot(wrappedHook, type, target, current)
      }
      current = current.parent
    }
  }
}

/**
 * 把后代钩子前置注入 KeepAlive 根，并在原目标卸载时移除注入项。
 * `injectHook` 会再包一层错误处理，所以清理时必须保存并删除其返回的包装函数。
 */
function injectToKeepAliveRoot(
  hook: Function & {
    /** 生命周期错误处理包装缓存；injectHook 返回的包装引用用于卸载时移除。 */
    __weh?: Function
  },
  type: LifecycleHooks,
  target: ComponentInternalInstance,
  keepAliveRoot: ComponentInternalInstance,
) {
  const injected = injectHook(type, hook, keepAliveRoot, true /* 前置 */)
  onUnmounted(() => {
    remove(keepAliveRoot[type]!, injected)
  }, target)
}

/** 清除两个 KeepAlive 位，使 VNode 恢复普通组件的挂载/卸载语义。 */
function resetShapeFlag(vnode: VNode) {
  // 用按位与反码只移除目标位，不影响 VNode 的组件/children 等其他形状标志。
  vnode.shapeFlag &= ~ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
  vnode.shapeFlag &= ~ShapeFlags.COMPONENT_KEPT_ALIVE
}

/** Suspense 外壳实际缓存其已解析内容分支，普通 VNode 则直接返回自身。 */
function getInnerChild(vnode: VNode) {
  return vnode.shapeFlag & ShapeFlags.SUSPENSE ? vnode.ssContent! : vnode
}
