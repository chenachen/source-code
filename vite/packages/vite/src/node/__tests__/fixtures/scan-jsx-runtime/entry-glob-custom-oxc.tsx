/** 收集 pages 目录的 TSX 模块，作为 glob 扫描与自定义 JSX runtime 的依赖输入。 */
export const pages = import.meta.glob('./pages/*.tsx')

export default <div />
