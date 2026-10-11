/** 从嵌套目录 eager 导入上一级 JSON，结果键保留 ../baz.json 相对关系。 */
const modules = import.meta.glob('../*.json', { eager: true })

/** 嵌套 JS 模块的具名值，与 JSON glob 结果一起进入根递归结果。 */
export const msg = 'bar'
export { modules }
