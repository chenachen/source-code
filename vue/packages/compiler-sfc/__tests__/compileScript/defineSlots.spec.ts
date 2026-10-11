/**
 * `defineSlots` 宏场景：验证有类型/无类型参数的调用；赋值时生成 useSlots 绑定，未使用返回值
 * 时删除宏调用，不生成 useSlots。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineSlots()', () => {
  // 将带 default 插槽类型的 defineSlots 赋给 slots；编译后类型宏消失，变量由 _useSlots() 初始化。
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

  // 调用带类型的 defineSlots 而不接收结果；整个宏语句删除，输出也不引入 useSlots。
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

  // 无泛型地接收 defineSlots 返回值；仍生成 _useSlots()，表明辅助调用由值使用决定。
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
