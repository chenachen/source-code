/** React 元素工厂；此兼容入口通过 CommonJS 加载以便直接替换 JSX 工厂。 */
const React = require('react')

/** 带动态数据和生命周期监听器缓存字段的 micro-app 自定义元素。 */
type MicroElementType = HTMLElement & Record<string, unknown>

/** 需要从 React props 转换为 DOM 事件监听器的 micro-app 回调名白名单。 */
const eventLifeCycles = [
  'oncreated',
  'onbeforemount',
  'onmounted',
  'onunmount',
  'onerror',
  'ondatachange',
  'onbeforeshow',
  'onaftershow',
  'onafterhidden',
]

/**
 * 包装 `React.createElement`，为 micro-app 元素桥接 `data` 属性和生命周期事件 props。
 *
 * @remarks
 * 普通元素直接透传。micro-app 元素使用包装后的 ref：先维护调用方原始 ref，再在真实元素存在时同步对象数据，并替换发生变化的生命周期监听器。
 */
function jsxCustomEvent (
  type: string | CallableFunction,
  props: Record<string, unknown> | null,
  ...children: any[]
): void {
  if (typeof type !== 'string' || !/^micro-app(-\S+)?/.test(type) || !props) {
    return React.createElement.apply(null, [type, props, ...children])
  }

  const newProps = Object.assign({}, props)

  // React 在创建、更新和卸载时调用 ref；元素为 null 时只需把状态转发给原始 ref。
  newProps.ref = (element: MicroElementType | null) => {
    if (typeof props.ref === 'function') {
      props.ref(element)
    } else if (typeof props.ref === 'object') {
      (props.ref as any).current = element
    }

    // 只有拿到真实元素时才能同步自定义属性和 DOM 监听器。
    if (element) {
      // `data` 只接受普通对象；引用未变化时避免触发自定义元素的重复数据更新。
      if (toString.call(props.data) === '[object Object]' && element.data !== props.data) {
        element.data = props.data
      }

      for (const key in props) {
        if (
          Object.prototype.hasOwnProperty.call(props, key) &&
          eventLifeCycles.includes(key.toLowerCase()) &&
          typeof props[key] === 'function' &&
          (!element[key] || element[key] !== props[key])
        ) {
          const eventName = key.toLowerCase().replace('on', '')
          if (element[key]) {
            // @ts-ignore
            element.removeEventListener(eventName, element[key], false)
          }
          // 保存当前函数引用，下一次 ref 更新时才能先移除旧监听器。
          // @ts-ignore
          element.addEventListener(eventName, props[key], false)
          element[key] = props[key]
        }
      }
    }
  }

  return React.createElement.apply(null, [type, newProps, ...children])
}

module.exports = jsxCustomEvent
module.exports.default = jsxCustomEvent
