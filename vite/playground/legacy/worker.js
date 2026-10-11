import { module } from './module'

/** 任意消息到达后回传依赖模块值，让页面确认 Worker 及其静态依赖加载成功。 */
self.onmessage = () => {
  self.postMessage(module)
}
