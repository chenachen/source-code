/** 三种入口格式共用的初始数值一，编辑后两个接受回调记录新值。 */
export const foo = 1
hmr('.app', foo)

if (import.meta.hot) {
  import.meta.hot.accept(({ foo }) => {
    log('(self-accepting 1) foo is now:', foo)
  })

  import.meta.hot.accept(({ foo }) => {
    log('(self-accepting 2) foo is now:', foo)
  })

  import.meta.hot.dispose(() => {
    log(`foo was:`, foo)
  })
}

/** 把导出值转成字符串写入共享槽位，供不同入口形式的 runner 用例轮询。
 * @param key 状态键。
 * @param value 当前值。 */
function hmr(key: string, value: unknown) {
  ;(globalThis.__HMR__ as any)[key] = String(value)
}
