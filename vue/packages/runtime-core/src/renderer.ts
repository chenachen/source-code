import {
  Comment,
  Fragment,
  Static,
  Text,
  type VNode,
  type VNodeArrayChildren,
  type VNodeHook,
  type VNodeProps,
  cloneIfMounted,
  createVNode,
  invokeVNodeHook,
  isSameVNodeType,
  normalizeVNode,
} from './vnode'
import {
  type ComponentInternalInstance,
  type ComponentOptions,
  type Data,
  type LifecycleHook,
  createComponentInstance,
  setupComponent,
} from './component'
import {
  filterSingleRoot,
  renderComponentRoot,
  shouldUpdateComponent,
  updateHOCHostEl,
} from './componentRenderUtils'
import {
  EMPTY_ARR,
  EMPTY_OBJ,
  NOOP,
  PatchFlags,
  ShapeFlags,
  def,
  getGlobalThis,
  invokeArrayFns,
  isArray,
  isReservedProp,
} from '@vue/shared'
import {
  type SchedulerJob,
  SchedulerJobFlags,
  type SchedulerJobs,
  flushPostFlushCbs,
  flushPreFlushCbs,
  queueJob,
  queuePostFlushCb,
} from './scheduler'
import {
  EffectFlags,
  ReactiveEffect,
  pauseTracking,
  resetTracking,
} from '@vue/reactivity'
import { updateProps } from './componentProps'
import { updateSlots } from './componentSlots'
import { popWarningContext, pushWarningContext, warn } from './warning'
import { type CreateAppFunction, createAppAPI } from './apiCreateApp'
import { setRef } from './rendererTemplateRef'
import {
  type SuspenseBoundary,
  type SuspenseImpl,
  isSuspense,
  queueEffectWithSuspense,
} from './components/Suspense'
import {
  TeleportEndKey,
  type TeleportImpl,
  type TeleportVNode,
} from './components/Teleport'
import { type KeepAliveContext, isKeepAlive } from './components/KeepAlive'
import {
  isHmrUpdating,
  registerHMR,
  setHmrUpdating,
  unregisterHMR,
} from './hmr'
import { type RootHydrateFunction, createHydrationFunctions } from './hydration'
import { invokeDirectiveHook } from './directives'
import { endMeasure, startMeasure } from './profiling'
import {
  devtoolsComponentAdded,
  devtoolsComponentRemoved,
  devtoolsComponentUpdated,
  setDevtoolsHook,
} from './devtools'
import { initFeatureFlags } from './featureFlags'
import { isAsyncWrapper } from './apiAsyncComponent'
import { isCompatEnabled } from './compat/compatConfig'
import { DeprecationTypes } from './compat/compatConfig'
import { type TransitionHooks, leaveCbKey } from './components/BaseTransition'
import type { ComponentCustomElementInterface } from './component'

/** 不含水合能力的渲染器公开接口。 */
export interface Renderer<HostElement = RendererElement> {
  /** 把 VNode 树渲染/更新到宿主容器；传 null 会卸载容器当前树。 */
  render: RootRenderFunction<HostElement>
  /** 创建绑定该渲染器的应用实例。 */
  createApp: CreateAppFunction<HostElement>
}

/** DOM 专用的可水合渲染器；在普通 render/createApp 之外暴露 hydrate。 */
export interface HydrationRenderer extends Renderer<Element | ShadowRoot> {
  hydrate: RootHydrateFunction
}

/** 当前元素所在命名空间；undefined 表示普通 HTML/宿主默认空间。 */
export type ElementNamespace = 'svg' | 'mathml' | undefined

/** 根渲染函数签名。容器会保存上次 VNode，以便后续调用执行增量 patch。 */
export type RootRenderFunction<HostElement = RendererElement> = (
  vnode: VNode | null,
  container: HostElement,
  namespace?: ElementNamespace,
) => void

/**
 * 平台渲染器必须提供的宿主操作集合。
 *
 * runtime-core 只操作抽象 HostNode，从不直接访问 DOM；runtime-dom、runtime-test 或
 * 自定义渲染器通过这些函数决定节点如何创建、插入、删除及设置属性。
 */
export interface RendererOptions<
  HostNode = RendererNode,
  HostElement = RendererElement,
> {
  /** 更新一个宿主元素属性、DOM property 或事件。 */
  patchProp(
    el: HostElement,
    key: string,
    prevValue: any,
    nextValue: any,
    namespace?: ElementNamespace,
    parentComponent?: ComponentInternalInstance | null,
  ): void
  /** 在 parent 的 anchor 前插入或移动节点；anchor 为空表示追加。 */
  insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
  /** 从宿主树移除节点。 */
  remove(el: HostNode): void
  /** 创建指定标签、命名空间及自定义内置类型的宿主元素。 */
  createElement(
    type: string,
    namespace?: ElementNamespace,
    isCustomizedBuiltIn?: string,
    vnodeProps?: (VNodeProps & { [key: string]: any }) | null,
  ): HostElement
  /** 创建宿主文本节点。 */
  createText(text: string): HostNode
  /** 创建宿主注释节点。 */
  createComment(text: string): HostNode
  /** 更新文本节点内容。 */
  setText(node: HostNode, text: string): void
  /** 以纯文本替换元素全部子节点。 */
  setElementText(node: HostElement, text: string): void
  /** 查询宿主父元素。 */
  parentNode(node: HostNode): HostElement | null
  /** 查询下一个宿主兄弟节点。 */
  nextSibling(node: HostNode): HostNode | null
  /** Teleport 解析字符串目标时使用；不支持选择器的平台可省略。 */
  querySelector?(selector: string): HostElement | null
  /** 给元素写入 SFC scopeId。 */
  setScopeId?(el: HostElement, id: string): void
  /** 克隆宿主节点的可选优化能力。 */
  cloneNode?(node: HostNode): HostNode
  /** 一次插入编译器字符串化的静态内容，并返回实际首尾节点。 */
  insertStaticContent?(
    content: string,
    parent: HostElement,
    anchor: HostNode | null,
    namespace: ElementNamespace,
    start?: HostNode | null,
    end?: HostNode | null,
  ): [HostNode, HostNode]
}

// 核心渲染器从不直接操作宿主节点，只把它传回 options 中的宿主函数。因此节点在技术
// 上可以是任何对象，而不限于 DOM Node；索引签名也容纳 __vnode 等开发内部标记。
export interface RendererNode {
  [key: string | symbol]: any
}

/** 可作为 children 容器的宿主节点。核心层不额外约束，由平台保证语义。 */
export interface RendererElement extends RendererNode {}

/**
 * 暴露给 Teleport、Suspense、KeepAlive、水合等可 tree-shaking 特性的渲染器内部能力。
 * 这些能力与主文件解耦，未使用的内置特性可被打包器删除；字段用短键减小生产体积。
 */
export interface RendererInternals<
  HostNode = RendererNode,
  HostElement = RendererElement,
> {
  p: PatchFn
  um: UnmountFn
  r: RemoveFn
  m: MoveFn
  mt: MountComponentFn
  mc: MountChildrenFn
  pc: PatchChildrenFn
  pbc: PatchBlockChildrenFn
  n: NextFn
  o: RendererOptions<HostNode, HostElement>
}

// 下列函数在 baseCreateRenderer 闭包内创建，无法从实现直接导出类型。签名单独声明并
// 让闭包实现引用，避免内部组件各自复制一份易漂移的参数定义。
/** 递归协调任意新旧 VNode 的挂载、更新或替换。 */
type PatchFn = (
  n1: VNode | null, // null 表示首次挂载。
  n2: VNode,
  container: RendererElement,
  anchor?: RendererNode | null,
  parentComponent?: ComponentInternalInstance | null,
  parentSuspense?: SuspenseBoundary | null,
  namespace?: ElementNamespace,
  slotScopeIds?: string[] | null,
  optimized?: boolean,
) => void

/** 标准化并挂载一段 children。 */
type MountChildrenFn = (
  children: VNodeArrayChildren,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
  start?: number,
) => void

/** 根据新旧 children 的 shapeFlag/patchFlag 选择文本、数组或空节点更新策略。 */
type PatchChildrenFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
) => void

/** 按相同索引 patch 编译器收集的定长动态 children。 */
type PatchBlockChildrenFn = (
  oldChildren: VNode[],
  newChildren: VNode[],
  fallbackContainer: RendererElement,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
) => void

/** 将 VNode 对应的一个或多个宿主节点移动到新容器/锚点。 */
type MoveFn = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  type: MoveType,
  parentSuspense?: SuspenseBoundary | null,
) => void

/** 返回整个 VNode 宿主范围之后的首个节点。 */
type NextFn = (vnode: VNode) => RendererNode | null

/** 卸载 VNode 的生命周期、响应式副作用和子树，可选同时移除宿主节点。 */
type UnmountFn = (
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean,
) => void

/** 只处理宿主节点移除与离场过渡；组件清理由 unmount 负责。 */
type RemoveFn = (vnode: VNode) => void

/** 批量卸载 children，可从指定下标开始。 */
type UnmountChildrenFn = (
  children: VNode[],
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean,
  start?: number,
) => void

/** 创建组件实例、执行 setup，并建立组件渲染 effect。 */
export type MountComponentFn = (
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  optimized: boolean,
) => void

/** 文本/注释节点共享的挂载更新函数签名。 */
type ProcessTextOrCommentFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
) => void

/** 建立组件响应式渲染 effect，并立即完成首次 render/patch 或 hydrate。 */
export type SetupRenderEffectFn = (
  instance: ComponentInternalInstance,
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  optimized: boolean,
) => void

/** 节点移动原因；过渡只响应 ENTER/LEAVE，列表 REORDER 不应触发进出动画。 */
export enum MoveType {
  /** 从缓存/隐藏容器进入活动树。 */
  ENTER,
  /** 离开活动树进入缓存/隐藏容器。 */
  LEAVE,
  /** 同一活动容器内因 keyed diff 重新排序。 */
  REORDER,
}

/**
 * 提交后 effect 的统一入队入口。
 * 有 Suspense 时，未决分支的钩子先缓存在边界，分支 resolve 后再进入 post 队列。
 */
export const queuePostRenderEffect: (
  fn: SchedulerJobs,
  suspense: SuspenseBoundary | null,
) => void = __FEATURE_SUSPENSE__
  ? __TEST__
    ? // Vitest 无法稳定处理这里的 eager 循环依赖，测试构建用一层惰性包装。
      (fn: Function | Function[], suspense: SuspenseBoundary | null) =>
        queueEffectWithSuspense(fn, suspense)
    : queueEffectWithSuspense
  : queuePostFlushCb

/**
 * 使用平台宿主操作创建一个不含水合代码的渲染器。
 *
 * 两个泛型 `HostNode` 与 `HostElement` 对应宿主环境的节点和容器类型。例如
 * runtime-dom 分别传 DOM `Node` 与 `Element`；自定义渲染器可传 Canvas 场景节点：
 *
 * ``` js
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 */
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement,
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement> {
  return baseCreateRenderer<HostNode, HostElement>(options)
}

/**
 * 创建带 SSR 水合能力的 DOM 渲染器。
 * 单独入口使只做客户端渲染的构建不会引用 hydration 模块，可被 tree-shaking 删除。
 */
export function createHydrationRenderer(
  options: RendererOptions<Node, Element>,
): HydrationRenderer {
  return baseCreateRenderer(options, createHydrationFunctions)
}

// 重载 1：任意宿主平台，不包含 hydration。
function baseCreateRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement,
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement>

// 重载 2：DOM 宿主并注入 hydration 函数工厂。
function baseCreateRenderer(
  options: RendererOptions<Node, Element>,
  createHydrationFns: typeof createHydrationFunctions,
): HydrationRenderer

/**
 * 创建渲染器闭包的共享实现。
 * 所有递归 patch 函数共享同一组宿主操作与内部能力，既避免层层传递 options，也让
 * Teleport/Suspense 只拿到必要的紧凑 internals。
 */
function baseCreateRenderer(
  options: RendererOptions,
  createHydrationFns?: typeof createHydrationFunctions,
): any {
  // 推迟到实际创建渲染器时初始化特性开关，保持“只导入 runtime-core”无副作用。
  if (__ESM_BUNDLER__ && !__TEST__) {
    initFeatureFlags()
  }

  const target = getGlobalThis()
  target.__VUE__ = true
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    setDevtoolsHook(target.__VUE_DEVTOOLS_GLOBAL_HOOK__, target)
  }

  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    insertStaticContent: hostInsertStaticContent,
  } = options

  // 闭包内函数刻意写成 `const xxx = () => {}`，避免压缩器内联超大递归函数，造成包体
  // 膨胀或破坏各可选特性共享同一函数引用。
  /**
   * patch 总分派入口：先处理身份替换/优化降级，再按 type 或 shapeFlag 进入专用流程。
   * 完成节点提交后统一维护模板 ref。
   */
  const patch: PatchFn = (
    n1,
    n2,
    container,
    anchor = null,
    parentComponent = null,
    parentSuspense = null,
    namespace = undefined,
    slotScopeIds = null,
    optimized = __DEV__ && isHmrUpdating ? false : !!n2.dynamicChildren,
  ) => {
    if (n1 === n2) {
      return
    }

    // type 或 key 不同不能就地复用；先记录旧范围后的锚点，再完整卸载旧树并按挂载处理。
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, parentComponent, parentSuspense, true)
      n1 = null
    }

    if (n2.patchFlag === PatchFlags.BAIL) {
      // BAIL 表示编译优化元数据不可信（常见于手写/异常插槽），清空 block 快路径。
      optimized = false
      n2.dynamicChildren = null
    }

    const { type, ref, shapeFlag } = n2
    switch (type) {
      case Text:
        processText(n1, n2, container, anchor)
        break
      case Comment:
        processCommentNode(n1, n2, container, anchor)
        break
      case Static:
        if (n1 == null) {
          mountStaticNode(n2, container, anchor, namespace)
        } else if (__DEV__) {
          patchStaticNode(n1, n2, container, namespace)
        }
        break
      case Fragment:
        processFragment(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          processComponent(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          ;(type as typeof TeleportImpl).process(
            n1 as TeleportVNode,
            n2 as TeleportVNode,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
            internals,
          )
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          ;(type as typeof SuspenseImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
            internals,
          )
        } else if (__DEV__) {
          warn('Invalid VNode type:', type, `(${typeof type})`)
        }
    }

    // 宿主/组件处理完成后再更新 ref，此时 n2.el/component 已经可用。
    if (ref != null && parentComponent) {
      setRef(ref, n1 && n1.ref, parentSuspense, n2 || n1, !n2)
    } else if (ref == null && n1 && n1.ref != null) {
      setRef(n1.ref, null, parentSuspense, n1, true)
    }
  }

  /** 挂载文本节点，或复用旧宿主节点并仅在内容变化时更新文本。 */
  const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor,
      )
    } else {
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  /**
   * 挂载注释节点。编译产物不会动态修改注释文本，更新时只传递旧宿主引用。
   */
  const processCommentNode: ProcessTextOrCommentFn = (
    n1,
    n2,
    container,
    anchor,
  ) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateComment((n2.children as string) || '')),
        container,
        anchor,
      )
    } else {
      // 注释只充当结构占位/锚点，不支持动态文本，避免无意义的宿主更新分支。
      n2.el = n1.el
    }
  }

  /** 一次性插入编译器字符串化的静态 HTML，并记录首尾宿主节点。 */
  const mountStaticNode = (
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    namespace: ElementNamespace,
  ) => {
    // Static VNode 只由 compiler-dom/runtime-dom 生成，该组合保证提供静态内容插入能力。
    ;[n2.el, n2.anchor] = hostInsertStaticContent!(
      n2.children as string,
      container,
      anchor,
      namespace,
      n2.el,
      n2.anchor,
    )
  }

  /** 开发/HMR 下静态字符串变化时，替换整段静态宿主节点。 */
  const patchStaticNode = (
    n1: VNode,
    n2: VNode,
    container: RendererElement,
    namespace: ElementNamespace,
  ) => {
    // 生产模板静态内容恒定；只有开发 HMR 可能让同一位置的字符串发生变化。
    if (n2.children !== n1.children) {
      const anchor = hostNextSibling(n1.anchor!)
      // 先删旧范围，再在原范围后的锚点前插入新内容。
      removeStaticNode(n1)
      ;[n2.el, n2.anchor] = hostInsertStaticContent!(
        n2.children as string,
        container,
        anchor,
        namespace,
      )
    } else {
      n2.el = n1.el
      n2.anchor = n1.anchor
    }
  }

  /** 将 Static VNode 的首尾范围逐节点移动到新位置。 */
  const moveStaticNode = (
    { el, anchor }: VNode,
    container: RendererElement,
    nextSibling: RendererNode | null,
  ) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostInsert(el, container, nextSibling)
      el = next
    }
    hostInsert(anchor!, container, nextSibling)
  }

  /** 删除 Static VNode 对应的完整宿主节点范围。 */
  const removeStaticNode = ({ el, anchor }: VNode) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostRemove(el)
      el = next
    }
    hostRemove(anchor!)
  }

  /**
   * 处理原生元素 VNode，并在进入 svg/mathml 根时切换命名空间。
   * 自定义元素 patch 用 begin/end 包裹，使它能区分 Vue 内部属性反射与外部属性变化。
   */
  const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    if (n2.type === 'svg') {
      namespace = 'svg'
    } else if (n2.type === 'math') {
      namespace = 'mathml'
    }

    if (n1 == null) {
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
      )
    } else {
      const customElement =
        n1.el && (n1.el as ComponentCustomElementInterface)._isVueCE
          ? (n1.el as ComponentCustomElementInterface)
          : null
      try {
        if (customElement) {
          customElement._beginPatch()
        }
        patchElement(
          n1,
          n2,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
      } finally {
        if (customElement) {
          customElement._endPatch()
        }
      }
    }
  }

  /**
   * 创建并提交一个原生宿主元素。
   *
   * 顺序不可随意调整：先挂 children，再设置依赖子内容的 props；执行 created/scopeId/
   * props/beforeMount 后才插入；mounted、transition enter 和指令 mounted 延迟到提交后。
   */
  const mountElement = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    const { props, shapeFlag, transition, dirs } = vnode

    el = vnode.el = hostCreateElement(
      vnode.type as string,
      namespace,
      props && props.is,
      props,
    )

    // 先挂 children，因为 `<select value>` 等 DOM property 的赋值依赖 option 已经存在。
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      hostSetElementText(el, vnode.children as string)
    } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      mountChildren(
        vnode.children as VNodeArrayChildren,
        el,
        null,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(vnode, namespace),
        slotScopeIds,
        optimized,
      )
    }

    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, 'created')
    }
    // 写入当前 SFC、插槽调用方及组件根继承的 scopeId。
    setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent)
    // `value` 之外的 props 先应用；保留项 key/ref/VNode 钩子不交给宿主层。
    if (props) {
      for (const key in props) {
        if (key !== 'value' && !isReservedProp(key)) {
          hostPatchProp(el, key, null, props[key], namespace, parentComponent)
        }
      }
      /**
       * DOM `value` 特判：
       * - #2325/#4024：它有赋值顺序要求，例如 input value 应在 min/max 后设置；
       * - #1471：即使新旧值相等也可能需要强制同步宿主当前值（用户可直接改 DOM）。
       * #2353 曾建议增加渲染器配置，但受影响属性很少，在核心层固定最后设置能降低宿主
       * 接口复杂度；非 DOM 渲染器把 `value` 当普通键处理也不受影响。
       */
      if ('value' in props) {
        hostPatchProp(el, 'value', null, props.value, namespace)
      }
      if ((vnodeHook = props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHook, parentComponent, vnode)
      }
    }

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      def(el, '__vnode', vnode, true)
      def(el, '__vueParentComponent', parentComponent, true)
    }

    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
    }
    // #1583：位于未决 Suspense 分支时，enter 钩子必须等边界 resolve、节点真正进入活动
    // 容器后执行。#1689：边界已 resolve 时可按普通元素立即进入。
    const needCallTransitionHooks = needTransition(parentSuspense, transition)
    if (needCallTransitionHooks) {
      transition!.beforeEnter(el)
    }
    hostInsert(el, container, anchor)
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      needCallTransitionHooks ||
      dirs
    ) {
      const isHmr = __DEV__ && isHmrUpdating
      queuePostRenderEffect(() => {
        let prev
        if (__DEV__) prev = setHmrUpdating(isHmr)
        try {
          vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
          needCallTransitionHooks && transition!.enter(el)
          dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        } finally {
          if (__DEV__) setHmrUpdating(prev!)
        }
      }, parentSuspense)
    }
  }

  /**
   * 把当前节点需要的全部 SFC scopeId 写入宿主元素。
   *
   * 除自身和 slot scope 外，若节点是组件子树根，还要沿父组件根链继承父 VNode 的
   * scopeId；这样父 SFC 的 scoped 样式可以选中直接子组件根元素。
   */
  const setScopeId = (
    el: RendererElement,
    vnode: VNode,
    scopeId: string | null,
    slotScopeIds: string[] | null,
    parentComponent: ComponentInternalInstance | null,
  ) => {
    if (scopeId) {
      hostSetScopeId(el, scopeId)
    }
    if (slotScopeIds) {
      for (let i = 0; i < slotScopeIds.length; i++) {
        hostSetScopeId(el, slotScopeIds[i])
      }
    }
    if (parentComponent) {
      let subTree = parentComponent.subTree
      if (
        __DEV__ &&
        subTree.patchFlag > 0 &&
        subTree.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
      ) {
        subTree =
          filterSingleRoot(subTree.children as VNodeArrayChildren) || subTree
      }
      if (
        vnode === subTree ||
        (isSuspense(subTree.type) &&
          (subTree.ssContent === vnode || subTree.ssFallback === vnode))
      ) {
        const parentVNode = parentComponent.vnode
        setScopeId(
          el,
          parentVNode,
          parentVNode.scopeId,
          parentVNode.slotScopeIds,
          parentComponent.parent,
        )
      }
    }
  }

  /** 标准化并依次挂载 children；optimized 模式只做已挂载 VNode 的必要克隆。 */
  const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    namespace: ElementNamespace,
    slotScopeIds,
    optimized,
    start = 0,
  ) => {
    for (let i = start; i < children.length; i++) {
      const child = (children[i] = optimized
        ? cloneIfMounted(children[i] as VNode)
        : normalizeVNode(children[i]))
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
      )
    }
  }

  /**
   * 更新同类型原生元素。
   *
   * 优先使用 block dynamicChildren 与 patchFlag 快路径；元数据不可信或 HMR 时退回完整
   * children/props diff。beforeUpdate 在提交前同步执行，updated 延迟到提交后。
   */
  const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    const el = (n2.el = n1.el!)
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      el.__vnode = n2
    }
    let { patchFlag, dynamicChildren, dirs } = n2
    // #1426：用户 clone 编译 VNode 时旧节点可能已被提升为 FULL_PROPS。新 VNode 仍保留
    // 原编译 flag，因此必须合入旧 flag，不能错误走局部 props 快路径。
    patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    // beforeUpdate 钩子期间禁止组件 effect 自触发，避免提交前递归进入同一更新。
    parentComponent && toggleRecurse(parentComponent, false)
    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }
    parentComponent && toggleRecurse(parentComponent, true)

    if (
      // HMR 改变了模板结构，编译时 block 元数据不再可靠。
      (__DEV__ && isHmrUpdating) ||
      // #6385：旧 VNode 可能是用户包装的非同构 block。动态 children 长度不一致即说明
      // 索引不能一一对应，必须退回完整 diff。
      (dynamicChildren &&
        (!n1.dynamicChildren ||
          n1.dynamicChildren.length !== dynamicChildren.length))
    ) {
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    // #9135：从 innerHTML/textContent 切回 VNode children 时要先清空宿主文本；否则新
    // children 会追加在旧的直接内容之后，或浏览器保留已被覆盖的节点。
    if (
      (oldProps.innerHTML && newProps.innerHTML == null) ||
      (oldProps.textContent && newProps.textContent == null)
    ) {
      hostSetElementText(el, '')
    }

    if (dynamicChildren) {
      patchBlockChildren(
        n1.dynamicChildren!,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(n2, namespace),
        slotScopeIds,
      )
      if (__DEV__) {
        // HMR 完整更新需要让跳过的静态节点也继承宿主引用。
        traverseStaticChildren(n1, n2)
      }
    } else if (!optimized) {
      // 无可靠 block 信息，按 children 形态执行完整 diff。
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(n2, namespace),
        slotScopeIds,
        false,
      )
    }

    if (patchFlag > 0) {
      // 正 patchFlag 代表编译器生成且新旧位置同构，可只更新标出的动态部分。
      if (patchFlag & PatchFlags.FULL_PROPS) {
        // 动态 key 无法预知属性名，需要完整 props diff。
        patchProps(el, oldProps, newProps, parentComponent, namespace)
      } else {
        // CLASS：只比较/更新动态 class。
        if (patchFlag & PatchFlags.CLASS) {
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, 'class', null, newProps.class, namespace)
          }
        }

        // STYLE：宿主层负责对象/字符串 style 的增删。
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps.style, newProps.style, namespace)
        }

        // PROPS：只遍历编译器保存的动态 prop 名。`:[foo]` 的 key 自身动态，旧 key 还需
        // 删除，编译器会改标 FULL_PROPS 而不进入这里。
        if (patchFlag & PatchFlags.PROPS) {
          // PROPS 标志由编译器与 dynamicProps 成对生成，此处可非空断言。
          const propsToUpdate = n2.dynamicProps!
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i]
            const prev = oldProps[key]
            const next = newProps[key]
            // #1471：value 可能被用户直接修改，即使 VNode 新旧值相同也强制校正 DOM。
            if (next !== prev || key === 'value') {
              hostPatchProp(el, key, prev, next, namespace, parentComponent)
            }
          }
        }
      }

      // TEXT：元素只有动态文本 children，可绕过通用 children diff。
      if (patchFlag & PatchFlags.TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      // 手写渲染函数或优化降级路径，完整比较全部 props。
      patchProps(el, oldProps, newProps, parentComponent, namespace)
    }

    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
        dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
      }, parentSuspense)
    }
  }

  /**
   * block 的定长动态 children 快路径。
   * 编译器保证新旧数组索引对应同一模板位置，因此无需 keyed diff，只需选对实际容器。
   */
  const patchBlockChildren: PatchBlockChildrenFn = (
    oldChildren,
    newChildren,
    fallbackContainer,
    parentComponent,
    parentSuspense,
    namespace: ElementNamespace,
    slotScopeIds,
  ) => {
    for (let i = 0; i < newChildren.length; i++) {
      const oldVNode = oldChildren[i]
      const newVNode = newChildren[i]
      // 只有可能替换/移动多节点范围的类型才查询真实父节点；普通同类型元素 patch 不使用
      // container，直接传 fallback 可省一次宿主 parentNode 调用。
      const container =
        // Suspense 中 async setup 报错的旧组件可能没有已挂载 el。
        oldVNode.el &&
        // Fragment 替换/移动 children 需要自身真实父容器。
        (oldVNode.type === Fragment ||
          // 类型不同会执行替换，同样需要真实父容器。
          !isSameVNodeType(oldVNode, newVNode) ||
          // 组件/Teleport/Suspense 子树形态任意，保守取真实父容器。
          oldVNode.shapeFlag &
            (ShapeFlags.COMPONENT | ShapeFlags.TELEPORT | ShapeFlags.SUSPENSE))
          ? hostParentNode(oldVNode.el)!
          : // 其他同类型节点不会使用 container，传 block 元素避免 DOM parentNode 调用。
            fallbackContainer
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        true,
      )
    }
  }

  /** 完整同步元素 props：先删除新对象缺失的旧键，再设置变化键，最后单独强制 value。 */
  const patchProps = (
    el: RendererElement,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    namespace: ElementNamespace,
  ) => {
    if (oldProps !== newProps) {
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              namespace,
              parentComponent,
            )
          }
        }
      }
      for (const key in newProps) {
        // 空 key 不构成合法 prop；保留 key/ref/VNode hooks 也不交宿主层。
        if (isReservedProp(key)) continue
        const next = newProps[key]
        const prev = oldProps[key]
        // value 延迟到其他约束属性之后，并在末尾强制同步。
        if (next !== prev && key !== 'value') {
          hostPatchProp(el, key, prev, next, namespace, parentComponent)
        }
      }
      if ('value' in newProps) {
        hostPatchProp(el, 'value', oldProps.value, newProps.value, namespace)
      }
    }
  }

  /**
   * 挂载或更新 Fragment 的宿主范围。
   *
   * Fragment 用两个空文本锚点界定范围。稳定 Fragment 可按 dynamicChildren 快速 patch；
   * v-for 或手写 Fragment 则按 keyed/unkeyed children 规则执行完整 diff。
   */
  const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2

    if (
      __DEV__ &&
      // #5523：开发环境根 Fragment 可能因注释保留而继承指令；HMR/DEV_ROOT_FRAGMENT
      // 的结构与生产编译结果不一定同构，禁用 block 快路径。
      (isHmrUpdating || patchFlag & PatchFlags.DEV_ROOT_FRAGMENT)
    ) {
      // 强制完整 diff，避免按旧动态索引漏掉新增/删除的开发注释节点。
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    // 插槽 Fragment 的 :slotted scopeId 与外层已有 scopeId 合并后传给每个根元素。
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // Fragment 来自编译器或数组隐式包装，正常只有数组 children。
      mountChildren(
        // #10007：`<></>` 可编译成没有 children 字段的空 Fragment，回退空数组。
        (n2.children || []) as VNodeArrayChildren,
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
      )
    } else {
      if (
        patchFlag > 0 &&
        patchFlag & PatchFlags.STABLE_FRAGMENT &&
        dynamicChildren &&
        // #2715：renderSlot() 没有有效 children 时旧 Fragment 可能标成 BAIL 且无
        // dynamicChildren；只有两边数组都存在且等长才能按索引快 patch。
        n1.dynamicChildren &&
        n1.dynamicChildren.length === dynamicChildren.length
      ) {
        // 稳定 Fragment（模板根或稳定 template v-for）顺序不变，只 patch 动态后代。
        patchBlockChildren(
          n1.dynamicChildren,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
        )
        if (__DEV__) {
          // HMR 后续完整更新需要静态节点也持有旧宿主引用。
          traverseStaticChildren(n1, n2)
        } else if (
          // #2080：带 key 的稳定 Fragment 通常是可移动的 `<template v-for>`；#2134：
          // 组件根也可能随组件移动。两者都要让根层静态 VNode 继承 el，move 才能定位。
          n2.key != null ||
          (parentComponent && n2 === parentComponent.subTree)
        ) {
          traverseStaticChildren(n1, n2, true /* shallow */)
        }
      } else {
        // keyed/unkeyed v-for 或手写 Fragment 走通用 children diff。编译 v-for 的每个
        // child 自身已是 block，外层 Fragment 不会再收集 dynamicChildren。
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
      }
    }
  }

  /** 挂载、更新或从 KeepAlive 缓存激活组件 VNode。 */
  const processComponent = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    n2.slotScopeIds = slotScopeIds
    if (n1 == null) {
      if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).activate(
          n2,
          container,
          anchor,
          namespace,
          optimized,
        )
      } else {
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          optimized,
        )
      }
    } else {
      updateComponent(n1, n2, optimized)
    }
  }

  /**
   * 创建组件内部实例，解析 setup/props/slots，并建立首次渲染。
   * async setup 在 Suspense 中先注册依赖并放置注释占位，resolve 后再建立 render effect。
   */
  const mountComponent: MountComponentFn = (
    initialVNode,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    namespace: ElementNamespace,
    optimized,
  ) => {
    // Vue 2 compat 根可能在真正 mount 前已创建实例，此处复用而非重复初始化。
    const compatMountInstance =
      __COMPAT__ && initialVNode.isCompatRoot && initialVNode.component
    const instance: ComponentInternalInstance =
      compatMountInstance ||
      (initialVNode.component = createComponentInstance(
        initialVNode,
        parentComponent,
        parentSuspense,
      ))

    if (__DEV__ && instance.type.__hmrId) {
      registerHMR(instance)
    }

    if (__DEV__) {
      pushWarningContext(initialVNode)
      startMeasure(instance, `mount`)
    }

    // KeepAlive 需要 move/unmount/patch 等能力管理缓存，但为可 tree-shaking 不直接导入
    // 渲染器；在实例创建时注入紧凑 internals。
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // setup 前先解析 props/slots，确保 setupContext 与组合式 API 读取到标准化数据。
    if (!(__COMPAT__ && compatMountInstance)) {
      if (__DEV__) {
        startMeasure(instance, `init`)
      }
      setupComponent(instance, false, optimized)
      if (__DEV__) {
        endMeasure(instance, `init`)
      }
    }

    // HMR 要按新模板完整重建，不能复用旧 SSR 节点执行水合。
    if (__DEV__ && isHmrUpdating) initialVNode.el = null

    // async setup 必须 resolve 后才能得到 render 函数；交由最近 Suspense 统计依赖。
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
      parentSuspense &&
        parentSuspense.registerDep(instance, setupRenderEffect, optimized)

      // 非水合路径放注释占位，保留父 children 顺序和未来插入锚点。
      // TODO：支持组件自定义 fallback，目前 fallback 由 Suspense 边界统一提供。
      if (!initialVNode.el) {
        const placeholder = (instance.subTree = createVNode(Comment))
        processCommentNode(null, placeholder, container!, anchor)
        initialVNode.placeholder = placeholder.el
      }
    } else {
      setupRenderEffect(
        instance,
        initialVNode,
        container,
        anchor,
        parentSuspense,
        namespace,
        optimized,
      )
    }

    if (__DEV__) {
      popWarningContext()
      endMeasure(instance, `mount`)
    }
  }

  /** 判断组件是否需要更新；需要则同步运行 render effect，否则只转移实例与 el 引用。 */
  const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
    const instance = (n2.component = n1.component)!
    if (shouldUpdateComponent(n1, n2, optimized)) {
      if (
        __FEATURE_SUSPENSE__ &&
        instance.asyncDep &&
        !instance.asyncResolved
      ) {
        // async setup 尚未完成，render effect 还不存在；只同步最新 props/slots，待 resolve
        // 后首次渲染直接使用最新输入。
        if (__DEV__) {
          pushWarningContext(n2)
        }
        updateComponentPreRender(instance, n2, optimized)
        if (__DEV__) {
          popWarningContext()
        }
        return
      } else {
        // 父驱动更新把新 VNode 放入 next，再同步运行 effect；调度器批处理只用于自身状态。
        instance.next = n2
        // instance.update 即组件的响应式渲染 effect。
        instance.update()
      }
    } else {
      // 即使跳过 render，也要让新 VNode 持有旧 el，并更新 instance.vnode 供未来卸载。
      n2.el = n1.el
      instance.vnode = n2
    }
  }

  /**
   * 建立组件 render effect。
   *
   * effect 首次运行执行 mount/hydrate 分支；之后运行执行 update 分支。所有组件自身状态
   * 变化进入带 uid 的调度任务，父组件直接传新 VNode 时则同步更新，维持父子顺序。
   */
  const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    namespace: ElementNamespace,
    optimized,
  ) => {
    const componentUpdateFn = () => {
      if (!instance.isMounted) {
        let vnodeHook: VNodeHook | null | undefined
        const { el, props } = initialVNode
        const { bm, m, parent, root, type } = instance
        const isAsyncWrapperVNode = isAsyncWrapper(initialVNode)

        toggleRecurse(instance, false)
        // 挂载前钩子执行期间禁止 effect 自递归调度。
        if (bm) {
          invokeArrayFns(bm)
        }
        // 异步包装器把 VNode 钩子转交内部真实组件，包装层不重复触发。
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeBeforeMount)
        ) {
          invokeVNodeHook(vnodeHook, parent, initialVNode)
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeMount')
        }
        toggleRecurse(instance, true)

        if (el && hydrateNode) {
          // initialVNode 已认领服务端宿主节点，渲染子树后走 hydrate 而非创建新节点。
          const hydrateSubTree = () => {
            if (__DEV__) {
              startMeasure(instance, `render`)
            }
            instance.subTree = renderComponentRoot(instance)
            if (__DEV__) {
              endMeasure(instance, `render`)
            }
            if (__DEV__) {
              startMeasure(instance, `hydrate`)
            }
            hydrateNode!(
              el as Node,
              instance.subTree,
              instance,
              parentSuspense,
              null,
            )
            if (__DEV__) {
              endMeasure(instance, `hydrate`)
            }
          }

          if (
            isAsyncWrapperVNode &&
            (type as ComponentOptions).__asyncHydrate
          ) {
            ;(type as ComponentOptions).__asyncHydrate!(
              el as Element,
              instance,
              hydrateSubTree,
            )
          } else {
            hydrateSubTree()
          }
        } else {
          // Shadow DOM 自定义元素需在渲染子组件前注入该组件样式。
          if (root.ce && root.ce._hasShadowRoot()) {
            root.ce._injectChildStyle(
              type,
              instance.parent ? instance.parent.type : undefined,
            )
          }

          if (__DEV__) {
            startMeasure(instance, `render`)
          }
          const subTree = (instance.subTree = renderComponentRoot(instance))
          if (__DEV__) {
            endMeasure(instance, `render`)
          }
          if (__DEV__) {
            startMeasure(instance, `patch`)
          }
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            namespace,
          )
          if (__DEV__) {
            endMeasure(instance, `patch`)
          }
          initialVNode.el = subTree.el
        }
        // mounted/VNode mounted 必须等宿主树提交完成；Suspense 未决时还要等分支激活。
        if (m) {
          queuePostRenderEffect(m, parentSuspense)
        }
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeMounted)
        ) {
          const scopedInitialVNode = initialVNode
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, scopedInitialVNode),
            parentSuspense,
          )
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:mounted'),
            parentSuspense,
          )
        }

        // KeepAlive 根的 activated。#1742：必须首次 render 后再读取 `instance.a`，因为
        // 子 KeepAlive 可能在自身 setup/render 期间向祖先实例注入 activated 钩子。
        if (
          initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE ||
          (parent &&
            isAsyncWrapper(parent.vnode) &&
            parent.vnode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE)
        ) {
          instance.a && queuePostRenderEffect(instance.a, parentSuspense)
          if (
            __COMPAT__ &&
            isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
          ) {
            queuePostRenderEffect(
              () => instance.emit('hook:activated'),
              parentSuspense,
            )
          }
        }
        instance.isMounted = true

        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentAdded(instance)
        }

        // #2458：effect 闭包会伴随组件存活。清空只在首次挂载使用的 initialVNode、
        // container、anchor，避免它们长期保留已脱离宿主树的大对象链。
        initialVNode = container = anchor = null as any
      } else {
        let { next, bu, u, parent, vnode } = instance

        if (__FEATURE_SUSPENSE__) {
          const nonHydratedAsyncRoot = locateNonHydratedAsyncRoot(instance)
          // 延迟水合的异步后代尚无已知客户端根节点，此时 patch 无法确定容器/锚点。
          if (nonHydratedAsyncRoot) {
            // 先同步最新 VNode/props/slots，暂不执行 render/patch。
            if (next) {
              next.el = vnode.el
              updateComponentPreRender(instance, next, optimized)
            }
            // 依赖 resolve 后再入 post 队列；等待期间组件可能已卸载，执行前复查。
            nonHydratedAsyncRoot.asyncDep!.then(() => {
              // Promise 等待期间实例可能已被父级销毁。
              queuePostRenderEffect(() => {
                if (!instance.isUnmounted) update()
              }, parentSuspense)
            })
            return
          }
        }

        // 更新来源有两类：组件自身状态触发时 next 为 null；父组件 patch 新 VNode 时
        // next 保存新输入。originNext 用于区分是否需要向上同步 HOC 根 el。
        let originNext = next
        let vnodeHook: VNodeHook | null | undefined
        if (__DEV__) {
          pushWarningContext(next || instance.vnode)
        }

        // 更新输入与 beforeUpdate 生命周期阶段禁止组件 effect 递归。
        toggleRecurse(instance, false)
        if (next) {
          next.el = vnode.el
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }

        if (bu) {
          invokeArrayFns(bu)
        }
        // onVnodeBeforeUpdate
        if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
          invokeVNodeHook(vnodeHook, parent, next, vnode)
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeUpdate')
        }
        toggleRecurse(instance, true)

        // render 只计算新子树，随后再用旧子树宿主位置执行 patch。
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        const nextTree = renderComponentRoot(instance)
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        const prevTree = instance.subTree
        instance.subTree = nextTree

        if (__DEV__) {
          startMeasure(instance, `patch`)
        }
        patch(
          prevTree,
          nextTree,
          // Teleport 可能改变实际父容器，必须从旧根宿主节点实时查询。
          hostParentNode(prevTree.el!)!,
          // Fragment/组件根可能是多节点范围，实时取得范围后的锚点。
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          namespace,
        )
        if (__DEV__) {
          endMeasure(instance, `patch`)
        }
        next.el = nextTree.el
        if (originNext === null) {
          // 自身状态更新没有来自父级的新 VNode。若当前组件是高阶组件唯一根，需要沿
          // 父 subTree 链更新 vnode.el，使外层移动/卸载仍指向最新真实根节点。
          updateHOCHostEl(instance, nextTree.el)
        }
        // updated 与 VNode updated 都在整棵提交完成后执行。
        if (u) {
          queuePostRenderEffect(u, parentSuspense)
        }
        // onVnodeUpdated
        if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, next!, vnode),
            parentSuspense,
          )
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:updated'),
            parentSuspense,
          )
        }

        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentUpdated(instance)
        }

        if (__DEV__) {
          popWarningContext()
        }
      }
    }

    // 在组件 effectScope 内创建 render effect，卸载时 scope.stop() 可统一停止。
    instance.scope.on()
    const effect = (instance.effect = new ReactiveEffect(componentUpdateFn))
    instance.scope.off()

    const update = (instance.update = effect.run.bind(effect))
    const job: SchedulerJob = (instance.job = effect.runIfDirty.bind(effect))
    job.i = instance
    job.id = instance.uid
    effect.scheduler = () => queueJob(job)

    // #1801/#2043：组件更新可能触发子 pre watcher，而 watcher 又修改父渲染依赖；允许
    // render effect 重新入队以得到最终一致状态，调度器仍有递归上限保护。
    toggleRecurse(instance, true)

    if (__DEV__) {
      effect.onTrack = instance.rtc
        ? e => invokeArrayFns(instance.rtc!, e)
        : void 0
      effect.onTrigger = instance.rtg
        ? e => invokeArrayFns(instance.rtg!, e)
        : void 0
    }

    update()
  }

  /**
   * 组件 render 前接收父级的新 VNode，更新 props/slots 并立即刷新该组件 pre watcher。
   */
  const updateComponentPreRender = (
    instance: ComponentInternalInstance,
    nextVNode: VNode,
    optimized: boolean,
  ) => {
    nextVNode.component = instance
    const prevProps = instance.vnode.props
    instance.vnode = nextVNode
    instance.next = null
    updateProps(instance, nextVNode.props, prevProps, optimized)
    updateSlots(instance, nextVNode.children, optimized)

    pauseTracking()
    // props 更新可能触发默认 pre watcher；必须在 render 前执行，使本轮渲染看到 watcher
    // 派生出的最终状态。暂停依赖收集，避免 watcher 依赖污染当前父 effect。
    flushPreFlushCbs(instance)
    resetTracking()
  }

  /**
   * 根据编译 patchFlag 或运行时 shapeFlag 更新 children。
   * 编译 v-for 可直接选择 keyed/unkeyed 算法；其他情况在文本、数组、空值之间转换。
   */
  const patchChildren: PatchChildrenFn = (
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    namespace: ElementNamespace,
    slotScopeIds,
    optimized = false,
  ) => {
    const c1 = n1 && n1.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const c2 = n2.children

    const { patchFlag, shapeFlag } = n2
    // 编译器已识别列表稳定性时直接进入对应快路径。
    if (patchFlag > 0) {
      if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
        // KEYED 也允许少量无 key 节点；patchFlag 保证新旧 children 均为数组。
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        return
      } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
        // UNKEYED 按索引复用，不尝试移动身份节点。
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        return
      }
    }

    // children 最终只有三态：文本、数组、空。
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // 新文本可直接替换容器内容；旧数组先卸载组件/指令等逻辑资源。
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2 as string)
      }
    } else {
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 旧 children 为数组。
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // 两边数组且无编译保证，使用可兼容混合 key 的完整 keyed diff。
          patchKeyedChildren(
            c1 as VNode[],
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
        } else {
          // 新 children 为空，只需卸载旧数组。
          unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
        }
      } else {
        // 旧 children 为文本/空，新 children 为数组/空。
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          hostSetElementText(container, '')
        }
        // 清空旧文本后再挂载新数组。
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
        }
      }
    }
  }

  /**
   * 按索引更新无 key children：公共长度逐项 patch，剩余旧节点卸载或剩余新节点挂载。
   * 节点插入/删除会导致后续组件实例就地复用，因此只适合编译器确认无身份语义的列表。
   */
  const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    const commonLength = Math.min(oldLength, newLength)
    let i
    for (i = 0; i < commonLength; i++) {
      const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
      )
    }
    if (oldLength > newLength) {
      // 旧数组更长，卸载尾部多余节点。
      unmountChildren(
        c1,
        parentComponent,
        parentSuspense,
        true,
        false,
        commonLength,
      )
    } else {
      // 新数组更长，从公共长度开始挂载尾部新增节点。
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
        commonLength,
      )
    }
  }

  /**
   * 更新带 key 或 key/无 key 混合的 children。
   *
   * 算法先同步相同前缀/后缀，快速覆盖常见追加与截断；未知中段建立新 key→index 映射，
   * 复用/卸载旧节点；最后从后向前挂载新节点，并用最长递增子序列只移动必要节点。
   */
  const patchKeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    let i = 0
    const l2 = c2.length
    let e1 = c1.length - 1 // 旧 children 末端下标。
    let e2 = l2 - 1 // 新 children 末端下标。

    // 1. 从头同步相同类型节点。
    // (a b) c
    // (a b) d e
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
      } else {
        break
      }
      i++
    }

    // 2. 从尾同步相同类型节点。
    // a (b c)
    // d e (b c)
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = optimized
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized,
        )
      } else {
        break
      }
      e1--
      e2--
    }

    // 3. 旧序列已耗尽：剩余全是新增节点。
    // (a b)
    // (a b) c
    // i = 2, e1 = 1, e2 = 2
    // (a b)
    // c (a b)
    // i = 0, e1 = -1, e2 = 0
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          patch(
            null,
            (c2[i] = optimized
              ? cloneIfMounted(c2[i] as VNode)
              : normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
          i++
        }
      }
    }

    // 4. 新序列已耗尽：剩余全是删除节点。
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
    else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i], parentComponent, parentSuspense, true)
        i++
      }
    }

    // 5. 两边中段都还有节点：进入完整复用、删除与移动判断。
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      const s1 = i // 旧未知中段起点。
      const s2 = i // 新未知中段起点。

      // 5.1 为新中段建立 key → 新下标映射，旧 keyed 节点可 O(1) 找到去向。
      const keyToNewIndexMap: Map<PropertyKey, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = optimized
          ? cloneIfMounted(c2[i] as VNode)
          : normalizeVNode(c2[i]))
        if (nextChild.key != null) {
          if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
              `Duplicate keys found during update:`,
              JSON.stringify(nextChild.key),
              `Make sure keys are unique.`,
            )
          }
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 遍历旧中段：找到新位置便 patch；找不到说明已删除，立即卸载。
      let j
      let patched = 0
      const toBePatched = e2 - s2 + 1
      let moved = false
      // 新下标不再单调递增即说明至少一个复用节点需要移动。
      let maxNewIndexSoFar = 0
      // `newIndexToOldIndexMap` 按新中段位置保存旧下标 + 1。0 专门表示新节点没有旧节点，
      // 同一数组随后也作为最长递增子序列输入，找出无需移动的最大稳定集合。
      const newIndexToOldIndexMap = new Array(toBePatched)
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // 所有新节点都已匹配，剩余旧节点只能是删除项。
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // 无 key 节点只能线性寻找尚未占用、type 相同的新节点。
          for (j = s2; j <= e2; j++) {
            if (
              newIndexToOldIndexMap[j - s2] === 0 &&
              isSameVNodeType(prevChild, c2[j] as VNode)
            ) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            moved = true
          }
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
          patched++
        }
      }

      // 5.3 挂载全新节点，并移动不属于最长稳定子序列的复用节点。
      // 只有检测到乱序时才计算 LIS，常见仅内容更新路径省去 O(n log n) 工作。
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      j = increasingNewIndexSequence.length - 1
      // 从后向前处理，右侧节点已处于最终位置，可直接作为当前节点插入锚点。
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex] as VNode
        const anchorVNode = c2[nextIndex + 1] as VNode
        const anchor =
          nextIndex + 1 < l2
            ? // #13559/#14173：未解析异步组件没有 el，沿其包装子树寻找注释 placeholder
              // 作为锚点，避免新节点被插到异步组件预留位置之后。
              anchorVNode.el || resolveAsyncComponentPlaceholder(anchorVNode)
            : parentAnchor
        if (newIndexToOldIndexMap[i] === 0) {
          // 映射值 0：新节点没有旧节点，直接在已确定锚点前挂载。
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
          )
        } else if (moved) {
          // 完全逆序可能没有可保留序列；其他情况仅移动不属于 LIS 的节点。
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            j--
          }
        }
      }
    }
  }

  /**
   * 移动 VNode 对应宿主范围。
   * 组件递归移动子树；Suspense/Teleport 委托各自实现；Fragment/Static 移动完整范围；
   * 单元素根据 ENTER/LEAVE/REORDER 决定是否执行过渡。
   */
  const move: MoveFn = (
    vnode,
    container,
    anchor,
    moveType,
    parentSuspense = null,
  ) => {
    const { el, type, transition, children, shapeFlag } = vnode
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor, moveType)
      return
    }

    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      vnode.suspense!.move(container, anchor, moveType)
      return
    }

    if (shapeFlag & ShapeFlags.TELEPORT) {
      ;(type as typeof TeleportImpl).move(vnode, container, anchor, internals)
      return
    }

    if (type === Fragment) {
      hostInsert(el!, container, anchor)
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move((children as VNode[])[i], container, anchor, moveType)
      }
      hostInsert(vnode.anchor!, container, anchor)
      return
    }

    if (type === Static) {
      moveStaticNode(vnode, container, anchor)
      return
    }

    // 单宿主节点。列表 REORDER 只移动，不应触发进场/离场动画。
    const needTransition =
      moveType !== MoveType.REORDER &&
      shapeFlag & ShapeFlags.ELEMENT &&
      transition
    if (needTransition) {
      if (moveType === MoveType.ENTER) {
        // #14031：persisted 过渡由 v-show 指令控制。若没有正在进行的 v-show leave，
        // KeepAlive 激活只需搬回元素，不应重复执行指令所属 enter 钩子。
        if (transition!.persisted && !el![leaveCbKey]) {
          hostInsert(el!, container, anchor)
        } else {
          transition!.beforeEnter(el!)
          hostInsert(el!, container, anchor)
          queuePostRenderEffect(() => transition!.enter(el!), parentSuspense)
        }
      } else {
        const { leave, delayLeave, afterLeave } = transition!
        const remove = () => {
          if (vnode.ctx!.isUnmounted) {
            hostRemove(el!)
          } else {
            hostInsert(el!, container, anchor)
          }
        }
        const performLeave = () => {
          // #13153：v-show leave 未完成时 KeepAlive 可能先移动节点。需取消当前 leave，
          // 让取消回调先把 display 恢复/收尾，再决定缓存移动，避免显示状态卡住。
          const wasLeaving = el!._isLeaving || !!el![leaveCbKey]
          if (el!._isLeaving) {
            el![leaveCbKey](true /* cancelled */)
          }
          // #14031：没有待处理 leave 时，persisted 过渡跳过指令所属 leave，仅搬移节点。
          if (transition!.persisted && !wasLeaving) {
            remove()
          } else {
            leave(el!, () => {
              remove()
              afterLeave && afterLeave()
            })
          }
        }
        if (delayLeave) {
          delayLeave(el!, remove, performLeave)
        } else {
          performLeave()
        }
      }
    } else {
      hostInsert(el!, container, anchor)
    }
  }

  /**
   * 卸载 VNode 的逻辑资源，并可选移除宿主节点。
   *
   * 顺序包含：清 ref/memo、KeepAlive 分流、before 钩子、组件/内置节点递归、宿主移除、
   * post 钩子。block 快路径只卸载动态后代，但含 v-once 或不稳定 Fragment 时必须遍历
   * 完整 children，确保隐藏在静态优化中的组件 effect 也被停止。
   */
  const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false,
  ) => {
    const {
      type,
      props,
      ref,
      children,
      dynamicChildren,
      shapeFlag,
      patchFlag,
      dirs,
      cacheIndex,
      memo,
    } = vnode

    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
    }

    // ref 清空属于同步状态变更；暂停追踪避免触发中的读取污染当前 effect。
    if (ref != null) {
      pauseTracking()
      setRef(ref, null, parentSuspense, vnode, true)
      resetTracking()
    }

    // #6593：卸载时清理组件 renderCache 对应 v-memo；否则 v-if 再挂载可能复用宿主节点
    // 已不存在的旧 VNode。
    if (cacheIndex != null) {
      parentComponent!.renderCache[cacheIndex] = undefined
    }

    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
      ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
      return
    }

    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs
    const shouldInvokeVnodeHook = !isAsyncWrapper(vnode)

    let vnodeHook: VNodeHook | undefined | null
    if (
      shouldInvokeVnodeHook &&
      (vnodeHook = props && props.onVnodeBeforeUnmount)
    ) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    if (shapeFlag & ShapeFlags.COMPONENT) {
      unmountComponent(vnode.component!, parentSuspense, doRemove)
    } else {
      if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        vnode.suspense!.unmount(parentSuspense, doRemove)
        return
      }

      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
      }

      if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(vnode.type as typeof TeleportImpl).remove(
          vnode,
          parentComponent,
          parentSuspense,
          internals,
          doRemove,
        )
      } else if (
        dynamicChildren &&
        // #5154：block 内 v-once 创建时会给 dynamicChildren 标记 hasOnce。此时不能只
        // 卸载动态数组，否则未被收集的 v-once 内嵌组件永远收不到卸载与 scope.stop。
        !dynamicChildren.hasOnce &&
        // #1153：非稳定 v-for Fragment 的 children 顺序/数量可变，不能只看动态数组。
        (type !== Fragment ||
          (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
      ) {
        // 稳定 block 中静态原生节点没有需清理逻辑，只递归卸载动态后代。
        unmountChildren(
          dynamicChildren,
          parentComponent,
          parentSuspense,
          false,
          true,
        )
      } else if (
        (type === Fragment &&
          patchFlag &
            (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) ||
        (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN)
      ) {
        unmountChildren(children as VNode[], parentComponent, parentSuspense)
      }

      if (doRemove) {
        remove(vnode)
      }
    }

    // v-for + v-memo 把缓存放在 renderList 数组而非组件 renderCache。卸载提交后把 el
    // 置空，使后续 v-if 重挂载将其识别为未挂载/需克隆，不能复用已移除 DOM。
    const shouldInvalidateMemo = memo != null && cacheIndex == null

    if (
      (shouldInvokeVnodeHook &&
        (vnodeHook = props && props.onVnodeUnmounted)) ||
      shouldInvokeDirs ||
      shouldInvalidateMemo
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
          invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
        if (shouldInvalidateMemo) {
          vnode.el = null
        }
      }, parentSuspense)
    }
  }

  /**
   * 从宿主树移除 VNode 范围，并协调非 persisted 过渡。
   * Fragment/Static 可能覆盖多个节点；普通元素在 leave 完成后才真正 hostRemove。
   */
  const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    if (type === Fragment) {
      if (
        __DEV__ &&
        vnode.patchFlag > 0 &&
        vnode.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT &&
        transition &&
        !transition.persisted
      ) {
        ;(vnode.children as VNode[]).forEach(child => {
          if (child.type === Comment) {
            hostRemove(child.el!)
          } else {
            remove(child)
          }
        })
      } else {
        removeFragment(el!, anchor!)
      }
      return
    }

    if (type === Static) {
      removeStaticNode(vnode)
      return
    }

    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        performLeave()
      }
    } else {
      performRemove()
    }
  }

  /** 删除 Fragment 两个锚点及其间全部宿主节点。子节点过渡已由上层 unmount 处理。 */
  const removeFragment = (cur: RendererNode, end: RendererNode) => {
    let next
    while (cur !== end) {
      next = hostNextSibling(cur)!
      hostRemove(cur)
      cur = next
    }
    hostRemove(end)
  }

  /**
   * 停止组件 effect scope、使调度任务失效、卸载渲染子树并安排 unmounted 钩子。
   */
  const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean,
  ) => {
    if (__DEV__ && instance.type.__hmrId) {
      unregisterHMR(instance)
    }

    const { bum, scope, job, subTree, um, m, a } = instance
    invalidateMount(m)
    invalidateMount(a)

    // beforeUnmount 在 effect 仍有效、子树仍存在时同步执行。
    if (bum) {
      invokeArrayFns(bum)
    }

    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      instance.emit('hook:beforeDestroy')
    }

    // 停止 setup/render/watch 等归属于组件 scope 的全部响应式 effect。
    scope.stop()

    // async setup resolve 前组件可能已卸载，此时 render job 尚未创建，也没有 subTree
    // 需要递归卸载。
    if (job) {
      // 即使任务已经入队，DISPOSED 也让调度器跳过。
      job.flags! |= SchedulerJobFlags.DISPOSED
      unmount(subTree, instance, parentSuspense, doRemove)
    }
    // unmounted 在子树宿主移除和本轮提交完成后执行。
    if (um) {
      queuePostRenderEffect(um, parentSuspense)
    }
    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      queuePostRenderEffect(
        () => instance.emit('hook:destroyed'),
        parentSuspense,
      )
    }
    queuePostRenderEffect(() => {
      instance.isUnmounted = true
    }, parentSuspense)

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      devtoolsComponentRemoved(instance)
    }
  }

  /** 从指定下标开始逐项卸载 children。 */
  const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false,
    start = 0,
  ) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove, optimized)
    }
  }

  /**
   * 取得整个 VNode 宿主范围之后的节点，供替换/插入作为锚点。
   * 组件递归看子树，Suspense 自行定位；普通多节点 VNode 从 anchor 后查找。
   */
  const getNextHostNode: NextFn = vnode => {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return vnode.suspense!.next()
    }
    const el = hostNextSibling((vnode.anchor || vnode.el)!)
    // #9071/#9313：Teleport 的目标内容锚点可能出现在 nextSibling 链中，直接返回会把
    // 新节点插进传送内容范围。通过 TeleportEndKey 跳到整段目标内容之后。
    const teleportEnd = el && el[TeleportEndKey]
    return teleportEnd ? hostNextSibling(teleportEnd) : el
  }

  /** 防止嵌套 render 调用重复刷新同一组 pre/post 队列。 */
  let isFlushing = false
  /**
   * 根 render：以容器 `_vnode` 为旧树执行 patch；传 null 则完整卸载。
   * 同步根调用结束前刷新 pre/post 队列，使非应用场景直接调用 render 也得到完整生命周期。
   */
  const render: RootRenderFunction = (vnode, container, namespace) => {
    let instance
    if (vnode == null) {
      if (container._vnode) {
        unmount(container._vnode, null, null, true)
        instance = container._vnode.component
      }
    } else {
      patch(
        container._vnode || null,
        vnode,
        container,
        null,
        null,
        null,
        namespace,
      )
    }
    container._vnode = vnode
    if (!isFlushing) {
      isFlushing = true
      flushPreFlushCbs(instance)
      flushPostFlushCbs()
      isFlushing = false
    }
  }

  /** 提供给内置可选特性的紧凑闭包能力表。 */
  const internals: RendererInternals = {
    p: patch,
    um: unmount,
    m: move,
    r: remove,
    mt: mountComponent,
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    n: getNextHostNode,
    o: options,
  }

  // 只有 hydration renderer 才执行工厂并把 hydrateNode 提供给组件首次 render effect。
  let hydrate: ReturnType<typeof createHydrationFunctions>[0] | undefined
  let hydrateNode: ReturnType<typeof createHydrationFunctions>[1] | undefined
  if (createHydrationFns) {
    ;[hydrate, hydrateNode] = createHydrationFns(
      internals as RendererInternals<Node, Element>,
    )
  }

  return {
    render,
    hydrate,
    createApp: createAppAPI(render, hydrate),
  }
}

/**
 * 计算元素 children 的命名空间。
 * SVG foreignObject 与 MathML annotation-xml(encoding 含 html) 内部重新进入 HTML 空间。
 */
function resolveChildrenNamespace(
  { type, props }: VNode,
  currentNamespace: ElementNamespace,
): ElementNamespace {
  return (currentNamespace === 'svg' && type === 'foreignObject') ||
    (currentNamespace === 'mathml' &&
      type === 'annotation-xml' &&
      props &&
      props.encoding &&
      props.encoding.includes('html'))
    ? undefined
    : currentNamespace
}

/** 同时切换组件 ReactiveEffect 与调度 job 的自递归许可，确保两层判断一致。 */
function toggleRecurse(
  { effect, job }: ComponentInternalInstance,
  allowed: boolean,
) {
  if (allowed) {
    effect.flags |= EffectFlags.ALLOW_RECURSE
    job.flags! |= SchedulerJobFlags.ALLOW_RECURSE
  } else {
    effect.flags &= ~EffectFlags.ALLOW_RECURSE
    job.flags! &= ~SchedulerJobFlags.ALLOW_RECURSE
  }
}

/**
 * 判断当前元素移动/挂载是否应运行过渡。
 * 未决 Suspense 分支尚在隐藏容器，enter 要等边界 resolve；persisted 过渡由 v-show 控制。
 */
export function needTransition(
  parentSuspense: SuspenseBoundary | null,
  transition: TransitionHooks | null,
): boolean | null {
  return (
    (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
    transition &&
    !transition.persisted
  )
}

/**
 * 让优化路径跳过的静态新 VNode 继承旧树宿主引用。
 *
 * #1156：HMR 会把后续更新提升为完整 diff；若 block 中静态节点没继承 el，完整 patch
 * 无法定位旧 DOM。#2080：带 key 的 template Fragment 移动时会移动全部 children；
 * 静态 children 同样需要旧 el 才能确定正确移动范围。
 */
export function traverseStaticChildren(
  n1: VNode,
  n2: VNode,
  shallow = false,
): void {
  const ch1 = n1.children
  const ch2 = n2.children
  if (isArray(ch1) && isArray(ch2)) {
    for (let i = 0; i < ch1.length; i++) {
      // 只由优化路径调用，编译器保证数组项已是 VNode。
      const c1 = ch1[i] as VNode
      let c2 = ch2[i] as VNode
      if (c2.shapeFlag & ShapeFlags.ELEMENT && !c2.dynamicChildren) {
        if (c2.patchFlag <= 0 || c2.patchFlag === PatchFlags.NEED_HYDRATION) {
          c2 = ch2[i] = cloneIfMounted(ch2[i] as VNode)
          c2.el = c1.el
        }
        if (!shallow && c2.patchFlag !== PatchFlags.BAIL)
          traverseStaticChildren(c1, c2)
      }
      // #6852：文本节点也可能是稳定静态项，需继承 el；缓存文本先 clone，避免缓存对象
      // 长期保留已脱离 DOM 的节点引用。
      if (c2.type === Text) {
        if (c2.patchFlag === PatchFlags.CACHED) {
          c2 = ch2[i] = cloneIfMounted(c2)
        }
        c2.el = c1.el
      }
      // #2324：注释静态项也继承 el，但已有 el 的动态占位（如 v-if）已由 block patch
      // 正确赋值，不能覆盖。
      if (c2.type === Comment && !c2.el) {
        c2.el = c1.el
      }

      if (__DEV__) {
        c2.el && (c2.el.__vnode = c2)
      }
    }
  }
}

/**
 * 返回数组中最长严格递增子序列的“下标序列”（忽略值 0）。
 *
 * keyed diff 的数组值是旧节点下标 + 1；递增部分代表相对顺序未变、无需移动的最大节点
 * 集合。算法用二分维护候选尾部，复杂度 O(n log n)，`p` 用于最后回溯实际序列。
 * 参见 https://en.wikipedia.org/wiki/Longest_increasing_subsequence
 */
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}

/** 沿单组件根链寻找尚未解析/水合的异步组件，找不到则返回 undefined。 */
function locateNonHydratedAsyncRoot(
  instance: ComponentInternalInstance,
): ComponentInternalInstance | undefined {
  const subComponent = instance.subTree.component
  if (subComponent) {
    if (subComponent.asyncDep && !subComponent.asyncResolved) {
      return subComponent
    } else {
      return locateNonHydratedAsyncRoot(subComponent)
    }
  }
}

/**
 * 将尚未执行的 mounted/activated 调度钩子标记为已废弃。
 * 组件若在 post 队列刷新前就卸载，调度器必须跳过这些过期挂载钩子。
 */
export function invalidateMount(hooks: LifecycleHook): void {
  if (hooks) {
    for (let i = 0; i < hooks.length; i++)
      hooks[i].flags! |= SchedulerJobFlags.DISPOSED
  }
}

/**
 * 从异步包装器/HOC 的单根组件链中寻找未解析异步组件的注释占位锚点。
 */
function resolveAsyncComponentPlaceholder(anchorVnode: VNode) {
  if (anchorVnode.placeholder) {
    return anchorVnode.placeholder
  }

  // 锚点 VNode 可能是多层包装组件，递归检查其单根 subTree。
  const instance = anchorVnode.component
  if (instance) {
    return resolveAsyncComponentPlaceholder(instance.subTree)
  }

  return null
}
