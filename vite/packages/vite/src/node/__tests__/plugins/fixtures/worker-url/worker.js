/* global self */
/** Worker 启动后发出的 hello 标记，供 ?worker&url 生成路径的运行结果对照。 */
const msg = 'hello from worker'
self.postMessage(msg)
