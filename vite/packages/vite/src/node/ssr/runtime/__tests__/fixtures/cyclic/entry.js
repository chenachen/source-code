/** 加载循环入口并等待其默认函数，构造动态导入的环。 */
export async function setupCyclic() {
  const mod = await import('./entry-cyclic.js')
  await mod.default()
}

/** 按调用方给出的 ID 动态导入模块；@vite-ignore 保留运行时解析路径。 */
export async function importAction(id) {
  return await import(/* @vite-ignore */ id)
}
