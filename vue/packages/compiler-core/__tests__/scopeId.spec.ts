/**
 * scopeId 编译支持场景：验证 scopeId 仅允许 module 模式，并检查默认、具名和动态
 * 插槽函数生成 withCtx 包装。
 */
import { baseCompile } from '../src/compile'

/**
 * 确认所有插槽函数都由 `_withCtx` 包装；执行插槽时它会设置 currentRenderingInstance
 * 与 currentScopeId，使插槽创建的 VNode 获得正确组件上下文和作用域属性。
 */
describe('scopeId compiler support', () => {
  /**
   * 函数模式编译空模板并传入 scopeId；默认错误处理器抛出仅模块模式支持 scopeId 的诊断。此场景检查选项约束，不执行样式作用域的运行时挂载。
   */
  test('should only work in module mode', () => {
    expect(() => {
      baseCompile(``, { scopeId: 'test' })
    }).toThrow(`"scopeId" option is only supported in module mode`)
  })

  /**
   * 模块模式编译 Child 的默认插槽 div，并传入 scopeId；检查默认插槽函数由 _withCtx 包装并比对快照。该包装保留提供插槽的渲染上下文。
   */
  test('should wrap default slot', () => {
    const { code } = baseCompile(`<Child><div/></Child>`, {
      mode: 'module',
      scopeId: 'test',
    })
    expect(code).toMatch(`default: _withCtx(() => [`)
    expect(code).toMatchSnapshot()
  })

  /**
   * Child 提供带 msg 参数的 foo 命名插槽和无参数的 bar 插槽；检查两个函数都用 _withCtx 包装，且 foo 保留解构参数。快照验证命名插槽的上下文包装与作用域参数可同时生成。
   */
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

  /**
   * Child 的 foo 插槽带 v-if，另一个插槽在 v-for 中以 i 为动态名；用正则检查动态描述记录里的 name 与 fn，后者仍由 _withCtx 包装。该场景覆盖条件/循环生成动态插槽记录时的上下文保留。
   */
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
