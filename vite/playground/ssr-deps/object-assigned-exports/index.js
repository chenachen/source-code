Object.defineProperty(exports, '__esModule', { value: true })

/** 先构造含 hello 方法的对象，再 Object.assign 到 exports；配合 __esModule 标记检查 SSR 导出互操作。 */
const obj = {
  /** 返回 Hello World!；方法经过 Object.assign 挂到 CommonJS exports 后仍应能被 SSR 命名导入调用。 */
  hello() {
    return 'Hello World!'
  },
}

Object.assign(exports, obj)
