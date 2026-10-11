/** 基础模块的 basic 名称标记，供 Runner 缓存与 namespace 测试。 */
export const name = 'basic'

/** 暴露本次求值的 import.meta 对象，供 url/env/hot 等注入字段测试检查。 */
export const meta = import.meta
