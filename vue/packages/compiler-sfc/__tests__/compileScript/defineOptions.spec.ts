/**
 * `defineOptions` 宏场景：把运行时选项合并到组件导出，删除无参调用，并诊断重复调用、类型
 * 参数和 props/emits/expose/slots 等专用选项；TS assertion 包装也不能绕过专用选项检查。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineOptions()', () => {
  // 传入 name: FooApp 的选项对象；删除 defineOptions 调用并用 Object.assign 合并到组件导出，选项位于 setup 之外。
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

  // 无参调用 defineOptions；删除空宏并直接导出组件对象，不需要选项合并。
  test('empty argument', () => {
    const { content } = compile(`
      <script setup>
      defineOptions()
      </script>
    `)
    assertCode(content)
    expect(content).toMatch(`export default {`)
    // 无参 defineOptions() 被删除，不额外生成需要合并的 options 对象。
    expect(content).not.toMatch('defineOptions')
  })

  // 同一 setup 连续声明两个组件名；第二次 defineOptions 触发重复调用诊断。
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

  // 分别传 props、emits、expose、slots 专用字段；编译器逐项报错并指向对应专用宏，避免两个入口竞争生成结果。
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

  // 给 defineOptions 传类型参数；它只接收运行时对象，因此编译时抛类型参数诊断。
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

  // 用 as any 包装含 props 的对象；去掉 TS 包装后仍检查专用字段，不能借断言绕过约束。
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

  // 分别以数组声明 props/emits/slots/expose；四个分支均拒绝该字段，约束不依赖其值采用对象还是数组。
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
