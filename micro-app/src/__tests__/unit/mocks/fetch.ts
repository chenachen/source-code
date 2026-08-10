/**
 * 创建可返回固定 HTML 文本或网络错误的 fetch stub。
 *
 * @param data - 成功响应的 `text()` 返回值。
 * @param error - 为真时让请求 Promise 拒绝。
 */
export function setupMockFetch (data: string, error?: boolean): CallableFunction {
  return function fetchStub () {
    return error
      ? Promise.reject(new Error('network error'))
      : Promise.resolve({
        text: () => data,
      })
  }
}
