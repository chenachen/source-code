/** 连接模板静态字符串，保留 TS 参数类型和 tagged template 作为 Oxc helper 转换输入。 */
function html(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings.join('')
}
/** 执行 html tagged template 的文本结果，供 runtime helper 导入测试核对。 */
export const result = html`<script>
  console.log('hi')
</script>`
