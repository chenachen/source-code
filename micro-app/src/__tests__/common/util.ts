/**
 * 在下一计时器任务执行回调，让当前栈及已排 Promise 微任务先结束。
 *
 * 它只提供一个任务间隔，不等待网络、mounted 或异步卸载；回调应检查已明确排队的状态。
 * @param cb - 延迟执行的断言/取值函数；返回 Promise 时 resolve 会继续采用其结算值。
 * @returns 回调的返回值。计时器内同步抛错不会自动变为此 Promise 的拒绝。
 */
export async function waitFor (cb: CallableFunction): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(cb())
    }, 0)
  })
}
