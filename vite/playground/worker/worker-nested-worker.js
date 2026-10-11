import ImportMetaGlobEagerWorker from './importMetaGlobEager.worker?worker'
import SubWorker from './sub-worker?worker'

/** 查询包装器创建的子worker，父worker收到ping后向它发送ping。 */
const subWorker = new SubWorker()

/** 只在ping输入时唤起查询子worker。
 * @param event 主页面消息。 */
self.onmessage = (event) => {
  if (event.data === 'ping') {
    subWorker.postMessage('ping')
  }
}

self.postMessage(self.location.href)

/** 把查询子worker消息标为module分支，转发给页面。
 * @param ev 子worker回传事件。 */
subWorker.onmessage = (ev) => {
  self.postMessage({
    type: 'module',
    data: ev.data,
  })
}

/** 通过new URL构造的module worker，名字虽为classicWorker但type为module，回传标成constructor分支。 */
const classicWorker = new Worker(new URL('./url-worker.js', import.meta.url), {
  type: 'module',
})
classicWorker.addEventListener('message', (ev) => {
  self.postMessage({
    type: 'constructor',
    data: ev.data,
  })
})

/** 查询包装器创建的eager glob worker，启动后发送消息请求候选键数组。 */
const importMetaGlobEagerWorker = new ImportMetaGlobEagerWorker()

importMetaGlobEagerWorker.postMessage('1')

importMetaGlobEagerWorker.addEventListener('message', (ev) => {
  self.postMessage({
    type: 'importMetaGlobEager',
    data: ev.data,
  })
})

// 为 source map 检查保留可定位的日志语句。
console.log('worker-nested-worker.js')
