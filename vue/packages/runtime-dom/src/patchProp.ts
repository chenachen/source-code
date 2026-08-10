import { patchClass } from './modules/class'
import { patchStyle } from './modules/style'
import { patchAttr } from './modules/attrs'
import { patchDOMProp } from './modules/props'
import { patchEvent } from './modules/events'
import {
  camelize,
  isFunction,
  isModelListener,
  isOn,
  isString,
} from '@vue/shared'
import type { RendererOptions } from '@vue/runtime-core'
import type { VueElement } from './apiCustomElement'

/** 判断键是否为小写 `onxxx` 原生事件 property；字符码检查用于热路径避免正则。 */
const isNativeOn = (key: string) =>
  key.charCodeAt(0) === 111 /* o */ &&
  key.charCodeAt(1) === 110 /* n */ &&
  // 第三个字符必须是小写字母，排除 `onUpdate:*` 等组件监听器形式。
  key.charCodeAt(2) > 96 &&
  key.charCodeAt(2) < 123

/** DOM 平台渲染器选项别名，用于复用 core 的 patchProp 精确签名。 */
type DOMRendererOptions = RendererOptions<Node, Element>

/**
 * 把一个 VNode prop 路由到 class、style、事件、DOM property 或 attribute 专用模块。
 *
 * `.` 前缀强制 property，`^` 前缀强制 attribute；无修饰符时由标签/命名空间和浏览器
 * 行为判断。Vue 自定义元素还要参考声明 props，保证对象值不被 attribute 字符串化。
 */
export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  namespace,
  parentComponent,
) => {
  const isSVG = namespace === 'svg'
  if (key === 'class') {
    patchClass(el, nextValue, isSVG)
  } else if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
  } else if (isOn(key)) {
    // `onUpdate:modelValue` 等由组件 v-model 消费，不注册成原生 DOM 事件。
    if (!isModelListener(key)) {
      patchEvent(el, key, prevValue, nextValue, parentComponent)
    }
  } else if (
    key[0] === '.'
      ? ((key = key.slice(1)), true)
      : key[0] === '^'
        ? ((key = key.slice(1)), false)
        : shouldSetAsProp(el, key, nextValue, isSVG)
  ) {
    patchDOMProp(el, key, nextValue, parentComponent)
    // #6007：value/checked/selected 写 property 后也同步 attribute，使表单 reset 能恢复
    // 初始状态，且依赖 attribute 的库/扩展可读取。#11163：自定义元素 value 可能是对象
    // prop，不能再写 attribute 造成字符串化，所以仅普通原生标签执行。
    if (
      !el.tagName.includes('-') &&
      (key === 'value' || key === 'checked' || key === 'selected')
    ) {
      patchAttr(el, key, nextValue, isSVG, parentComponent, key !== 'value')
    }
  } else if (
    // #11081：Vue 自定义元素即使组件定义异步未解析，也要把可能 prop 先写入元素对象。
    (el as VueElement)._isVueCE &&
    // #12408：已解析元素只对声明 prop 走 property；异步元素还接受大写键/非字符串值，
    // 等定义解析后再完成类型转换。
    (shouldSetAsPropForVueCE(el as VueElement, key) ||
      // `_def` 是 runtime-dom 内部字段，公开 VueElement 类型不暴露。
      // @ts-expect-error
      ((el as VueElement)._def.__asyncLoader &&
        (/[A-Z]/.test(key) || !isString(nextValue))))
  ) {
    patchDOMProp(el, camelize(key), nextValue, parentComponent, key)
  } else {
    // checkbox 的 true-value/false-value 允许对象等非字符串。attribute 会强制字符串化，
    // 额外存 `_trueValue/_falseValue` 供 vModelCheckbox 读取原始值。
    if (key === 'true-value') {
      ;(el as any)._trueValue = nextValue
    } else if (key === 'false-value') {
      ;(el as any)._falseValue = nextValue
    }
    patchAttr(el, key, nextValue, isSVG, parentComponent)
  }
}

/**
 * 判断无显式修饰符的键应写 DOM property 还是 attribute。
 * “key in el” 是默认规则，但若 property 类型/只读行为与 HTML attribute 语义不同，需
 * 按标签逐项排除；SVG 默认使用 attribute，仅 innerHTML/textContent/函数事件例外。
 */
function shouldSetAsProp(
  el: Element,
  key: string,
  value: unknown,
  isSVG: boolean,
) {
  if (isSVG) {
    // SVG 大多数键只有 attribute 语义；innerHTML/textContent 是可直接写的 property。
    if (key === 'innerHTML' || key === 'textContent') {
      return true
    }
    // 函数形式原生 onclick 需写 property，字符串形式仍作为 attribute。
    if (key in el && isNativeOn(key) && isFunction(value)) {
      return true
    }
    return false
  }

  // 这些枚举 attribute 对应 property 在部分浏览器表现为布尔；写字符串 "false" 会被
  // 转 true，必须走 attribute。contentEditable 的 property 本身也是枚举字符串，无此问题。
  if (
    key === 'spellcheck' ||
    key === 'draggable' ||
    key === 'translate' ||
    key === 'autocorrect'
  ) {
    return false
  }

  // #13946：iframe.sandbox property 设 null 会变成字符串 'null'，空串又代表最严格
  // sandbox，而不是移除限制。只有 attribute 增删能表达正确语义。
  if (key === 'sandbox' && el.tagName === 'IFRAME') {
    return false
  }

  // #1787/#2840：表单控件 `form` property 只读，关联 form 必须写 attribute。
  if (key === 'form') {
    return false
  }

  // #1526：input.list property 返回 datalist 元素而不是 ID 字符串，必须写 attribute。
  if (key === 'list' && el.tagName === 'INPUT') {
    return false
  }

  // #2766：textarea.type property 不适合赋值，保留 attribute 语义。
  if (key === 'type' && el.tagName === 'TEXTAREA') {
    return false
  }

  // #8780：嵌入/媒体元素 width/height property 会做数值转换，attribute 才能正确增删。
  if (key === 'width' || key === 'height') {
    const tag = el.tagName
    if (
      tag === 'IMG' ||
      tag === 'VIDEO' ||
      tag === 'CANVAS' ||
      tag === 'SOURCE'
    ) {
      return false
    }
  }

  // 字符串 onxxx 表示内联事件源码，只能通过 attribute 表达。
  if (isNativeOn(key) && isString(value)) {
    return false
  }

  return key in el
}

/** 检查 Vue 自定义元素组件定义是否声明给定 prop，比较时统一 camelCase。 */
function shouldSetAsPropForVueCE(el: VueElement, key: string) {
  const props = // `_def` 是内部字段。
    // @ts-expect-error
    el._def.props as Record<string, unknown> | string[] | undefined
  if (!props) {
    return false
  }

  const camelKey = camelize(key)
  return Array.isArray(props)
    ? props.some(prop => camelize(prop) === camelKey)
    : Object.keys(props).some(prop => camelize(prop) === camelKey)
}
