/** lazy glob 生成的导入函数映射；当前fixture只返回键名，未调用这些函数。 */
const modules = import.meta.glob('./modules/*js')

/** 收到任意消息后回传 glob 键数组，供页面确认扫描匹配的候选路径。
 * @param e 消息事件，当前不读取负载。 */
self.onmessage = function (e) {
  self.postMessage(Object.keys(modules))
}

// 为 source map 检查保留可定位的日志语句。
console.log('importMetaGlob.worker.js')
