import { Namespaces, NodeTypes, type ParserOptions } from '@vue/compiler-core'
import { isHTMLTag, isMathMLTag, isSVGTag, isVoidTag } from '@vue/shared'
import { TRANSITION, TRANSITION_GROUP } from './runtimeHelpers'
import { decodeHtmlBrowser } from './decodeHtmlBrowser'

/**
 * DOM 编译器的解析平台配置。
 *
 * 它定义原生/空元素、`pre` 换行规则、浏览器实体解码，以及 HTML、SVG、MathML
 * 之间的命名空间切换。compiler-core 本身不内置这些平台知识。
 */
export const parserOptions: ParserOptions = {
  parseMode: 'html',
  isVoidTag,
  isNativeTag: tag => isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag),
  isPreTag: tag => tag === 'pre',
  isIgnoreNewlineTag: tag => tag === 'pre' || tag === 'textarea',
  decodeEntities: __BROWSER__ ? decodeHtmlBrowser : undefined,

  isBuiltInComponent: tag => {
    if (tag === 'Transition' || tag === 'transition') {
      return TRANSITION
    } else if (tag === 'TransitionGroup' || tag === 'transition-group') {
      return TRANSITION_GROUP
    }
  },

  /**
   * 按 HTML 规范推导子元素命名空间。
   * MathML 的集成点和 SVG 的 `foreignObject/desc/title` 会重新进入 HTML；HTML 中的
   * `<svg>` / `<math>` 则分别开启对应命名空间。这会影响属性名、VNode 创建与水合。
   * @see https://html.spec.whatwg.org/multipage/parsing.html#tree-construction-dispatcher
   */
  getNamespace(tag, parent, rootNamespace) {
    let ns = parent ? parent.ns : rootNamespace
    if (parent && ns === Namespaces.MATH_ML) {
      if (parent.tag === 'annotation-xml') {
        if (tag === 'svg') {
          return Namespaces.SVG
        }
        if (
          parent.props.some(
            a =>
              a.type === NodeTypes.ATTRIBUTE &&
              a.name === 'encoding' &&
              a.value != null &&
              (a.value.content === 'text/html' ||
                a.value.content === 'application/xhtml+xml'),
          )
        ) {
          ns = Namespaces.HTML
        }
      } else if (
        /^m(?:[ions]|text)$/.test(parent.tag) &&
        tag !== 'mglyph' &&
        tag !== 'malignmark'
      ) {
        ns = Namespaces.HTML
      }
    } else if (parent && ns === Namespaces.SVG) {
      if (
        parent.tag === 'foreignObject' ||
        parent.tag === 'desc' ||
        parent.tag === 'title'
      ) {
        ns = Namespaces.HTML
      }
    }

    if (ns === Namespaces.HTML) {
      if (tag === 'svg') {
        return Namespaces.SVG
      }
      if (tag === 'math') {
        return Namespaces.MATH_ML
      }
    }
    return ns
  },
}
