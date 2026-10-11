self.postMessage(
  [
    'A string',
    import.meta.env.BASE_URL,
    self.location.url,
    import.meta && import.meta.url,
    import.meta.url,
  ].join(' '),
)

// 为 source map 检查保留可定位的日志语句。
console.log('url-worker.js')
