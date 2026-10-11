/** 收到消息后动态导入 ./dynamic，将 hello 前缀与依赖默认值组合后发回页面。 */
self.onmessage = async () => {
  const mod = await import('./dynamic')
  self.postMessage('hello from worker: ' + mod.default)
}
