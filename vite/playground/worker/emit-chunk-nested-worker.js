import SubWorker from './emit-chunk-sub-worker?worker'
/** 查询包装器创建的子worker，汇总子图消息后由父worker转发。 */
const subWorker = new SubWorker()

/** 给子worker消息加类型标签并转发给主页面。
 * @param event 子worker消息。 */
subWorker.onmessage = (event) => {
  self.postMessage({
    type: 'emit-chunk-sub-worker',
    data: event.data,
  })
}

/** 把也会作为普通模块动态导入的文件创建为worker，覆盖同源文件两种图角色。 */
const moduleWorker = new Worker(
  new URL('./module-and-worker.js', import.meta.url),
  { type: 'module' },
)

/** 给worker角色的输出加标签并转发，使页面能区别普通模块角色。
 * @param event 该worker回传的消息。 */
moduleWorker.onmessage = (event) => {
  self.postMessage({
    type: 'module-and-worker:worker',
    data: event.data,
  })
}

import('./module-and-worker').then((res) => {
  self.postMessage({
    type: 'module-and-worker:module',
    data: res.module,
  })
})

// 为 source map 检查保留可定位的日志语句。
console.log('emit-chunk-nested-worker.js')
