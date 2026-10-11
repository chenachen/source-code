/**
 * `defineModel` 宏场景：生成 props、`update:*` emits 与 useModel 调用，覆盖默认 modelValue、
 * 具名 model、类型/默认值/修饰符、多个模型及与 defineProps/defineEmits 的合并。
 */
import { BindingTypes } from '@vue/compiler-core'
import { assertCode, compileSFCScript as compile } from '../utils'

describe('defineModel()', () => {
  // 同时声明默认、count、toString 模型；生成对应 props/update 事件及 useModel，模型变量是 SETUP_REF，未被本地变量覆盖的模型名登记为 PROPS。
  test('basic usage', () => {
    const { content, bindings } = compile(
      `
      <script setup>
      const modelValue = defineModel({ required: true })
      const c = defineModel('count')
      const toString = defineModel('toString', { type: Function })
      </script>
      `,
    )
    assertCode(content)
    expect(content).toMatch('props: {')
    expect(content).toMatch('"modelValue": { required: true },')
    expect(content).toMatch('"count": {},')
    expect(content).toMatch('"toString": { type: Function },')
    expect(content).toMatch(
      'emits: ["update:modelValue", "update:count", "update:toString"],',
    )
    expect(content).toMatch(
      `const modelValue = _useModel(__props, "modelValue")`,
    )
    expect(content).toMatch(`const c = _useModel(__props, 'count')`)
    expect(content).toMatch(`const toString = _useModel(__props, 'toString')`)
    expect(content).toMatch(`return { modelValue, c, toString }`)
    expect(content).not.toMatch('defineModel')

    expect(bindings).toStrictEqual({
      modelValue: BindingTypes.SETUP_REF,
      count: BindingTypes.PROPS,
      c: BindingTypes.SETUP_REF,
      toString: BindingTypes.SETUP_REF,
    })
  })

  // 使用不含插值的模板字符串命名 x/y；静态名称被提取，默认值进入各自 prop，useModel 保留原名称表达式。
  test('w/ template literal name', () => {
    const { content, bindings } = compile(
      `
      <script setup>
      const x = defineModel(\`x\`, { default: 100 })
      const y = defineModel(\`y\`, { default: 200 })
      </script>
      `,
    )
    assertCode(content)
    expect(content).toMatch('"x": { default: 100 },')
    expect(content).toMatch('"y": { default: 200 },')
    expect(content).toMatch('emits: ["update:x", "update:y"],')
    expect(content).toMatch('const x = _useModel(__props, `x`)')
    expect(content).toMatch('const y = _useModel(__props, `y`)')
    expect(content).not.toMatch('defineModel')

    expect(bindings).toStrictEqual({
      x: BindingTypes.SETUP_REF,
      y: BindingTypes.SETUP_REF,
    })
  })

  // 模型名模板字符串含 name 插值；它不是静态名称，回退 modelValue 并把该表达式作为 options 传给 useModel。
  test('w/ template literal name with expressions falls back to modelValue', () => {
    const { content } = compile(
      `
      <script setup>
      const name = 'x'
      const m = defineModel(\`\${name}\`)
      </script>
      `,
    )
    assertCode(content)
    expect(content).toMatch('"modelValue":')
    expect(content).toMatch('_useModel(__props, "modelValue",')
  })

  // 已有 foo props/change emits，再声明默认模型；通过 mergeModels 合并选项，生成 useModel 并保留各类绑定。
  test('w/ defineProps and defineEmits', () => {
    const { content, bindings } = compile(
      `
      <script setup>
      defineProps({ foo: String })
      defineEmits(['change'])
      const count = defineModel({ default: 0 })
      </script>
    `,
    )
    assertCode(content)
    expect(content).toMatch(`props: /*@__PURE__*/_mergeModels({ foo: String }`)
    expect(content).toMatch(`"modelValue": { default: 0 }`)
    expect(content).toMatch(`const count = _useModel(__props, "modelValue")`)
    expect(content).not.toMatch('defineModel')
    expect(bindings).toStrictEqual({
      count: BindingTypes.SETUP_REF,
      foo: BindingTypes.PROPS,
      modelValue: BindingTypes.PROPS,
    })
  })

  // 已有数组 props，再声明 count 模型；mergeModels 合并数组与模型对象，并生成 countModifiers。
  test('w/ array props', () => {
    const { content, bindings } = compile(
      `
      <script setup>
      defineProps(['foo', 'bar'])
      const count = defineModel('count')
      </script>
    `,
    )
    assertCode(content)
    expect(content).toMatch(`props: /*@__PURE__*/_mergeModels(['foo', 'bar'], {
    "count": {},
    "countModifiers": {},
  })`)
    expect(content).toMatch(`const count = _useModel(__props, 'count')`)
    expect(content).not.toMatch('defineModel')
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      count: BindingTypes.SETUP_REF,
    })
  })

  // 声明布尔/字符串联合、数字及含 any 的模型；推导构造器与修饰符 prop，未知联合保留 Boolean 并加 skipCheck。
  test('w/ types, basic usage', () => {
    const { content, bindings } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel<boolean | string>()
      const count = defineModel<number>('count')
      const disabled = defineModel<number>('disabled', { required: false })
      const any = defineModel<any | boolean>('any')
      </script>
      `,
    )
    assertCode(content)
    expect(content).toMatch('"modelValue": { type: [Boolean, String] }')
    expect(content).toMatch('"modelModifiers": {}')
    expect(content).toMatch('"count": { type: Number }')
    expect(content).toMatch(
      '"disabled": { type: Number, ...{ required: false } }',
    )
    expect(content).toMatch('"any": { type: Boolean, skipCheck: true }')
    expect(content).toMatch(
      'emits: ["update:modelValue", "update:count", "update:disabled", "update:any"]',
    )

    expect(content).toMatch(
      `const modelValue = _useModel<boolean | string>(__props, "modelValue")`,
    )
    expect(content).toMatch(`const count = _useModel<number>(__props, 'count')`)
    expect(content).toMatch(
      `const disabled = _useModel<number>(__props, 'disabled')`,
    )
    expect(content).toMatch(
      `const any = _useModel<any | boolean>(__props, 'any')`,
    )

    expect(bindings).toStrictEqual({
      modelValue: BindingTypes.SETUP_REF,
      count: BindingTypes.SETUP_REF,
      disabled: BindingTypes.SETUP_REF,
      any: BindingTypes.SETUP_REF,
    })
  })

  // 生产模式编译 Boolean、无默认 Function、有默认 Function、String 及 required 选项；保留转换或默认值解释所需的类型，其余校验类型裁剪。
  test('w/ types, production mode', () => {
    const { content, bindings } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel<boolean>()
      const fn = defineModel<() => void>('fn')
      const fnWithDefault = defineModel<() => void>('fnWithDefault', { default: () => null })
      const str = defineModel<string>('str')
      const optional = defineModel<string>('optional', { required: false })
      </script>
      `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch('"modelValue": { type: Boolean }')
    expect(content).toMatch('"fn": {}')
    expect(content).toMatch(
      '"fnWithDefault": { type: Function, ...{ default: () => null } },',
    )
    expect(content).toMatch('"str": {}')
    expect(content).toMatch('"optional": { required: false }')
    expect(content).toMatch(
      'emits: ["update:modelValue", "update:fn", "update:fnWithDefault", "update:str", "update:optional"]',
    )
    expect(content).toMatch(
      `const modelValue = _useModel<boolean>(__props, "modelValue")`,
    )
    expect(content).toMatch(`const fn = _useModel<() => void>(__props, 'fn')`)
    expect(content).toMatch(`const str = _useModel<string>(__props, 'str')`)
    expect(bindings).toStrictEqual({
      modelValue: BindingTypes.SETUP_REF,
      fn: BindingTypes.SETUP_REF,
      fnWithDefault: BindingTypes.SETUP_REF,
      str: BindingTypes.SETUP_REF,
      optional: BindingTypes.SETUP_REF,
    })
  })

  // 生产模式模型包含 Boolean/String/Object 联合；为布尔转换保留完整构造器数组及原顺序。
  test('w/ types, production mode, boolean + multiple types', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel<boolean | string | {}>()
      </script>
      `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch('"modelValue": { type: [Boolean, String, Object] }')
  })

  // 生产模式模型含 Number/Function 联合和函数默认值；保留两个类型，使运行时不会误执行 Function 默认值。
  test('w/ types, production mode, function + runtime opts + multiple types', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel<number | (() => number)>({ default: () => 1 })
      </script>
      `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch(
      '"modelValue": { type: [Number, Function], ...{ default: () => 1 } }',
    )
  })

  // 分别以不同位置声明 get/set 与 required/default；prop 选项提升到模型 props，转换器留在 useModel 第三参数且保持方法源码。
  test('get / set transformers', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel({
        get(v) { return v - 1 },
        set: (v) => { return v + 1 },
        required: true
      })
      </script>
      `,
    )
    assertCode(content)
    expect(content).toMatch(/"modelValue": {\s+required: true,?\s+}/m)
    expect(content).toMatch(
      `_useModel(__props, "modelValue", {
        get(v) { return v - 1 },
        set: (v) => { return v + 1 },
        })`,
    )

    const { content: content2 } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel({
        default: 0,
        get(v) { return v - 1 },
        required: true,
        set: (v) => { return v + 1 },
      })
      </script>
      `,
    )
    assertCode(content2)
    expect(content2).toMatch(
      /"modelValue": {\s+default: 0,\s+required: true,?\s+}/m,
    )
    expect(content2).toMatch(
      `_useModel(__props, "modelValue", {
        get(v) { return v - 1 },
        set: (v) => { return v + 1 },
      })`,
    )
  })

  // 响应式解构 x 后在模型 set 中读取；转换器留在 setup 并把 x 改为 __props.x，允许捕获 prop。
  test('usage w/ props destructure', () => {
    const { content } = compile(
      `
      <script setup lang="ts">
      const { x } = defineProps<{ x: number }>()
      const modelValue = defineModel({
        set: (v) => { return v + x }
      })
      </script>
      `,
      { propsDestructure: true },
    )
    assertCode(content)
    expect(content).toMatch(`set: (v) => { return v + __props.x }`)
  })

  // 生产模式再次覆盖 boolean | string 默认模型；Boolean 转换要求保留联合类型及 update:modelValue，局部变量仍分类为 SETUP_REF。
  test('w/ Boolean And Function types, production mode', () => {
    const { content, bindings } = compile(
      `
      <script setup lang="ts">
      const modelValue = defineModel<boolean | string>()
      </script>
      `,
      { isProd: true },
    )
    assertCode(content)
    expect(content).toMatch('"modelValue": { type: [Boolean, String] }')
    expect(content).toMatch('emits: ["update:modelValue"]')
    expect(content).toMatch(
      `const modelValue = _useModel<boolean | string>(__props, "modelValue")`,
    )
    expect(bindings).toStrictEqual({
      modelValue: BindingTypes.SETUP_REF,
    })
  })
})
