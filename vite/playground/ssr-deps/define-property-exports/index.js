Object.defineProperty(exports, 'hello', {
  /** 通过 Object.defineProperty 的 value 方法提供 Hello World!，验证 SSR 对单个属性描述符形式 CommonJS 导出的读取。 */
  value() {
    return 'Hello World!'
  },
})
