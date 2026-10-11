/** eager glob 求值得到的模块映射；回传仅检查键数组，导入本身发生在模块初始化时。 */
const modules = import.meta.glob('./modules/*js', { eager: true })

/** 收到任意消息后回传 eager glob 的键数组。
 * @param e 消息事件，当前不读取负载。 */
self.onmessage = function (e) {
  self.postMessage(Object.keys(modules))
}

// 为 source map 检查保留可定位的日志语句。
console.log('importMetaGlobEager.worker.js')
