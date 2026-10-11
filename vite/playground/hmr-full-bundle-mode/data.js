// #23001：检验 hot.data 在多轮 HMR 更新后继续保留。
/** 读取当前模块 hot.data，非 HMR 环境使用新空对象；执行和 dispose 分别递增两个计数，供两轮更新比较。 */
const data = import.meta.hot?.data ?? {}

// 直接改写保存的对象；每轮更新继续累加 count。
data.count = (data.count ?? 0) + 1
text('.data-count', data.count)

// 下面的 dispose 回调写入 disposed，下一轮执行读取它；
// 证明回调收到原有的数据对象，而非新分配的空对象。
text('.data-disposed', data.disposed ?? 0)

if (import.meta.hot) {
  import.meta.hot.dispose((prev) => {
    prev.disposed = (prev.disposed ?? 0) + 1
  })
  import.meta.hot.accept()
}

globalThis.__hmrBump = 'initial'

/** 按选择器写入字符串化后的计数。
 * @param el 输出节点选择器。
 * @param value 待显示数值。 */
function text(el, value) {
  document.querySelector(el).textContent = String(value)
}
