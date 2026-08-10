/**
 * 输出共享类型底层链表及当前未删除内容，供人工诊断结构状态。
 *
 * 输出量可能很大，也会暴露完整内容；不要在生产路径调用。
 *
 * @param {YType<any>} type 要检查的共享类型。
 */
export const logType = type => {
  const res = []
  let n = type._start
  while (n) {
    res.push(n)
    n = n.right
  }
  console.log('Children: ', res)
  console.log('Children content: ', res.filter(m => !m.deleted).map(m => m.content))
}
