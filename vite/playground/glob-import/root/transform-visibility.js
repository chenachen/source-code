/** 变量动态导入的固定插值，供 post 插件检查 dynamicImportVars 已注入 helper。 */
const name = 'foo'
/** 由 post 插件观察的 glob 调用，插件不执行结果而检查调用已被替换。 */
export const globResult = import.meta.glob('./dir/*.js')
/** 变量动态 import 的 Promise；post 插件将模块替换成转换完成标志，验证 helper 可见。 */
export const dynamicResult = import(`./dir/${name}.js`)
