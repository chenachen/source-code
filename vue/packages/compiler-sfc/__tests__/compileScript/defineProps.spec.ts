/**
 * `defineProps` 宏场景：覆盖运行时与类型式声明、运行时类型推导、默认值合并、泛型/导入类型、
 * bindingMetadata 和生产优化，并验证重复调用及不允许的类型/运行时混用。
 */
import { BindingTypes } from '@vue/compiler-core'
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineProps', () => {
  // 对象声明 foo:String，并接收 props、定义字面量 bar；宏删除、变量改为 __props，生成组件 props，同时区分 PROPS/响应式常量/字面量常量绑定。
  test('basic usage', () => {
    const { content, bindings } = compile(`
<script setup>
const props = defineProps({
  foo: String
})
const bar = 1
</script>
  `)
    // 生成模块须通过 Babel 语法解析，并符合输出快照。
    assertCode(content)
    // props 中的每个键都应记录为 PROPS 绑定，供模板表达式改写使用。
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.LITERAL_CONST,
      props: BindingTypes.SETUP_REACTIVE_CONST,
    })

    // defineProps 是编译期宏：导入和原始调用都应从输出中移除。
    expect(content).not.toMatch('defineProps')
    // setup 签名应接收编译器生成的 props 参数。
    expect(content).toMatch(`setup(__props, { expose: __expose }) {`)
    // 用户声明的变量应绑定到生成的 props 参数。
    expect(content).toMatch(`const props = __props`)
    // 运行时 props 参数应原样进入组件的 props 选项。
    expect(content).toMatch(`export default {
  props: {
  foo: String
},`)
  })

  // 导入 propsModel 作为运行时参数；组件 props 直接引用该模块绑定，宏不尝试把外部对象内联。
  test('w/ external definition', () => {
    const { content } = compile(`
    <script setup>
    import { propsModel } from './props'
    const props = defineProps(propsModel)
    </script>
      `)
    assertCode(content)
    expect(content).toMatch(`export default {
  props: propsModel,`)
  })

  // #12254：首个交叉成员被 @vue-ignore 忽略后，仍保留后续 Bar 的 props。
  // 交叉类型首项 Foo 标 @vue-ignore，后项 Bar 含 boolean；跳过 Foo 后继续展开 Bar，只登记 bar。
  test('w/ leading intersection type ignore', () => {
    const { content, bindings } = compile(`<script setup lang="ts">
type Foo = { foo: number }
type Bar = { bar: boolean }
defineProps</* @vue-ignore */ Foo & Bar>()
</script>`)

    expect(content).not.toMatch(`foo: { type`)
    expect(content).toMatch(`bar: { type: Boolean, required: true }`)
    expect(bindings).toStrictEqual({
      bar: BindingTypes.PROPS,
    })
  })

  // #4764：defineProps 前存在任意顶层代码时，宏定位和生成插入点仍应正确。
  // 宏前已有紧邻 script 起点的 import；移动 import 时不能带走 props 初始化，输出模块仍可解析。
  test('w/ leading code', () => {
    const { content } = compile(`
    <script setup>import { x } from './x'
    const props = defineProps({})
    </script>
    `)
    // props 声明依赖 setup 作用域，不能在提升 import 时被一起移到模块顶层。
    expect(content).not.toMatch(`const props = __props\nimport`)
    assertCode(content)
  })

  // TS setup 使用对象运行时声明；以 defineComponent 包装并原样生成 props 和 __props 参数。
  test('defineProps w/ runtime options', () => {
    const { content } = compile(`
<script setup lang="ts">
const props = defineProps({ foo: String })
</script>
    `)
    assertCode(content)
    expect(content).toMatch(`export default /*@__PURE__*/_defineComponent({
  props: { foo: String },
  setup(__props, { expose: __expose }) {`)
  })

  // 一个类型式宏包含关键字、容器、字面量、方法、工具类型、联合/交叉及未知引用；逐项核对构造器、required 和 skipCheck，所有字段登记 PROPS。
  test('w/ type', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    interface Test {}

    type Alias = number[]

    defineProps<{
      string: string
      number: number
      boolean: boolean
      object: object
      objectLiteral: { a: number }
      fn: (n: number) => void
      functionRef: Function
      objectRef: Object
      dateTime: Date
      array: string[]
      arrayRef: Array<any>
      tuple: [number, number]
      set: Set<string>
      literal: 'foo'
      optional?: any
      recordRef: Record<string, null>
      interface: Test
      alias: Alias
      method(): void
      symbol: symbol
      error: Error
      extract: Extract<1 | 2 | boolean, 2>
      exclude: Exclude<1 | 2 | boolean, 2>
      uppercase: Uppercase<'foo'>
      params: Parameters<(foo: any) => void>
      nonNull: NonNullable<string | null>
      objectOrFn: {
        (): void
        foo: string
      }

      union: string | number
      literalUnion: 'foo' | 'bar'
      literalUnionNumber: 1 | 2 | 3 | 4 | 5
      literalUnionMixed: 'foo' | 1 | boolean
      intersection: Test & {}
      intersection2: 'foo' & ('foo' | 'bar')
      foo: ((item: any) => boolean) | null

      unknown: UnknownType
      unknownUnion: UnknownType | string
      unknownIntersection: UnknownType & Object
      unknownUnionWithBoolean: UnknownType | boolean
      unknownUnionWithFunction: UnknownType | (() => any)
    }>()
    </script>`)
    assertCode(content)
    expect(content).toMatch(`string: { type: String, required: true }`)
    expect(content).toMatch(`number: { type: Number, required: true }`)
    expect(content).toMatch(`boolean: { type: Boolean, required: true }`)
    expect(content).toMatch(`object: { type: Object, required: true }`)
    expect(content).toMatch(`objectLiteral: { type: Object, required: true }`)
    expect(content).toMatch(`fn: { type: Function, required: true }`)
    expect(content).toMatch(`functionRef: { type: Function, required: true }`)
    expect(content).toMatch(`objectRef: { type: Object, required: true }`)
    expect(content).toMatch(`dateTime: { type: Date, required: true }`)
    expect(content).toMatch(`array: { type: Array, required: true }`)
    expect(content).toMatch(`arrayRef: { type: Array, required: true }`)
    expect(content).toMatch(`tuple: { type: Array, required: true }`)
    expect(content).toMatch(`set: { type: Set, required: true }`)
    expect(content).toMatch(`literal: { type: String, required: true }`)
    expect(content).toMatch(`optional: { type: null, required: false }`)
    expect(content).toMatch(`recordRef: { type: Object, required: true }`)
    expect(content).toMatch(`interface: { type: Object, required: true }`)
    expect(content).toMatch(`alias: { type: Array, required: true }`)
    expect(content).toMatch(`method: { type: Function, required: true }`)
    expect(content).toMatch(`symbol: { type: Symbol, required: true }`)
    expect(content).toMatch(`error: { type: Error, required: true }`)
    expect(content).toMatch(
      `objectOrFn: { type: [Function, Object], required: true },`,
    )
    expect(content).toMatch(`extract: { type: Number, required: true }`)
    expect(content).toMatch(
      `exclude: { type: [Number, Boolean], required: true }`,
    )
    expect(content).toMatch(`uppercase: { type: String, required: true }`)
    expect(content).toMatch(`params: { type: Array, required: true }`)
    expect(content).toMatch(`nonNull: { type: String, required: true }`)
    expect(content).toMatch(`union: { type: [String, Number], required: true }`)
    expect(content).toMatch(`literalUnion: { type: String, required: true }`)
    expect(content).toMatch(
      `literalUnionNumber: { type: Number, required: true }`,
    )
    expect(content).toMatch(
      `literalUnionMixed: { type: [String, Number, Boolean], required: true }`,
    )
    expect(content).toMatch(`intersection: { type: Object, required: true }`)
    expect(content).toMatch(`intersection2: { type: String, required: true }`)
    expect(content).toMatch(`foo: { type: [Function, null], required: true }`)
    expect(content).toMatch(`unknown: { type: null, required: true }`)
    // 联合类型含未知分支时无法可靠收窄，因此跳过运行时类型校验。
    expect(content).toMatch(`unknownUnion: { type: null, required: true }`)
    // 交叉类型即使含未知分支，已知分支仍可用于收窄运行时类型。
    expect(content).toMatch(
      `unknownIntersection: { type: Object, required: true },`,
    )
    expect(content).toMatch(
      `unknownUnionWithBoolean: { type: Boolean, required: true, skipCheck: true },`,
    )
    expect(content).toMatch(
      `unknownUnionWithFunction: { type: Function, required: true, skipCheck: true }`,
    )
    expect(bindings).toStrictEqual({
      string: BindingTypes.PROPS,
      number: BindingTypes.PROPS,
      boolean: BindingTypes.PROPS,
      object: BindingTypes.PROPS,
      objectLiteral: BindingTypes.PROPS,
      fn: BindingTypes.PROPS,
      functionRef: BindingTypes.PROPS,
      objectRef: BindingTypes.PROPS,
      dateTime: BindingTypes.PROPS,
      array: BindingTypes.PROPS,
      arrayRef: BindingTypes.PROPS,
      tuple: BindingTypes.PROPS,
      set: BindingTypes.PROPS,
      literal: BindingTypes.PROPS,
      optional: BindingTypes.PROPS,
      recordRef: BindingTypes.PROPS,
      interface: BindingTypes.PROPS,
      alias: BindingTypes.PROPS,
      method: BindingTypes.PROPS,
      symbol: BindingTypes.PROPS,
      error: BindingTypes.PROPS,
      objectOrFn: BindingTypes.PROPS,
      extract: BindingTypes.PROPS,
      exclude: BindingTypes.PROPS,
      union: BindingTypes.PROPS,
      literalUnion: BindingTypes.PROPS,
      literalUnionNumber: BindingTypes.PROPS,
      literalUnionMixed: BindingTypes.PROPS,
      intersection: BindingTypes.PROPS,
      intersection2: BindingTypes.PROPS,
      foo: BindingTypes.PROPS,
      uppercase: BindingTypes.PROPS,
      params: BindingTypes.PROPS,
      nonNull: BindingTypes.PROPS,
      unknown: BindingTypes.PROPS,
      unknownUnion: BindingTypes.PROPS,
      unknownIntersection: BindingTypes.PROPS,
      unknownUnionWithBoolean: BindingTypes.PROPS,
      unknownUnionWithFunction: BindingTypes.PROPS,
    })
  })

  // interface 的 x 是可选 number；引用展开后生成 Number 与 required:false，x 登记 PROPS。
  test('w/ interface', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    interface Props { x?: number }
    defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
    })
  })

  // Props 经 Bar 继承普通 script 的 Foo，并覆盖 y；本地必填 string 覆盖父级可选 number，x 仍来自父级。
  test('w/ extends interface', () => {
    const { content, bindings } = compile(`
    <script lang="ts">
      interface Foo { x?: number }
    </script>
    <script setup lang="ts">
      interface Bar extends Foo { y?: number }
      interface Props extends Bar {
        z: number
        y: string
      }
      defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`z: { type: Number, required: true }`)
    expect(content).toMatch(`y: { type: String, required: true }`)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
      y: BindingTypes.PROPS,
      z: BindingTypes.PROPS,
    })
  })

  // interface 继承对象别名 Foo；保留父级可选 x 和自身必填 y/z，说明 extends 可解析到别名对象。
  test('w/ extends intersection type', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
      type Foo = {
        x?: number;
      };
      interface Props extends Foo {
        z: number
        y: string
      }
      defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`z: { type: Number, required: true }`)
    expect(content).toMatch(`y: { type: String, required: true }`)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
      y: BindingTypes.PROPS,
      z: BindingTypes.PROPS,
    })
  })

  // Foo & Bar 合并可选 number 与必填 string；交叉展开把两边字段一起交给运行时 props 生成。
  test('w/ intersection type', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
      type Foo = {
        x?: number;
      };
      type Bar = {
        y: string;
      };
      defineProps<Foo & Bar>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`y: { type: String, required: true }`)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
      y: BindingTypes.PROPS,
    })
  })

  // setup 导出 Props interface 后引用；导出声明仍可从类型表展开为可选 Number。
  test('w/ exported interface', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    export interface Props { x?: number }
    defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
    })
  })

  // 普通 script 导出 Props interface，setup 消费；两个脚本共用类型作用域，生成可选 x。
  test('w/ exported interface in normal script', () => {
    const { content, bindings } = compile(`
    <script lang="ts">
      export interface Props { x?: number }
    </script>
    <script setup lang="ts">
      defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
    })
  })

  // 本地 Props 别名指向可选 number 字段；沿别名展开并生成 x 的运行时校验。
  test('w/ type alias', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    type Props = { x?: number }
    defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
    })
  })

  // Props 类型别名同时导出；类型导出包装不影响 x 的展开与绑定分类。
  test('w/ exported type alias', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    export type Props = { x?: number }
    defineProps<Props>()
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`x: { type: Number, required: false }`)
    expect(bindings).toStrictEqual({
      x: BindingTypes.PROPS,
    })
  })

  // 运行时数组宏被非空断言/as any 包装；解包 TS 节点后仍识别宏并登记 foo 为 PROPS。
  test('w/ TS assertion', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
      defineProps(['foo'])! as any
    </script>
  `)
    expect(content).toMatch(`props: ['foo']`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
    })
  })

  // 静态 withDefaults 含字面量、普通/计算静态方法、async、解构参数及 getter；默认值直接并入各 prop，方法参数和修饰符保留。
  test('withDefaults (static)', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    const props = withDefaults(defineProps<{
      foo?: string
      bar?: number;
      baz: boolean;
      qux?(): number;
      quux?(): void
      quuxx?: Promise<string>;
      quuux?: number;
      fred?: string
    }>(), {
      foo: 'hi',
      qux() { return 1 },
      ['quux']() { },
      async quuxx() { return await Promise.resolve('hi') },
      quuux(a, [b, ...c], {d, ...e}, ...f) { return 1 },
      get fred() { return 'fred' }
    })
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(
      `foo: { type: String, required: false, default: 'hi' }`,
    )
    expect(content).toMatch(`bar: { type: Number, required: false }`)
    expect(content).toMatch(`baz: { type: Boolean, required: true }`)
    expect(content).toMatch(
      `qux: { type: Function, required: false, default() { return 1 } }`,
    )
    expect(content).toMatch(
      `quux: { type: Function, required: false, default() { } }`,
    )
    expect(content).toMatch(
      `quuxx: { type: Promise, required: false, async default() { return await Promise.resolve('hi') } }`,
    )
    expect(content).toMatch(
      `quuux: { type: Number, required: false, default(a, [b, ...c], {d, ...e}, ...f) { return 1 } }`,
    )
    expect(content).toMatch(
      `fred: { type: String, required: false, get default() { return 'fred' } }`,
    )
    expect(content).toMatch(`const props = __props`)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      baz: BindingTypes.PROPS,
      qux: BindingTypes.PROPS,
      quux: BindingTypes.PROPS,
      quuxx: BindingTypes.PROPS,
      quuux: BindingTypes.PROPS,
      fred: BindingTypes.PROPS,
      props: BindingTypes.SETUP_CONST,
    })
  })

  // Props interface 位于普通 script，静态 defaults 位于 setup；类型跨块解析与默认值生成后仍通过语法及快照检查。
  test('withDefaults (static) + normal script', () => {
    const { content } = compile(`
    <script lang="ts">
      interface Props {
        a?: string;
      }
    </script>
    <script setup lang="ts">
      const props = withDefaults(defineProps<Props>(), {
        a: "a",
      });
    </script>
    `)
    assertCode(content)
  })

  // #7111：生产模式静态 defaults 仍要保留必要默认值，同时裁剪开发期类型校验信息。
  // 生产模式静态 defaults 覆盖 Function、Boolean、联合与普通字段；裁剪无默认 Function 校验，保留 Boolean 转换、联合函数解释和默认值。
  test('withDefaults (static) w/ production mode', () => {
    const { content } = compile(
      `
    <script setup lang="ts">
    const props = withDefaults(defineProps<{
      foo: () => void
      bar: boolean
      baz: boolean | (() => void)
      qux: string | number
    }>(), {
      baz: true,
      qux: 'hi'
    })
    </script>
    `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch(`const props = __props`)

    // foo 没有默认值，不会把函数误当作工厂执行，因此可删除 Function 运行时类型。
    expect(content).toMatch(`foo: {}`)
    expect(content).toMatch(`bar: { type: Boolean }`)
    expect(content).toMatch(`baz: { type: [Boolean, Function], default: true }`)
    expect(content).toMatch(`qux: { default: 'hi' }`)
  })

  // withDefaults 对象含 ...defaults；无法逐字段静态内联，生成 mergeDefaults 合并完整运行时 prop 表。
  test('withDefaults (dynamic)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    import { defaults } from './foo'
    const props = withDefaults(defineProps<{
      foo?: string
      bar?: number
      baz: boolean
    }>(), { ...defaults })
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`import { mergeDefaults as _mergeDefaults`)
    expect(content).toMatch(
      `
  _mergeDefaults({
    foo: { type: String, required: false },
    bar: { type: Number, required: false },
    baz: { type: Boolean, required: true }
  }, { ...defaults })`.trim(),
    )
  })

  // defaults 直接引用导入对象；同样走 mergeDefaults，而不把引用误当静态字面量。
  test('withDefaults (reference)', () => {
    const { content } = compile(`
    <script setup lang="ts">
    import { defaults } from './foo'
    const props = withDefaults(defineProps<{
      foo?: string
      bar?: number
      baz: boolean
    }>(), defaults)
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`import { mergeDefaults as _mergeDefaults`)
    expect(content).toMatch(
      `
  _mergeDefaults({
    foo: { type: String, required: false },
    bar: { type: Number, required: false },
    baz: { type: Boolean, required: true }
  }, defaults)`.trim(),
    )
  })

  // #7111：动态 defaults 必须通过 mergeDefaults 保留，不能被生产优化误当成可内联静态对象。
  // 生产模式 defaults 含 spread；保留可能影响默认值解释的 Function/Boolean 类型，并通过 mergeDefaults 在运行时合并。
  test('withDefaults (dynamic) w/ production mode', () => {
    const { content } = compile(
      `
    <script setup lang="ts">
    import { defaults } from './foo'
    const props = withDefaults(defineProps<{
      foo: () => void
      bar: boolean
      baz: boolean | (() => void)
      qux: string | number
    }>(), { ...defaults })
    </script>
    `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch(`import { mergeDefaults as _mergeDefaults`)
    expect(content).toMatch(
      `
  _mergeDefaults({
    foo: { type: Function },
    bar: { type: Boolean },
    baz: { type: [Boolean, Function] },
    qux: {}
  }, { ...defaults })`.trim(),
    )
  })

  // 默认值方法键由字符串拼接计算；动态键使整组 defaults 走 mergeDefaults，原方法源码保留。
  test('withDefaults w/ dynamic object method', () => {
    const { content } = compile(`
    <script setup lang="ts">
    const props = withDefaults(defineProps<{
      foo?: () => 'string'
    }>(), {
      ['fo' + 'o']() { return 'foo' }
    })
    </script>
    `)
    assertCode(content)
    expect(content).toMatch(`import { mergeDefaults as _mergeDefaults`)
    expect(content).toMatch(
      `
  _mergeDefaults({
    foo: { type: Function, required: false }
  }, {
      ['fo' + 'o']() { return 'foo' }
    })`.trim(),
    )
  })

  // 分别声明数字、字符串、混合与无初始化 enum；运行时 prop 类型依次为 Number、String、两者联合和 Number。
  test('runtime inference for Enum', () => {
    expect(
      compile(
        `<script setup lang="ts">
      const enum Foo { A = 123 }
      defineProps<{
        foo: Foo
      }>()
      </script>`,
        { hoistStatic: true },
      ).content,
    ).toMatch(`foo: { type: Number`)

    expect(
      compile(
        `<script setup lang="ts">
      const enum Foo { A = '123' }
      defineProps<{
        foo: Foo
      }>()
      </script>`,
        { hoistStatic: true },
      ).content,
    ).toMatch(`foo: { type: String`)

    expect(
      compile(
        `<script setup lang="ts">
      const enum Foo { A = '123', B = 123 }
      defineProps<{
        foo: Foo
      }>()
      </script>`,
        { hoistStatic: true },
      ).content,
    ).toMatch(`foo: { type: [String, Number]`)

    expect(
      compile(
        `<script setup lang="ts">
      const enum Foo { A, B }
      defineProps<{
        foo: Foo
      }>()
      </script>`,
        { hoistStatic: true },
      ).content,
    ).toMatch(`foo: { type: Number`)
  })

  // #8148：props 名与已有 setup 局部绑定重名时，不能覆盖更精确的本地 bindingMetadata。
  // prop bar 与 computed 局部 bar 同名；局部 SETUP_REF 分类优先，宏字段不得覆盖更精确绑定。
  test('should not override local bindings', () => {
    const { bindings } = compile(`
    <script setup lang="ts">
    import { computed } from 'vue'
    defineProps<{ bar: string }>()
    const bar = computed(() => 1)
    </script>
  `)
    expect(bindings).toStrictEqual({
      bar: BindingTypes.SETUP_REF,
      computed: BindingTypes.SETUP_CONST,
    })
  })

  // #8289：关闭响应式解构时仍允许普通解构，但不生成 `__props` 读取重写。
  // propsDestructure:false 下解构未知类型 foo；保留普通 const 解构与返回值，foo 分类为 SETUP_CONST，不做响应式读取改写。
  test('destructure without enabling reactive destructure', () => {
    const { content, bindings } = compile(
      `<script setup lang="ts">
      const { foo } = defineProps<{
        foo: Foo
      }>()
      </script>`,
      {
        propsDestructure: false,
      },
    )
    expect(content).toMatch(`const { foo } = __props`)
    expect(content).toMatch(`return { foo }`)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_CONST,
    })
    assertCode(content)
  })

  // propsDestructure:'error' 下出现宏解构；编译器直接拒绝该模式，区别于 false 的普通解构路径。
  test('prohibiting reactive destructure', () => {
    expect(() =>
      compile(
        `<script setup lang="ts">
      const { foo } = defineProps<{
        foo: Foo
      }>()
      </script>`,
        {
          propsDestructure: 'error',
        },
      ),
    ).toThrow()
  })

  // 错误分组：重复声明、类型/运行时混用、宏参数捕获 setup 局部量及无法解析类型。
  describe('errors', () => {
    // defineProps 同时带类型与运行时参数；诊断声明来源冲突。
    test('w/ both type and non-type args', () => {
      expect(() => {
        compile(`<script setup lang="ts">
        defineProps<{}>({})
        </script>`)
      }).toThrow(`cannot accept both type and non-type arguments`)
    })
  })

  // 类型字段名包含空格、引号、反斜杠及多种符号；逐项检查生成键转义和原始绑定名，未知类型统一 type:null。
  test('should escape names w/ special symbols', () => {
    const { content, bindings } = compile(`
    <script setup lang="ts">
    defineProps<{
      'spa ce': unknown
      'exclamation!mark': unknown
      'double"quote': unknown
      'hash#tag': unknown
      'dollar$sign': unknown
      'percentage%sign': unknown
      'amper&sand': unknown
      "single'quote": unknown
      'round(brack)ets': unknown
      'aste*risk': unknown
      'pl+us': unknown
      'com,ma': unknown
      'do.t': unknown
      'sla/sh': unknown
      'co:lon': unknown
      'semi;colon': unknown
      'angle<brack>ets': unknown
      'equal=sign': unknown
      'question?mark': unknown
      'at@sign': unknown
      'square[brack]ets': unknown
      'back\\\\slash': unknown
      'ca^ret': unknown
      'back\`tick': unknown
      'curly{bra}ces': unknown
      'pi|pe': unknown
      'til~de': unknown
      'da-sh': unknown
    }>()
    </script>`)
    assertCode(content)
    expect(content).toMatch(`"spa ce": { type: null, required: true }`)
    expect(content).toMatch(
      `"exclamation!mark": { type: null, required: true }`,
    )
    expect(content).toMatch(`"double\\"quote": { type: null, required: true }`)
    expect(content).toMatch(`"hash#tag": { type: null, required: true }`)
    expect(content).toMatch(`"dollar$sign": { type: null, required: true }`)
    expect(content).toMatch(`"percentage%sign": { type: null, required: true }`)
    expect(content).toMatch(`"amper&sand": { type: null, required: true }`)
    expect(content).toMatch(`"single'quote": { type: null, required: true }`)
    expect(content).toMatch(`"round(brack)ets": { type: null, required: true }`)
    expect(content).toMatch(`"aste*risk": { type: null, required: true }`)
    expect(content).toMatch(`"pl+us": { type: null, required: true }`)
    expect(content).toMatch(`"com,ma": { type: null, required: true }`)
    expect(content).toMatch(`"do.t": { type: null, required: true }`)
    expect(content).toMatch(`"sla/sh": { type: null, required: true }`)
    expect(content).toMatch(`"co:lon": { type: null, required: true }`)
    expect(content).toMatch(`"semi;colon": { type: null, required: true }`)
    expect(content).toMatch(`"angle<brack>ets": { type: null, required: true }`)
    expect(content).toMatch(`"equal=sign": { type: null, required: true }`)
    expect(content).toMatch(`"question?mark": { type: null, required: true }`)
    expect(content).toMatch(`"at@sign": { type: null, required: true }`)
    expect(content).toMatch(
      `"square[brack]ets": { type: null, required: true }`,
    )
    expect(content).toMatch(`"back\\\\slash": { type: null, required: true }`)
    expect(content).toMatch(`"ca^ret": { type: null, required: true }`)
    expect(content).toMatch(`"back\`tick": { type: null, required: true }`)
    expect(content).toMatch(`"curly{bra}ces": { type: null, required: true }`)
    expect(content).toMatch(`"pi|pe": { type: null, required: true }`)
    expect(content).toMatch(`"til~de": { type: null, required: true }`)
    expect(content).toMatch(`"da-sh": { type: null, required: true }`)
    expect(bindings).toStrictEqual({
      'spa ce': BindingTypes.PROPS,
      'exclamation!mark': BindingTypes.PROPS,
      'double"quote': BindingTypes.PROPS,
      'hash#tag': BindingTypes.PROPS,
      dollar$sign: BindingTypes.PROPS,
      'percentage%sign': BindingTypes.PROPS,
      'amper&sand': BindingTypes.PROPS,
      "single'quote": BindingTypes.PROPS,
      'round(brack)ets': BindingTypes.PROPS,
      'aste*risk': BindingTypes.PROPS,
      'pl+us': BindingTypes.PROPS,
      'com,ma': BindingTypes.PROPS,
      'do.t': BindingTypes.PROPS,
      'sla/sh': BindingTypes.PROPS,
      'co:lon': BindingTypes.PROPS,
      'semi;colon': BindingTypes.PROPS,
      'angle<brack>ets': BindingTypes.PROPS,
      'equal=sign': BindingTypes.PROPS,
      'question?mark': BindingTypes.PROPS,
      'at@sign': BindingTypes.PROPS,
      'square[brack]ets': BindingTypes.PROPS,
      'back\\slash': BindingTypes.PROPS,
      'ca^ret': BindingTypes.PROPS,
      'back`tick': BindingTypes.PROPS,
      'curly{bra}ces': BindingTypes.PROPS,
      'pi|pe': BindingTypes.PROPS,
      'til~de': BindingTypes.PROPS,
      'da-sh': BindingTypes.PROPS,
    })
  })

  // #8989：Custom Element 的生产构建仍需保留 prop 运行时类型，供属性到属性值的转换使用。
  // 生产模式且文件名命中自定义元素判定；Number 构造器仍保留，以供自定义元素属性值转换。
  test('custom element retains the props type & production mode', () => {
    const { content } = compile(
      `<script setup lang="ts">
      const props = defineProps<{ foo: number}>()
      </script>`,
      { isProd: true, customElement: filename => /\.ce\.vue$/.test(filename) },
      { filename: 'app.ce.vue' },
    )

    expect(content).toMatch(`foo: {type: Number}`)
    assertCode(content)
  })

  // 自定义元素生产模式叠加 withDefaults；同时保留数字默认值和 Number 构造器，默认值优化不能删除属性转换信息。
  test('custom element retains the props type & default value & production mode', () => {
    const { content } = compile(
      `<script setup lang="ts">
      interface Props { 
          foo?: number;
      }
      const props = withDefaults(defineProps<Props>(), {
          foo: 5.5,
      });
      </script>`,
      { isProd: true, customElement: filename => /\.ce\.vue$/.test(filename) },
      { filename: 'app.ce.vue' },
    )
    expect(content).toMatch(`foo: { default: 5.5, type: Number }`)
    assertCode(content)
  })
})
