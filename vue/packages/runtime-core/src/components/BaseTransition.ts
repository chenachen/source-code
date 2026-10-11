import {
  type ComponentInternalInstance,
  type ComponentOptions,
  type SetupContext,
  getCurrentInstance,
} from '../component'
import {
  Comment,
  Fragment,
  type VNode,
  type VNodeArrayChildren,
  cloneVNode,
  createCommentVNode,
  isSameVNodeType,
} from '../vnode'
import { warn } from '../warning'
import { isKeepAlive } from './KeepAlive'
import { toRaw } from '@vue/reactivity'
import { ErrorCodes, callWithAsyncErrorHandling } from '../errorHandling'
import { PatchFlags, ShapeFlags, isArray, isFunction } from '@vue/shared'
import { onBeforeUnmount, onMounted } from '../apiLifecycle'
import { isTeleport } from './Teleport'
import type { RendererElement } from '../renderer'
import { SchedulerJobFlags } from '../scheduler'
import { isHmrUpdating } from '../hmr'

/**
 * 单个过渡钩子既可以是一个函数，也可以是由多个函数组成的数组。
 * 数组形式主要来自同一事件上合并的多个监听器。
 */
type Hook<T = () => void> = T | T[]

/** DOM/宿主元素上保存“离场完成回调”的私有键，供渲染器和 v-show 取消未完成的过渡。 */
export const leaveCbKey: unique symbol = Symbol('_leaveCb')
/** DOM/宿主元素上保存“入场完成回调”的私有键，防止同一过渡被重复结算。 */
const enterCbKey: unique symbol = Symbol('_enterCb')

/**
 * 平台无关的基础过渡参数。
 *
 * runtime-core 只负责决定何时调用钩子，并不操作 CSS class；Web 平台的
 * `<Transition>` 会在 runtime-dom 中把 CSS 过渡能力包装到这些钩子之上。
 */
export interface BaseTransitionProps<HostElement = RendererElement> {
  /** 新旧节点切换顺序：同时、先出后进或先进后出。 */
  mode?: 'in-out' | 'out-in' | 'default'
  /** 是否让组件首次挂载也执行入场动画。 */
  appear?: boolean

  // 为 true 时，过渡只切换显示/隐藏状态，不真正插入或移除元素。
  // 渲染器仍会把过渡钩子注入 VNode，但不会按普通卸载流程调用它们；
  // v-show 一类自定义指令会在切换 display 时主动调用这些钩子。
  /** 显示/隐藏由调用方控制的过渡标记（例如v-show）：渲染器不自动入场/移除，调用方主动调用transition hooks并在leave完成后隐藏。 */
  persisted?: boolean

  // 这里使用驼峰命名，便于渲染函数和 JSX 传参；模板中的
  // @before-enter 会在编译后转换为 onBeforeEnter。
  /** 普通入场前的用户钩子，接收尚未插入的宿主元素；首次挂载不开appear时跳过。 */
  onBeforeEnter?: Hook<(el: HostElement) => void>
  /** 入场钩子；声明 done 参数时必须主动调用，未接收 done 则由 core 自动结算。 */
  onEnter?: Hook<(el: HostElement, done: () => void) => void>
  /** 入场自然完成后调用；取消时改调 onEnterCancelled。 */
  onAfterEnter?: Hook<(el: HostElement) => void>
  /** 同一宿主元素反向离场时调用，区别于自然完成。 */
  onEnterCancelled?: Hook<(el: HostElement) => void>
  // 离场阶段
  /** 普通离场开始前的用户钩子，接收仍在宿主树中的元素。 */
  onBeforeLeave?: Hook<(el: HostElement) => void>
  /** 离场钩子，done 最终触发移除；声明第二参数表示手动控制完成。 */
  onLeave?: Hook<(el: HostElement, done: () => void) => void>
  /** 自然离场完成且 remove 已执行后调用。 */
  onAfterLeave?: Hook<(el: HostElement) => void>
  /** 仅持久化过渡（如 v-show）会发生离场取消。 */
  onLeaveCancelled?: Hook<(el: HostElement) => void>
  // 首次渲染（appear）阶段；未提供时可回退到对应的 enter 钩子
  /** 首次入场前的用户钩子；appear=true时优先使用，未提供则回退onBeforeEnter。 */
  onBeforeAppear?: Hook<(el: HostElement) => void>
  /** 首次入场钩子，未提供时回退 onEnter，done 控制规则相同。 */
  onAppear?: Hook<(el: HostElement, done: () => void) => void>
  /** 首次入场自然完成回调，未设置回退 onAfterEnter。 */
  onAfterAppear?: Hook<(el: HostElement) => void>
  /** 首次入场被打断回调，未设置回退 onEnterCancelled。 */
  onAppearCancelled?: Hook<(el: HostElement) => void>
}

/**
 * 解析后挂在 `vnode.transition` 上的统一过渡协议。
 * 渲染器只依赖这个协议，因此不需要知道 CSS、JavaScript 动画或具体宿主平台。
 */
export interface TransitionHooks<HostElement = RendererElement> {
  /** 解析时保存的切换模式，用于 renderer/Suspense 协调延迟进入。 */
  mode: BaseTransitionProps['mode']
  /** 由 v-show 等指令控制显示的持久化过渡；renderer 不按插入/移除路径调用。 */
  persisted: boolean
  /** 宿主插入/显示前准备入场，取消旧离场并清理同 type/key 的旧副本。 */
  beforeEnter(el: HostElement): void
  /** 宿主进入后启动钩子，创建幂等 done 并在完成时释放 in-out 延迟离场。 */
  enter(el: HostElement): void
  /** 启动离场并最终调用 remove；整体卸载直接移除，反向切换可取消。 */
  leave(el: HostElement, remove: () => void): void
  /** 为新 VNode 重建独立过渡闭包，避免 Suspense 分支共享回调状态。 */
  clone(vnode: VNode): TransitionHooks<HostElement>
  // 以下钩子只在特定 mode 下动态安装。
  /** out-in 旧分支结束后继续新分支渲染/移动的内部钩子。 */
  afterLeave?(): void
  /** in-out 模式截住旧树移除；保存 earlyRemove 并把正常 delayedLeave 交给新树入场完成器。 */
  delayLeave?(
    el: HostElement,
    earlyRemove: () => void,
    delayedLeave: () => void,
  ): void
  /** 新树入场完成时调用，开始之前暂缓的旧树离场。 */
  delayedLeave?(): void
}

/** 在组件错误边界保护下调用用户过渡钩子的函数签名。 */
export type TransitionHookCaller = <T extends any[] = [el: any]>(
  hook: Hook<(...args: T) => void> | undefined,
  args?: T,
) => void

/**
 * 一个可取消的过渡完成回调。`cancelled` 用于区分自然结束和被反向切换打断。
 */
export type PendingCallback = (cancelled?: boolean) => void

/** 同一个 `<BaseTransition>` 实例在多次渲染之间共享的状态。 */
export interface TransitionState {
  /** 组件是否已经完成首次挂载，用于区分 enter 和 appear。 */
  isMounted: boolean
  /** `out-in` 模式是否正在等待旧节点离场。 */
  isLeaving: boolean
  /** 父组件是否正在卸载；此时离场动画应跳过并立即移除。 */
  isUnmounting: boolean
  // 按 VNode 类型和 key 记录尚未结束离场的节点。若相同类型、相同 key 的
  // 新节点开始入场，可立即移除旧副本，避免页面短暂存在两个逻辑相同的节点。
  /** 按VNode类型分组、再按字符串key索引的离场节点记录；同type/key重新入场时找到旧副本并提前结束移除，完成回调清理自己的记录。 */
  leavingVNodes: Map<any, Record<string, VNode>>
}

/** 带有 Vue 私有过渡状态的宿主元素。 */
export interface TransitionElement {
  // 持久化模式（如 v-show）会反复切换同一个元素。若上一次动画尚未结束就
  // 反向切换，必须先调用并清除待处理回调，否则两个动画会同时修改元素状态。
  /** 当前元素的入场完成/取消回调；离场开始可调用它取消旧入场，回调完成后清空以保证重复done无效。 */
  [enterCbKey]?: PendingCallback
  /** 元素上可取消且幂等的离场完成器，remove 与离场缓存清理在其中执行。 */
  [leaveCbKey]?: PendingCallback
}

/**
 * 创建过渡实例状态，并通过生命周期标记“已挂载”和“正在卸载”。
 * 这些标记让钩子能够正确区分 appear/enter，并在整体卸载时跳过无意义动画。
 */
export function useTransitionState(): TransitionState {
  const state: TransitionState = {
    isMounted: false,
    isLeaving: false,
    isUnmounting: false,
    leavingVNodes: new Map(),
  }
  onMounted(() => {
    state.isMounted = true
  })
  onBeforeUnmount(() => {
    state.isUnmounting = true
  })
  return state
}

/** 运行时 props 校验中，过渡钩子允许函数或函数数组。 */
const TransitionHookValidator = [Function, Array]

/** `<BaseTransition>` 的运行时 props 校验表。 */
export const BaseTransitionPropsValidators: Record<string, any> = {
  mode: String,
  appear: Boolean,
  persisted: Boolean,
  // 普通入场钩子。
  onBeforeEnter: TransitionHookValidator,
  onEnter: TransitionHookValidator,
  onAfterEnter: TransitionHookValidator,
  onEnterCancelled: TransitionHookValidator,
  // 普通离场钩子。
  onBeforeLeave: TransitionHookValidator,
  onLeave: TransitionHookValidator,
  onAfterLeave: TransitionHookValidator,
  onLeaveCancelled: TransitionHookValidator,
  // 首次入场钩子。
  onBeforeAppear: TransitionHookValidator,
  onAppear: TransitionHookValidator,
  onAfterAppear: TransitionHookValidator,
  onAppearCancelled: TransitionHookValidator,
}

/** 沿组件子树向下取得最终渲染根节点，供切换判断排除注释占位树。 */
const recursiveGetSubtree = (instance: ComponentInternalInstance): VNode => {
  const subTree = instance.subTree
  return subTree.component ? recursiveGetSubtree(subTree.component) : subTree
}

/**
 * 平台无关的过渡组件实现。
 *
 * 每次渲染会提取唯一有效子节点，为新旧节点解析钩子，再根据 mode 决定：
 * 默认模式直接交叉切换；`out-in` 先返回占位符；`in-out` 则延迟旧节点离场。
 */
const BaseTransitionImpl: ComponentOptions = {
  name: `BaseTransition`,

  props: BaseTransitionPropsValidators,

  /** 把单个默认插槽节点与前次内部子树比较，安装新旧过渡钩子，并按 out-in/in-out 协调占位、延迟离场和 KeepAlive 外壳。 */
  setup(props: BaseTransitionProps, { slots }: SetupContext) {
    const instance = getCurrentInstance()!
    const state = useTransitionState()

    return () => {
      const children =
        slots.default && getTransitionRawChildren(slots.default(), true)
      const child =
        children && children.length
          ? findNonCommentChild(children)
          : // 显式默认插槽条件分支也要走和 v-if 相同的过渡路径；
            // v-if 的空分支会生成注释节点，因此这里也生成注释占位符。
            instance.subTree
            ? createCommentVNode()
            : undefined
      if (!child) {
        return
      }

      // 这里只在渲染时读取 props，不需要为每个属性建立依赖；使用原始对象可减少
      // 代理访问开销，也避免过渡控制逻辑意外成为响应式依赖。
      const rawProps = toRaw(props)
      const { mode } = rawProps
      // mode 拼写错误会破坏新旧节点的切换顺序，仅在开发环境提示。
      if (
        __DEV__ &&
        mode &&
        mode !== 'in-out' &&
        mode !== 'out-in' &&
        mode !== 'default'
      ) {
        warn(`invalid <transition> mode: ${mode}`)
      }

      if (state.isLeaving) {
        return emptyPlaceholder(child)
      }

      // `<transition><keep-alive /></transition>` 外层 VNode 类型始终是 KeepAlive，
      // 真正需要比较的是其当前缓存子节点，否则页面切换不会触发过渡。
      const innerChild = getInnerChild(child)
      if (!innerChild) {
        return emptyPlaceholder(child)
      }

      let enterHooks = resolveTransitionHooks(
        innerChild,
        rawProps,
        state,
        instance,
        // #11061：Suspense 等分支会 clone 过渡钩子。克隆后必须把闭包中的
        // 普通入场钩子。Hooks 指向新对象，否则 in-out 模式会把 delayedLeave 写到旧钩子上，
        // 新分支入场完成后便无法启动旧分支的离场。
        hooks => (enterHooks = hooks),
      )

      if (innerChild.type !== Comment) {
        setTransitionHooks(innerChild, enterHooks)
      }

      let oldInnerChild = instance.subTree && getInnerChild(instance.subTree)

      // 只有新旧内部节点类型/key 不同，且当前真实子树不是注释占位符时才切换。
      if (
        oldInnerChild &&
        oldInnerChild.type !== Comment &&
        !isSameVNodeType(oldInnerChild, innerChild) &&
        recursiveGetSubtree(instance).type !== Comment
      ) {
        let leavingHooks = resolveTransitionHooks(
          oldInnerChild,
          rawProps,
          state,
          instance,
        )
        // transition props 可能动态变化，旧树离场前也必须换成当前这次解析的钩子。
        setTransitionHooks(oldInnerChild, leavingHooks)
        // out-in：先让旧视图离场，这一轮只渲染占位；离场完成后主动触发更新，
        // 下一轮才挂载新视图，保证两者不会同时显示。
        if (mode === 'out-in' && innerChild.type !== Comment) {
          state.isLeaving = true
          // 返回占位节点，并在旧节点离场完成时排队更新。
          /** out-in 旧树离场后清 isLeaving，未销毁时触发组件更新，再删除自身与旧分支引用，允许下一轮挂新树。 */
          leavingHooks.afterLeave = () => {
            state.isLeaving = false
            // #6835：不能再以“effect 是否 active”判断能否更新，因为组件被 KeepAlive
            // 停用时 effect 仍可能需要恢复切换。这里只排除已经正式销毁的 job。
            if (!(instance.job.flags! & SchedulerJobFlags.DISPOSED)) {
              instance.update()
            }
            delete leavingHooks.afterLeave
            oldInnerChild = undefined
          }
          return emptyPlaceholder(child)
        } else if (mode === 'in-out' && innerChild.type !== Comment) {
          /** in-out 延迟旧树移除；登记离场缓存和 earlyRemove，并把正常启动离场交给新树 enter 完成。 */
          leavingHooks.delayLeave = (
            el: TransitionElement,
            earlyRemove,
            delayedLeave,
          ) => {
            const leavingVNodesCache = getLeavingNodesForType(
              state,
              oldInnerChild!,
            )
            leavingVNodesCache[String(oldInnerChild!.key)] = oldInnerChild!
            // in-out：新节点先入场，旧节点延迟离场。若等待期间又切换一次，
            // earlyRemove 可立即清走旧节点；正常路径则由 delayedLeave 启动离场。
            /** 等待新树入场期间被再次切换时提前移除旧树，并清元素回调、delayedLeave 与旧 VNode 引用。 */
            el[leaveCbKey] = () => {
              earlyRemove()
              el[leaveCbKey] = undefined
              delete enterHooks.delayedLeave
              oldInnerChild = undefined
            }
            /** 新树入场结束后启动旧树离场，随后删除延迟钩子和旧分支引用。 */
            enterHooks.delayedLeave = () => {
              delayedLeave()
              delete enterHooks.delayedLeave
              oldInnerChild = undefined
            }
          }
        } else {
          oldInnerChild = undefined
        }
      } else if (oldInnerChild) {
        oldInnerChild = undefined
      }

      return child
    }
  },
}

if (__COMPAT__) {
  BaseTransitionImpl.__isBuiltIn = true
}

/**
 * 从默认插槽中取得唯一的非注释子节点。
 * `<Transition>` 只管理单个节点；开发环境会继续扫描并提示多根节点，生产环境
 * 找到首个有效节点即可退出，以免为错误用法付出额外遍历成本。
 */
function findNonCommentChild(children: VNode[]): VNode {
  let child: VNode = children[0]
  if (children.length > 1) {
    let hasFound = false
    // v-if 的空分支会产生注释 VNode，它不算实际过渡目标。
    for (const c of children) {
      if (c.type !== Comment) {
        if (__DEV__ && hasFound) {
          // 第二个有效节点无法共享一套进入/离开状态，应改用 TransitionGroup。
          warn(
            '<transition> can only be used on a single element or component. ' +
              'Use <transition-group> for lists.',
          )
          break
        }
        child = c
        hasFound = true
        if (!__DEV__) break
      }
    }
  }
  return child
}

/**
 * 暴露给 `h()`/TSX 推导的公共组件类型。
 * 显式写出构造签名还能避免生成的 d.ts 出现难以阅读的内联 `import()` 类型。
 */
export const BaseTransition = BaseTransitionImpl as unknown as {
  /** 仅供 h/TSX 推导 BaseTransition props/slots 的虚拟构造签名。 */
  new (): {
    /** 平台无关过渡配置，运行时对象通过 props 校验消费。 */
    $props: BaseTransitionProps<any>
    /** 单根默认插槽的公共类型协议。 */
    $slots: {
      /** 返回待过渡的 VNode 列表；实现会提取唯一有效非注释节点。 */
      default(): VNode[]
    }
  }
}

/**
 * 取得某种 VNode 类型的“正在离场”缓存。
 * 第二层以 key 索引，从而区分同一组件类型在列表中的不同实例。
 */
function getLeavingNodesForType(
  state: TransitionState,
  vnode: VNode,
): Record<string, VNode> {
  const { leavingVNodes } = state
  let leavingVNodesCache = leavingVNodes.get(vnode.type)!
  if (!leavingVNodesCache) {
    leavingVNodesCache = Object.create(null)
    leavingVNodes.set(vnode.type, leavingVNodesCache)
  }
  return leavingVNodesCache
}

/**
 * 把组件 props 中的用户钩子解析为渲染器可调用的 `TransitionHooks`。
 *
 * 返回对象会挂到 `vnode.transition`，渲染器在插入、移动和移除节点的准确时机
 * 调用它。函数还负责 appear 回退、异步 done 回调、快速反向切换时的取消，以及
 * 相同 type/key 节点的离场去重。
 */
export function resolveTransitionHooks(
  vnode: VNode,
  props: BaseTransitionProps<any>,
  state: TransitionState,
  instance: ComponentInternalInstance,
  postClone?: (hooks: TransitionHooks) => void,
): TransitionHooks {
  const {
    appear,
    mode,
    persisted = false,
    onBeforeEnter,
    onEnter,
    onAfterEnter,
    onEnterCancelled,
    onBeforeLeave,
    onLeave,
    onAfterLeave,
    onLeaveCancelled,
    onBeforeAppear,
    onAppear,
    onAfterAppear,
    onAppearCancelled,
  } = props
  const key = String(vnode.key)
  const leavingVNodesCache = getLeavingNodesForType(state, vnode)

  // 所有用户代码都经过统一错误处理，这样异常能进入组件 errorCaptured/app handler。
  /** 在组件上下文调用单个/数组用户钩子，异常交给 TRANSITION_HOOK 错误通道。 */
  const callHook: TransitionHookCaller = (hook, args) => {
    hook &&
      callWithAsyncErrorHandling(
        hook,
        instance,
        ErrorCodes.TRANSITION_HOOK,
        args,
      )
  }

  /**
   * 调用可能由用户通过 `done` 手动结束的钩子。
   * 函数声明参数不超过一个，表示没有接收 done，Vue 可立即完成；数组中则要求
   * 所有钩子都未接收 done 才能自动完成。
   */
  const callAsyncHook = (
    hook: Hook<(el: any, done: () => void) => void>,
    args: [TransitionElement, () => void],
  ) => {
    const done = args[1]
    callHook(hook, args)
    if (isArray(hook)) {
      if (hook.every(hook => hook.length <= 1)) done()
    } else if (hook.length <= 1) {
      done()
    }
  }

  const hooks: TransitionHooks<TransitionElement> = {
    mode,
    persisted,
    /** 按 mounted/appear 选择用户起态钩子；取消同元素旧 leave，强制完成同 type/key 旧副本后再准备入场。 */
    beforeEnter(el) {
      let hook = onBeforeEnter
      if (!state.isMounted) {
        if (appear) {
          hook = onBeforeAppear || onBeforeEnter
        } else {
          return
        }
      }
      // v-show 操作同一个元素：开始入场前先取消尚未完成的离场。
      if (el[leaveCbKey]) {
        el[leaveCbKey](true /* 取消 */)
      }
      // v-if 可能创建相同 type/key 的新元素：旧副本若仍在离场，必须提前真正移除；
      // 此处不是“取消离场”，因此不传 cancelled，仍会触发 onAfterLeave。
      const leavingVNode = leavingVNodesCache[key]
      if (
        leavingVNode &&
        isSameVNodeType(vnode, leavingVNode) &&
        (leavingVNode.el as TransitionElement)[leaveCbKey]
      ) {
        // 同 type/key 的旧副本提前完成移除，按 afterLeave 结算。
        ;(leavingVNode.el as TransitionElement)[leaveCbKey]!()
      }
      callHook(hook, [el])
    },

    /** 跳过仍在离场缓存中的同 VNode（HMR 除外），创建幂等完成器；自然/取消分别通知，结束后启动 delayedLeave 并清空 enter 回调。 */
    enter(el) {
      // 同一个 VNode 已进入离场缓存时，普通更新不得又启动入场；HMR 替换树是例外，
      // 因为开发态需要让重载后的节点恢复到正确显示状态。
      if (!isHmrUpdating && leavingVNodesCache[key] === vnode) return
      let hook = onEnter
      let afterHook = onAfterEnter
      let cancelHook = onEnterCancelled
      if (!state.isMounted) {
        if (appear) {
          hook = onAppear || onEnter
          afterHook = onAfterAppear || onAfterEnter
          cancelHook = onAppearCancelled || onEnterCancelled
        } else {
          return
        }
      }
      let called = false
      // 将幂等完成器挂在元素上，使 leave/v-show 能中断尚未完成的 enter。
      /** 幂等入场完成器：区分自然/取消回调，启动 in-out 延迟离场，最后释放元素回调。 */
      el[enterCbKey] = (cancelled?) => {
        if (called) return
        called = true
        if (cancelled) {
          callHook(cancelHook, [el])
        } else {
          callHook(afterHook, [el])
        }
        if (hooks.delayedLeave) {
          // in-out 模式下，新节点入场完成后才允许旧节点开始离场。
          hooks.delayedLeave()
        }
        el[enterCbKey] = undefined
      }
      const done = el[enterCbKey]!.bind(null, false)
      if (hook) {
        callAsyncHook(hook, [el, done])
      } else {
        done()
      }
    },

    /** 取消尚未完成的 enter；整体卸载立即 remove，否则把 VNode 登记到离场缓存并用幂等 done 执行 remove、钩子和缓存清理。 */
    leave(el, remove) {
      const key = String(vnode.key)
      if (el[enterCbKey]) {
        el[enterCbKey](true /* 取消 */)
      }
      if (state.isUnmounting) {
        // 整棵组件树卸载时无需等待动画，否则父容器可能已删除而回调仍悬空。
        return remove()
      }
      callHook(onBeforeLeave, [el])
      let called = false
      /** 幂等离场完成器：先执行 remove，再调用自然/取消钩子，清元素回调并只删除仍属于本 VNode 的离场缓存。 */
      el[leaveCbKey] = (cancelled?) => {
        if (called) return
        called = true
        remove()
        if (cancelled) {
          callHook(onLeaveCancelled, [el])
        } else {
          callHook(onAfterLeave, [el])
        }
        el[leaveCbKey] = undefined
        if (leavingVNodesCache[key] === vnode) {
          delete leavingVNodesCache[key]
        }
      }
      const done = el[leaveCbKey]!.bind(null, false)
      leavingVNodesCache[key] = vnode
      if (onLeave) {
        callAsyncHook(onLeave, [el, done])
      } else {
        done()
      }
    },

    /** 对新 VNode 重新解析钩子并通知 postClone，使 in-out 闭包引用跟随新对象。 */
    clone(vnode) {
      // 每个克隆分支需要独立回调状态，不能共享同一个 hooks 对象。
      const hooks = resolveTransitionHooks(
        vnode,
        props,
        state,
        instance,
        postClone,
      )
      if (postClone) postClone(hooks)
      return hooks
    },
  }

  return hooks
}

/**
 * 为离场阶段生成占位节点，目前专门处理 KeepAlive。
 *
 * 若直接返回空节点，渲染器会卸载 KeepAlive 实例及其缓存；克隆外壳并清空 children
 * 则能保住缓存容器，只让当前活动内容暂时消失。
 */
function emptyPlaceholder(vnode: VNode): VNode | undefined {
  if (isKeepAlive(vnode)) {
    vnode = cloneVNode(vnode)
    vnode.children = null
    return vnode
  }
}

/**
 * 取得 Transition 真正应控制的内部节点。
 *
 * 普通 VNode 原样返回；Teleport 选择其唯一有效子节点；KeepAlive 则深入当前缓存
 * 子树。后两者的外壳类型不会随页面内容变化，若只比较外壳会漏掉实际视图切换。
 */
export function getInnerChild(vnode: VNode): VNode | undefined {
  if (!isKeepAlive(vnode)) {
    if (isTeleport(vnode.type) && vnode.children) {
      return findNonCommentChild(vnode.children as VNode[])
    }

    return vnode
  }
  // #7121/#12465：KeepAlive 已挂载后应直接读取组件 subTree。仅从原始 children
  // 推断会在插槽更新、缓存恢复或异步组件解析后拿到旧 VNode，导致钩子挂错节点。
  if (vnode.component) {
    return vnode.component.subTree
  }

  const { shapeFlag, children } = vnode

  if (children) {
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      return (children as VNodeArrayChildren)[0] as VNode
    }

    if (
      shapeFlag & ShapeFlags.SLOTS_CHILDREN &&
      isFunction((children as any).default)
    ) {
      return (children as any).default()
    }
  }
}

/**
 * 将过渡钩子递归安装到实际会被渲染器挂载/卸载的 VNode 上。
 * 组件需继续下钻到 subTree；Suspense 的 content/fallback 两个分支各自克隆一份，
 * 避免分支切换时共享完成回调；Teleport 则安装到其内部有效节点。
 */
export function setTransitionHooks(vnode: VNode, hooks: TransitionHooks): void {
  if (vnode.shapeFlag & ShapeFlags.COMPONENT && vnode.component) {
    vnode.transition = hooks
    const subTree = vnode.component.subTree
    setTransitionHooks(
      isTeleport(subTree.type) ? getInnerChild(subTree) || subTree : subTree,
      hooks,
    )
  } else if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    vnode.ssContent!.transition = hooks.clone(vnode.ssContent!)
    vnode.ssFallback!.transition = hooks.clone(vnode.ssFallback!)
  } else {
    vnode.transition = hooks
  }
}

/**
 * 展平 Transition 插槽中的 Fragment，得到可参与过渡判断的原始子节点列表。
 *
 * 编译器会为 `template v-for`、条件分支生成 Fragment。这里递归展平并合成父子 key，
 * 保证列表项在跨层级移动时仍可稳定识别；注释节点是否保留由 `keepComment` 决定。
 */
export function getTransitionRawChildren(
  children: VNode[],
  keepComment: boolean = false,
  parentKey?: VNode['key'],
): VNode[] {
  let ret: VNode[] = []
  let keyedFragmentCount = 0
  for (let i = 0; i < children.length; i++) {
    let child = children[i]
    // #5360：`<template v-for>` 的子节点 key 只在各自 Fragment 内唯一。继承并拼接
    // 父 key，避免多个 Fragment 展平后发生 key 冲突、复用到错误的 DOM。
    const key =
      parentKey == null
        ? child.key
        : String(parentKey) + String(child.key != null ? child.key : i)
    // v-for 等场景会产生 Fragment，需要递归展平后才能判断真实子节点。
    if (child.type === Fragment) {
      if (child.patchFlag & PatchFlags.KEYED_FRAGMENT) keyedFragmentCount++
      ret = ret.concat(
        getTransitionRawChildren(child.children as VNode[], keepComment, key),
      )
    }
    // 默认跳过 v-if 空分支的注释占位；BaseTransition 主流程可要求保留它。
    else if (keepComment || child.type !== Comment) {
      ret.push(key != null ? cloneVNode(child, { key }) : child)
    }
  }
  // #1126：若插槽含多个 keyed Fragment，展平后会丢失每个 Fragment 各自的动态
  // children 边界，而不同 v-for 分支内部可能有不同的静态绑定。此时将 patchFlag
  // 设为 BAIL，放弃块级优化并强制完整 diff，避免错误复用静态节点。
  if (keyedFragmentCount > 1) {
    for (let i = 0; i < ret.length; i++) {
      ret[i].patchFlag = PatchFlags.BAIL
    }
  }
  return ret
}
