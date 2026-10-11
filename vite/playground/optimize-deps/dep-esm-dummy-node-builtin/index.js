/** 默认函数返回 foo，且函数对象带 bar 属性，供 CJS/ESM 互操作路径测试。 */
function foo() {
  return 'foo'
}

foo.bar = 'bar'

/** ESM 包的 bar 具名标记，供伪 Node 内置名称 stream 的互操作对照。 */
export const bar = 'bar'

export default foo
