/**
 * 响应式 props 解构场景：把读取改写为 `__props`、保留别名/默认值/剩余属性，准确维护函数与
 * catch/循环作用域，并诊断对解构 prop 的赋值、传递给 ref 宏和不支持的嵌套模式。
 */
import { BindingTypes } from '@vue/compiler-core'
import type { SFCScriptCompileOptions } from '../../src'
import { assertCode, compileSFCScript } from '../utils'

describe('sfc reactive props destructure', () => {
  /** 用 inlineTemplate 编译响应式解构，使生成 render 可直接检查 prop 读取改写。 */
  function compile(src: string, options?: Partial<SFCScriptCompileOptions>) {
    return compileSFCScript(src, {
      inlineTemplate: true,
      ...options,
    })
  }

  test('basic usage', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo } = defineProps(['foo'])
      console.log(foo)
      </script>
      <template>{{ foo }}</template>
    `)
    expect(content).not.toMatch(`const { foo } =`)
    expect(content).toMatch(`console.log(__props.foo)`)
    expect(content).toMatch(`_toDisplayString(__props.foo)`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
    })
  })

  test('multiple variable declarations', () => {
    const { content, bindings } = compile(`
      <script setup>
      const bar = 'fish', { foo } = defineProps(['foo']), hello = 'world'
      </script>
      <template><div>{{ foo }} {{ hello }} {{ bar }}</div></template>
    `)
    expect(content).not.toMatch(`const { foo } =`)
    expect(content).toMatch(`const bar = 'fish', hello = 'world'`)
    expect(content).toMatch(`_toDisplayString(hello)`)
    expect(content).toMatch(`_toDisplayString(bar)`)
    expect(content).toMatch(`_toDisplayString(__props.foo)`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.LITERAL_CONST,
      hello: BindingTypes.LITERAL_CONST,
    })
  })

  test('nested scope', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo, bar } = defineProps(['foo', 'bar'])
      function test(foo) {
        console.log(foo)
        console.log(bar)
      }
      </script>
    `)
    expect(content).not.toMatch(`const { foo, bar } =`)
    expect(content).toMatch(`console.log(foo)`)
    expect(content).toMatch(`console.log(__props.bar)`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      test: BindingTypes.SETUP_CONST,
    })
  })

  test('for-of loop variable shadowing', () => {
    const { content } = compile(`
      <script setup lang="ts">
      interface Props {
        msg: string;
        input: string[];
      }
      const { msg, input } = defineProps<Props>();
      for (const msg of input) {
        console.log('MESSAGE', msg);
      }
      console.log('NOT FAIL', { msg });
      </script>
    `)
    // 循环作用域内同名变量已遮蔽 prop，应使用局部变量。
    expect(content).toMatch(`for (const msg of __props.input)`)
    expect(content).toMatch(`console.log('MESSAGE', msg)`)
    // 离开循环作用域后，应恢复为对 prop 的引用。
    expect(content).toMatch(`console.log('NOT FAIL', { msg: __props.msg })`)
    assertCode(content)
  })

  test('regular for loop variable shadowing', () => {
    const { content } = compile(`
      <script setup lang="ts">
      const { i, len } = defineProps<{ i: number; len: number }>();
      for (let i = 0; i < len; i++) {
        console.log('INDEX', i);
      }
      console.log('AFTER', { i });
      </script>
    `)
    // 循环作用域内同名变量已遮蔽 prop，应使用局部变量。
    expect(content).toMatch(`for (let i = 0; i < __props.len; i++)`)
    expect(content).toMatch(`console.log('INDEX', i)`)
    // 离开循环作用域后，应恢复为对 prop 的引用。
    expect(content).toMatch(`console.log('AFTER', { i: __props.i })`)
    assertCode(content)
  })

  test('var declaration shadowing in nested block', () => {
    const { content } = compile(`<script setup lang="ts">
const { foo = "a" } = defineProps<{ foo?: string }>();
let bar: string | undefined;
function init() {
  {
    var foo = "b";
  }
  bar = foo;
}
init();
</script>`)
    expect(content).toMatch(`var foo = "b"`)
    expect(content).toMatch(`bar = foo`)
    expect(content).not.toMatch(`bar = __props.foo`)
    assertCode(content)
  })

  test('var declaration shadowing before declaration in nested block', () => {
    const { content } = compile(`<script setup lang="ts">
const { foo = "a" } = defineProps<{ foo?: string }>();
let bar: string | undefined;
function init() {
  bar = foo;
  {
    var foo = "b";
  }
}
init();
</script>`)
    expect(content).toMatch(`bar = foo`)
    expect(content).toMatch(`var foo = "b"`)
    expect(content).not.toMatch(`bar = __props.foo`)
    assertCode(content)
  })

  test('var declaration shadowing before declaration in for loop', () => {
    const { content } = compile(`<script setup lang="ts">
const { foo = "a" } = defineProps<{ foo?: string }>();
let bar: string | undefined;
function init() {
  bar = foo;
  for (var foo = "b"; false;) {}
}
init();
</script>`)
    expect(content).toMatch(`bar = foo`)
    expect(content).toMatch(`for (var foo = "b"; false;)`)
    expect(content).not.toMatch(`bar = __props.foo`)
    assertCode(content)
  })

  test('var declaration shadowing does not cross function scope', () => {
    const { content } = compile(`<script setup lang="ts">
const { foo = "a" } = defineProps<{ foo?: string }>();
let bar: string | undefined;
function init() {
  function nested() {
    {
      var foo = "b";
    }
    return foo;
  }
  bar = foo;
  nested();
}
init();
</script>`)
    expect(content).toMatch(`return foo`)
    expect(content).toMatch(`bar = __props.foo`)
    assertCode(content)
  })

  test('default values w/ array runtime declaration', () => {
    const { content } = compile(`
      <script setup>
      const { foo = 1, bar = {}, func = () => {} } = defineProps(['foo', 'bar', 'baz'])
      </script>
    `)
    // 字面量默认值可直接内联；非字面量必须包装为工厂函数。
    // 函数值还要带跳过工厂调用的标记，避免把函数类型 prop 的默认值执行掉。
    expect(content)
      .toMatch(`props: /*@__PURE__*/_mergeDefaults(['foo', 'bar', 'baz'], {
  foo: 1,
  bar: () => ({}),
  func: () => {}, __skip_func: true
})`)
    assertCode(content)
  })

  test('default values w/ object runtime declaration', () => {
    const { content } = compile(`
      <script setup>
      const { foo = 1, bar = {}, func = () => {}, ext = x } = defineProps({ foo: Number, bar: Object, func: Function, ext: null })
      </script>
    `)
    // 字面量默认值可直接内联；非字面量必须包装为工厂函数。
    // 函数值必须带跳过标记，因为运行时类型未必能可靠推断为 Function；例如类型
    // 来自导入，或运行时声明展开了另一个对象时，都无法安全判断。
    expect(content)
      .toMatch(`props: /*@__PURE__*/_mergeDefaults({ foo: Number, bar: Object, func: Function, ext: null }, {
  foo: 1,
  bar: () => ({}),
  func: () => {}, __skip_func: true,
  ext: x, __skip_ext: true
})`)
    assertCode(content)
  })
  test('default values w/ runtime declaration & key is string', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo = 1, 'foo:bar': fooBar = 'foo-bar' } = defineProps(['foo', 'foo:bar'])
      </script>
    `)
    expect(bindings).toStrictEqual({
      __propsAliases: {
        fooBar: 'foo:bar',
      },
      foo: BindingTypes.PROPS,
      'foo:bar': BindingTypes.PROPS,
      fooBar: BindingTypes.PROPS_ALIASED,
    })

    expect(content).toMatch(`
  props: /*@__PURE__*/_mergeDefaults(['foo', 'foo:bar'], {
  foo: 1,
  "foo:bar": 'foo-bar'
}),`)
    assertCode(content)
  })

  test('default values w/ type declaration', () => {
    const { content } = compile(`
      <script setup lang="ts">
      const { foo = 1, bar = {}, func = () => {} } = defineProps<{ foo?: number, bar?: object, func?: () => any }>()
      </script>
    `)
    // 字面量默认值可直接内联，非字面量默认值则始终由工厂函数返回。
    expect(content).toMatch(`props: {
    foo: { type: Number, required: false, default: 1 },
    bar: { type: Object, required: false, default: () => ({}) },
    func: { type: Function, required: false, default: () => {} }
  }`)
    assertCode(content)
  })

  test('default values w/ type declaration & key is string', () => {
    const { content, bindings } = compile(`
      <script setup lang="ts">
      const { foo = 1, bar = 2, 'foo:bar': fooBar = 'foo-bar' } = defineProps<{ 
        "foo": number // double-quoted string
        'bar': number // single-quoted string
        'foo:bar': string // single-quoted string containing symbols
        "onUpdate:modelValue": (val: number) => void  // double-quoted string containing symbols
      }>()
      </script>
    `)
    expect(bindings).toStrictEqual({
      __propsAliases: {
        fooBar: 'foo:bar',
      },
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      'foo:bar': BindingTypes.PROPS,
      fooBar: BindingTypes.PROPS_ALIASED,
      'onUpdate:modelValue': BindingTypes.PROPS,
    })
    expect(content).toMatch(`
  props: {
    foo: { type: Number, required: true, default: 1 },
    bar: { type: Number, required: true, default: 2 },
    "foo:bar": { type: String, required: true, default: 'foo-bar' },
    "onUpdate:modelValue": { type: Function, required: true }
  },`)
    assertCode(content)
  })

  test('default values w/ type declaration, prod mode', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      const { foo = 1, bar = {}, func = () => {} } = defineProps<{ foo?: number, bar?: object, baz?: any, boola?: boolean, boolb?: boolean | number, func?: Function }>()
      </script>
    `,
      { isProd: true },
    )
    assertCode(content)
    // 字面量默认值可直接内联，非字面量默认值则始终由工厂函数返回。
    expect(content).toMatch(`props: {
    foo: { default: 1 },
    bar: { default: () => ({}) },
    baz: {},
    boola: { type: Boolean },
    boolb: { type: [Boolean, Number] },
    func: { type: Function, default: () => {} }
  }`)
  })

  test('with TSInstantiationExpression', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      type Foo = <T extends string | number>(data: T) => void
      const { value } = defineProps<{ value: Foo }>()
      const foo = value<123>
      </script>
    `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch(`const foo = __props.value<123>`)
  })

  test('aliasing', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo: bar } = defineProps(['foo'])
      let x = foo
      let y = bar
      </script>
      <template>{{ foo + bar }}</template>
    `)
    expect(content).not.toMatch(`const { foo: bar } =`)
    expect(content).toMatch(`let x = foo`) // should not process
    expect(content).toMatch(`let y = __props.foo`)
    // 解构别名 bar 在模板表达式中仍应改写为原始属性 __props.foo。
    expect(content).toMatch(`_toDisplayString(__props.foo + __props.foo)`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      x: BindingTypes.SETUP_LET,
      y: BindingTypes.SETUP_LET,
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS_ALIASED,
      __propsAliases: {
        bar: 'foo',
      },
    })
  })

  // #5425：含连字符等非标识符 prop 名可通过字符串 key 解构，并映射到合法本地变量。
  test('non-identifier prop names', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { 'foo.bar': fooBar } = defineProps({ 'foo.bar': Function })
      let x = fooBar
      </script>
      <template>{{ fooBar }}</template>
    `)
    expect(content).toMatch(`x = __props["foo.bar"]`)
    expect(content).toMatch(`toDisplayString(__props["foo.bar"])`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      x: BindingTypes.SETUP_LET,
      'foo.bar': BindingTypes.PROPS,
      fooBar: BindingTypes.PROPS_ALIASED,
      __propsAliases: {
        fooBar: 'foo.bar',
      },
    })
  })

  test('rest spread', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo, bar, ...rest } = defineProps(['foo', 'bar', 'baz'])
      </script>
    `)
    expect(content).toMatch(
      `const rest = _createPropsRestProxy(__props, ["foo","bar"])`,
    )
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      baz: BindingTypes.PROPS,
      rest: BindingTypes.SETUP_REACTIVE_CONST,
    })
  })

  test('rest spread non-inline', () => {
    const { content, bindings } = compile(
      `
      <script setup>
      const { foo, ...rest } = defineProps(['foo', 'bar'])
      </script>
      <template>{{ rest.bar }}</template>
    `,
      { inlineTemplate: false },
    )
    expect(content).toMatch(
      `const rest = _createPropsRestProxy(__props, ["foo"])`,
    )
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      rest: BindingTypes.SETUP_REACTIVE_CONST,
    })
  })

  // #6960：计算形式但值为静态字符串的 key 仍可在编译期解析为 prop 名。
  test('computed static key', () => {
    const { content, bindings } = compile(`
    <script setup>
    const { ['foo']: foo } = defineProps(['foo'])
    console.log(foo)
    </script>
    <template>{{ foo }}</template>
  `)
    expect(content).not.toMatch(`const { foo } =`)
    expect(content).toMatch(`console.log(__props.foo)`)
    expect(content).toMatch(`_toDisplayString(__props.foo)`)
    assertCode(content)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
    })
  })

  test('multi-variable declaration', () => {
    const { content } = compile(`
    <script setup>
    const { item } = defineProps(['item']),
      a = 1;
    </script>
  `)
    assertCode(content)
    expect(content).toMatch(`const a = 1;`)
    expect(content).toMatch(`props: ['item'],`)
  })

  // #6757：同一 `const` 声明含多个 declarator 时，只改写 defineProps 项，不能吞掉兄弟声明。
  test('multi-variable declaration fix #6757 ', () => {
    const { content } = compile(`
    <script setup>
    const a = 1,
      { item } = defineProps(['item']);
    </script>
  `)
    assertCode(content)
    expect(content).toMatch(`const a = 1;`)
    expect(content).toMatch(`props: ['item'],`)
  })

  // #7422：defineProps 解构位于多变量声明后部时也必须保留前部声明和逗号结构。
  test('multi-variable declaration fix #7422', () => {
    const { content } = compile(`
    <script setup>
    const { item } = defineProps(['item']),
          a = 0,
          b = 0;
    </script>
  `)
    assertCode(content)
    expect(content).toMatch(`const a = 0,`)
    expect(content).toMatch(`b = 0;`)
    expect(content).toMatch(`props: ['item'],`)
  })

  test('handle function parameters with same name as destructured props', () => {
    const { content } = compile(`
    <script setup>
    const { value } = defineProps()
    function test(value) {
      try {
      } catch {
      }
    }
    console.log(value)
    </script>
  `)
    assertCode(content)
    expect(content).toMatch(`console.log(__props.value)`)
  })

  test('defineProps/defineEmits in multi-variable declaration (full removal)', () => {
    const { content } = compile(`
    <script setup>
    const props = defineProps(['item']),
          emit = defineEmits(['a']);
    </script>
  `)
    assertCode(content)
    expect(content).toMatch(`props: ['item'],`)
    expect(content).toMatch(`emits: ['a'],`)
  })

  // 错误分组：嵌套模式、计算 key、对 prop 写入及把响应式解构变量传给会失去响应性的 API。
  describe('errors', () => {
    test('should error on deep destructure', () => {
      expect(() =>
        compile(
          `<script setup>const { foo: [bar] } = defineProps(['foo'])</script>`,
        ),
      ).toThrow(`destructure does not support nested patterns`)

      expect(() =>
        compile(
          `<script setup>const { foo: { bar } } = defineProps(['foo'])</script>`,
        ),
      ).toThrow(`destructure does not support nested patterns`)
    })

    test('should error on computed key', () => {
      expect(() =>
        compile(
          `<script setup>const { [foo]: bar } = defineProps(['foo'])</script>`,
        ),
      ).toThrow(`destructure cannot use computed key`)
    })

    test('should warn when used with withDefaults', () => {
      compile(
        `<script setup lang="ts">
        const { foo } = withDefaults(defineProps<{ foo: string }>(), { foo: 'foo' })
        </script>`,
      )
      expect(
        `withDefaults() is unnecessary when using destructure`,
      ).toHaveBeenWarned()
    })

    test('should error if destructure reference local vars', () => {
      expect(() =>
        compile(
          `<script setup>
          let x = 1
          const {
            foo = () => x
          } = defineProps(['foo'])
          </script>`,
        ),
      ).toThrow(`cannot reference locally declared variables`)
    })

    test('should error if assignment to destructured prop binding', () => {
      expect(() =>
        compile(
          `<script setup>
          const { foo } = defineProps(['foo'])
          foo = 'bar'
          </script>`,
        ),
      ).toThrow(`Cannot assign to destructured props`)

      expect(() =>
        compile(
          `<script setup>
          let { foo } = defineProps(['foo'])
          foo = 'bar'
          </script>`,
        ),
      ).toThrow(`Cannot assign to destructured props`)
    })

    test('should error when passing destructured prop into certain methods', () => {
      expect(() =>
        compile(
          `<script setup>
        import { watch } from 'vue'
        const { foo } = defineProps(['foo'])
        watch(foo, () => {})
        </script>`,
        ),
      ).toThrow(
        `"foo" is a destructured prop and should not be passed directly to watch().`,
      )

      expect(() =>
        compile(
          `<script setup>
        import { watch as w } from 'vue'
        const { foo } = defineProps(['foo'])
        w(foo, () => {})
        </script>`,
        ),
      ).toThrow(
        `"foo" is a destructured prop and should not be passed directly to watch().`,
      )

      expect(() =>
        compile(
          `<script setup>
        import { toRef } from 'vue'
        const { foo } = defineProps(['foo'])
        toRef(foo)
        </script>`,
        ),
      ).toThrow(
        `"foo" is a destructured prop and should not be passed directly to toRef().`,
      )

      expect(() =>
        compile(
          `<script setup>
        import { toRef as r } from 'vue'
        const { foo } = defineProps(['foo'])
        r(foo)
        </script>`,
        ),
      ).toThrow(
        `"foo" is a destructured prop and should not be passed directly to toRef().`,
      )
    })

    // 这里不穷举所有语法，只覆盖最常见的嵌套作用域与遮蔽组合。
    test('should error if default value type does not match declared type', () => {
      expect(() =>
        compile(
          `<script setup lang="ts">
        const { foo = 'hello' } = defineProps<{ foo?: number }>()
        </script>`,
        ),
      ).toThrow(`Default value of prop "foo" does not match declared type.`)
    })

    // #8017：同名局部变量若不是 props 解构来源，不应被“禁止写 prop”检查误伤。
    test('should not throw an error if the variable is not a props', () => {
      expect(() =>
        compile(
          `<script setup lang='ts'>
        import { watch } from 'vue'
        const { userId } = defineProps({ userId: Number })
        const { error: e, info } = useRequest();
        watch(e, () => {});
        watch(info, () => {});
        </script>`,
        ),
      ).not.toThrowError()
    })
  })
})
