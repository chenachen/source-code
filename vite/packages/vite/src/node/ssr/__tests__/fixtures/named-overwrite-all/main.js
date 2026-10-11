/** 本模块显式导出的 a 字符串标记，供 export * 与同名显式导出优先级测试对照。 */
export const a = 'main-a'
export * from './dep1.js'
/** 本模块显式导出的 c 字符串标记，供 export * 与同名显式导出优先级测试对照。 */
export const c = 'main-c'
export * from './dep2.js'
