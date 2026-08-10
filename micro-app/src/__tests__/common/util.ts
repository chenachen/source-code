/** 把断言回调推迟到下一宏任务并以其返回值结算，供异步 DOM 副作用稳定后检查。 */
export async function waitFor (cb: CallableFunction): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(cb())
    }, 0)
  })
}
