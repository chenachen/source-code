// 带模块级状态的外部依赖，供消费者核对未被复制进优化产物。
let msg
/** 修改此入口模块的共享消息；SSR 样例从另一依赖读取该值，用于核对显式 external 子路径是否共享同一份 Node 模块状态。 */
export function setMessage(externalMsg) {
  msg = externalMsg
}
/** 返回入口模块当前消息；不复制状态，使外部依赖能够观察 setMessage 的更新。 */
export default function getMessage() {
  return msg
}
