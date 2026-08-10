/**
 * `defineEmits` 宏场景：覆盖运行时数组/对象和类型声明两种输入、事件名提取、类型签名合并、
 * setup 返回绑定及重复/混用声明诊断。
 */
import { BindingTypes } from '@vue/compiler-core'
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineEmits', () => {
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

  test('w/ type', () => {
    const { content } = compile(`
    <script setup lang="ts">
    const emit = defineEmits<(e: 'foo' | 'bar') => void>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`emits: ["foo", "bar"]`)
  })

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

  // #5393：interface 调用签名声明的事件也要解析，不能只支持 type literal。
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

  // 错误分组：重复调用、类型与运行时参数混用、引用局部变量等宏提升限制。
  describe('errors', () => {
    test('w/ both type and non-type args', () => {
      expect(() => {
        compile(`<script setup lang="ts">
        defineEmits<{}>({})
        </script>`)
      }).toThrow(`cannot accept both type and non-type arguments`)
    })

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
