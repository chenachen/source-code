/** 具名库导出值；对它执行对象展开，覆盖含 helper 的 UMD/IIFE 包装输出。 */
export const foo = 'foo'

// 对具名导出执行对象展开，构造需要兼容转换的表达式。
console.log({ ...foo })
