import foo from './foo'

/** 异步导入与静态入口同一个 foo.js，再尝试调用解构的 foo；该模块只导出 default，测试只检查构建警告而不验证此调用成功。
 * @returns 动态加载及调用的 Promise。 */
const asyncImport = async () => {
  const { foo } = await import('./foo.js')
  foo()
}

foo()
asyncImport()
