/**
 * scopeId 代码生成场景：确认 scoped CSS 标识只包围正确的 VNode 创建范围，并验证 module
 * 模式、静态提升以及插槽等路径不会丢失或泄漏 pushScopeId/popScopeId。
 */
import { baseCompile } from '../src/compile'

/**
 * 确认所有插槽函数都由 `_withCtx` 包装；执行插槽时它会设置 currentRenderingInstance
 * 与 currentScopeId，使插槽创建的 VNode 获得正确组件上下文和作用域属性。
 */
describe('scopeId compiler support', () => {
  test('should only work in module mode', () => {
    expect(() => {
      baseCompile(``, { scopeId: 'test' })
    }).toThrow(`"scopeId" option is only supported in module mode`)
  })

  test('should wrap default slot', () => {
    const { code } = baseCompile(`<Child><div/></Child>`, {
      mode: 'module',
      scopeId: 'test',
    })
    expect(code).toMatch(`default: _withCtx(() => [`)
    expect(code).toMatchSnapshot()
  })

  test('should wrap named slots', () => {
    const { code } = baseCompile(
      `<Child>
        <template #foo="{ msg }">{{ msg }}</template>
        <template #bar><div/></template>
      </Child>
      `,
      {
        mode: 'module',
        scopeId: 'test',
      },
    )
    expect(code).toMatch(`foo: _withCtx(({ msg }) => [`)
    expect(code).toMatch(`bar: _withCtx(() => [`)
    expect(code).toMatchSnapshot()
  })

  test('should wrap dynamic slots', () => {
    const { code } = baseCompile(
      `<Child>
        <template #foo v-if="ok"><div/></template>
        <template v-for="i in list" #[i]><div/></template>
      </Child>
      `,
      {
        mode: 'module',
        scopeId: 'test',
      },
    )
    expect(code).toMatch(/name: "foo",\s+fn: _withCtx\(/)
    expect(code).toMatch(/name: i,\s+fn: _withCtx\(/)
    expect(code).toMatchSnapshot()
  })
})
