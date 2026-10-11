/**
 * 创建可返回固定 HTML 文本或网络错误的 fetch stub。
 *
 * 不做真实网络请求，也不检查 URL/cache；成功只提供 fetchSource 所需的 text()，
 * 用 Promise.resolve 包装响应，让加载器保留异步 then/catch 边界。
 *
 * @param data - 成功响应的 `text()` 返回值。
 * @param error - 为真时让请求 Promise 拒绝。
 */
export function setupMockFetch (data: string, error?: boolean): CallableFunction {
  /** 返回的 fetchStub 每次重复提供同一输入或拒绝原因，不消费一次性队列。 */
  return function fetchStub () {
    return error
      ? Promise.reject(new Error('network error'))
      : Promise.resolve({
        /** 返回传入的原文而不改写标签；虽是同步值，fetchSource 的 then 会采用它。 */
        text: () => data,
      })
  }
}
