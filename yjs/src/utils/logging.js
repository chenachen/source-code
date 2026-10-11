/**
 * 输出共享类型底层链表及当前未删除内容，供人工诊断结构状态。
 *
 * 第一项输出包含序列链中的已删除节点，第二项只保留未删除节点的 content 对象。
 * 属性链位于 `_map`，不在这里的遍历范围内。
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
