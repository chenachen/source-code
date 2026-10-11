/** 接受回调消费的命名导出；测试连续更新值和回调文本，区分旧回调函数体与新导出参数。 */
export const x = 'X'

if (import.meta.hot) {
  import.meta.hot.acceptExports(['x'], (m) => {
    console.log(`reloaded >>> ${m.x}`)
  })
}
