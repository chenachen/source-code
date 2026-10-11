/**
 * `defineExpose` 宏场景：确认调用被改写为 setup 的 expose 参数，并验证普通 script 位于
 * script setup 后时仍能正确合并。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

// 输入 defineExpose({ foo: 123 })；编译后删除宏名并注入 expose 参数，原调用转为 __expose，确认显式暴露路径。
test('defineExpose()', () => {
  const { content } = compile(`
<script setup>
defineExpose({ foo: 123 })
</script>
`)
  assertCode(content)
  // defineExpose 是编译期宏：导入和原始调用都应从输出中移除。
  expect(content).not.toMatch('defineExpose')
  // setup 签名中应注入 expose 上下文参数。
  expect(content).toMatch(`setup(__props, { expose: __expose }) {`)
  // 宏调用的 callee 应替换为编译器生成的 expose 辅助变量。
  expect(content).toMatch(/\b__expose\(\{ foo: 123 \}\)/)
})

// 把无结尾换行的普通 script 放在 setup 后，setup 中含 import；assertCode 检查移动与合并后仍是合法模块并匹配快照。
test('<script> after <script setup> the script content not end with `\\n`', () => {
  const { content } = compile(`
  <script setup>
  import { x } from './x'
  </script>
  <script>const n = 1</script>
  `)
  assertCode(content)
})
