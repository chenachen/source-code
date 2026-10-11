// 从不同路径导入后读写同一消息数组，检查是否共享模块实例。
/** 模块实例共享的消息数组；不同导入路径必须观察同一集合。 */
const messages = []
/** 向当前模块的共享数组追加消息，供实例去重对照。 */
export const add = (message) => {
  messages.push(message)
}
/** 返回共享数组本身，供不同导入路径比较模块实例状态。 */
export const get = () => messages
