/**
 * `defineSlots` 宏场景：移除仅类型的宏调用并生成 useSlots 运行时绑定；验证类型参数可用，
 * 运行时参数和重复调用会被诊断。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineSlots()', () => {
  test('basic usage', () => {
    const { content } = compile(`
      <script setup lang="ts">
      const slots = defineSlots<{
        default: { msg: string }
      }>()
      </script>
    `)
    assertCode(content)
    expect(content).toMatch(`const slots = _useSlots()`)
    expect(content).not.toMatch('defineSlots')
  })

  test('w/o return value', () => {
    const { content } = compile(`
      <script setup lang="ts">
      defineSlots<{
        default: { msg: string }
      }>()
      </script>
    `)
    assertCode(content)
    expect(content).not.toMatch('defineSlots')
    expect(content).not.toMatch(`_useSlots`)
  })

  test('w/o generic params', () => {
    const { content } = compile(`
      <script setup>
      const slots = defineSlots()
      </script>
    `)
    assertCode(content)
    expect(content).toMatch(`const slots = _useSlots()`)
    expect(content).not.toMatch('defineSlots')
  })
})
