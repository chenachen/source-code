import module1Url from './modules/module1.js?url'

import('./modules/module0').then((module) => {
  import(/* @vite-ignore */ module1Url).then((module1) => {
    self.postMessage(module.default + module1.msg1 + import.meta.env.BASE_URL)
  })
})

// 为 source map 检查保留可定位的日志语句。
console.log('emit-chunk-dynamic-import-worker.js')
