Promise.all([
  import('./module-and-worker'),
  import('./modules/module2'),
  import('./modules/module3'),
]).then((data) => {
  const _data = { ...data[0], ...data[1], ...data[2] }
  self.postMessage(_data)
})

// 为 source map 检查保留可定位的日志语句。
console.log('emit-chunk-sub-worker.js')
