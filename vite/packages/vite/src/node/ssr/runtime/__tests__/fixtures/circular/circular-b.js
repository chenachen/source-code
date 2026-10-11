export { a } from './circular-a'
/** 互相重导出依赖的 b 标记，用于检验循环模块 namespace 的初始化与 HMR。 */
export const b = 'b'
