/**
 * 通过监听器调用次数、参数和开发期警告，验证事件名匹配、emits 合并及 v-model 修饰符。
 */
// emits 声明与监听器透传的交互另由 rendererAttrsFallthrough.spec.ts 覆盖。
// 本文件重点观察 emit 参数、匹配与校验。

import {
  type ComponentPublicInstance,
  createApp,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  render,
  toHandlers,
} from '@vue/runtime-test'
import { isEmitListener } from '../src/componentEmits'

// 组件 emit 对 VNode 监听器的匹配、参数转换和校验。
describe('component: emit', () => {
  // 分别触发 foo、bar、!baz；onfoo 不匹配，onBar 与 on!baz 被调用。
  test('trigger handlers', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo')`、`this.$emit('bar')`、`this.$emit('!baz')`。
       */
      created() {
        // $emit 已绑定当前组件实例，可在 created 中直接调用。
        this.$emit('foo')
        this.$emit('bar')
        this.$emit('!baz')
      },
    })

    const onfoo = vi.fn()
    const onBar = vi.fn()
    const onBaz = vi.fn()
    /**
     * 返回 `h(Foo, { onfoo, onBar, ['on!baz']: onBaz })`。
     */
    const Comp = () => h(Foo, { onfoo, onBar, ['on!baz']: onBaz })
    render(h(Comp), nodeOps.createElement('div'))

    expect(onfoo).not.toHaveBeenCalled()
    // 父级监听器以 on 后接大写字母或特殊字符的键传入；onfoo 不匹配 emit 的处理器查找。
    expect(onBar).toHaveBeenCalled()
    expect(onBaz).toHaveBeenCalled()
  })

  // 触发 test-event，匹配 camelCase 形式的 onTestEvent。
  test('trigger camelCase handler', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('test-event')`。
       */
      created() {
        this.$emit('test-event')
      },
    })

    const fooSpy = vi.fn()
    /**
     * 返回 `h(Foo, { onTestEvent: fooSpy, })`。
     */
    const Comp = () =>
      h(Foo, {
        onTestEvent: fooSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalledTimes(1)
  })

  // 触发 test-event，匹配保留连字符的 onTest-event。
  test('trigger kebab-case handler', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('test-event')`。
       */
      created() {
        this.$emit('test-event')
      },
    })

    const fooSpy = vi.fn()
    /**
     * 返回 `h(Foo, { 'onTest-event': fooSpy, })`。
     */
    const Comp = () =>
      h(Foo, {
        'onTest-event': fooSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalledTimes(1)
  })

  // #3527
  // toHandlers 分别转换 test-event 与 testEvent，两个事件各调用自己的监听器一次。
  test('trigger mixed case handlers', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('test-event')`、`this.$emit('testEvent')`。
       */
      created() {
        this.$emit('test-event')
        this.$emit('testEvent')
      },
    })

    const fooSpy = vi.fn()
    const barSpy = vi.fn()
    /**
     * 返回 `h(Foo, toHandlers({ 'test-event': fooSpy, testEvent: barSpy, }))`。
     */
    const Comp = () =>
      // 用 toHandlers 模拟 v-on="obj" 的监听器对象转换。
      h(
        Foo,
        toHandlers({
          'test-event': fooSpy,
          testEvent: barSpy,
        }),
      )
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalledTimes(1)
    expect(barSpy).toHaveBeenCalledTimes(1)
  })

  // 覆盖 DOM 模板中 v-model:foo-bar 的连字符监听器写法。
  // update:fooProp 匹配同名监听器，update:barProp 也能回退匹配 onUpdate:bar-prop。
  test('trigger hyphenated events for update:xxx events', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:fooProp')`、`this.$emit('update:barProp')`。
       */
      created() {
        this.$emit('update:fooProp')
        this.$emit('update:barProp')
      },
    })

    const fooSpy = vi.fn()
    const barSpy = vi.fn()
    /**
     * 返回 `h(Foo, { 'onUpdate:fooProp': fooSpy, 'onUpdate:bar-prop': barSpy, })`。
     */
    const Comp = () =>
      h(Foo, {
        'onUpdate:fooProp': fooSpy,
        'onUpdate:bar-prop': barSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalled()
    expect(barSpy).toHaveBeenCalled()
  })

  // onFoo 是监听器数组；一次 emit 将参数 1 传给数组中的两个函数。
  test('should trigger array of listeners', async () => {
    const Child = defineComponent({
      /**
       * 返回渲染闭包，执行时产出 `h('div')`。
       */
      setup(_, { emit }) {
        emit('foo', 1)
        return () => h('div')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { onFoo: [fn1, fn2], })`。
       */
      setup() {
        return () =>
          h(Child, {
            onFoo: [fn1, fn2],
          })
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith(1)
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith(1)
  })

  // 数组 emits 只声明 foo，触发 bar-baz 时发出未声明事件警告。
  test('warning for undeclared event (array)', () => {
    const Foo = defineComponent({
      emits: ['foo'],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('bar-baz')`。
       */
      created() {
        // @ts-expect-error
        this.$emit('bar-baz')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "bar-baz" but it is neither declared in the emits option nor as an "onBarBaz" prop`,
    ).toHaveBeenWarned()
  })

  // 对象 emits 只声明 foo，触发 bar-baz 时同样发出未声明事件警告。
  test('warning for undeclared event (object)', () => {
    const Foo = defineComponent({
      emits: {
        foo: null,
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('bar-baz')`。
       */
      created() {
        // @ts-expect-error
        this.$emit('bar-baz')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "bar-baz" but it is neither declared in the emits option nor as an "onBarBaz" prop`,
    ).toHaveBeenWarned()
  })

  // 即使 emits 未声明 foo，props 中声明 onFoo 也能避免未声明事件警告。
  test('should not warn if has equivalent onXXX prop', () => {
    const Foo = defineComponent({
      props: ['onFoo'],
      emits: [],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo')`。
       */
      created() {
        // @ts-expect-error
        this.$emit('foo')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "foo" but it is neither declared`,
    ).not.toHaveBeenWarned()
  })

  // 触发 foo-bar 时，props 中的 onFooBar 声明同样能避免未声明事件警告。
  test('should not warn if has equivalent onXXX prop with kebab-cased event', () => {
    const Foo = defineComponent({
      props: ['onFooBar'],
      emits: [],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo-bar')`。
       */
      created() {
        // @ts-expect-error
        this.$emit('foo-bar')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "foo-bar" but it is neither declared`,
    ).not.toHaveBeenWarned()
  })

  // foo 的 validator 只接受正数，emit 传入 -1 时触发参数校验警告。
  test('validator warning', () => {
    const Foo = defineComponent({
      emits: {
        /**
         * 返回 `arg > 0`。
         */
        foo: (arg: number) => arg > 0,
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo', -1)`。
       */
      created() {
        this.$emit('foo', -1)
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(`event validation failed for event "foo"`).toHaveBeenWarned()
  })

  // mixin 声明的 foo validator 被合并，组件触发 foo(-1) 时仍执行校验并警告。
  test('merging from mixins', () => {
    const mixin = {
      emits: {
        /**
         * 返回 `arg > 0`。
         */
        foo: (arg: number) => arg > 0,
      },
    }
    const Foo = defineComponent({
      mixins: [mixin],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo', -1)`。
       */
      created() {
        this.$emit('foo', -1)
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(`event validation failed for event "foo"`).toHaveBeenWarned()
  })

  // #2651
  // 空 mixin 不应使未声明 emits 的组件得到空声明约束，触发 foo 时不报未声明警告。
  test('should not attach normalized object when mixins do not contain emits', () => {
    const Foo = defineComponent({
      mixins: [{}],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('foo')`。
       */
      created() {
        this.$emit('foo')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "foo" but it is neither declared`,
    ).not.toHaveBeenWarned()
  })

  // foo、bar 各触发两次，对应的 onXxxOnce 监听器分别只调用一次。
  test('.once', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      emits: {
        foo: null,
        bar: null,
      },
      /**
       * 在 created 阶段执行 `this.$emit('foo')`、`this.$emit('bar')`。
       */
      created() {
        this.$emit('foo')
        this.$emit('foo')
        this.$emit('bar')
        this.$emit('bar')
      },
    })
    const fn = vi.fn()
    const barFn = vi.fn()
    render(
      h(Foo, {
        onFooOnce: fn,
        onBarOnce: barFn,
      }),
      nodeOps.createElement('div'),
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(barFn).toHaveBeenCalledTimes(1)
  })

  // 同一 foo 触发两次，普通监听器调用两次，onFooOnce 只调用一次。
  test('.once with normal listener of the same name', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      emits: {
        foo: null,
      },
      /**
       * 在 created 阶段执行 `this.$emit('foo')`。
       */
      created() {
        this.$emit('foo')
        this.$emit('foo')
      },
    })
    const onFoo = vi.fn()
    const onFooOnce = vi.fn()
    render(
      h(Foo, {
        onFoo,
        onFooOnce,
      }),
      nodeOps.createElement('div'),
    )
    expect(onFoo).toHaveBeenCalledTimes(2)
    expect(onFooOnce).toHaveBeenCalledTimes(1)
  })

  // 默认和具名 v-model 的 number 修饰符，将字符串事件参数转换成数字后交给监听器。
  test('.number modifier should work with v-model on component', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:modelValue', '1')`、`this.$emit('update:foo', '2')`。
       */
      created() {
        this.$emit('update:modelValue', '1')
        this.$emit('update:foo', '2')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 返回 `h(Foo, { modelValue: null, modelModifiers: { number: true }, 'onUpdate:modelValue': fn1, foo: null, fooModifiers: { number: true }, 'onUpdate:foo': fn2, })`。
     */
    const Comp = () =>
      h(Foo, {
        modelValue: null,
        modelModifiers: { number: true },
        'onUpdate:modelValue': fn1,

        foo: null,
        fooModifiers: { number: true },
        'onUpdate:foo': fn2,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith(1)
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith(2)
  })

  // 默认和具名 v-model 的 trim 修饰符，去掉字符串事件参数两端的空白。
  test('.trim modifier should work with v-model on component', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:modelValue', ' one ')`、`this.$emit('update:foo', ' two ')`。
       */
      created() {
        this.$emit('update:modelValue', ' one ')
        this.$emit('update:foo', '  two  ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 返回 `h(Foo, { modelValue: null, modelModifiers: { trim: true }, 'onUpdate:modelValue': fn1, foo: null, fooModifiers: { trim: true }, 'onUpdate:foo': fn2, })`。
     */
    const Comp = () =>
      h(Foo, {
        modelValue: null,
        modelModifiers: { trim: true },
        'onUpdate:modelValue': fn1,

        foo: null,
        fooModifiers: { trim: true },
        'onUpdate:foo': fn2,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith('one')
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith('two')
  })

  // first-name 输入与 update:firstName 事件配合时，仍找到 trim 修饰符与连字符监听器。
  test('.trim modifier should work with v-model on component for kebab-cased props and camelCased emit', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:firstName', ' one ')`。
       */
      created() {
        this.$emit('update:firstName', ' one ')
      },
    })

    const fn1 = vi.fn()

    /**
     * 返回 `h(Foo, { 'first-name': null, 'first-nameModifiers': { trim: true }, 'onUpdate:first-name': fn1, })`。
     */
    const Comp = () =>
      h(Foo, {
        'first-name': null,
        'first-nameModifiers': { trim: true },
        'onUpdate:first-name': fn1,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith('one')
  })

  // modelValue/firstName 输入与连字符 update 事件配合时，仍找到 trim 修饰符和 camelCase 监听器。
  test('.trim modifier should work with v-model on component for camelCased props and kebab-cased emit', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:model-value', ' one ')`、`this.$emit('update:first-name', ' two ')`。
       */
      created() {
        this.$emit('update:model-value', ' one ')
        this.$emit('update:first-name', ' two ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 渲染 Foo，传入 camelCase 的 modelValue/firstName、trim 修饰符及对应监听器；Foo 发送 kebab-case update 事件，外层检查两条回调都得到裁剪后的文本。
     */
    const Comp = () =>
      h(Foo, {
        modelValue: null,
        modelModifiers: { trim: true },
        'onUpdate:modelValue': fn1,

        firstName: null,
        firstNameModifiers: { trim: true },
        'onUpdate:firstName': fn2,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith('one')
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith('two')
  })

  // base-URL 保留混合大小写，update:base-URL 仍匹配对应修饰符并传出裁剪后的字符串。
  test('.trim modifier should work with v-model on component for mixed cased props and emit', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:base-URL', ' one ')`。
       */
      created() {
        this.$emit('update:base-URL', ' one ')
      },
    })

    const fn1 = vi.fn()

    /**
     * 返回 `h(Foo, { 'base-URL': null, 'base-URLModifiers': { trim: true }, 'onUpdate:base-URL': fn1, })`。
     */
    const Comp = () =>
      h(Foo, {
        'base-URL': null,
        'base-URLModifiers': { trim: true },
        'onUpdate:base-URL': fn1,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith('one')
  })

  // trim 与 number 同时存在时，带空白的数字字符串最终以数字 1.2 和 1 传给监听器。
  test('.trim and .number modifiers should work with v-model on component', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:modelValue', ' +01.2 ')`、`this.$emit('update:foo', ' 1 ')`。
       */
      created() {
        this.$emit('update:modelValue', '    +01.2    ')
        this.$emit('update:foo', '    1    ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 渲染 Foo，为 modelValue 与 foo 同时传入 trim/number 修饰符及监听器；供外层检查数值字符串最终转为数字，不单独证明两种转换的中间顺序。
     */
    const Comp = () =>
      h(Foo, {
        modelValue: null,
        modelModifiers: { trim: true, number: true },
        'onUpdate:modelValue': fn1,

        foo: null,
        fooModifiers: { trim: true, number: true },
        'onUpdate:foo': fn2,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn1).toHaveBeenCalledWith(1.2)
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith(1)
  })

  // 同一次 emit 包含字符串和对象参数；trim 只处理字符串，保留对象内部的空白。
  test('only trim string parameter when work with v-model on component', () => {
    const Foo = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$emit('update:modelValue', ' foo ', { bar: ' bar ' })`。
       */
      created() {
        this.$emit('update:modelValue', ' foo ', { bar: ' bar ' })
      },
    })

    const fn = vi.fn()
    /**
     * 返回 `h(Foo, { modelValue: null, modelModifiers: { trim: true }, 'onUpdate:modelValue': fn, })`。
     */
    const Comp = () =>
      h(Foo, {
        modelValue: null,
        modelModifiers: { trim: true },
        'onUpdate:modelValue': fn,
      })

    render(h(Comp), nodeOps.createElement('div'))

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('foo', { bar: ' bar ' })
  })

  // isEmitListener 匹配已声明事件及 Once 后缀，明确拒绝 onclick 这类 on 后接小写字母的键。
  test('isEmitListener', () => {
    const options = {
      click: null,
      'test-event': null,
      fooBar: null,
      FooBaz: null,
      once: null,
    }
    expect(isEmitListener(options, 'onClick')).toBe(true)
    expect(isEmitListener(options, 'onclick')).toBe(false)
    expect(isEmitListener(options, 'onBlick')).toBe(false)
    // Once 后缀仍匹配原事件声明。
    expect(isEmitListener(options, 'onClickOnce')).toBe(true)
    expect(isEmitListener(options, 'onclickOnce')).toBe(false)
    // 声明使用连字符形式。
    expect(isEmitListener(options, 'onTestEvent')).toBe(true)
    // 声明使用 camelCase 形式。
    expect(isEmitListener(options, 'onFooBar')).toBe(true)
    // 声明使用 PascalCase 形式。
    expect(isEmitListener(options, 'onFooBaz')).toBe(true)
    // 事件本身名为 once，onOnce 不能被剥为空名。
    expect(isEmitListener(options, 'onOnce')).toBe(true)
    // once 事件再加一次性修饰符，onOnceOnce 只移除末尾 Once。
    expect(isEmitListener(options, 'onOnceOnce')).toBe(true)
  })

  // beforeUnmount 等待 nextTick 后再 emit，此时实例已卸载，父监听器不会被调用。
  test('does not emit after unmount', async () => {
    const fn = vi.fn()
    const Foo = defineComponent({
      emits: ['closing'],
      /**
       * 在 beforeUnmount 阶段执行 `this.$nextTick()`、`this.$emit('closing', true)`；异步延续在首个 await 后继续；生命周期调度不等待其完成。
       */
      async beforeUnmount() {
        await this.$nextTick()
        this.$emit('closing', true)
      },
      /**
       * 渲染结果为 `h('div')`。
       */
      render() {
        return h('div')
      },
    })
    /**
     * 返回 `h(Foo, { onClosing: fn, })`。
     */
    const Comp = () =>
      h(Foo, {
        onClosing: fn,
      })

    const el = nodeOps.createElement('div')
    render(h(Comp), el)
    await nextTick()
    render(null, el)
    await nextTick()
    expect(fn).not.toHaveBeenCalled()
  })

  // 两个 mixin 的字符串数组 emits 合并到 $options，结果包含 one、two、three。
  test('merge string array emits', async () => {
    const ComponentA = defineComponent({
      emits: ['one', 'two'],
    })
    const ComponentB = defineComponent({
      emits: ['three'],
    })
    const renderFn = vi.fn(function (this: ComponentPublicInstance) {
      expect(this.$options.emits).toEqual(['one', 'two', 'three'])
      return h('div')
    })
    const ComponentC = defineComponent({
      render: renderFn,
      mixins: [ComponentA, ComponentB],
    })
    const el = nodeOps.createElement('div')
    expect(renderFn).toHaveBeenCalledTimes(0)
    render(h(ComponentC), el)
    expect(renderFn).toHaveBeenCalledTimes(1)
  })

  // 对象与数组 emits 来自两个 mixin；合并结果保留 two 的 validator 引用，并把 three 转为 null。
  test('merge object emits', async () => {
    const twoFn = vi.fn((v: unknown) => !v)
    const ComponentA = defineComponent({
      emits: {
        one: null,
        two: twoFn,
      },
    })
    const ComponentB = defineComponent({
      emits: ['three'],
    })
    const renderFn = vi.fn(function (this: ComponentPublicInstance) {
      expect(this.$options.emits).toEqual({
        one: null,
        two: twoFn,
        three: null,
      })
      expect(this.$options.emits.two).toBe(twoFn)
      return h('div')
    })
    const ComponentC = defineComponent({
      render: renderFn,
      mixins: [ComponentA, ComponentB],
    })
    const el = nodeOps.createElement('div')
    expect(renderFn).toHaveBeenCalledTimes(0)
    render(h(ComponentC), el)
    expect(renderFn).toHaveBeenCalledTimes(1)
  })

  // CompA 同时作为组件和 mixin 使用；CompB 的局部 validator 覆盖全局同名声明，只调用局部 validator。
  test('merging emits for a component that is also used as a mixin', () => {
    /**
     * 渲染结果为 `h('div')`。
     */
    const render = () => h('div')
    const CompA = {
      render,
    }
    const validateByMixin = vi.fn(() => true)
    const validateByGlobalMixin = vi.fn(() => true)

    const mixin = {
      emits: {
        one: validateByMixin,
      },
    }

    const CompB = defineComponent({
      mixins: [mixin, CompA],
      /**
       * 在 created 阶段执行 `this.$emit('one', 1)`。
       */
      created(this) {
        this.$emit('one', 1)
      },
      render,
    })

    const app = createApp({
      /**
       * 渲染结果为 `[h(CompA), h(CompB)]`。
       */
      render() {
        return [h(CompA), h(CompB)]
      },
    })

    app.mixin({
      emits: {
        one: validateByGlobalMixin,
        two: null,
      },
    })

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(validateByMixin).toHaveBeenCalledTimes(1)
    expect(validateByGlobalMixin).not.toHaveBeenCalled()
  })
})
