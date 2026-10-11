export * from './module0'
export * from './module1'
/** 第二子模块独立消息；同时重导出其他命名导出，供子worker合并namespace。 */
export const msg2 = 'module2'
