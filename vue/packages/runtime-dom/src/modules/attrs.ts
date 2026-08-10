import {
  NOOP,
  includeBooleanAttr,
  isSpecialBooleanAttr,
  isSymbol,
  makeMap,
} from '@vue/shared'
import {
  type ComponentInternalInstance,
  DeprecationTypes,
  compatUtils,
} from '@vue/runtime-core'

/** SVG xlink attribute 的命名空间 URI。 */
export const xlinkNS = 'http://www.w3.org/1999/xlink'

/**
 * 设置/移除普通 DOM attribute。
 * SVG xlink 使用命名空间 API；特殊布尔 attribute 只关心是否存在，真值写空字符串；
 * Symbol 显式转字符串，避免 setAttribute 的隐式转换在部分环境抛错。
 */
export function patchAttr(
  el: Element,
  key: string,
  value: any,
  isSVG: boolean,
  instance?: ComponentInternalInstance | null,
  isBoolean: boolean = isSpecialBooleanAttr(key),
): void {
  if (isSVG && key.startsWith('xlink:')) {
    if (value == null) {
      el.removeAttributeNS(xlinkNS, key.slice(6, key.length))
    } else {
      el.setAttributeNS(xlinkNS, key, value)
    }
  } else {
    if (__COMPAT__ && compatCoerceAttr(el, key, value, instance)) {
      return
    }

    // 此处的 special Boolean 仅指没有同名 DOM property、因此不会走 patchDOMProp 的键。
    if (value == null || (isBoolean && !includeBooleanAttr(value))) {
      el.removeAttribute(key)
    } else {
      // HTML attribute 值最终为字符串；布尔 attribute 用空串表达“存在”。
      el.setAttribute(
        key,
        isBoolean ? '' : isSymbol(value) ? String(value) : value,
      )
    }
  }
}

/** Vue 2 对枚举 attribute 的特殊强制转换集合，仅 compat 构建生成。 */
const isEnumeratedAttr = __COMPAT__
  ? /*@__PURE__*/ makeMap('contenteditable,draggable,spellcheck')
  : NOOP

/**
 * 在启用对应 compat 开关时复现 Vue 2 attribute 转换规则。
 * 返回 true 表示已处理，调用方不再执行 Vue 3 默认 patch。
 */
export function compatCoerceAttr(
  el: Element,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance | null = null,
): boolean {
  if (isEnumeratedAttr(key)) {
    const v2CoercedValue =
      value === undefined
        ? null
        : value === null || value === false || value === 'false'
          ? 'false'
          : 'true'
    if (
      v2CoercedValue &&
      compatUtils.softAssertCompatEnabled(
        DeprecationTypes.ATTR_ENUMERATED_COERCION,
        instance,
        key,
        value,
        v2CoercedValue,
      )
    ) {
      el.setAttribute(key, v2CoercedValue)
      return true
    }
  } else if (
    value === false &&
    !(el.tagName === 'INPUT' && key === 'value') &&
    !isSpecialBooleanAttr(key) &&
    compatUtils.isCompatEnabled(DeprecationTypes.ATTR_FALSE_VALUE, instance)
  ) {
    compatUtils.warnDeprecation(
      DeprecationTypes.ATTR_FALSE_VALUE,
      instance,
      key,
    )
    el.removeAttribute(key)
    return true
  }
  return false
}
