/**
 * 响应式 props 解构场景：把读取改写为 `__props`、保留别名/默认值/剩余属性，准确维护函数与
 * catch/循环作用域，并诊断对解构 prop 的赋值、直接传给 watch/toRef 和不支持的嵌套模式。
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

  // 解构数组式 foo 并在脚本与内联模板读取；删除解构声明，两处都改为 __props.foo，绑定登记 PROPS。
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

  // 同一 const 中宏解构夹在两个字面量之间；只移除宏项并修逗号，bar/hello 保持字面量绑定与模板直接读取。
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

  // 函数参数 foo 遮蔽同名 prop，bar 未遮蔽；foo 读取保留局部名，bar 改为 __props.bar。
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

  // for-of 声明局部 msg 并迭代 prop input；循环内 msg 保留，循环外对象简写恢复为 __props.msg。
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

  // 普通 for 声明局部 i，条件读取 prop len；初始化/更新使用局部 i，离开循环后的简写改为 __props.i。
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

  // 函数内嵌套块用 var 声明 foo；var 属于函数作用域，块外 bar=foo 不应改成 prop 读取。
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

  // 函数先读取 foo 再在后续块声明 var foo；预扫描提升绑定，使声明前引用仍指向函数局部。
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

  // 函数先读取 foo 再在 for 初始化声明 var foo；循环中的 var 同样提升到函数作用域，早期读取不改写。
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

  // 嵌套函数有 var foo，外层函数读取同名 prop；遮蔽不跨函数边界，外层改为 __props.foo、内层保留局部。
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

  // 数组式运行时 props 解构数字、对象、函数默认值；对象包装工厂，函数保持自身并通过 __skip_func 标记避免当工厂执行。
  test('default values w/ array runtime declaration', () => {
    const { content } = compile(`
      <script setup>
      const { foo = 1, bar = {}, func = () => {} } = defineProps(['foo', 'bar', 'baz'])
      </script>
    `)
    // 字面量默认值直接保留，对象默认值包装为工厂；函数默认值保留函数本身。
    // 运行时式声明未推导函数类型，生成 __skip_func，让 mergeDefaults 登记 skipFactory。
    expect(content)
      .toMatch(`props: /*@__PURE__*/_mergeDefaults(['foo', 'bar', 'baz'], {
  foo: 1,
  bar: () => ({}),
  func: () => {}, __skip_func: true
})`)
    assertCode(content)
  })

  // 对象式运行时 props 解构字面量、对象、函数和外部引用默认值；mergeDefaults 保存默认值，函数/引用带 skipFactory 标记。
  test('default values w/ object runtime declaration', () => {
    const { content } = compile(`
      <script setup>
      const { foo = 1, bar = {}, func = () => {}, ext = x } = defineProps({ foo: Number, bar: Object, func: Function, ext: null })
      </script>
    `)
    // 字面量默认值直接保留，对象默认值包装为工厂；函数和外部标识符默认值保留原表达式。
    // 此路径不推导运行时 props 声明的字段类型，为 func/ext 生成 skipFactory 标记。
    expect(content)
      .toMatch(`props: /*@__PURE__*/_mergeDefaults({ foo: Number, bar: Object, func: Function, ext: null }, {
  foo: 1,
  bar: () => ({}),
  func: () => {}, __skip_func: true,
  ext: x, __skip_ext: true
})`)
    assertCode(content)
  })
  // 数组 props 含 foo:bar，解构为 fooBar 且有默认值；用原 prop 名生成默认键，并登记 PROPS_ALIASED 与别名表。
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

  // 类型式 props 解构 number/object/函数默认值；数字直接内联、对象套工厂，已知 Function 默认值保持函数本身。
  test('default values w/ type declaration', () => {
    const { content } = compile(`
      <script setup lang="ts">
      const { foo = 1, bar = {}, func = () => {} } = defineProps<{ foo?: number, bar?: object, func?: () => any }>()
      </script>
    `)
    // 字面量直接保留，对象默认值包装为工厂；Function 默认值保留函数本身，不再套一层工厂。
    expect(content).toMatch(`props: {
    foo: { type: Number, required: false, default: 1 },
    bar: { type: Object, required: false, default: () => ({}) },
    func: { type: Function, required: false, default: () => {} }
  }`)
    assertCode(content)
  })

  // 类型字段键使用单/双引号及含冒号字符串；默认值按公开键生成，合法本地 fooBar 映射回 foo:bar。
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

  // 生产模式类型式解构含默认值、未知类型及 Boolean 联合；保留默认值和转换所需类型，普通校验字段裁剪。
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
    // 生产模式也保留默认值：对象默认值包装为工厂，Function 默认值保留函数本身。
    expect(content).toMatch(`props: {
    foo: { default: 1 },
    bar: { default: () => ({}) },
    baz: {},
    boola: { type: Boolean },
    boolb: { type: [Boolean, Number] },
    func: { type: Function, default: () => {} }
  }`)
  })

  // 泛型函数 prop value 被 TSInstantiationExpression 使用；value<123> 改为 __props.value<123>，泛型实例化语法保留。
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

  // foo 解构为 bar；脚本中的裸 foo 不在别名表而保留，bar 改为 __props.foo，模板两名都通过公开 prop 访问。
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
    expect(content).toMatch(`let x = foo`) // foo 不是此解构的本地别名，不改写。
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
  // foo.bar 字符串 prop 解构为 fooBar；脚本和模板使用方括号 __props 访问，并保留别名绑定信息。
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

  // 解构 foo/bar 与 ...rest；生成排除两键的 createPropsRestProxy，rest 是 SETUP_REACTIVE_CONST，剩余 baz 仍登记 PROPS。
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

  // 关闭模板内联后读取 rest.bar；仍生成排除 foo 的 rest getter 代理并保留响应式常量分类。
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
  // 计算形式的键是静态字符串 ['foo']；编译期可解析并把脚本与模板读取改为 __props.foo。
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

  // 宏解构是多个 declarator 的首项；删除该项后保留 const a=1 与 props 选项，校验模块语法。
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
  // 宏解构是多个 declarator 的末项；删除它时保留前面的 a 及有效分号结构。
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

  // #7422：删除声明首项的 props 解构后，保留后面的 a、b 及逗号结构。
  // 宏解构后跟 a/b 两项；仅移除首项及相应逗号，两个兄弟声明均保留。
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

  // 函数参数 value 遮蔽 prop，函数含无参数 catch；退出函数后 console.log(value) 仍正确改为 __props.value。
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

  // 同一声明的两项分别调用 defineProps/defineEmits；生成两组选项并移除宏声明部分，输出可解析且匹配快照。
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
    // 分别把 prop 解构为嵌套数组和嵌套对象；两条分支均拒绝嵌套 pattern，避免无法建立单一公开键映射。
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

    // 使用动态 [foo] 解构键；无法确定公开 prop 名，编译时报计算键错误。
    test('should error on computed key', () => {
      expect(() =>
        compile(
          `<script setup>const { [foo]: bar } = defineProps(['foo'])</script>`,
        ),
      ).toThrow(`destructure cannot use computed key`)
    })

    // withDefaults 包装类型式宏后再解构；发出多余 withDefaults 警告，并走禁用响应式解构的包装路径。
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

    // 解构默认值函数捕获 setup 中的 let x；默认值需提升为组件选项，因此触发局部变量引用错误。
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

    // 分别以 const/let 解构后直接赋值 foo；两条声明路径都拒绝写入只读 prop 绑定。
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

    // 分别使用 watch/toRef 原名及导入别名直接接收解构 foo；四条路径均诊断传入快照值会丢失响应性。
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

    // 字符串默认值与声明的 number 类型不匹配，应在编译期报错。
    // 可选 number prop 默认值写成字符串 hello；静态默认值类型检查拒绝不匹配。
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
    // 普通 useRequest 解构 e/info 后交给 watch，同时存在另一组 prop 解构；只约束 prop 绑定，普通局部量不应误报。
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
