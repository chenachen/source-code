/** 动态导入同目录子模块后返回 foo，检验预构建保留可用的动态依赖路径。 */
export const lazyFoo = async function () {
  const { foo } = await import('./dynamic.js')
  return foo
}
