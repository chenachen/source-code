/**
 * `defineOptions` 宏场景：把静态选项提升并合并到组件导出，允许 TS satisfies/assertion 包装，
 * 同时禁止重复调用、引用 setup 局部值以及声明 props/emits/expose/slots 等专用选项。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineOptions()', () => {
  test('basic usage', () => {
    const { content } = compile(`
      <script setup>
      defineOptions({ name: 'FooApp' })
      </script>
    `)
    assertCode(content)
    // defineOptions 是编译期宏：导入和原始调用都应从输出中移除。
    expect(content).not.toMatch('defineOptions')
    // 宏传入的组件选项应合并进默认导出。
    expect(content).toMatch(
      `export default /*@__PURE__*/Object.assign({ name: 'FooApp' }, `,
    )
  })

  test('empty argument', () => {
    const { content } = compile(`
      <script setup>
      defineOptions()
      </script>
    `)
    assertCode(content)
    expect(content).toMatch(`export default {`)
    // 即使使用别名导入，也必须识别并移除 defineOptions 宏调用。
    expect(content).not.toMatch('defineOptions')
  })

  it('should emit an error with two defineOptions', () => {
    expect(() =>
      compile(`
      <script setup>
      defineOptions({ name: 'FooApp' })
      defineOptions({ name: 'BarApp' })
      </script>
      `),
    ).toThrowError('[@vue/compiler-sfc] duplicate defineOptions() call')
  })

  it('should emit an error with props or emits property', () => {
    expect(() =>
      compile(`
      <script setup>
      defineOptions({ props: { foo: String } })
      </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare props. Use defineProps() instead.',
    )

    expect(() =>
      compile(`
      <script setup>
      defineOptions({ emits: ['update'] })
      </script>
    `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare emits. Use defineEmits() instead.',
    )

    expect(() =>
      compile(`
      <script setup>
      defineOptions({ expose: ['foo'] })
      </script>
    `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare expose. Use defineExpose() instead.',
    )

    expect(() =>
      compile(`
      <script setup>
      defineOptions({ slots: ['foo'] })
      </script>
    `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare slots. Use defineSlots() instead.',
    )
  })

  it('should emit an error with type generic', () => {
    expect(() =>
      compile(`
      <script setup lang="ts">
      defineOptions<{ name: 'FooApp' }>()
      </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot accept type arguments',
    )
  })

  it('should emit an error with type assertion', () => {
    expect(() =>
      compile(`
      <script setup lang="ts">
      defineOptions({ props: [] } as any)
      </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare props. Use defineProps() instead.',
    )
  })

  it('should emit an error with declaring props/emits/slots/expose', () => {
    expect(() =>
      compile(`
        <script setup>
        defineOptions({ props: ['foo'] })
        </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare props. Use defineProps() instead',
    )

    expect(() =>
      compile(`
        <script setup>
        defineOptions({ emits: ['update'] })
        </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare emits. Use defineEmits() instead',
    )

    expect(() =>
      compile(`
        <script setup>
        defineOptions({ expose: ['foo'] })
        </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare expose. Use defineExpose() instead',
    )

    expect(() =>
      compile(`
        <script setup lang="ts">
        defineOptions({ slots: Object })
        </script>
      `),
    ).toThrowError(
      '[@vue/compiler-sfc] defineOptions() cannot be used to declare slots. Use defineSlots() instead',
    )
  })
})
