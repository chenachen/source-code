/** 测试使用的颜色名称包类型补充，其默认值为颜色名到文本颜色值的映射。 */
declare module 'css-color-names' {
  /** 颜色名与文本值的字典，供 CSS 场景消费该包默认导出。 */
  const colors: Record<string, string>
  export default colors
}

/** 测试端口清理依赖的默认函数类型补充。 */
declare module 'kill-port' {
  /** 清理指定端口的异步函数，返回完成时的 Promise。 */
  const kill: (port: number) => Promise<void>
  export default kill
}

/** playground Vue 单文件组件的通配模块声明，供 TypeScript 测试代码导入组件。 */
declare module '*.vue' {
  import type { ComponentOptions } from 'vue'
  /** Vue SFC 默认导出的组件选项类型。 */
  const component: ComponentOptions
  export default component
}
