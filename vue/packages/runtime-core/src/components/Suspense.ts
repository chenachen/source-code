import {
  Comment,
  type VNode,
  type VNodeProps,
  closeBlock,
  createVNode,
  currentBlock,
  isBlockTreeEnabled,
  isSameVNodeType,
  normalizeVNode,
  openBlock,
} from '../vnode'
import { ShapeFlags, isArray, isFunction, toNumber } from '@vue/shared'
import {
  type ComponentInternalInstance,
  handleSetupResult,
  unsetCurrentInstance,
} from '../component'
import type { Slots } from '../componentSlots'
import {
  type ElementNamespace,
  MoveType,
  type RendererElement,
  type RendererInternals,
  type RendererNode,
  type SetupRenderEffectFn,
  queuePostRenderEffect,
} from '../renderer'
import { queuePostFlushCb } from '../scheduler'
import { filterSingleRoot, updateHOCHostEl } from '../componentRenderUtils'
import {
  assertNumber,
  popWarningContext,
  pushWarningContext,
  warn,
} from '../warning'
import { ErrorCodes, handleError } from '../errorHandling'
import { NULL_DYNAMIC_COMPONENT } from '../helpers/resolveAssets'

/** `<Suspense>` 的事件、超时与嵌套边界配置。 */
export interface SuspenseProps {
  /** 边界结算 pending 分支并切换逻辑活动分支后触发；out-in 时 DOM 仍需等待旧分支离场。 */
  onResolve?: () => void
  /** 首次挂载发现异步依赖，或更新替换默认分支根节点时触发；后者也可能同步 resolve。 */
  onPending?: () => void
  /** fallback 即将显示时触发。 */
  onFallback?: () => void
  /**
   * 更新后的默认内容超过 `timeout` 毫秒仍未完成时切换到 fallback。
   * `0` 表示替换默认内容时立即显示 fallback；负数/未设置表示更新期间继续保留
   * 当前活动内容，不自动进入 fallback。首次挂载只要有异步依赖就会直接显示 fallback。
   */
  timeout?: string | number
  /**
   * 是否让当前 Suspense 也作为父 Suspense 的一个异步依赖。
   *
   * 默认情况下嵌套边界独立 resolve；开启后，父边界会等当前边界一起完成。
   * @default false
   */
  suspensible?: boolean
}

/** 通过类型标记识别 Suspense，避免 renderer 直接导入实现而影响 tree-shaking。 */
export const isSuspense = (type: any): boolean => type.__isSuspense

/**
 * 每个 pending 分支递增的版本号。异步 setup 完成时会比对版本，旧分支的 Promise
 * 即使较晚 resolve，也不能重新挂载已被新一轮更新淘汰的组件。
 */
let suspenseId = 0

/** 仅供测试重置全局 pending 分支编号，使断言结果稳定。 */
export const resetSuspenseId = (): number => (suspenseId = 0)

/**
 * Suspense 的内置类型协议。
 *
 * 对编译器和用户它像组件，内部却直接接入 renderer：默认分支先在离屏容器挂载，
 * 期间发现的 async setup 会增加 `deps`；清零后整棵分支一次性移入真实容器。
 */
export const SuspenseImpl = {
  name: 'Suspense',
  // renderer 通过标记发现 Suspense，再把底层能力传给 process。若 renderer 直接
  // import Suspense，未使用该功能的应用也无法将实现 tree-shake 掉。
  __isSuspense: true,
  /** renderer 的 Suspense 分派入口；首次 mount 收集默认分支依赖，更新复用 boundary。父边界仍 pending 且本边界未处 fallback 时只迁移引用，交由父树处理以免重复 patch。 */
  process(
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
    // 由具体平台 renderer 传入 patch/move/unmount 等宿主无关内部能力。
    rendererInternals: RendererInternals,
  ): void {
    if (n1 == null) {
      mountSuspense(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
        rendererInternals,
      )
    } else {
      // #8678：父 Suspense 仍 pending 时，它的 pendingBranch 已包含当前边界。本轮若
      // 同时单独 patch 子边界，之后父分支挂载又会处理一次，导致内部组件重复 mount。
      // 因而这里只迁移 boundary/VNode 引用，让父边界成为唯一的实际 patch 入口。
      if (
        parentSuspense &&
        parentSuspense.deps > 0 &&
        !n1.suspense!.isInFallback
      ) {
        n2.suspense = n1.suspense!
        n2.suspense.vnode = n2
        n2.el = n1.el
        return
      }
      patchSuspense(
        n1,
        n2,
        container,
        anchor,
        parentComponent,
        namespace,
        slotScopeIds,
        optimized,
        rendererInternals,
      )
    }
  },
  hydrate: hydrateSuspense as typeof hydrateSuspense,
  normalize: normalizeSuspenseChildren as typeof normalizeSuspenseChildren,
}

/** Suspense 的公共构造类型，供 `h()`/TSX 推导 props 及 default/fallback 插槽。 */
export const Suspense = (__FEATURE_SUSPENSE__
  ? SuspenseImpl
  : null) as unknown as {
  /** 供 renderer 按类型分派的内置字面量标记。 */
  __isSuspense: true
  /** h/TSX 使用的虚拟构造协议，运行时对象由 renderer 特殊处理。 */
  new (): {
    /** VNode 属性与 Suspense 事件/超时/嵌套捕获参数的交集。 */
    $props: VNodeProps & SuspenseProps
    /** 默认内容和 fallback 的单根插槽协议。 */
    $slots: {
      /** 返回默认内容节点列表，规范化后形成 ssContent。 */
      default(): VNode[]
      /** 返回等待期间备用内容，规范化后形成 ssFallback。 */
      fallback(): VNode[]
    }
  }
}

/** 调用 VNode 上的 Suspense 事件监听器；缺失或非函数时忽略。 */
function triggerEvent(
  vnode: VNode,
  name: 'onResolve' | 'onPending' | 'onFallback',
) {
  const eventListener = vnode.props && vnode.props[name]
  if (isFunction(eventListener)) {
    eventListener()
  }
}

/**
 * 首次挂载 Suspense：先把默认分支 patch 到离屏容器，以收集 async setup 依赖。
 * 有依赖则在真实容器挂载 fallback；没有依赖则直接 resolve 并移入默认内容。
 */
function mountSuspense(
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
) {
  const {
    p: patch,
    o: { createElement },
  } = rendererInternals
  const hiddenContainer = createElement('div')
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    container,
    hiddenContainer,
    anchor,
    namespace,
    slotScopeIds,
    optimized,
    rendererInternals,
  ))

  // 默认内容必须完整执行 mount 才能发现深层异步依赖，但此时不能让半成品出现在
  // 页面上，所以先挂载到离屏宿主容器。
  patch(
    null,
    (suspense.pendingBranch = vnode.ssContent!),
    hiddenContainer,
    null,
    parentComponent,
    suspense,
    namespace,
    slotScopeIds,
  )
  // patch 过程中每个 async setup 都会 registerDep 并增加 deps。
  if (suspense.deps > 0) {
    // 有异步依赖：通知 pending/fallback，并在真实容器显示备用分支。
    triggerEvent(vnode, 'onPending')
    triggerEvent(vnode, 'onFallback')

    // fallback 不属于当前 Suspense 的依赖收集范围，否则备用内容自身异步会造成死等。
    patch(
      null,
      vnode.ssFallback!,
      container,
      anchor,
      parentComponent,
      null, // fallback 树不继承当前 suspense 上下文
      namespace,
      slotScopeIds,
    )
    setActiveBranch(suspense, vnode.ssFallback!)
  } else {
    // 没有异步依赖，离屏内容可以同步进入真实容器。
    suspense.resolve(false, true)
  }
}

/**
 * 更新已有 Suspense 边界。
 *
 * 核心分为：已有 pending 分支时继续/替换它；没有 pending 时普通 patch 当前分支，
 * 或为新的根分支开启一次 pending 周期。`pendingId` 负责废弃旧 Promise 回调。
 */
function patchSuspense(
  n1: VNode,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
  { p: patch, um: unmount, o: { createElement } }: RendererInternals,
) {
  const suspense = (n2.suspense = n1.suspense)!
  suspense.vnode = n2
  n2.el = n1.el
  const newBranch = n2.ssContent!
  const newFallback = n2.ssFallback!

  const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense
  if (pendingBranch) {
    // 已经在等待异步分支：先将边界的目标更新为本轮 newBranch。
    suspense.pendingBranch = newBranch
    if (isSameVNodeType(pendingBranch, newBranch)) {
      // 根类型相同可直接 patch 离屏 pending 树，保留其中已创建的组件/DOM。
      patch(
        pendingBranch,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        namespace,
        slotScopeIds,
        optimized,
      )
      if (suspense.deps <= 0) {
        suspense.resolve()
      } else if (isInFallback) {
        // 水合期间，子组件 setup 可能同步触发更新，但页面当前实际是 SSR content，
        // 并未显示 fallback。若此时按 isInFallback 去 patch，会把真实 SSR DOM 当成
        // fallback 处理而产生错配；因此 hydration 状态下该操作必须为 no-op。
        if (!isHydrating) {
          patch(
            activeBranch,
            newFallback,
            container,
            anchor,
            parentComponent,
            null, // fallback 树不收集到当前 suspense
            namespace,
            slotScopeIds,
            optimized,
          )
          setActiveBranch(suspense, newFallback)
        }
      }
    } else {
      // pending 尚未完成，根类型就切换：开启新版本，使旧分支稍后 resolve 的 Promise
      // 因 pendingId 不匹配而自动失效。
      suspense.pendingId = suspenseId++
      if (isHydrating) {
        // hydration 未结束就切换，现有 SSR DOM 已不再对应目标树。把旧 pending 暂作
        // activeBranch，退出水合模式，随后 resolve 时即可按普通旧分支将它卸载。
        suspense.isHydrating = false
        suspense.activeBranch = pendingBranch
      } else {
        unmount(pendingBranch, parentComponent, suspense)
      }
      // 新分支重新收集依赖；旧 deps 属于已废弃 Promise，不能继续计数。
      suspense.deps = 0
      // 旧 pending 分支未展示，其 mounted/watch post effects 也必须丢弃。
      suspense.effects.length = 0
      // 换用新的离屏容器，避免与旧分支遗留宿主节点混在同一范围。
      suspense.hiddenContainer = createElement('div')

      if (isInFallback) {
        // 已显示 fallback：后台挂载新 pending；仍未完成时同步更新页面上的 fallback。
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        if (suspense.deps <= 0) {
          suspense.resolve()
        } else {
          patch(
            activeBranch,
            newFallback,
            container,
            anchor,
            parentComponent,
            null, // fallback 树不收集到当前 suspense
            namespace,
            slotScopeIds,
            optimized,
          )
          setActiveBranch(suspense, newFallback)
        }
      } else if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
        // 又切回当前已显示的分支，可在真实容器正常 patch，并强制结束这轮 pending。
        patch(
          activeBranch,
          newBranch,
          container,
          anchor,
          parentComponent,
          suspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        // resume=true 避免再移动/卸载本来就处于活动状态的同一分支。
        suspense.resolve(true)
      } else {
        // 切到第三种根：继续在新离屏容器收集依赖，页面暂时保留旧 activeBranch。
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          namespace,
          slotScopeIds,
          optimized,
        )
        if (suspense.deps <= 0) {
          suspense.resolve()
        }
      }
    }
  } else {
    if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
      // 根类型未变，没有新的 pending 周期，直接像普通子树一样 patch。
      patch(
        activeBranch,
        newBranch,
        container,
        anchor,
        parentComponent,
        suspense,
        namespace,
        slotScopeIds,
        optimized,
      )
      setActiveBranch(suspense, newBranch)
    } else {
      // 根节点切换，开启新 pending 周期并通知用户。
      triggerEvent(n2, 'onPending')
      // 新分支先挂离屏容器；KeepAlive 恢复的组件沿用其原 suspenseId，确保异步回调
      // 与创建它的那一轮边界版本一致。
      suspense.pendingBranch = newBranch
      if (newBranch.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        suspense.pendingId = newBranch.component!.suspenseId!
      } else {
        suspense.pendingId = suspenseId++
      }
      patch(
        null,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        namespace,
        slotScopeIds,
        optimized,
      )
      if (suspense.deps <= 0) {
        // 新分支同步完成，立即替换活动内容。
        suspense.resolve()
      } else {
        // 更新期间可以继续展示旧 activeBranch，直到 timeout 到期。闭包捕获 pendingId，
        // 若期间又切换分支，旧定时器因版本不匹配不会错误显示旧 fallback。
        const { timeout, pendingId } = suspense
        if (timeout > 0) {
          setTimeout(() => {
            if (suspense.pendingId === pendingId) {
              suspense.fallback(newFallback)
            }
          }, timeout)
        } else if (timeout === 0) {
          suspense.fallback(newFallback)
        }
      }
    }
  }
}

/**
 * 一个 Suspense 实例的完整运行时状态与操作协议。
 *
 * `activeBranch` 是边界当前采用的逻辑活动分支；out-in 等待期间，其 DOM 可能尚未搬入
 * 真实容器。`pendingBranch` 通常在 hiddenContainer 准备，水合时则认领已可见的 SSR DOM。
 * `deps` 计入 async setup 与向本 pending 边界登记的 suspensible 子边界；
 * `effects` 缓冲 mounted/updated 等提交后副作用。
 */
export interface SuspenseBoundary {
  /** 当前 Suspense 外壳 VNode。 */
  vnode: VNode<RendererNode, RendererElement, SuspenseProps>
  /** 嵌套的父边界。 */
  parent: SuspenseBoundary | null
  /** 边界所属组件上下文，传给分支 patch/unmount 与 HOC 根引用更新。 */
  parentComponent: ComponentInternalInstance | null
  /** 创建分支宿主节点时沿用的 HTML/SVG/MathML 命名空间。 */
  namespace: ElementNamespace
  /** 活动分支所在的真实容器。 */
  container: RendererElement
  /** pending 分支的离屏容器。 */
  hiddenContainer: RendererElement
  /** 逻辑活动的 content 或 fallback；out-in 等待期间不保证其 DOM 已进入真实容器。 */
  activeBranch: VNode | null
  /** fallback 是否因 out-in 过渡而正在等待旧分支离场。 */
  isFallbackMountPending: boolean
  /** 正在准备的默认内容分支。 */
  pendingBranch: VNode | null
  /** 当前 pending 周期尚未结算的依赖数，包括 async setup 和登记的 suspensible 子边界。 */
  deps: number
  /** 当前 pending 周期版本号。 */
  pendingId: number
  /** 更新分支等待多久后显示 fallback；-1 表示不自动显示。 */
  timeout: number
  /** 逻辑上处于/进入 fallback；out-in 等待时 fallback DOM 可能尚未挂载，resolve 会清除此标记。 */
  isInFallback: boolean
  /** pending 默认分支正在认领可见 SSR DOM；resolve 在此模式仅结算，不移动/卸载已有内容。 */
  isHydrating: boolean
  /** 边界已销毁，晚到的 async setup 完成回调必须退出。 */
  isUnmounted: boolean
  /** pending 期间暂缓的提交后副作用。 */
  effects: Function[]
  /** 结算 pending 默认内容；第一参数在实现中名为 resume，表示复用已在真实容器的分支，sync 表示不要立即递归 resolve 父依赖。 */
  resolve(force?: boolean, sync?: boolean): void
  /** 仍有 pending 时启动 fallback 切换；out-in 先等旧分支离场，逻辑标记先于实际挂载。 */
  fallback(fallbackVNode: VNode): void
  /** 移动逻辑活动分支并更新真实目标容器；后台 pending 内容留在其准备位置。 */
  move(
    container: RendererElement,
    anchor: RendererNode | null,
    type: MoveType,
  ): void
  /** 取得活动分支范围后的宿主节点，供父渲染器选择插入锚点。 */
  next(): RendererNode | null
  /** 登记 async setup；仅登记时 pending 才增加 deps，完成后检查实例/边界/版本，恢复渲染并在最后依赖结束时 resolve。 */
  registerDep(
    instance: ComponentInternalInstance,
    setupRenderEffect: SetupRenderEffectFn,
    optimized: boolean,
  ): void
  /** 销毁活动与 pending 分支，先标记 isUnmounted 令异步完成回调失效；doRemove 控制宿主删除。 */
  unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}

/** 开发环境中只提示一次 Suspense 实验性 API，避免每个实例重复刷屏。 */
let hasWarned = false

/**
 * 创建 Suspense 边界及其状态机方法。
 * 方法闭包持有 renderer internals，可在异步完成时跨越原 patch 调用继续移动、卸载、
 * 挂载分支；嵌套且 `suspensible` 的边界还会登记为父边界依赖。
 */
function createSuspenseBoundary(
  vnode: VNode,
  parentSuspense: SuspenseBoundary | null,
  parentComponent: ComponentInternalInstance | null,
  container: RendererElement,
  hiddenContainer: RendererElement,
  anchor: RendererNode | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  isHydrating = false,
): SuspenseBoundary {
  /* v8 ignore start */
  if (__DEV__ && !__TEST__ && !hasWarned) {
    hasWarned = true
    // @ts-expect-error `console.info` cannot be null error
    // eslint-disable-next-line no-console
    console[console.info ? 'info' : 'log'](
      `<Suspense> is an experimental feature and its API will likely change.`,
    )
  }
  /* v8 ignore stop */

  const {
    p: patch,
    m: move,
    um: unmount,
    n: next,
    o: { parentNode, remove },
  } = rendererInternals

  // suspensible=true 时，只有父边界正处于 pending 才需增加依赖；保存父 pendingId，
  // 当前边界完成时只结算同一轮父分支，不能影响后来新开的 pending 周期。
  let parentSuspenseId: number | undefined
  const isSuspensible = isVNodeSuspensible(vnode)
  if (isSuspensible) {
    if (parentSuspense && parentSuspense.pendingBranch) {
      parentSuspenseId = parentSuspense.pendingId
      parentSuspense.deps++
    }
  }

  const timeout = vnode.props ? toNumber(vnode.props.timeout) : undefined
  if (__DEV__) {
    assertNumber(timeout, `Suspense timeout`)
  }

  const initialAnchor = anchor
  const suspense: SuspenseBoundary = {
    vnode,
    parent: parentSuspense,
    parentComponent,
    namespace,
    container,
    hiddenContainer,
    deps: 0,
    pendingId: suspenseId++,
    timeout: typeof timeout === 'number' ? timeout : -1,
    activeBranch: null,
    isFallbackMountPending: false,
    pendingBranch: null,
    isInFallback: !isHydrating,
    isHydrating,
    isUnmounted: false,
    effects: [],

    /**
     * 提交已经完成的 pendingBranch。
     * 普通情况先卸载活动/fallback，再把离屏内容搬进真实容器；若有 out-in 过渡，
     * 则把移动动作挂到旧分支 afterLeave。最后结算嵌套边界与缓冲副作用。
     */
    resolve(resume = false, sync = false) {
      if (__DEV__) {
        if (!resume && !suspense.pendingBranch) {
          throw new Error(
            `suspense.resolve() is called without a pending branch.`,
          )
        }
        if (suspense.isUnmounted) {
          throw new Error(
            `suspense.resolve() is called on an already unmounted suspense boundary.`,
          )
        }
      }
      const {
        vnode,
        activeBranch,
        pendingBranch,
        pendingId,
        effects,
        parentComponent,
        container,
        isInFallback,
      } = suspense

      // out-in 要先完成旧 activeBranch 离场，再让 pendingBranch 入场。
      let delayEnter: boolean | null = false
      if (suspense.isHydrating) {
        suspense.isHydrating = false
      } else if (!resume) {
        delayEnter =
          activeBranch &&
          pendingBranch!.transition &&
          pendingBranch!.transition.mode === 'out-in'
        let hasUpdatedAnchor = false
        if (delayEnter) {
          /** out-in 延迟提交：仅捕获 pendingId 仍有效时移动新默认树并排队该轮 effects；随后清旧 fallback 的 el 引用。 */
          activeBranch!.transition!.afterLeave = () => {
            if (pendingId === suspense.pendingId) {
              move(
                pendingBranch!,
                container,
                anchor === initialAnchor && !hasUpdatedAnchor
                  ? next(activeBranch!)
                  : anchor,
                MoveType.ENTER,
              )
              queuePostFlushCb(effects)
              // 过渡结束后清掉 fallback VNode 的 DOM 引用，让已移除节点可被回收。
              if (isInFallback && vnode.ssFallback) {
                vnode.ssFallback.el = null
              }
            }
          }
        }
        // #7966：Suspense 外包 Transition 时，fallback 可能在 afterLeave 之前仍未挂载，
        // 此窗口 activeBranch 仍指向正在离场的旧内容。resolve 不得再次 unmount，
        // 否则离场钩子重复执行、DOM 被提前删除；isFallbackMountPending 标记此窗口。
        if (activeBranch && !suspense.isFallbackMountPending) {
          // fallback 可能随父 Suspense 被移动过，插入点必须以当前真实 DOM 重新计算。
          // #8105：delayEnter 期间若再次切换，active/pending 可能暂时同处离屏容器，
          // 过早 next(activeBranch) 会误拿 pendingBranch.el。只有确认 activeBranch
          // 仍位于真实 container 时才记录最新 anchor，并让 afterLeave 使用该结果。
          if (parentNode(activeBranch.el!) === container) {
            anchor = next(activeBranch)
            hasUpdatedAnchor = true
          }
          unmount(activeBranch, parentComponent, suspense, true)
          // 无延迟过渡时也在提交后清理 fallback DOM 引用。
          if (!delayEnter && isInFallback && vnode.ssFallback) {
            queuePostRenderEffect(() => (vnode.ssFallback!.el = null), suspense)
          }
        }
        if (!delayEnter) {
          // 同步把已完成内容从离屏容器移到真实容器。
          move(pendingBranch!, container, anchor, MoveType.ENTER)
        }
      }

      suspense.isFallbackMountPending = false
      setActiveBranch(suspense, pendingBranch!)
      suspense.pendingBranch = null
      suspense.isInFallback = false

      // pending 分支中的 mounted/updated/watch post 等副作用不能在节点尚未显示时执行。
      // 若祖先仍 pending，就合并到最近祖先继续等待；否则进入全局 post-flush 队列。
      let parent = suspense.parent
      let hasUnresolvedAncestor = false
      while (parent) {
        if (parent.pendingBranch) {
          // 最近 pending 祖先会在整棵可见树提交时统一冲刷这些任务。
          for (let i = 0; i < effects.length; i++) {
            parent.effects.push(effects[i])
          }
          hasUnresolvedAncestor = true
          break
        }
        parent = parent.parent
      }
      // 无 pending 祖先且没有 out-in 延迟，当前分支已经可见，可以执行所有任务。
      if (!hasUnresolvedAncestor && !delayEnter) {
        queuePostFlushCb(effects)
      }
      suspense.effects = []

      // 当前边界作为父依赖时，仅在父仍处于登记时那一轮 pending 才减计数。
      if (isSuspensible) {
        if (
          parentSuspense &&
          parentSuspense.pendingBranch &&
          parentSuspenseId === parentSuspense.pendingId
        ) {
          parentSuspense.deps--
          if (parentSuspense.deps === 0 && !sync) {
            parentSuspense.resolve()
          }
        }
      }

      // 状态和父依赖均结算后通知用户 resolve；out-in 的实际 move 仍由 afterLeave 执行。
      triggerEvent(vnode, 'onResolve')
    },

    /**
     * 在真实容器显示 fallback。
     * 若 fallback 使用 out-in 过渡，先卸载当前分支并等待其 afterLeave，再挂备用树；
     * 否则立即替换。fallback 不继承本边界，避免其异步依赖阻塞默认内容 resolve。
     */
    fallback(fallbackVNode) {
      if (!suspense.pendingBranch) {
        return
      }

      const { vnode, activeBranch, parentComponent, container, namespace } =
        suspense

      // 事件在开始切换时触发，不等待过渡完成。
      triggerEvent(vnode, 'onFallback')

      const anchor = next(activeBranch!)
      /** 旧分支离场后的备用树挂载器；先清等待标记，若默认内容已经 resolve 则取消，仍处 fallback 才 patch 并更新 activeBranch。 */
      const mountFallback = () => {
        suspense.isFallbackMountPending = false
        if (!suspense.isInFallback) {
          return
        }
        // 若 pending 已在等待离场期间 resolve，isInFallback 会被清掉，此任务必须取消。
        patch(
          null,
          fallbackVNode,
          container,
          anchor,
          parentComponent,
          null, // fallback 树不收集到当前 suspense
          namespace,
          slotScopeIds,
          optimized,
        )
        setActiveBranch(suspense, fallbackVNode)
      }

      const delayEnter =
        fallbackVNode.transition && fallbackVNode.transition.mode === 'out-in'
      if (delayEnter) {
        suspense.isFallbackMountPending = true
        activeBranch!.transition!.afterLeave = mountFallback
      }
      suspense.isInFallback = true

      // 当前分支的卸载钩子应立即进入普通 post 队列，不能缓冲到正在等待的 suspense。
      unmount(
        activeBranch!,
        parentComponent,
        null, // 不传 suspense，卸载钩子现在即可触发
        true, // 物理移除宿主节点
      )

      if (!delayEnter) {
        mountFallback()
      }
    },

    /** 父级移动 Suspense 时，只移动当前可见分支，并更新之后 resolve 的目标容器。 */
    move(container, anchor, type) {
      suspense.activeBranch &&
        move(suspense.activeBranch, container, anchor, type)
      suspense.container = container
    },

    /** 返回当前活动分支之后的宿主节点，供父 renderer 确定插入锚点。 */
    next() {
      return suspense.activeBranch && next(suspense.activeBranch)
    },

    /**
     * 登记一个返回 Promise 的 setup，并在其完成后继续组件首次渲染。
     * 组件可能在等待期间被卸载、移动或收到更新，因此完成回调必须校验边界版本，
     * 重新查找容器/锚点，并把 hydration 已存在的 el 迁移到最新 VNode。
     */
    registerDep(instance, setupRenderEffect, optimized) {
      const isInPendingSuspense = !!suspense.pendingBranch
      if (isInPendingSuspense) {
        suspense.deps++
      }
      const hydratedEl = instance.vnode.el
      instance
        .asyncDep!.catch(err => {
          handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
        })
        .then(asyncSetupResult => {
          // Promise resolve 时重试；组件/边界可能已卸载，或当前 pending 已是新版本。
          if (
            instance.isUnmounted ||
            suspense.isUnmounted ||
            suspense.pendingId !== instance.suspenseId
          ) {
            return
          }
          // withAsyncContext 会把 currentInstance 清理延迟到后续微任务；Suspense 此刻
          // 可能重入另一个组件渲染。先显式清空，避免组合式 API 错绑到旧异步组件。
          unsetCurrentInstance()
          // 将 async setup 结果装入实例，然后从该组件恢复首次 render effect。
          instance.asyncResolved = true
          const { vnode } = instance
          if (__DEV__) {
            pushWarningContext(vnode)
          }
          handleSetupResult(instance, asyncSetupResult, false)
          if (hydratedEl) {
            // 等待期间组件可能已更新并替换 vnode；把 SSR DOM 引用迁移到最新 vnode。
            vnode.el = hydratedEl
          }
          const placeholder = !hydratedEl && instance.subTree.el
          setupRenderEffect(
            instance,
            vnode,
            // 等待期间父分支可能移动。非水合时 subTree 是注释占位符，从其当前 parent
            // 反查真实容器，不能使用注册依赖时捕获的旧 container。
            parentNode(hydratedEl || instance.subTree.el!)!,
            // 水合会复用 hydratedEl，不用 anchor；普通挂载插在占位符的下一个兄弟前。
            hydratedEl ? null : next(instance.subTree),
            suspense,
            namespace,
            optimized,
          )
          if (placeholder) {
            // 真实子树完成后清除临时注释及 VNode 上的占位引用。
            vnode.placeholder = null
            remove(placeholder)
          }
          updateHOCHostEl(instance, vnode.el)
          if (__DEV__) {
            popWarningContext()
          }
          // 只有注册时边界处于 pending 才参与 deps；最后一个依赖完成即提交整条分支。
          if (isInPendingSuspense && --suspense.deps === 0) {
            suspense.resolve()
          }
        })
    },

    /** 卸载活动与后台 pending 两条分支，并使稍后到达的异步回调全部失效。 */
    unmount(parentSuspense, doRemove) {
      suspense.isUnmounted = true
      if (suspense.activeBranch) {
        unmount(
          suspense.activeBranch,
          parentComponent,
          parentSuspense,
          doRemove,
        )
      }
      if (suspense.pendingBranch) {
        unmount(
          suspense.pendingBranch,
          parentComponent,
          parentSuspense,
          doRemove,
        )
      }
    },
  }

  return suspense
}

/**
 * 水合服务端输出的 Suspense 内容。
 * 服务器渲染器输出默认内容分支，并等待其中异步组件；失败走错误处理，不自动输出
 * Suspense fallback。客户端以 ssContent 建立 pending 分支并水合现有 DOM，异步依赖
 * 未结束时保持 isHydrating/pending，完成后只结算分支状态，不再搬移已显示的 SSR 节点。
 */
function hydrateSuspense(
  node: Node,
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  namespace: ElementNamespace,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  hydrateNode: (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => Node | null,
): Node | null {
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    node.parentNode!,
    // eslint-disable-next-line no-restricted-globals
    document.createElement('div'),
    null,
    namespace,
    slotScopeIds,
    optimized,
    rendererInternals,
    true /* 水合中 */,
  ))
  // 先创建 boundary，再以默认内容作为 pendingBranch 认领 SSR DOM，过程中遇到的
  // async setup 才能 registerDep。此时 activeBranch 尚为空；deps 清零后的 resolve
  // 将 pendingBranch 记为 activeBranch，水合路径跳过普通的卸载/移动操作。
  const result = hydrateNode(
    node,
    (suspense.pendingBranch = vnode.ssContent!),
    parentComponent,
    suspense,
    slotScopeIds,
    optimized,
  )
  if (suspense.deps === 0) {
    suspense.resolve(false, true)
  }
  return result
}

/** 将 Suspense 的 children 规范化为单根 `ssContent` 与 `ssFallback` 两个分支。 */
function normalizeSuspenseChildren(vnode: VNode): void {
  const { shapeFlag, children } = vnode
  const isSlotChildren = shapeFlag & ShapeFlags.SLOTS_CHILDREN
  vnode.ssContent = normalizeSuspenseSlot(
    isSlotChildren ? (children as Slots).default : children,
  )
  vnode.ssFallback = isSlotChildren
    ? normalizeSuspenseSlot((children as Slots).fallback)
    : createVNode(Comment)
}

/**
 * 执行并规范化单个 Suspense 插槽，同时保留编译器 block tree 信息。
 * Suspense 的分支必须是单根 VNode；多根仅在开发环境提示，最终仍通过 normalizeVNode
 * 得到稳定节点。编译插槽执行时临时恢复 block tracking，避免丢失动态子节点快路径。
 */
function normalizeSuspenseSlot(s: any) {
  let block: VNode[] | null | undefined
  if (isFunction(s)) {
    const trackBlock = isBlockTreeEnabled && s._c
    if (trackBlock) {
      // `_d=false` 表示不要禁用 tracking：编译插槽平时为避免错误收集会关闭 block
      // tracking，此处正是在构建 Suspense 分支，需要临时恢复（见 componentRenderContext）。
      s._d = false
      openBlock()
    }
    s = s()
    if (trackBlock) {
      s._d = true
      block = currentBlock
      closeBlock()
    }
  }
  if (isArray(s)) {
    const singleChild = filterSingleRoot(s)
    if (
      __DEV__ &&
      !singleChild &&
      s.filter(child => child !== NULL_DYNAMIC_COMPONENT).length > 0
    ) {
      warn(`<Suspense> slots expect a single root node.`)
    }
    s = singleChild
  }
  s = normalizeVNode(s)
  if (block && !s.dynamicChildren) {
    // 插槽返回根本身不应出现在自己的 dynamicChildren 中，否则 patch 会递归处理自身。
    s.dynamicChildren = block.filter(c => c !== s)
  }
  return s
}

/**
 * 调度渲染提交后的副作用。
 * 若所在 Suspense 仍 pending，先缓存在 boundary.effects，防止 mounted/watch post 等
 * 在离屏 DOM 上提前执行；分支 resolve 后才转入全局 post-flush 队列。
 */
export function queueEffectWithSuspense(
  fn: Function | Function[],
  suspense: SuspenseBoundary | null,
): void {
  if (suspense && suspense.pendingBranch) {
    if (isArray(fn)) {
      suspense.effects.push(...fn)
    } else {
      suspense.effects.push(fn)
    }
  } else {
    queuePostFlushCb(fn)
  }
}

/**
 * 更新当前可见分支，并把其真实宿主根 el 同步到 Suspense 外壳及 HOC 祖先。
 * 高阶组件包裹异步组件时分支根可能暂时没有 el，需要沿 component.subTree 下钻到
 * 实际节点/注释占位符，父 renderer 才能正确移动和定位该边界。
 */
function setActiveBranch(suspense: SuspenseBoundary, branch: VNode) {
  suspense.activeBranch = branch
  const { vnode, parentComponent } = suspense
  let el = branch.el
  // 无 el 通常表示 HOC 包裹尚未解析的异步组件，沿子树找到真实占位节点。
  while (!el && branch.component) {
    branch = branch.component.subTree
    el = branch.el
  }
  vnode.el = el
  // Suspense 若恰好是父组件根节点，还要递归更新所有 HOC VNode 的 el 引用。
  if (parentComponent && parentComponent.subTree === vnode) {
    parentComponent.vnode.el = el
    updateHOCHostEl(parentComponent, el)
  }
}

/**
 * 判断当前边界是否应被父 Suspense 捕获。
 * 模板布尔 attribute 可能是空字符串，因此只把 null/undefined/false 视为关闭。
 */
function isVNodeSuspensible(vnode: VNode) {
  const suspensible = vnode.props && vnode.props.suspensible
  return suspensible != null && suspensible !== false
}
