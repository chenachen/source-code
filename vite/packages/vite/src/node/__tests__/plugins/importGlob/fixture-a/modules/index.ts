export { name as a } from './a'
export { name as b } from './b'

/** 目录聚合模块的 name 标记；负 pattern 排除 index.ts 时不得导入它。 */
export const name = 'index'

export default 'indexDefault'
