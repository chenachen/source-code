import { DeprecationTypes, compatUtils, warn } from '@vue/runtime-core'
import { includeBooleanAttr } from '@vue/shared'
import { unsafeToTrustedHTML } from '../nodeOps'

/**
 * 更新 DOM property，并处理 innerHTML、value、空值转换和只读/校验 property 异常。
 * innerHTML 属于不安全 sink；调用方必须只传可信内容，Vue 不负责清洗用户 HTML。
 */
export function patchDOMProp(
  el: any,
  key: string,
  value: any,
  parentComponent: any,
  attrName?: string,
): void {
  // __UNSAFE__：v-html 或手写 render 的 innerHTML 可执行不可信标记；这里只做 Trusted
  // Types 包装，不做 sanitizer。
  if (key === 'innerHTML' || key === 'textContent') {
    // null 清理由 renderer 在挂新 children 前统一完成，避免 innerHTML 残留节点。
    if (value != null) {
      el[key] = key === 'innerHTML' ? unsafeToTrustedHTML(value) : value
    }
    return
  }

  const tag = el.tagName

  if (
    key === 'value' &&
    tag !== 'PROGRESS' &&
    // 自定义元素可自行定义 value/_value 语义，不进入原生表单特判。
    !tag.includes('-')
  ) {
    // #4956：option.value 缺失时回退文本内容；比较 attribute 才能知道显式 value 是否一致。
    const oldValue =
      tag === 'OPTION' ? el.getAttribute('value') || '' : el.value
    const newValue =
      value == null
        ? // #11647：null/undefined 普通 value 应写空串；checkbox 浏览器默认 value 是 'on'，
          // 清空会破坏无 value attribute 的原生提交语义，因此恢复为 'on'。
          el.type === 'checkbox'
          ? 'on'
          : ''
        : String(value)
    if (oldValue !== newValue || !('_value' in el)) {
      el.value = newValue
    }
    if (value == null) {
      el.removeAttribute(key)
    }
    // DOM value 会字符串化；`_value` 保留原始绑定值供 v-model 读回。
    // 选中比较由控件与 model 类型决定：Array/单选可用宽松比较，Set 使用 Set.has。
    el._value = value
    return
  }

  let needRemove = false
  if (value === '' || value == null) {
    const type = typeof el[key]
    if (type === 'boolean') {
      // 如 `<select multiple>` 编译为 `{ multiple: '' }`，空串应转 true。
      value = includeBooleanAttr(value)
    } else if (value == null && type === 'string') {
      // 如 `<div :id="null">`，先给 property 合法空串，再移除 attribute。
      value = ''
      needRemove = true
    } else if (type === 'number') {
      // 数字 property 不能接 null，先归零，再移除 attribute 恢复未设置状态。
      value = 0
      needRemove = true
    }
  } else {
    if (
      __COMPAT__ &&
      value === false &&
      compatUtils.isCompatEnabled(
        DeprecationTypes.ATTR_FALSE_VALUE,
        parentComponent,
      )
    ) {
      const type = typeof el[key]
      if (type === 'string' || type === 'number') {
        __DEV__ &&
          compatUtils.warnDeprecation(
            DeprecationTypes.ATTR_FALSE_VALUE,
            parentComponent,
            key,
          )
        value = type === 'number' ? 0 : ''
        needRemove = true
      }
    }
  }

  // 某些 property 会校验并抛错，或只有 getter、在 strict mode 赋值抛错，例如 select.type、
  // select.willValidate。捕获后开发警告，不能让整次组件 patch 中断。
  try {
    el[key] = value
  } catch (e: any) {
    // nullish 自动转换是清理流程的一部分，失败时不额外警告。
    if (__DEV__ && !needRemove) {
      warn(
        `Failed setting prop "${key}" on <${tag.toLowerCase()}>: ` +
          `value ${value} is invalid.`,
        e,
      )
    }
  }
  needRemove && el.removeAttribute(attrName || key)
}
