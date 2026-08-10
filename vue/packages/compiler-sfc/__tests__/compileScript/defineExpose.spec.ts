/**
 * `defineExpose` 宏场景：确认调用被改写为 setup 的 expose 参数并禁止重复调用，同时保证
 * 未调用时生成 `expose()`，使 script setup 组件默认保持封闭。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

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

test('<script> after <script setup> the script content not end with `\\n`', () => {
  const { content } = compile(`
  <script setup>
  import { x } from './x'
  </script>
  <script>const n = 1</script>
  `)
  assertCode(content)
})
