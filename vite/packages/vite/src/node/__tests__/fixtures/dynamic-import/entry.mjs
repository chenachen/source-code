/** 动态导入同目录 dep.mjs 并打印 namespace，供 SSR 构建检查浏览器 preload helper 是否被排除。 */
export async function main() {
  const mod = await import('./dep.mjs')
  console.log(mod)
}
