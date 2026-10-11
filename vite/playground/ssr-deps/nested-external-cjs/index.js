// 带模块级状态的 CommonJS 外部依赖，供多个父包核对共享实例。
let msg

module.exports = {
  /** 更新嵌套外部依赖的模块级消息；其他依赖对同一包的访问应读取这份共享状态。 */
  setMessage(externalMsg) {
    msg = externalMsg
  },
  /** 返回嵌套外部依赖当前消息，用于核对优化与未优化父依赖是否共用其模块实例。 */
  getMessage() {
    return msg
  },
}
