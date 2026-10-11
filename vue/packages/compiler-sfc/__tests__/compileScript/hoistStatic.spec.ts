/**
 * script setup 静态提升场景：仅提升不依赖实例的字面量/纯表达式，结合绑定类型决定模板访问
 * 是否需要 unref，并确保对象、await、宏参数和引用局部状态的声明不会被错误移出 setup。
 */
import { BindingTypes } from '@vue/compiler-core'
import type { SFCScriptCompileOptions } from '../../src'
import { assertCode, compileSFCScript } from '../utils'

describe('sfc hoist static', () => {
  /** 开启 inlineTemplate 与 hoistStatic 编译 script setup。 */
  function compile(src: string, options?: Partial<SFCScriptCompileOptions>) {
    return compileSFCScript(src, {
      inlineTemplate: true,
      hoistStatic: true,
      ...options,
    })
  }

  // 编译字符串、数字、布尔、null、BigInt 与无插值模板字面量；均移到输出首部并登记 LITERAL_CONST，避免每实例重复初始化。
  test('should hoist literal value', () => {
    const code = `
    const string = 'default value'
    const number = 123
    const boolean = false
    const nil = null
    const bigint = 100n
    const template = \`str\`
    `.trim()
    const { content, bindings } = compile(`
    <script setup>
    ${code}
    </script>
    `)

    // 静态声明应提升到 setup 生成代码的首行，确保后续选项可以引用。
    expect(content.startsWith(code)).toBe(true)
    expect(bindings).toStrictEqual({
      string: BindingTypes.LITERAL_CONST,
      number: BindingTypes.LITERAL_CONST,
      boolean: BindingTypes.LITERAL_CONST,
      nil: BindingTypes.LITERAL_CONST,
      bigint: BindingTypes.LITERAL_CONST,
      template: BindingTypes.LITERAL_CONST,
    })
    assertCode(content)
  })

  // 常量初始化为纯一元、二元、条件和序列表达式；递归静态检查通过后整体提升，绑定保持 LITERAL_CONST。
  test('should hoist expressions', () => {
    const code = `
    const unary = !false
    const binary = 1 + 2
    const conditional = 1 ? 2 : 3
    const sequence = (1, true, 'foo', 1)
    `.trim()
    const { content, bindings } = compile(`
    <script setup>
    ${code}
    </script>
    `)
    // 静态声明应提升到 setup 生成代码的首行，确保后续选项可以引用。
    expect(content.startsWith(code)).toBe(true)
    expect(bindings).toStrictEqual({
      binary: BindingTypes.LITERAL_CONST,
      conditional: BindingTypes.LITERAL_CONST,
      unary: BindingTypes.LITERAL_CONST,
      sequence: BindingTypes.LITERAL_CONST,
    })
    assertCode(content)
  })

  // defineProps 默认值引用 setup 字符串常量；先提升该常量使模块选项可读取，默认值引用不触发作用域错误。
  test('should hoist w/ defineProps/Emits', () => {
    const hoistCode = `const defaultValue = 'default value'`
    const { content, bindings } = compile(`
    <script setup>
    ${hoistCode}
    defineProps({
      foo: {
        default: defaultValue
      }
    })
    </script>
    `)

    // 静态声明应提升到 setup 生成代码的首行，确保后续选项可以引用。
    expect(content.startsWith(hoistCode)).toBe(true)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      defaultValue: BindingTypes.LITERAL_CONST,
    })
    assertCode(content)
  })

  // 输入 let/var、正则及 undefined 引用；可变量、对象实例和标识符不满足字面量提升条件，声明留在 setup 且分类分别核对。
  test('should not hoist a variable', () => {
    const code = `
    let KEY1 = 'default value'
    var KEY2 = 123
    const regex = /.*/g
    const undef = undefined
    `.trim()
    const { content, bindings } = compile(`
    <script setup>
    ${code}
    </script>
    `)
    expect(bindings).toStrictEqual({
      KEY1: BindingTypes.SETUP_LET,
      KEY2: BindingTypes.SETUP_LET,
      regex: BindingTypes.SETUP_CONST,
      undef: BindingTypes.SETUP_MAYBE_REF,
    })
    expect(content).toMatch(`setup(__props) {\n\n    ${code}`)
    assertCode(content)
  })

  // 常量引用构造器、数组、调用、副作用序列、动态 enum 和插值模板；逐项保留在 setup，避免提升实例依赖或副作用。
  test('should not hoist a constant initialized to a reference value', () => {
    const code = `
    const KEY1 = Boolean
    const KEY2 = [Boolean]
    const KEY3 = [getCurrentInstance()]
    let i = 0;
    const KEY4 = (i++, 'foo')
    enum KEY5 {
      FOO = 1,
      BAR = getCurrentInstance(),
    }
    const KEY6 = \`template\${i}\`
    `.trim()
    const { content, bindings } = compile(`
    <script setup lang="ts">
    ${code}
    </script>
    `)
    expect(bindings).toStrictEqual({
      KEY1: BindingTypes.SETUP_MAYBE_REF,
      KEY2: BindingTypes.SETUP_CONST,
      KEY3: BindingTypes.SETUP_CONST,
      KEY4: BindingTypes.SETUP_CONST,
      KEY5: BindingTypes.SETUP_CONST,
      KEY6: BindingTypes.SETUP_CONST,
      i: BindingTypes.SETUP_LET,
    })
    expect(content).toMatch(`setup(__props) {\n\n    ${code}`)
    assertCode(content)
  })

  // 常量对象和数组即便元素都是字面量；两者会创建实例对象，因此保持 SETUP_CONST 且不提升。
  test('should not hoist a object or array', () => {
    const code = `
    const obj = { foo: 'bar' }
    const arr = [1, 2, 3]
    `.trim()
    const { content, bindings } = compile(`
    <script setup>
    ${code}
    </script>
    `)
    expect(bindings).toStrictEqual({
      arr: BindingTypes.SETUP_CONST,
      obj: BindingTypes.SETUP_CONST,
    })
    expect(content).toMatch(`setup(__props) {\n\n    ${code}`)
    assertCode(content)
  })

  // 箭头函数、函数声明和类声明；均保持 setup 内的 SETUP_CONST，以保留实例作用域及闭包。
  test('should not hoist a function or class', () => {
    const code = `
    const fn = () => {}
    function fn2() {}
    class Foo {}
    `.trim()
    const { content, bindings } = compile(`
    <script setup>
    ${code}
    </script>
    `)
    expect(bindings).toStrictEqual({
      Foo: BindingTypes.SETUP_CONST,
      fn: BindingTypes.SETUP_CONST,
      fn2: BindingTypes.SETUP_CONST,
    })
    expect(content).toMatch(`setup(__props) {\n\n    ${code}`)
    assertCode(content)
  })

  // 同时存在普通 script 与 setup 的同名字面量；自动静态提升仅适用于单 setup 场景，该组合中的 setup foo 不升为 LITERAL_CONST。
  test('should enable when only script setup', () => {
    const { content, bindings } = compile(`
    <script>
    const foo = 'bar'
    </script>
    <script setup>
    const foo = 'bar'
    </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_CONST,
    })
    assertCode(content)
  })

  // 显式 hoistStatic:false 编译字符串常量；关闭优化后仍登记 SETUP_CONST，输出通过语法与快照检查。
  test('should not hoist when disabled', () => {
    const { content, bindings } = compile(
      `
    <script setup>
    const foo = 'bar'
    </script>
    `,
      { hoistStatic: false },
    )
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_CONST,
    })
    assertCode(content)
  })

  // 内联模板读取已提升 foo；模板直接引用 foo，无需 unref 或上下文查找。
  test('template binding access in inline mode', () => {
    const { content } = compile(
      `
    <script setup>
    const foo = 'bar'
    </script>
    <template>{{ foo }}</template>
    `,
    )
    expect(content).toMatch('_toDisplayString(foo)')
  })
})
