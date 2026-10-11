import dep from './dep'

/** 上游使用且初始接受的命名导出，连续编辑用于验证旧接受列表与新列表的切换。 */
export const a = 'A0'

/** 未被入口读取的内部值，以 b 重导出；第二轮测试把接受列表改为该导出。 */
const bValue = 'B0'
export { bValue as b }

/** 入口使用的默认导出初值，接受列表也包括 default；执行日志与它一起观察值变化。 */
const def = 'D0'

export default def

log(`<<<<<< ${a} ${bValue} ${def} ; ${dep}`)

if (import.meta.hot) {
  import.meta.hot.acceptExports(['a', 'default'])
}
