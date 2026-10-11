import { warn } from '@vue/runtime-core'
import type { RendererOptions } from '@vue/runtime-core'
import type {
  TrustedHTML,
  TrustedTypePolicy,
  TrustedTypesWindow,
} from 'trusted-types/lib'

/** Vue 自用 Trusted Types policy；浏览器/CSP 不支持时保持 undefined。 */
let policy: Pick<TrustedTypePolicy, 'name' | 'createHTML'> | undefined =
  undefined

/** 当前 window 暴露的 Trusted Types 工厂；SSR 中没有 window。 */
const tt =
  typeof window !== 'undefined' &&
  (window as unknown as TrustedTypesWindow).trustedTypes

if (tt) {
  try {
    policy = /*@__PURE__*/ tt.createPolicy('vue', {
      /** Trusted Types policy 的透明转换函数；只包装类型，不做 HTML 清洗。 */
      createHTML: val => val,
    })
  } catch (e: unknown) {
    // policy 名重复且 CSP trusted-types 未允许 `allow-duplicates` 时 createPolicy 会抛
    // TypeError。Vue 可能被加载多份，不能让第二份 runtime 因此中断初始化。
    __DEV__ && warn(`Error creating trusted types policy: ${e}`)
  }
}

/**
 * 将字符串包装成可赋给 innerHTML 的 TrustedHTML。
 *
 * __UNSAFE__：这只完成 Trusted Types 类型转换，不做清洗或转义。调用方必须保证内容
 * 来自可信模板；把用户输入传入仍会产生 XSS。
 */
export const unsafeToTrustedHTML: (value: string) => TrustedHTML | string =
  policy ? val => policy.createHTML(val) : val => val

/** SVG 元素创建使用的标准命名空间 URI。 */
export const svgNS = 'http://www.w3.org/2000/svg'
/** MathML 元素创建使用的标准命名空间 URI。 */
export const mathmlNS = 'http://www.w3.org/1998/Math/MathML'

/** 当前 document；SSR 导入 runtime-dom 时为 null，只有客户端实际渲染才会使用。 */
const doc = (typeof document !== 'undefined' ? document : null) as Document

/** 解析编译器静态 HTML 的复用 template 容器，避免每次插入创建新解析器元素。 */
const templateContainer = doc && /*@__PURE__*/ doc.createElement('template')

/**
 * runtime-core 渲染器在 DOM 平台上的基础宿主操作。
 * 除 patchProp 外，所有 Node/Element 创建、移动、删除、查询都集中在这里。
 */
export const nodeOps: Omit<RendererOptions<Node, Element>, 'patchProp'> = {
  /** 将已有/新节点插在 anchor 前；空锚点追加，浏览器自动从旧父移动。 */
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null)
  },

  /** 仅在节点仍有父级时调用 removeChild；已经脱离节点直接返回。 */
  remove: child => {
    const parent = child.parentNode
    if (parent) {
      parent.removeChild(child)
    }
  },

  /** 按 HTML/SVG/MathML 命名空间或 customized built-in 的 is 创建元素；select.multiple 在挂 option 前设置，随后返回未插入元素。 */
  createElement: (tag, namespace, is, props): Element => {
    const el =
      namespace === 'svg'
        ? doc.createElementNS(svgNS, tag)
        : namespace === 'mathml'
          ? doc.createElementNS(mathmlNS, tag)
          : is
            ? doc.createElement(tag, { is })
            : doc.createElement(tag)

    if (tag === 'select' && props && props.multiple != null) {
      // select 创建后立即设置 multiple，确保随后挂 option/value 时浏览器按多选语义处理。
      ;(el as HTMLSelectElement).setAttribute('multiple', props.multiple)
    }

    return el
  },

  /** 创建可由 renderer 插入/更新的原生 Text。 */
  createText: text => doc.createTextNode(text),

  /** 创建占位/锚点用原生 Comment。 */
  createComment: text => doc.createComment(text),

  /** 就地写节点 nodeValue，保留宿主身份。 */
  setText: (node, text) => {
    node.nodeValue = text
  },

  /** 写 textContent，替换元素整个现有内容范围。 */
  setElementText: (el, text) => {
    el.textContent = text
  },

  /** 把原生父节点交给 renderer 重新定位当前容器；脱离节点返回 null。 */
  parentNode: node => node.parentNode as Element | null,

  /** 取得当前原生兄弟位置，移动/水合游标依赖它。 */
  nextSibling: node => node.nextSibling,

  /** 在当前 document 解析选择器，供 Teleport 等宿主查询使用。 */
  querySelector: selector => doc.querySelector(selector),

  /** 给宿主元素写入名称为id、值为空串的scope属性，供渲染器标记SFC作用域样式选择器。 */
  setScopeId(el, id) {
    el.setAttribute(id, '')
  },

  /**
   * 一次解析/插入编译器静态内容，并返回实际首尾 DOM。
   *
   * __UNSAFE__：内部使用 innerHTML，但内容只应来自可信编译模板。已有首尾节点时 clone
   * 缓存范围，避免再次解析；SVG/MathML 用外层 wrapper 强制正确命名空间后再拆掉。
   */
  insertStaticContent(content, parent, anchor, namespace, start, end) {
    // 插入前结构：<parent> before | first ... last | anchor </parent>。
    const before = anchor ? anchor.previousSibling : parent.lastChild
    // #5308：单节点或 start 仍有 nextSibling 时走克隆；多根缓存被逐个移除、
    // start 已无兄弟时重新解析。这里不预检 end 可达，调用方需保留缓存范围的首尾关系。
    if (start && (start === end || start.nextSibling)) {
      // 沿缓存范围逐个深克隆并插入，原缓存节点保持不动供下一次复用。
      while (true) {
        parent.insertBefore(start!.cloneNode(true), anchor)
        if (start === end || !(start = start!.nextSibling)) break
      }
    } else {
      // 首次/缓存失效：通过 template.innerHTML 解析。
      templateContainer.innerHTML = unsafeToTrustedHTML(
        namespace === 'svg'
          ? `<svg>${content}</svg>`
          : namespace === 'mathml'
            ? `<math>${content}</math>`
            : content,
      ) as string

      const template = templateContainer.content
      if (namespace === 'svg' || namespace === 'mathml') {
        // wrapper 只用于命名空间解析，把其 children 提升回 template Fragment。
        const wrapper = template.firstChild!
        while (wrapper.firstChild) {
          template.appendChild(wrapper.firstChild)
        }
        template.removeChild(wrapper)
      }
      parent.insertBefore(template, anchor)
    }
    return [
      // 插入后首节点。
      before ? before.nextSibling! : parent.firstChild!,
      // 插入后末节点。
      anchor ? anchor.previousSibling! : parent.lastChild!,
    ]
  },
}
