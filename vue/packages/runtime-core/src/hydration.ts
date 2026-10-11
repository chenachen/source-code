import {
  Fragment,
  Static,
  Text,
  Comment as VComment,
  type VNode,
  type VNodeHook,
  createTextVNode,
  createVNode,
  invokeVNodeHook,
  normalizeVNode,
} from './vnode'
import { flushPostFlushCbs } from './scheduler'
import type { ComponentInternalInstance, ComponentOptions } from './component'
import { invokeDirectiveHook } from './directives'
import { warn } from './warning'
import {
  PatchFlags,
  ShapeFlags,
  def,
  getEscapedCssVarName,
  includeBooleanAttr,
  isBooleanAttr,
  isKnownHtmlAttr,
  isKnownSvgAttr,
  isOn,
  isRenderableAttrValue,
  isReservedProp,
  isString,
  normalizeClass,
  normalizeCssVarValue,
  normalizeStyle,
  stringifyStyle,
} from '@vue/shared'
import { type RendererInternals, needTransition } from './renderer'
import { setRef } from './rendererTemplateRef'
import {
  type SuspenseBoundary,
  type SuspenseImpl,
  queueEffectWithSuspense,
} from './components/Suspense'
import type { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isAsyncWrapper } from './apiAsyncComponent'
import { isReactive } from '@vue/reactivity'
import { updateHOCHostEl } from './componentRenderUtils'

/** 把客户端 VNode 树绑定到容器现有 SSR DOM 的根水合函数。 */
export type RootHydrateFunction = (
  vnode: VNode<Node, Element>,
  container: (Element | ShadowRoot) & {
    /** 根水合完成后保存提交的 VNode，后续 render 以其为旧树执行 patch。 */
    _vnode?: VNode
  },
) => void

/** 水合分派只关心的 DOM nodeType 子集。 */
export enum DOMNodeTypes {
  /** DOM 元素节点，对应 nodeType 1。 */
  ELEMENT = 1,
  /** DOM 文本节点，对应 nodeType 3。 */
  TEXT = 3,
  /** Comment，包括 Fragment/Teleport 锚点。 */
  COMMENT = 8,
}

/** 整个运行时只输出一次总括 mismatch 错误，具体差异仍可逐项警告。 */
let hasLoggedMismatchError = false
/** 标记本次页面水合存在差异；生产也输出，因为这通常代表同构逻辑错误。 */
const logMismatchError = () => {
  if (__TEST__ || hasLoggedMismatchError) {
    return
  }
  // 即使生产关闭详细诊断，也需让开发者知道 SSR DOM 与客户端 VDOM 不一致。
  console.error('Hydration completed but contains mismatches.')
  hasLoggedMismatchError = true
}

/** 判断容器 children 是否仍处于 SVG 命名空间；foreignObject 内部回到 HTML。 */
const isSVGContainer = (container: Element) =>
  container.namespaceURI!.includes('svg') &&
  container.tagName !== 'foreignObject'

/** 判断容器是否属于 MathML 命名空间。 */
const isMathMLContainer = (container: Element) =>
  container.namespaceURI!.includes('MathML')

/** 从真实 DOM 容器推导 patch 新缺失节点时应使用的命名空间。 */
const getContainerType = (
  container: Element | ShadowRoot,
): 'svg' | 'mathml' | undefined => {
  if (container.nodeType !== DOMNodeTypes.ELEMENT) return undefined
  if (isSVGContainer(container as Element)) return 'svg'
  if (isMathMLContainer(container as Element)) return 'mathml'
  return undefined
}

/** DOM 注释节点类型守卫。 */
export const isComment = (node: Node): node is Comment =>
  node.nodeType === DOMNodeTypes.COMMENT

/**
 * 创建与给定渲染器闭包配套的根水合函数和单节点水合函数。
 *
 * 水合本身是 DOM 专用能力，但与组件首次 render、Suspense/Teleport、patch/mount 的耦合
 * 很紧，拆到 runtime-dom 会产生大量反向接口，所以保留在 core，并通过 internals 注入
 * 具体渲染器操作。只有 `createHydrationRenderer()` 引用它，普通客户端构建仍可摇掉。
 */
export function createHydrationFunctions(
  rendererInternals: RendererInternals<Node, Element>,
): [
  RootHydrateFunction,
  (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized?: boolean,
  ) => Node | null,
] {
  const {
    mt: mountComponent,
    p: patch,
    o: {
      patchProp,
      createText,
      nextSibling,
      parentNode,
      remove,
      insert,
      createComment,
    },
  } = rendererInternals

  /**
   * 从容器首节点开始水合整棵 VNode 树，并刷新挂载后的生命周期钩子。
   * 空容器无法复用 SSR DOM，直接退回普通完整挂载。
   */
  const hydrate: RootHydrateFunction = (vnode, container) => {
    if (!container.hasChildNodes()) {
      ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
        warn(
          `Attempting to hydrate existing markup but container is empty. ` +
            `Performing full mount instead.`,
        )
      patch(null, vnode, container)
      flushPostFlushCbs()
      container._vnode = vnode
      return
    }

    hydrateNode(container.firstChild!, vnode, null, null, null)
    flushPostFlushCbs()
    container._vnode = vnode
  }

  /**
   * 让一个 VNode 认领当前 DOM 节点，返回该 VNode 宿主范围之后的兄弟节点。
   *
   * 返回 next 而不是只修改当前位置，使父级可顺序水合多根 Fragment、组件和 Teleport。
   * 类型不匹配时 `handleMismatch()` 删除服务端节点并在原位置客户端挂载。
   */
  const hydrateNode = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized = false,
  ): Node | null => {
    optimized = optimized || !!vnode.dynamicChildren
    const isFragmentStart = isComment(node) && node.data === '['
    /** 按当前 SSR 游标修复结构差异，保留组件/Suspense 上下文及是否要删除整个范围。 */
    const onMismatch = () =>
      handleMismatch(
        node,
        vnode,
        parentComponent,
        parentSuspense,
        slotScopeIds,
        isFragmentStart,
      )

    const { type, ref, shapeFlag, patchFlag } = vnode
    let domType = node.nodeType
    vnode.el = node

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      def(node, '__vnode', vnode, true)
      def(node, '__vueParentComponent', parentComponent, true)
    }

    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
      vnode.dynamicChildren = null
    }

    let nextNode: Node | null = null
    switch (type) {
      case Text:
        if (domType !== DOMNodeTypes.TEXT) {
          // #5728：HTML 中空文本不会生成 DOM Text。客户端 VNode 仍需一个 el，因此在
          // 当前节点前补空 Text，但不消费当前节点，让下一个 VNode 继续认领它。
          if (vnode.children === '') {
            insert((vnode.el = createText('')), parentNode(node)!, node)
            nextNode = node
          } else {
            nextNode = onMismatch()
          }
        } else {
          if ((node as Text).data !== vnode.children) {
            // 独立 Text VNode 的检查直接警告，不读取 data-allow-mismatch；元素
            // TEXT_CHILDREN 的允许失配判断位于 hydrateElement，两条路径不同。
            ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
              warn(
                `Hydration text mismatch in`,
                node.parentNode,
                `\n  - rendered on server: ${JSON.stringify(
                  (node as Text).data,
                )}` +
                  `\n  - expected on client: ${JSON.stringify(vnode.children)}`,
              )
            logMismatchError()
            ;(node as Text).data = vnode.children as string
          }
          nextNode = nextSibling(node)
        }
        break
      case VComment:
        if (isTemplateNode(node)) {
          nextNode = nextSibling(node)
          // SSR 的 `<transition appear>` 可能用 template 包装注释位置；客户端 VNode.el
          // 应指向 template 内容的首个真实子节点，再用它替换外层 template。
          replaceNode(
            (vnode.el = node.content.firstChild!),
            node,
            parentComponent,
          )
        } else if (domType !== DOMNodeTypes.COMMENT || isFragmentStart) {
          nextNode = onMismatch()
        } else {
          nextNode = nextSibling(node)
        }
        break
      case Static:
        if (isFragmentStart) {
          // 整个模板虽是 Static，SSR 多根输出仍用 Fragment 锚点包围，先越过起点。
          node = nextSibling(node)!
          domType = node.nodeType
        }
        if (domType === DOMNodeTypes.ELEMENT || domType === DOMNodeTypes.TEXT) {
          // 按 staticCount 向前扫描并认领首尾范围。
          nextNode = node
          // 构建可能为减包体剥离静态字符串；此时从 SSR DOM 反向拼回，供后续 clone/插入。
          const needToAdoptContent = !(vnode.children as string).length
          for (let i = 0; i < vnode.staticCount!; i++) {
            if (needToAdoptContent)
              vnode.children +=
                nextNode.nodeType === DOMNodeTypes.ELEMENT
                  ? (nextNode as Element).outerHTML
                  : (nextNode as Text).data
            if (i === vnode.staticCount! - 1) {
              vnode.anchor = nextNode
            }
            nextNode = nextSibling(nextNode)!
          }
          return isFragmentStart ? nextSibling(nextNode) : nextNode
        } else {
          onMismatch()
        }
        break
      case Fragment:
        if (!isFragmentStart) {
          nextNode = onMismatch()
        } else {
          nextNode = hydrateFragment(
            node as Comment,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized,
          )
        }
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          if (
            (domType !== DOMNodeTypes.ELEMENT ||
              (vnode.type as string).toLowerCase() !==
                (node as Element).tagName.toLowerCase()) &&
            !isTemplateNode(node)
          ) {
            nextNode = onMismatch()
          } else {
            nextNode = hydrateElement(
              node as Element,
              vnode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized,
            )
          }
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          // mountComponent 看到 initialVNode.el 已设置，会让组件首次 render effect 对其
          // subTree 执行 hydrate，而不是创建宿主节点。
          vnode.slotScopeIds = slotScopeIds
          const container = parentNode(node)!

          // 组件可能异步，不能等内部 render 后再找 next；先根据 SSR 锚点向前看。
          if (isFragmentStart) {
            // Fragment 根可能来自异步组件，预先扫描配对结束锚点，作为父级后续水合位置。
            nextNode = locateClosingAnchor(node)
          } else if (isComment(node) && node.data === 'teleport start') {
            // #4293/#6152：组件根为 Teleport 时，跳过到 `teleport end` 后，不能把中间
            // 原位置锚点误认作下一个兄弟组件。
            nextNode = locateClosingAnchor(node, node.data, 'teleport end')
          } else {
            nextNode = nextSibling(node)
          }

          mountComponent(
            vnode,
            container,
            null,
            parentComponent,
            parentSuspense,
            getContainerType(container),
            optimized,
          )

          // #3787：异步组件解析前可能被移动/卸载。构造一个与已认领 DOM 范围匹配的
          // placeholder subTree，让 renderer 在真实组件尚未加载时仍能定位和操作范围。
          if (
            isAsyncWrapper(vnode) &&
            !(vnode.type as ComponentOptions).__asyncResolved
          ) {
            let subTree
            if (isFragmentStart) {
              subTree = createVNode(Fragment)
              subTree.anchor = nextNode
                ? nextNode.previousSibling
                : container.lastChild
            } else {
              subTree =
                node.nodeType === 3 ? createTextVNode('') : createVNode('div')
            }
            subTree.el = node
            vnode.component!.subTree = subTree
          }
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          if (domType !== DOMNodeTypes.COMMENT) {
            nextNode = onMismatch()
          } else {
            nextNode = (vnode.type as typeof TeleportImpl).hydrate(
              node,
              vnode as TeleportVNode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized,
              rendererInternals,
              hydrateChildren,
            )
          }
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          nextNode = (vnode.type as typeof SuspenseImpl).hydrate(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            getContainerType(parentNode(node)!),
            slotScopeIds,
            optimized,
            rendererInternals,
            hydrateNode,
          )
        } else if (__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) {
          warn('Invalid HostVNode type:', type, `(${typeof type})`)
        }
    }

    if (ref != null) {
      setRef(ref, null, parentSuspense, vnode)
    }

    return nextNode
  }

  /**
   * 水合已确认标签匹配的元素：递归认领 children，校验/绑定 props，并执行挂载钩子。
   * CACHED 静态节点在生产可跳过大部分工作；表单状态、事件和动态 props 仍必须校正。
   */
  const hydrateElement = (
    el: Element,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    optimized = optimized || !!vnode.dynamicChildren
    const {
      type,
      dynamicProps,
      props,
      patchFlag,
      shapeFlag,
      dirs,
      transition,
    } = vnode
    // #4006：`<option :value="obj">`、checkbox true-value 等非字符串 v-model 值无法
    // 完整表达在 SSR attribute 中。#7476：input.indeterminate 也没有等价 HTML 表达。
    // 这两类元素必须经过 patchProp 恢复 DOM property/内部 `_value`。
    const forcePatch = type === 'input' || type === 'option'
    // #9033：dynamicProps 必须强制水合。与 forcePatch 分开，因为后者还会扫描 value 类键。
    const hasDynamicProps = !!dynamicProps
    // 生产可跳过完全提升静态节点；#5405 开发环境仍水合 children，HMR 后完整 patch 才
    // 有每个 VNode 对应的 el。
    if (
      __DEV__ ||
      forcePatch ||
      hasDynamicProps ||
      patchFlag !== PatchFlags.CACHED
    ) {
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }

      // SSR 的 `<transition appear>` 可能把真实元素包在 template，占位需替换成其内容。
      let needCallTransitionHooks = false
      if (isTemplateNode(el)) {
        needCallTransitionHooks =
          needTransition(
            null, // 水合节点已在活动 DOM，无需再检查 parentSuspense 隐藏分支。
            transition,
          ) &&
          parentComponent &&
          parentComponent.vnode.props &&
          parentComponent.vnode.props.appear

        const content = (el as HTMLTemplateElement).content
          .firstChild as Element & {
          /** 保存 beforeEnter 添加过渡类之前的 SSR class，供属性不匹配诊断。 */
          $cls?: string
        }

        if (needCallTransitionHooks) {
          const cls = content.getAttribute('class')
          if (cls) content.$cls = cls
          transition!.beforeEnter(content)
        }

        // 用 template.content 的真实根替换 wrapper，并让 VNode 认领它。
        replaceNode(content, el, parentComponent)
        vnode.el = el = content
      }

      // 先水合 children，剩余 SSR 节点代表服务端多渲染，统一移除。
      if (
        shapeFlag & ShapeFlags.ARRAY_CHILDREN &&
        // innerHTML/textContent 的内容不对应 VNode children，不能递归认领。
        !(props && (props.innerHTML || props.textContent))
      ) {
        let next = hydrateChildren(
          el.firstChild,
          vnode,
          el,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized,
        )
        if (next && !isMismatchAllowed(el, MismatchTypes.CHILDREN)) {
          ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
            warn(
              `Hydration children mismatch on`,
              el,
              `\nServer rendered element contains more child nodes than client vdom.`,
            )
          logMismatchError()
        }
        while (next) {
          // SSR DOM 比客户端 VDOM 多；保留警告后移除多余节点以恢复客户端结构。
          const cur = next
          next = next.nextSibling
          remove(cur)
        }
      } else if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        // #11873：HTML 解析器会吞掉 `<pre>`/`<textarea>` 源码开头第一个换行。比较时
        // 从客户端期望值移除该换行，避免把浏览器规范行为误报成水合不匹配。
        let clientText = vnode.children as string
        if (
          clientText[0] === '\n' &&
          (el.tagName === 'PRE' || el.tagName === 'TEXTAREA')
        ) {
          clientText = clientText.slice(1)
        }
        const { textContent } = el
        if (
          textContent !== clientText &&
          // DOM 解析会把 CRLF/CR 统一为 LF，比较时接受这种等价规范化。
          textContent !== clientText.replace(/\r\n|\r/g, '\n')
        ) {
          if (!isMismatchAllowed(el, MismatchTypes.TEXT)) {
            ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
              warn(
                `Hydration text content mismatch on`,
                el,
                `\n  - rendered on server: ${textContent}` +
                  `\n  - expected on client: ${clientText}`,
              )
            logMismatchError()
          }
          el.textContent = vnode.children as string
        }
      }

      // 校验 SSR attribute 与客户端期望，并绑定必须在客户端恢复的事件/property。
      if (props) {
        if (
          __DEV__ ||
          __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__ ||
          forcePatch ||
          hasDynamicProps ||
          !optimized ||
          patchFlag & (PatchFlags.FULL_PROPS | PatchFlags.NEED_HYDRATION)
        ) {
          const isCustomElement = el.tagName.includes('-')
          const namespace = el.namespaceURI!.includes('svg')
            ? 'svg'
            : el.namespaceURI!.includes('MathML')
              ? 'mathml'
              : undefined
          for (const key in props) {
            // 指令 created 可能任意修改 DOM，无法区分是 SSR 差异还是指令结果。
            if (
              (__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
              // #11189：存在 created 指令钩子时跳过 prop mismatch 诊断，避免误报。
              !(dirs && dirs.some(d => d.dir.created)) &&
              propHasMismatch(el, key, props[key], vnode, parentComponent)
            ) {
              logMismatchError()
            }
            if (
              (forcePatch &&
                (key.endsWith('value') || key === 'indeterminate')) ||
              (isOn(key) && !isReservedProp(key)) ||
              // `.prop` 强制 DOM property，SSR attribute 不足以恢复其客户端值。
              key[0] === '.' ||
              (isCustomElement && !isReservedProp(key)) ||
              (dynamicProps && dynamicProps.includes(key))
            ) {
              if (isUnchangedResourceProp(el, key, props[key])) {
                continue
              }
              patchProp(el, key, null, props[key], namespace, parentComponent)
            }
          }
        } else if (props.onClick) {
          // 静态优化路径最常见只含 click，直接绑定避免遍历整个 props。
          patchProp(
            el,
            'onClick',
            null,
            props.onClick,
            undefined,
            parentComponent,
          )
        } else if (patchFlag & PatchFlags.STYLE && isReactive(props.style)) {
          // #11372：对象 style 的属性在 patch 阶段才遍历，水合静态优化会跳过 style patch。
          // 显式遍历一次，让组件 render effect 收集响应式 style 对象各键依赖。
          for (const key in props.style) props.style[key]
        }
      }

      // before 钩子同步执行，mounted/appear enter 等到 Suspense 允许提交后执行。
      let vnodeHooks: VNodeHook | null | undefined
      if ((vnodeHooks = props && props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHooks, parentComponent, vnode)
      }
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }
      if (
        (vnodeHooks = props && props.onVnodeMounted) ||
        dirs ||
        needCallTransitionHooks
      ) {
        queueEffectWithSuspense(() => {
          vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode)
          needCallTransitionHooks && transition!.enter(el)
          dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
      }
    }

    return el.nextSibling
  }

  /**
   * 从给定 DOM 节点开始依次水合父 VNode 的 children，并返回未消费的下一个节点。
   * SSR 节点不足时从当前位置普通挂载缺失 VNode；多余节点由调用方统一处理。
   */
  const hydrateChildren = (
    node: Node | null,
    parentVNode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ): Node | null => {
    optimized = optimized || !!parentVNode.dynamicChildren
    const children = parentVNode.children as VNode[]
    const l = children.length
    let hasCheckedMismatch = false
    for (let i = 0; i < l; i++) {
      const vnode = optimized
        ? children[i]
        : (children[i] = normalizeVNode(children[i]))
      const isText = vnode.type === Text
      if (node) {
        if (isText && !optimized) {
          // #7285：手写 render/JSX 可生成连续 Text VNode，但浏览器解析 SSR HTML 时会把
          // 相邻文本合并成一个 DOM Text。若下一个也是 Text，按当前期望长度拆出额外节点。
          if (i + 1 < l && normalizeVNode(children[i + 1]).type === Text) {
            // 当前 VNode 认领前半段，插入后半段 Text 供下一个 VNode 继续认领。
            insert(
              createText(
                (node as Text).data.slice((vnode.children as string).length),
              ),
              container,
              nextSibling(node),
            )
            ;(node as Text).data = vnode.children as string
          }
        }
        node = hydrateNode(
          node,
          vnode,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized,
        )
      } else if (isText && !vnode.children) {
        // #7215：SSR HTML 不会保留空 Text，客户端补节点以维持 VNode 与 DOM 一一对应。
        insert((vnode.el = createText('')), container)
      } else {
        if (!hasCheckedMismatch) {
          hasCheckedMismatch = true
          if (!isMismatchAllowed(container, MismatchTypes.CHILDREN)) {
            ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
              warn(
                `Hydration children mismatch on`,
                container,
                `\nServer rendered element contains fewer child nodes than client vdom.`,
              )
            logMismatchError()
          }
        }

        // SSR DOM 节点不足；首次报告 children mismatch 后普通挂载全部缺失项。
        patch(
          null,
          vnode,
          container,
          null,
          parentComponent,
          parentSuspense,
          getContainerType(container),
          slotScopeIds,
        )
      }
    }
    return node
  }

  /** 水合 `[` / `]` 锚点包围的 Fragment，并修复缺失结束锚点。 */
  const hydrateFragment = (
    node: Comment,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean,
  ) => {
    const { slotScopeIds: fragmentSlotScopeIds } = vnode
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    const container = parentNode(node)!
    const next = hydrateChildren(
      nextSibling(node)!,
      vnode,
      container,
      parentComponent,
      parentSuspense,
      slotScopeIds,
      optimized,
    )
    if (next && isComment(next) && next.data === ']') {
      return nextSibling((vnode.anchor = next))
    } else {
      // 没有得到 `]` 表示服务端范围不完整；此前节点/children 流程应已给出具体警告。
      logMismatchError()

      // 补结束锚点，使未来 Fragment move/remove 仍有合法范围。
      insert((vnode.anchor = createComment(`]`)), container, next)
      return next
    }
  }

  /**
   * 修复当前 DOM 节点与 VNode 类型不匹配：删除旧服务端范围并在原位置完整挂载 VNode。
   * Fragment mismatch 会先删除配对锚点内多余节点；组件祖先的根 el 也同步为新节点。
   */
  const handleMismatch = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    isFragment: boolean,
  ): Node | null => {
    if (!isNodeMismatchAllowed(node, vnode)) {
      ;(__DEV__ || __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__) &&
        warn(
          `Hydration node mismatch:\n- rendered on server:`,
          node,
          node.nodeType === DOMNodeTypes.TEXT
            ? `(text)`
            : isComment(node) && node.data === '['
              ? `(start of fragment)`
              : ``,
          `\n- expected on client:`,
          vnode.type,
        )
      logMismatchError()
    }

    vnode.el = null

    if (isFragment) {
      // 当前节点是 Fragment 起点时，先清空直到匹配结束锚点，避免留下孤立 SSR 内容。
      const end = locateClosingAnchor(node)
      while (true) {
        const next = nextSibling(node)
        if (next && next !== end) {
          remove(next)
        } else {
          break
        }
      }
    }

    const next = nextSibling(node)
    const container = parentNode(node)!
    remove(node)

    patch(
      null,
      vnode,
      container,
      next,
      parentComponent,
      parentSuspense,
      getContainerType(container),
      slotScopeIds,
    )
    // mismatch 替换了真实根节点，组件及 HOC 祖先 VNode 的 el 必须同步。
    if (parentComponent) {
      parentComponent.vnode.el = vnode.el
      updateHOCHostEl(parentComponent, vnode.el)
    }
    return next
  }

  /**
   * 向后扫描成对注释锚点，并返回最外层结束锚点后的节点。
   * `match` 处理嵌套 Fragment 或嵌套 Teleport 标记。
   */
  const locateClosingAnchor = (
    node: Node | null,
    open = '[',
    close = ']',
  ): Node | null => {
    let match = 0
    while (node) {
      node = nextSibling(node)
      if (node && isComment(node)) {
        if (node.data === open) match++
        if (node.data === close) {
          if (match === 0) {
            return nextSibling(node)
          } else {
            match--
          }
        }
      }
    }
    return node
  }

  /** 用 template 内真实节点替换 wrapper，并沿组件根链更新所有指向旧节点的 el。 */
  const replaceNode = (
    newNode: Node,
    oldNode: Node,
    parentComponent: ComponentInternalInstance | null,
  ): void => {
    // 先修改真实 DOM。
    const parentNode = oldNode.parentNode
    if (parentNode) {
      parentNode.replaceChild(newNode, oldNode)
    }

    // 再修正以该节点作为唯一根的组件/HOC VNode 引用。
    let parent = parentComponent
    while (parent) {
      if (parent.vnode.el === oldNode) {
        parent.vnode.el = parent.subTree.el = newNode
      }
      parent = parent.parent
    }
  }

  /** 判断 SSR/Transition 包装产生的 template 宿主节点。 */
  const isTemplateNode = (node: Node): node is HTMLTemplateElement => {
    return (
      node.nodeType === DOMNodeTypes.ELEMENT &&
      (node as Element).tagName === 'TEMPLATE'
    )
  }

  return [hydrate, hydrateNode]
}

/**
 * 赋值时会触发资源请求的属性集合。
 * 水合若服务端 attribute 已相同则不再 patch，避免图片、脚本、链接等重复请求。
 */
const resourceProps = /*@__PURE__*/ new Set(['src', 'srcset', 'href', 'poster'])

/**
 * 判断资源 attribute 是否已与客户端值一致。
 * 使用原始 attribute 而非反射 DOM property，因为浏览器会把后者规范化成绝对 URL。
 */
function isUnchangedResourceProp(
  el: Element,
  key: string,
  clientValue: any,
): boolean {
  if (!resourceProps.has(key)) {
    return false
  }
  // 与 SSR 原始 attribute 字符串比较，避免相对 URL/绝对 URL 形式差异。
  return (
    el.getAttribute(key) === (clientValue == null ? null : `${clientValue}`)
  )
}

/**
 * 诊断元素 class/style/已知 attribute 与客户端期望是否等价。
 *
 * class 按集合比较、style 按映射比较，忽略无语义的顺序差异；函数只负责诊断，生产
 * 不主动校正普通 attribute，以免为所有静态属性支付写 DOM 成本。
 */
function propHasMismatch(
  el: Element & {
    /** appear 水合时暂存的原始 SSR class，避免把过渡类误判为不匹配。 */
    $cls?: string
  },
  key: string,
  clientValue: any,
  vnode: VNode,
  instance: ComponentInternalInstance | null,
): boolean {
  let mismatchType: MismatchTypes | undefined
  let mismatchKey: string | undefined
  let actual: string | boolean | null | undefined
  let expected: string | boolean | null | undefined
  if (key === 'class') {
    // class 顺序不影响层叠，比较 token 集合即可。appear transition 可能暂存原 class。
    if (el.$cls) {
      actual = el.$cls
      delete el.$cls
    } else {
      actual = el.getAttribute('class')
    }
    expected = normalizeClass(clientValue)
    if (!isSetEqual(toClassSet(actual || ''), toClassSet(expected))) {
      mismatchType = MismatchTypes.CLASS
      mismatchKey = `class`
    }
  } else if (key === 'style') {
    // style 声明顺序通常不影响最终值，解析为 property→value 映射比较。
    actual = el.getAttribute('style') || ''
    expected = isString(clientValue)
      ? clientValue
      : stringifyStyle(normalizeStyle(clientValue))
    const actualMap = toStyleMap(actual)
    const expectedMap = toStyleMap(expected)
    // `v-show=false` 的 display:none 由指令在客户端添加，也属于正确期望样式。
    if (vnode.dirs) {
      for (const { dir, value } of vnode.dirs) {
        // 只有 vShow 内置指令带内部 name；公开 ObjectDirective 类型不暴露该字段。
        // @ts-expect-error
        if (dir.name === 'show' && !value) {
          expectedMap.set('display', 'none')
        }
      }
    }

    if (instance) {
      resolveCssVars(instance, vnode, expectedMap)
    }

    if (!isMapEqual(actualMap, expectedMap)) {
      mismatchType = MismatchTypes.STYLE
      mismatchKey = 'style'
    }
  } else if (
    (el instanceof SVGElement && isKnownSvgAttr(key)) ||
    (el instanceof HTMLElement && (isBooleanAttr(key) || isKnownHtmlAttr(key)))
  ) {
    if (key === 'hidden') {
      actual = normalizeHiddenValue(el.getAttribute(key))
      expected = normalizeHiddenValue(clientValue)
    } else if (isBooleanAttr(key)) {
      actual = el.hasAttribute(key)
      expected = includeBooleanAttr(clientValue)
    } else if (clientValue == null) {
      actual = el.hasAttribute(key)
      expected = false
    } else {
      if (el.hasAttribute(key)) {
        actual = el.getAttribute(key)
      } else if (key === 'value' && el.tagName === 'TEXTAREA') {
        // #10000：textarea 的初始 value 来自文本内容，不一定存在 value attribute。
        actual = (el as HTMLTextAreaElement).value
      } else {
        actual = false
      }
      expected = isRenderableAttrValue(clientValue)
        ? String(clientValue)
        : false
    }
    if (actual !== expected) {
      mismatchType = MismatchTypes.ATTRIBUTE
      mismatchKey = key
    }
  }

  if (mismatchType != null && !isMismatchAllowed(el, mismatchType)) {
    /** 把未渲染属性与实际字符串区分显示，只服务诊断消息，不修改元素。 */
    const format = (v: any) =>
      v === false ? `(not rendered)` : `${mismatchKey}="${v}"`
    const preSegment = `Hydration ${MismatchTypeString[mismatchType]} mismatch on`
    const postSegment =
      `\n  - rendered on server: ${format(actual)}` +
      `\n  - expected on client: ${format(expected)}` +
      `\n  Note: this mismatch is check-only. The DOM will not be rectified ` +
      `in production due to performance overhead.` +
      `\n  You should fix the source of the mismatch.`
    if (__TEST__) {
      // 测试中合成单字符串，便于快照和断言读取完整消息。
      warn(`${preSegment} ${el.tagName}${postSegment}`)
    } else {
      warn(preSegment, el, postSegment)
    }
    return true
  }
  return false
}

/**
 * 把 hidden 的 attribute/property 多种输入归一为缺失、普通布尔或 `until-found`。
 */
function normalizeHiddenValue(value: unknown): false | '' | 'until-found' {
  if (!isRenderableAttrValue(value)) {
    return false
  }
  if (isString(value)) {
    // DOM attribute 总是字符串；客户端数值走 hidden property 规则，0/NaN 会移除属性。
    return value.toLowerCase() === 'until-found' ? 'until-found' : ''
  }
  return includeBooleanAttr(value) ? '' : false
}

/** 把 class 字符串拆成去重 token 集合，供无序等价比较。 */
function toClassSet(str: string): Set<string> {
  return new Set(str.trim().split(/\s+/))
}

/** 判断两个 class token 集合严格相等。 */
function isSetEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const s of a) {
    if (!b.has(s)) {
      return false
    }
  }
  return true
}

/** 把序列化 style 拆成属性映射，用于忽略声明顺序的水合比较。 */
function toStyleMap(str: string): Map<string, string> {
  const styleMap: Map<string, string> = new Map()
  for (const item of str.split(';')) {
    let [key, value] = item.split(':')
    key = key.trim()
    value = value && value.trim()
    if (key && value) {
      styleMap.set(key, value)
    }
  }
  return styleMap
}

/** 判断两个规范化 style 映射包含相同属性和值。 */
function isMapEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [key, value] of a) {
    if (value !== b.get(key)) {
      return false
    }
  }
  return true
}

/**
 * 把组件 `useCssVars` 生成的 CSS 自定义属性补入期望 style 映射。
 * 组件根会继续向父级递归，因为父 SFC 的 CSS vars 也会落到直接子组件根元素上。
 */
function resolveCssVars(
  instance: ComponentInternalInstance,
  vnode: VNode,
  expectedMap: Map<string, string>,
) {
  const root = instance.subTree
  if (
    instance.getCssVars &&
    (vnode === root ||
      (root &&
        root.type === Fragment &&
        (root.children as VNode[]).includes(vnode)))
  ) {
    const cssVars = instance.getCssVars()
    for (const key in cssVars) {
      const value = normalizeCssVarValue(cssVars[key])
      expectedMap.set(`--${getEscapedCssVarName(key, false)}`, value)
    }
  }
  if (vnode === root && instance.parent) {
    resolveCssVars(instance.parent, instance.vnode, expectedMap)
  }
}

/** 用户显式允许非确定 SSR 内容不匹配的 attribute 名。 */
const allowMismatchAttr = 'data-allow-mismatch'

/** 可按 `data-allow-mismatch` 分别抑制的差异类别。 */
enum MismatchTypes {
  /** 元素 TEXT_CHILDREN 的文本内容不一致；独立 Text VNode 不经过该允许失配检查。 */
  TEXT = 0,
  /** 元素的子节点数量或结构不一致。 */
  CHILDREN = 1,
  /** class 集合不一致。 */
  CLASS = 2,
  /** style 声明集合不一致。 */
  STYLE = 3,
  /** class/style 以外的 attribute 值不一致。 */
  ATTRIBUTE = 4,
}

/** 差异类别到 attribute 配置 token/警告文本的映射。 */
const MismatchTypeString: Record<MismatchTypes, string> = {
  [MismatchTypes.TEXT]: 'text',
  [MismatchTypes.CHILDREN]: 'children',
  [MismatchTypes.CLASS]: 'class',
  [MismatchTypes.STYLE]: 'style',
  [MismatchTypes.ATTRIBUTE]: 'attribute',
} as const

/**
 * 判断元素或祖先是否允许某类差异。
 * text/children 从本元素向上寻找最近一处声明；更近的声明会遮住外层声明，不合并配置。
 * class/style/attribute 只读取本元素上的声明。
 */
function isMismatchAllowed(
  el: Element | null,
  allowedType: MismatchTypes,
): boolean {
  if (
    allowedType === MismatchTypes.TEXT ||
    allowedType === MismatchTypes.CHILDREN
  ) {
    while (el && !el.hasAttribute(allowMismatchAttr)) {
      el = el.parentElement
    }
  }
  return isMismatchAllowedByAttr(
    el && el.getAttribute(allowMismatchAttr),
    allowedType,
  )
}

/** 解析 `data-allow-mismatch` 值；空值允许全部，逗号列表只允许指定类别。 */
function isMismatchAllowedByAttr(
  allowedAttr: string | null,
  allowedType: MismatchTypes,
): boolean {
  if (allowedAttr == null) {
    return false
  } else if (allowedAttr === '') {
    return true
  } else {
    const list = allowedAttr.split(',')
    // 允许 children 自然包含更窄的 text 差异。
    if (allowedType === MismatchTypes.TEXT && list.includes('children')) {
      return true
    }
    return list.includes(MismatchTypeString[allowedType])
  }
}

/** 综合父元素、当前服务端节点和客户端 VNode 两侧声明判断节点类型差异是否允许。 */
function isNodeMismatchAllowed(node: Node, vnode: VNode): boolean {
  return (
    isMismatchAllowed(node.parentElement, MismatchTypes.CHILDREN) ||
    isMismatchAllowedByNode(node) ||
    isMismatchAllowedByVNode(vnode)
  )
}

/** 读取当前服务端元素上的声明，用于服务端多出的节点。 */
function isMismatchAllowedByNode(node: Node): boolean {
  return (
    node.nodeType === DOMNodeTypes.ELEMENT &&
    isMismatchAllowedByAttr(
      (node as Element).getAttribute(allowMismatchAttr),
      MismatchTypes.CHILDREN,
    )
  )
}

/** 读取客户端 VNode props 上的声明，用于客户端期望与服务端类型不同的节点。 */
function isMismatchAllowedByVNode({ props }: VNode): boolean {
  const allowedAttr = props && props[allowMismatchAttr]
  return (
    typeof allowedAttr === 'string' &&
    isMismatchAllowedByAttr(allowedAttr, MismatchTypes.CHILDREN)
  )
}
