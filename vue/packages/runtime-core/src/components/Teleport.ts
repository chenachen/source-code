import type { ComponentInternalInstance } from '../component'
import type { SuspenseBoundary } from './Suspense'
import {
  type ElementNamespace,
  MoveType,
  type RendererElement,
  type RendererInternals,
  type RendererNode,
  type RendererOptions,
  queuePostRenderEffect,
  traverseStaticChildren,
} from '../renderer'
import type { VNode, VNodeArrayChildren, VNodeProps } from '../vnode'
import { ShapeFlags, isString } from '@vue/shared'
import { warn } from '../warning'
import { isHmrUpdating } from '../hmr'
import { type SchedulerJob, SchedulerJobFlags } from '../scheduler'

/** 带 Teleport props、主视图锚点和目标容器信息的专用 VNode 类型。 */
export type TeleportVNode = VNode<RendererNode, RendererElement, TeleportProps>

/** `<Teleport>` 的运行时参数。 */
export interface TeleportProps {
  /** CSS 选择器或宿主元素；决定 children 实际插入的位置。 */
  to: string | RendererElement | null | undefined
  /** 为真时不传送，children 保留在组件原位置。 */
  disabled?: boolean
  /** 将目标解析与挂载延迟到本轮其余内容渲染完成之后。 */
  defer?: boolean
}

/**
 * 尚未执行的延迟挂载任务。WeakMap 不会阻止旧 VNode 回收，也用于更新/卸载时
 * 取消过时任务，避免旧 children 在新一轮渲染后才被挂载。
 */
const pendingMounts = new WeakMap<VNode, SchedulerJob>()

/**
 * 写在目标起始锚点上的私有键，值为结束锚点；渲染器查找 nextSibling 时可一次
 * 跳过整段 Teleport 内容，而不把目标中的远端节点误认为主视图兄弟。
 */
export const TeleportEndKey: unique symbol = Symbol('_vte')

/** 通过内置标记识别 Teleport，避免 renderer 静态导入实现而影响 tree-shaking。 */
export const isTeleport = (type: any): boolean => type.__isTeleport

/** 布尔 attribute 可被编译为 `true` 或空字符串，两者都表示禁用传送。 */
const isTeleportDisabled = (props: VNode['props']): boolean =>
  props && (props.disabled || props.disabled === '')

/** 判断是否启用延迟挂载，兼容模板布尔 attribute 的空字符串形式。 */
const isTeleportDeferred = (props: VNode['props']): boolean =>
  props && (props.defer || props.defer === '')

/** 目标是否位于 SVG 命名空间；非浏览器宿主环境会安全返回 false。 */
const isTargetSVG = (target: RendererElement): boolean =>
  typeof SVGElement !== 'undefined' && target instanceof SVGElement

/** 目标是否位于 MathML 命名空间。 */
const isTargetMathML = (target: RendererElement): boolean =>
  typeof MathMLElement === 'function' && target instanceof MathMLElement

/**
 * 将 `to` 解析为宿主元素。
 * 字符串依赖 renderer 提供 querySelector；元素引用则直接使用。启用状态下找不到
 * 目标会在开发环境提示，因为 children 无法安全挂载到不存在的容器。
 */
const resolveTarget = <T = RendererElement>(
  props: TeleportProps | null,
  select: RendererOptions['querySelector'],
): T | null => {
  const targetSelector = props && props.to
  if (isString(targetSelector)) {
    if (!select) {
      __DEV__ &&
        warn(
          `Current renderer does not support string target for Teleports. ` +
            `(missing querySelector renderer option)`,
        )
      return null
    } else {
      const target = select(targetSelector)
      if (__DEV__ && !target && !isTeleportDisabled(props)) {
        warn(
          `Failed to locate Teleport target with selector "${targetSelector}". ` +
            `Note the target element must exist before the component is mounted - ` +
            `i.e. the target cannot be rendered by the component itself, and ` +
            `ideally should be outside of the entire Vue component tree.`,
        )
      }
      return target as T
    }
  } else {
    if (__DEV__ && !targetSelector && !isTeleportDisabled(props)) {
      warn(`Invalid Teleport target: ${targetSelector}`)
    }
    return targetSelector as T
  }
}

/**
 * Teleport 的平台无关实现，由 renderer 通过 `process/remove/move/hydrate` 协议调用。
 *
 * 主视图只保留 start/end 锚点；children 通常位于目标容器的另一对锚点之间。
 * disabled、to 变化和列表重排，本质上都是在这两组边界间移动同一批宿主节点。
 */
export const TeleportImpl = {
  name: 'Teleport',
  __isTeleport: true,
  /** renderer 的 Teleport 挂载/更新入口：维护主树与目标锚点，先 patch 旧物理容器中的 children，再按 disabled/to 变化移动；defer/pending Suspense 用可废弃 job 挂最新 VNode。 */
  process(
    n1: TeleportVNode | null,
    n2: TeleportVNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    namespace: ElementNamespace,
    slotScopeIds: string[] | null,
    optimized: boolean,
    internals: RendererInternals,
  ): void {
    const {
      mc: mountChildren,
      pc: patchChildren,
      pbc: patchBlockChildren,
      o: { insert, querySelector, createText, createComment, parentNode },
    } = internals

    const disabled = isTeleportDisabled(n2.props)
    let { dynamicChildren } = n2

    // #3302：HMR 可能改变编译器生成的 block/dynamicChildren 结构，旧块树已不可靠；
    // 强制完整 diff，避免只更新旧动态列表而漏掉热更新新增或删除的静态根节点。
    if (__DEV__ && isHmrUpdating) {
      optimized = false
      dynamicChildren = null
    }

    /** 把 Teleport 的数组 children 挂载到指定容器和结束锚点之前。 */
    const mount = (
      vnode: TeleportVNode,
      container: RendererElement,
      anchor: RendererNode,
    ) => {
      // 编译器与 VNode children 规范化共同保证 Teleport 只有数组 children 或空内容。
      if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        mountChildren(
          vnode.children as VNodeArrayChildren,
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

    /** 解析目标、建立目标锚点，并在启用状态下把 children 挂载到目标。 */
    const mountToTarget = (vnode: TeleportVNode = n2) => {
      const disabled = isTeleportDisabled(vnode.props)
      const target = (vnode.target = resolveTarget(vnode.props, querySelector))
      const targetAnchor = prepareAnchor(target, vnode, createText, insert)
      if (target) {
        // #2652：Teleport 可能从普通 HTML 树传送进 `<svg>`/`<math>`，创建 children
        // 时必须以目标而非来源容器确定命名空间，否则会生成错误类型的 DOM 元素。
        if (namespace !== 'svg' && isTargetSVG(target)) {
          namespace = 'svg'
        } else if (namespace !== 'mathml' && isTargetMathML(target)) {
          namespace = 'mathml'
        }

        // 自定义元素需记录远端目标，以便断开连接、样式和宿主生命周期处理。
        if (parentComponent && parentComponent.isCE) {
          ;(
            parentComponent.ce!._teleportTargets ||
            (parentComponent.ce!._teleportTargets = new Set())
          ).add(target)
        }

        if (!disabled) {
          mount(vnode, target, targetAnchor)
          updateCssVars(vnode, false)
        }
      } else if (__DEV__ && !disabled) {
        warn('Invalid Teleport target on mount:', target, `(${typeof target})`)
      }
    }

    /**
     * 为 defer 或 pending Suspense 排队目标挂载。
     * WeakMap 中的身份检查让新一次更新可以废弃旧任务，保证最终只挂载最新 VNode。
     */
    const queuePendingMount = (vnode: TeleportVNode) => {
      /** 执行当前 VNode 仍持有的挂载 job，先删除 pending 记录；disabled 从主锚点的现父重新找容器，随后解析/建立远端锚点，避免使用 Suspense 移动前的旧位置。 */
      const mountJob: SchedulerJob = () => {
        if (pendingMounts.get(vnode) !== mountJob) return
        pendingMounts.delete(vnode)
        if (isTeleportDisabled(vnode.props)) {
          // Suspense resolve 期间可能已把整条分支移动到另一容器，闭包捕获的 container
          // 会过期；从当前占位节点反查父容器，才能把 disabled children 放到正确位置。
          const mountContainer = parentNode(vnode.el!) || container
          mount(vnode, mountContainer, vnode.anchor!)
          updateCssVars(vnode, true)
        }
        mountToTarget(vnode)
      }
      pendingMounts.set(vnode, mountJob)
      queuePostRenderEffect(mountJob, parentSuspense)
    }

    if (n1 == null) {
      // 主视图始终插入开始/结束锚点。即使内容远端渲染，diff、移动和卸载仍需要
      // 这两个位置标记 Teleport 在逻辑 children 中所占的范围。
      const placeholder = (n2.el = __DEV__
        ? createComment('teleport start')
        : createText(''))
      const mainAnchor = (n2.anchor = __DEV__
        ? createComment('teleport end')
        : createText(''))
      insert(placeholder, container, anchor)
      insert(mainAnchor, container, anchor)

      if (
        isTeleportDeferred(n2.props) ||
        (__FEATURE_SUSPENSE__ && parentSuspense && parentSuspense.pendingBranch)
      ) {
        queuePendingMount(n2)
        return
      }

      if (disabled) {
        mount(n2, container, mainAnchor)
        updateCssVars(n2, true)
      }

      mountToTarget()
    } else {
      // 更新复用主视图锚点和目标锚点，避免重新创建/丢失现有 DOM 范围。
      n2.el = n1.el
      const mainAnchor = (n2.anchor = n1.anchor)!
      // defer 或父 Suspense 可能仍缓存着首次挂载任务。此时废弃旧 job 并为最新
      // VNode 重新排队，否则旧 props/children 会在本轮更新结束后反而覆盖新状态。
      const pendingMount = pendingMounts.get(n1)
      if (pendingMount) {
        pendingMount.flags! |= SchedulerJobFlags.DISPOSED
        pendingMounts.delete(n1)
        queuePendingMount(n2)
        return
      }
      n2.targetStart = n1.targetStart
      const target = (n2.target = n1.target)!
      const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
      const wasDisabled = isTeleportDisabled(n1.props)
      const currentContainer = wasDisabled ? container : target
      const currentAnchor = wasDisabled ? mainAnchor : targetAnchor

      if (namespace === 'svg' || isTargetSVG(target)) {
        namespace = 'svg'
      } else if (namespace === 'mathml' || isTargetMathML(target)) {
        namespace = 'mathml'
      }

      if (dynamicChildren) {
        // Teleport 是 block root 时只 patch 编译器记录的动态 children。
        patchBlockChildren(
          n1.dynamicChildren!,
          dynamicChildren,
          currentContainer,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
        )
        // 即使走块优化，根级静态节点也必须继承旧 DOM 引用，后续切换 disabled/to 时
        // 才能整段移动。开发环境为 HMR 深度遍历，生产只处理必要层级。
        traverseStaticChildren(n1, n2, !__DEV__)
      } else if (!optimized) {
        patchChildren(
          n1,
          n2,
          currentContainer,
          currentAnchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          false,
        )
      }

      if (disabled) {
        if (!wasDisabled) {
          // enabled -> disabled：把目标范围中的 children 搬回主视图结束锚点之前。
          moveTeleport(
            n2,
            container,
            mainAnchor,
            internals,
            TeleportMoveTypes.TOGGLE,
          )
        } else {
          // #7835：disabled 期间不应实际切换目标。这里把新 VNode 的 to 恢复为旧值，
          // 防止连续禁用更新时基准不断漂移；重新 enabled 后才能从当前有效目标移动。
          if (n2.props && n1.props && n2.props.to !== n1.props.to) {
            n2.props.to = n1.props.to
          }
        }
      } else {
        // 启用状态下 to 改变：建立/移动到新目标；否则若之前 disabled，搬回既有目标。
        if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
          const nextTarget = resolveTarget(n2.props, querySelector)
          if (nextTarget) {
            n2.target = nextTarget
            moveTeleport(
              n2,
              nextTarget,
              null,
              internals,
              TeleportMoveTypes.TARGET_CHANGE,
            )
          } else if (__DEV__) {
            warn(
              'Invalid Teleport target on update:',
              target,
              `(${typeof target})`,
            )
          }
        } else if (wasDisabled) {
          // disabled -> enabled：把主视图 children 搬到目标结束锚点之前。
          moveTeleport(
            n2,
            target,
            targetAnchor,
            internals,
            TeleportMoveTypes.TOGGLE,
          )
        }
      }
      updateCssVars(n2, disabled)
    }
  },

  /** 取消尚未执行的挂载 job，并清理目标锚点。未挂载 children 不执行卸载；已挂载远端内容必须移除，disabled 主树内容按 doRemove 处理。 */
  remove(
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    { um: unmount, o: { remove: hostRemove } }: RendererInternals,
    doRemove: boolean,
  ): void {
    const {
      shapeFlag,
      children,
      anchor,
      targetStart,
      targetAnchor,
      target,
      props,
    } = vnode
    const disabled = isTeleportDisabled(props)
    // disabled 时 children 在主容器，是否物理删除服从调用方 doRemove；启用时 children
    // 位于远端目标，Teleport 被卸载便必须移除，不能遗留孤儿 DOM。
    const shouldRemove = doRemove || !disabled
    // pending Suspense 内的 defer Teleport 可能在任务执行前已卸载。必须处置排队 job；
    // 此时 children 从未挂载，下面也要跳过逐个 unmount，避免对空 el 执行宿主删除。
    const pendingMount = pendingMounts.get(vnode)
    if (pendingMount) {
      pendingMount.flags! |= SchedulerJobFlags.DISPOSED
      pendingMounts.delete(vnode)
    }

    if (target) {
      hostRemove(targetStart!)
      hostRemove(targetAnchor!)
    }

    // Teleport 自身真正卸载时，主视图结束锚点总要删除。
    doRemove && hostRemove(anchor!)
    // #14876：延迟任务仍 pending 表示 children 从未挂载，不得调用其卸载钩子/宿主删除。
    if (
      !pendingMount &&
      (disabled || target) &&
      shapeFlag & ShapeFlags.ARRAY_CHILDREN
    ) {
      for (let i = 0; i < (children as VNode[]).length; i++) {
        const child = (children as VNode[])[i]
        unmount(
          child,
          parentComponent,
          parentSuspense,
          shouldRemove,
          !!child.dynamicChildren,
        )
      }
    }
  },

  move: moveTeleport as typeof moveTeleport,
  hydrate: hydrateTeleport as typeof hydrateTeleport,
}

/** Teleport 移动的原因；原因决定只搬锚点还是连同 children 一起搬。 */
export enum TeleportMoveTypes {
  /** `to` 改变，目标锚点与 children 一起迁往新目标。 */
  TARGET_CHANGE,
  /** disabled 状态切换，children 在主视图与目标之间迁移。 */
  TOGGLE,
  /** Teleport 在主视图列表中重排；启用时远端 children 位置保持不变。 */
  REORDER,
}

/**
 * 根据移动原因调整 Teleport 的锚点和 children。
 * 列表重排时，启用的 Teleport 只移动主视图占位范围；disabled、目标切换时才移动
 * 实际 children，确保“逻辑位置”和“物理渲染位置”各自保持正确。
 */
function moveTeleport(
  vnode: VNode,
  container: RendererElement,
  parentAnchor: RendererNode | null,
  { o: { insert }, m: move }: RendererInternals,
  moveType: TeleportMoveTypes = TeleportMoveTypes.REORDER,
): void {
  // 目标变化先插入 targetAnchor，再用同一个 parentAnchor 移动 children。
  // process 的 TARGET_CHANGE 路径传入 null，二者依次追加，所以新目标内是
  // targetAnchor、children；targetStart 仍留在旧目标，不构成新的完整包围区间。
  if (moveType === TeleportMoveTypes.TARGET_CHANGE) {
    insert(vnode.targetAnchor!, container, parentAnchor)
  }
  const { el, anchor, shapeFlag, children, props } = vnode
  const isReorder = moveType === TeleportMoveTypes.REORDER
  // 主视图重排需要先插入开始锚点，再移动可能存在的 children，最后插入结束锚点。
  if (isReorder) {
    insert(el!, container, parentAnchor)
  }
  // 启用 Teleport 的主视图重排不应影响远端 children。只有非重排或 disabled 时才搬
  // children。#14701：pendingMount 表示 children 尚不存在，提前 move 会访问空 el，
  // 并可能打乱延迟任务最终选择的容器，因此必须跳过。
  if (!pendingMounts.has(vnode) && (!isReorder || isTeleportDisabled(props))) {
    // Teleport 只可能有数组 children 或无 children。
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move(
          (children as VNode[])[i],
          container,
          parentAnchor,
          MoveType.REORDER,
        )
      }
    }
  }
  // 最后移动主视图结束锚点，维持完整逻辑范围。
  if (isReorder) {
    insert(anchor!, container, parentAnchor)
  }
}

/**
 * SSR hydration 时附加在目标元素上的游标。
 * 多个 Teleport 可以共享一个目标，后一个必须从前一个结束锚点之后继续认领 DOM。
 */
interface TeleportTargetElement extends Element {
  /** last processed anchor：上一个已水合 Teleport 的结束位置之后。 */
  _lpa?: Node | null
}

/**
 * 复用 SSR 输出的 Teleport DOM，并恢复主视图/目标两套锚点。
 * 服务端可能把多个 Teleport 连续写入同一目标，因此不能只依赖 hydrateChildren 的
 * 返回值（其中还可能嵌套 Teleport），而要显式扫描特征注释并维护目标游标。
 */
function hydrateTeleport(
  node: Node,
  vnode: TeleportVNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  slotScopeIds: string[] | null,
  optimized: boolean,
  {
    o: { nextSibling, parentNode, querySelector, insert, createText },
  }: RendererInternals<Node, Element>,
  hydrateChildren: (
    node: Node | null,
    vnode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => Node | null,
): Node | null {
  // 向前扫描 SSR 注释，找到当前 Teleport 在目标中的 start/end。不能依赖
  // hydrateChildren 返回值，因为嵌套 Teleport 会让物理兄弟关系与逻辑子树不一致。
  /** 从目标游标扫描 SSR 的 Teleport 起止注释；记下 targetStart/targetAnchor，并把 _lpa 推进到结束锚点之后，供下一个共用目标的 Teleport 认领。 */
  function hydrateAnchor(
    target: TeleportTargetElement,
    targetNode: Node | null,
  ) {
    let targetAnchor = targetNode
    while (targetAnchor) {
      if (targetAnchor && targetAnchor.nodeType === 8) {
        if ((targetAnchor as Comment).data === 'teleport start anchor') {
          vnode.targetStart = targetAnchor
        } else if ((targetAnchor as Comment).data === 'teleport anchor') {
          vnode.targetAnchor = targetAnchor
          target._lpa =
            vnode.targetAnchor && nextSibling(vnode.targetAnchor as Node)
          break
        }
      }
      targetAnchor = nextSibling(targetAnchor)
    }
  }

  /** disabled 内容位于主视图，从起始占位符的下一个兄弟开始水合。 */
  function hydrateDisabledTeleport(node: Node, vnode: VNode) {
    vnode.anchor = hydrateChildren(
      nextSibling(node),
      vnode,
      parentNode(node)!,
      parentComponent,
      parentSuspense,
      slotScopeIds,
      optimized,
    )
  }

  const target = (vnode.target = resolveTarget<Element>(
    vnode.props,
    querySelector,
  ))
  const disabled = isTeleportDisabled(vnode.props)
  if (target) {
    // 多个 Teleport 共用目标时，从上一个结束点继续，而不是每次从 firstChild 开始，
    // 否则后一个会重复认领前一个的 DOM，造成整段 hydration mismatch。
    const targetNode =
      (target as TeleportTargetElement)._lpa || target.firstChild
    if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      if (disabled) {
        hydrateDisabledTeleport(node, vnode)
        hydrateAnchor(target as TeleportTargetElement, targetNode)
        if (!vnode.targetAnchor) {
          prepareAnchor(
            target,
            vnode,
            createText,
            insert,
            // 目标与主视图是同一元素时，新锚点插在当前节点前，避免改变接下来
            // hydrateChildren 所期望的兄弟顺序。
            parentNode(node)! === target ? node : null,
          )
        }
      } else {
        vnode.anchor = nextSibling(node)
        hydrateAnchor(target as TeleportTargetElement, targetNode)
        // #11400：某些 SSR 集成没有把 Teleport HTML 注入最终页面的正确目标位置，
        // 因而扫描不到 targetAnchor。主动补齐锚点，让后续更新至少能安全移动/卸载，
        // 而不是因空锚点崩溃或把目标中其他内容一并删除。
        if (!vnode.targetAnchor) {
          prepareAnchor(target, vnode, createText, insert)
        }

        hydrateChildren(
          targetNode && nextSibling(targetNode),
          vnode,
          target,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized,
        )
      }
    }
    updateCssVars(vnode, disabled)
  } else if (disabled) {
    if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      hydrateDisabledTeleport(node, vnode)
      vnode.targetStart = node
      vnode.targetAnchor = nextSibling(node)
    }
  }
  return vnode.anchor && nextSibling(vnode.anchor as Node)
}

/** 强制声明公共构造类型，供 `h()` 和 TSX 正确推导 Teleport props/默认插槽。 */
export const Teleport = TeleportImpl as unknown as {
  /** 供 renderer 分派的内置字面量标记。 */
  __isTeleport: true
  /** 供 h/TSX 推导 Teleport props/slots 的虚拟构造协议。 */
  new (): {
    /** VNode 通用属性与目标/禁用/延迟参数的交集。 */
    $props: VNodeProps & TeleportProps
    /** 逻辑默认 children 的公共类型；宿主位置由 Teleport 决定。 */
    $slots: {
      /** 返回要传送/原位渲染的 VNode 列表。 */
      default(): VNode[]
    }
  }
}

/**
 * 为 Teleport 范围内的真实元素标记 CSS 变量所有者，并触发组件的变量更新函数。
 * `<style vars>` 选择器依赖 `data-v-owner` 找到已移出组件 DOM 子树的远端节点。
 */
function updateCssVars(vnode: VNode, isDisabled: boolean) {
  // ctx.ut 存在即表示所有者使用了 CSS 变量；该能力仅由浏览器 runtime-dom 安装，
  // 因此下面可以直接使用 nodeType/setAttribute/nextSibling。
  const ctx = vnode.ctx
  if (ctx && ctx.ut) {
    let node, anchor
    if (isDisabled) {
      node = vnode.el
      anchor = vnode.anchor
    } else {
      node = vnode.targetStart
      anchor = vnode.targetAnchor
    }
    while (node && node !== anchor) {
      if (node.nodeType === 1) node.setAttribute('data-v-owner', ctx.uid)
      node = node.nextSibling
    }
    ctx.ut()
  }
}

/**
 * 首次为目标建立空文本起止锚点，并把结束引用写到开始节点的 TeleportEndKey。
 * 有 target 时依序插入，返回结束锚点供 children 挂在其前；目标后续切换只移动结束锚点，因此不能把初始包围关系当成跨目标不变量。
 */
function prepareAnchor(
  target: RendererElement | null,
  vnode: TeleportVNode,
  createText: RendererOptions['createText'],
  insert: RendererOptions['insert'],
  anchor: RendererNode | null = null,
) {
  const targetStart = (vnode.targetStart = createText(''))
  const targetAnchor = (vnode.targetAnchor = createText(''))

  // 渲染器查找逻辑兄弟时看到该私有属性，可直接跳到结束锚点之后，跳过远端范围。
  targetStart[TeleportEndKey] = targetAnchor

  if (target) {
    insert(targetStart, target, anchor)
    insert(targetAnchor, target, anchor)
  }

  return targetAnchor
}
