/** 提供静态导入与动态导入共享的默认函数；调用返回 foo，fixture 用于观察关闭代码分割时的构建警告。
 * @returns 固定字符串 foo。 */
export default function foo() {
  return 'foo'
}
