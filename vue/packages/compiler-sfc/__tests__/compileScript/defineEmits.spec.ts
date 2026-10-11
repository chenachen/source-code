/**
 * `defineEmits` 宏场景：覆盖运行时数组和类型式声明、interface/别名/联合与属性式事件名提取、
 * setup emit 绑定，以及类型/运行时参数和调用签名/属性式语法混用诊断。
 */
import { BindingTypes } from '@vue/compiler-core'
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineEmits', () => {
  // 数组声明 foo/bar 并接收 myEmit；宏调用替换为 __emit、setup 注入 emit、导出生成 emits 数组，myEmit 分类为 SETUP_CONST。
  test('basic usage', () => {
    const { content, bindings } = compile(`
<script setup>
const myEmit = defineEmits(['foo', 'bar'])
</script>
  `)
    assertCode(content)
    expect(bindings).toStrictEqual({
      myEmit: BindingTypes.SETUP_CONST,
    })
    // defineEmits 是编译期宏：导入和原始调用都应从输出中移除。
    expect(content).not.toMatch('defineEmits')
    // setup 签名应注入编译器生成的 emit 上下文参数。
    expect(content).toMatch(
      `setup(__props, { expose: __expose, emit: __emit }) {`,
    )
    expect(content).toMatch('const myEmit = __emit')
    // 从宏声明提取出的 emits 选项应写入默认导出。
    expect(content).toMatch(`export default {
  emits: ['foo', 'bar'],`)
  })

  // 在 TS setup 中数组声明 a/b；生成 defineComponent 包装及 emit 参数，运行时声明不要求泛型。
  test('w/ runtime options', () => {
    const { content } = compile(`
<script setup lang="ts">
const emit = defineEmits(['a', 'b'])
</script>
    `)
    assertCode(content)
    expect(content).toMatch(`export default /*@__PURE__*/_defineComponent({
  emits: ['a', 'b'],
  setup(__props, { expose: __expose, emit: __emit }) {`)
    expect(content).toMatch('const emit = __emit')
  })

  // 函数类型首参数为 foo | bar；从事件字面量联合生成两个运行时 emits 名称。
  test('w/ type', () => {
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<(e: 'foo' | 'bar') => void>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 联合两个函数类型，第二个还带 id 参数；只收集各函数的第一个事件参数，得到 foo/bar/baz。
  test('w/ type (union)', () => {
    const type = `((e: 'foo' | 'bar') => void) | ((e: 'baz', id: number) => void)`
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<${type}>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar", "baz"]`)
  })

  // 对象类型包含两条调用签名；逐签名合并事件名，生成 foo/bar/baz 数组。
  test('w/ type (type literal w/ call signatures)', () => {
    const type = `{(e: 'foo' | 'bar'): void; (e: 'baz', id: number): void;}`
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<${type}>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar", "baz"]`)
  })

  // interface 声明事件调用签名；先解析类型引用，再生成 foo/bar 的 emits。
  test('w/ type (interface)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    interface Emits { (e: 'foo' | 'bar'): void }
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 事件 interface 继承 Base；本地 bar 与父级 foo 一并提取，并保持解析得到的顺序。
  test('w/ type (interface w/ extends)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    interface Base { (e: 'foo'): void }
    interface Emits extends Base { (e: 'bar'): void }
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["bar", "foo"]`)
  })

  // setup 导出的 interface 用作宏泛型；类型声明可保留为模块导出，事件名仍被展开。
  test('w/ type (exported interface)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    export interface Emits { (e: 'foo' | 'bar'): void }
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 普通 script 导出 Emits，setup 引用它；共享类型作用域使 foo/bar 可跨两个脚本块解析。
  test('w/ type from normal script', () => {
    const { content } = compile(`
    <script lang="ts">
      export interface Emits { (e: 'foo' | 'bar'): void }
    </script>
    <script setup lang="ts">
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 别名指向含调用签名的对象类型；解析别名后生成 foo/bar。
  test('w/ type (type alias)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    type Emits = { (e: 'foo' | 'bar'): void }
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 导出的对象类型别名供 defineEmits 引用；导出包装不阻断调用签名提取。
  test('w/ type (exported type alias)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    export type Emits = { (e: 'foo' | 'bar'): void }
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 别名直接指向函数类型；沿引用提取首参数的字面量联合，输出 foo/bar。
  test('w/ type (referenced function type)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    type Emits = (e: 'foo' | 'bar') => void
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // 导出的函数类型别名作为宏参数；与非导出别名相同生成两个事件名。
  test('w/ type (referenced exported function type)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    export type Emits = (e: 'foo' | 'bar') => void
    const emit = defineEmits<Emits>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

  // #5393：给 emit 变量标注 interface 不影响运行时 emits 数组的生成。
  // 为 emit 变量额外标 interface，但宏使用运行时 foo 数组；emits 取宏参数，变量注解不覆盖运行时声明。
  test('w/ type (interface ts type)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    interface Emits { (e: 'foo'): void }
    const emit: Emits = defineEmits(['foo'])
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ['foo']`)
  })

  // 属性式事件类型声明 foo/bar 空元组；属性键直接成为 emits 名称，不依赖调用签名。
  test('w/ type (property syntax)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<{ foo: [], bar: [] }>()
    </script>
    `)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
    assertCode(content)
  })

  // #8040：属性式 emits 的字符串字面量 key 应作为事件名保留，而非要求 Identifier。
  // 属性式事件键采用字符串 foo:bar；保留带冒号的完整事件名，不能按标识符切分。
  test('w/ type (property syntax string literal)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<{ 'foo:bar': [] }>()
    </script>
    `)
    expect(content).toMatch(`emits: ["foo:bar"]`)
    assertCode(content)
  })

  // #7943：联合类型中的引用事件名需要递归解析并去重，不能把引用节点当未知类型丢弃。
  // 事件首参数联合包含别名 BaseEmit，另有 another 签名；递归展开引用并合并为四个事件名称。
  test('w/ type (type references in union)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    type BaseEmit = "change"
    type Emit = "some" | "emit" | BaseEmit
    const emit = defineEmits<{
      (e: Emit): void;
      (e: "another", val: string): void;
    }>();
    </script>
    `)

    expect(content).toMatch(`emits: ["some", "emit", "change", "another"]`)
    assertCode(content)
  })

  // 错误分组：类型与运行时参数混用，以及调用签名与属性式语法混用。
  describe('errors', () => {
    // 同一 defineEmits 同时传泛型与运行时对象；编译器拒绝双重声明来源。
    test('w/ both type and non-type args', () => {
      expect(() => {
        compile(`<script setup lang="ts">
        defineEmits<{}>({})
        </script>`)
      }).toThrow(`cannot accept both type and non-type arguments`)
    })

    // 同一类型同时含 foo 属性与 hi 调用签名；两套事件语法不能混用，编译器给出明确诊断。
    test('mixed usage of property / call signature', () => {
      expect(() =>
        compile(`<script setup lang="ts">
        defineEmits<{
          foo: []
          (e: 'hi'): void
        }>()
        </script>`),
      ).toThrow(
        `defineEmits() type cannot mixed call signature and property syntax.`,
      )
    })
  })
})
