(() => {})() // 检验前置 importScripts 注入后，相邻 IIFE 仍能正确执行。

let base = `/${self.location.pathname.split('/')[1]}`
if (base.endsWith('.js') || base === `/worker-entries`) base = '' // 开发模式下修正源文件 URL 对应的 base。

importScripts(`${base}/classic.js`)

self.addEventListener('message', async (e) => {
  switch (e.data) {
    case 'ping': {
      self.postMessage({
        message: e.data,
        result: self.constant,
      })
      break
    }
    case 'test-import': {
      // Vite 处理动态导入时可能注入导入辅助代码；
      // 此处检验 classic worker 仍能完成该动态导入。
      // 此分支只在开发模式的 classic worker 套件中验证。
      const importPath = `${base}/classic-esm.js`
      const { msg } = await import(/* @vite-ignore */ importPath)
      self.postMessage({
        message: e.data,
        result: msg,
      })
      break
    }
  }
})

// 为 source map 检查保留可定位的日志语句。
console.log('classic-worker.js')
