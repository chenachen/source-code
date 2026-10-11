/** 动态导回 entry.js 构成循环，调用时等待该导入完成。 */
export default async function main() {
  await import('./entry.js')
}
