/** 使用 package imports 的 #src 子路径 glob 收集模块，检验扫描时的子路径模式解析。 */
export const modules = import.meta.glob('#src/foo/*.ts')
