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
 * 名称不匹配 micro-app 前缀的元素直接透传。匹配元素使用包装后的 ref：先转发调用方 ref，
 * 再同步对象数据；本轮仍传入的函数型生命周期 props 发生变化时，移除旧监听并绑定新函数。
 * 已省略或变成非函数的 prop 不进入替换分支，旧监听仍留在元素上。
 * 生命周期事件名按 prop 小写归一化，但缓存字段仍使用原 prop 键；ref 反复调用时
 * 依靠函数引用避免重复绑定。此工厂不负责卸载清理或 React 合成事件调度。
 *
 * @param type - React 元素类型；字符串匹配 micro-app 前缀时才进行自定义元素桥接。
 * @param props - 保留原对象，浅复制后只替换 ref；data 由元素属性 setter 进入数据中心。
 * @param children - 原样交给 React.createElement 的子节点。
 * @returns 实际返回 React.createElement 的结果；这里的 void 声明未表达 React 返回类型。
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

  /**
   * React 每次回调 ref 时先转发原 ref，再同步真实元素的 data 与事件函数引用。
   * @param element - 创建/更新时的宿主元素，卸载时为 null；null 元素不解除旧 DOM 监听。
   * @remarks 对象 ref 直接写 current，未单独排除 props.ref 为 null 的情况。
   */
  newProps.ref = (element: MicroElementType | null) => {
    if (typeof props.ref === 'function') {
      props.ref(element)
    } else if (typeof props.ref === 'object') {
      (props.ref as any).current = element
    }

    // 只有拿到真实元素时才能同步自定义属性和 DOM 监听器。
    if (element) {
      // `data` 接受 [object Object] 标签的值；引用未变化时避免触发元素的重复数据更新。
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
