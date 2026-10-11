/** 返回 foo 的具名导出，供被排除依赖仍能作为外部 ESM 导入的测试。 */
export function foo() {
  return 'foo'
}
