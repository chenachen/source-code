import { mode, msg } from './modules/workerImport'

/** 收到任意消息后回传导入的msg与mode，文件可被插件当TypeScript输出继续转换。
 * @param e 输入消息，当前不读取负载。 */
self.onmessage = (e) => {
  self.postMessage({ msg, mode })
}

self.postMessage({ msg, mode })

// 为 source map 检查保留可定位的日志语句。
console.log('possible-ts-output-worker.mjs')
