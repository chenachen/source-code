/**
 * 测试阅读说明：本文件验证 `runtime-core/componentEmits` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
// Note: emits and listener fallthrough is tested in
// ./rendererAttrsFallthrough.spec.ts.

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

// 测试组：组件：emit。
describe('component: emit', () => {
  // 测试场景：触发处理程序。
  test('trigger handlers', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        // the `emit` function is bound on component instances
        this.$emit('foo')
        this.$emit('bar')
        this.$emit('!baz')
      },
    })

    const onfoo = vi.fn()
    const onBar = vi.fn()
    const onBaz = vi.fn()
    const Comp = () => h(Foo, { onfoo, onBar, ['on!baz']: onBaz })
    render(h(Comp), nodeOps.createElement('div'))

    expect(onfoo).not.toHaveBeenCalled()
    // only capitalized or special chars are considered event listeners
    expect(onBar).toHaveBeenCalled()
    expect(onBaz).toHaveBeenCalled()
  })

  // 测试场景：触发camelCase处理程序。
  test('trigger camelCase handler', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('test-event')
      },
    })

    const fooSpy = vi.fn()
    const Comp = () =>
      h(Foo, {
        onTestEvent: fooSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalledTimes(1)
  })

  // 测试场景：kebab-case 事件名能够匹配对应监听器。
  test('trigger kebab-case handler', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('test-event')
      },
    })

    const fooSpy = vi.fn()
    const Comp = () =>
      h(Foo, {
        'onTest-event': fooSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalledTimes(1)
  })

  // #3527
  // 测试场景：触发混合案例处理程序。
  test('trigger mixed case handlers', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('test-event')
        this.$emit('testEvent')
      },
    })

    const fooSpy = vi.fn()
    const barSpy = vi.fn()
    const Comp = () =>
      // simulate v-on="obj" usage
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

  // for v-model:foo-bar usage in DOM templates
  // 测试场景：触发 update:xxx 事件的连字符事件。
  test('trigger hyphenated events for update:xxx events', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:fooProp')
        this.$emit('update:barProp')
      },
    })

    const fooSpy = vi.fn()
    const barSpy = vi.fn()
    const Comp = () =>
      h(Foo, {
        'onUpdate:fooProp': fooSpy,
        'onUpdate:bar-prop': barSpy,
      })
    render(h(Comp), nodeOps.createElement('div'))

    expect(fooSpy).toHaveBeenCalled()
    expect(barSpy).toHaveBeenCalled()
  })

  // 测试场景：应该触发监听器数组。
  test('should trigger array of listeners', async () => {
    const Child = defineComponent({
      setup(_, { emit }) {
        emit('foo', 1)
        return () => h('div')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const App = {
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

  // 测试场景：未声明事件的警告（数组）。
  test('warning for undeclared event (array)', () => {
    const Foo = defineComponent({
      emits: ['foo'],
      render() {},
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

  // 测试场景：未声明事件（对象）的警告。
  test('warning for undeclared event (object)', () => {
    const Foo = defineComponent({
      emits: {
        foo: null,
      },
      render() {},
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

  // 测试场景：如果具有等效的 onXXX 属性，则不应发出警告。
  test('should not warn if has equivalent onXXX prop', () => {
    const Foo = defineComponent({
      props: ['onFoo'],
      emits: [],
      render() {},
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

  // 测试场景：如果具有与 kebab-cased 事件等效的 onXXX 属性，则不应发出警告。
  test('should not warn if has equivalent onXXX prop with kebab-cased event', () => {
    const Foo = defineComponent({
      props: ['onFooBar'],
      emits: [],
      render() {},
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

  // 测试场景：验证器警告。
  test('validator warning', () => {
    const Foo = defineComponent({
      emits: {
        foo: (arg: number) => arg > 0,
      },
      render() {},
      created() {
        this.$emit('foo', -1)
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(`event validation failed for event "foo"`).toHaveBeenWarned()
  })

  // 测试场景：从 mixin 合并。
  test('merging from mixins', () => {
    const mixin = {
      emits: {
        foo: (arg: number) => arg > 0,
      },
    }
    const Foo = defineComponent({
      mixins: [mixin],
      render() {},
      created() {
        this.$emit('foo', -1)
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(`event validation failed for event "foo"`).toHaveBeenWarned()
  })

  // #2651
  // 测试场景：当 mixin 不包含 emits 时不应附加规范化对象。
  test('should not attach normalized object when mixins do not contain emits', () => {
    const Foo = defineComponent({
      mixins: [{}],
      render() {},
      created() {
        this.$emit('foo')
      },
    })
    render(h(Foo), nodeOps.createElement('div'))
    expect(
      `Component emitted event "foo" but it is neither declared`,
    ).not.toHaveBeenWarned()
  })

  // 测试场景：onXxxOnce 监听器在同一组件实例上最多执行一次。
  test('.once', () => {
    const Foo = defineComponent({
      render() {},
      emits: {
        foo: null,
        bar: null,
      },
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

  // 测试场景：.once 与同名的普通监听器。
  test('.once with normal listener of the same name', () => {
    const Foo = defineComponent({
      render() {},
      emits: {
        foo: null,
      },
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

  // 测试场景：.number 修饰符应与组件上的 v-model 一起使用。
  test('.number modifier should work with v-model on component', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:modelValue', '1')
        this.$emit('update:foo', '2')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

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

  // 测试场景：.trim 修饰符应与组件上的 v-model 一起使用。
  test('.trim modifier should work with v-model on component', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:modelValue', ' one ')
        this.$emit('update:foo', '  two  ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

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

  // 测试场景：kebab-case props、camelCase emit 与 v-model.trim 可以协同工作。
  test('.trim modifier should work with v-model on component for kebab-cased props and camelCased emit', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:firstName', ' one ')
      },
    })

    const fn1 = vi.fn()

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

  // 测试场景：.trim 修饰符应与 camelCased props 和 kebab-cased emit 组件上的 v-model 一起使用。
  test('.trim modifier should work with v-model on component for camelCased props and kebab-cased emit', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:model-value', ' one ')
        this.$emit('update:first-name', ' two ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

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

  // 测试场景：props 与 emit 使用混合大小写时，v-model.trim 仍能匹配并转换参数。
  test('.trim modifier should work with v-model on component for mixed cased props and emit', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:base-URL', ' one ')
      },
    })

    const fn1 = vi.fn()

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

  // 测试场景：.trim 和 .number 修饰符应与组件上的 v-model 一起使用。
  test('.trim and .number modifiers should work with v-model on component', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:modelValue', '    +01.2    ')
        this.$emit('update:foo', '    1    ')
      },
    })

    const fn1 = vi.fn()
    const fn2 = vi.fn()

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

  // 测试场景：在组件上使用 v-model 时仅修剪字符串参数。
  test('only trim string parameter when work with v-model on component', () => {
    const Foo = defineComponent({
      render() {},
      created() {
        this.$emit('update:modelValue', ' foo ', { bar: ' bar ' })
      },
    })

    const fn = vi.fn()
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

  // 测试场景：isEmitListener 识别 onXxx props 是否对应组件已声明的 emit。
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
    // .once listeners
    expect(isEmitListener(options, 'onClickOnce')).toBe(true)
    expect(isEmitListener(options, 'onclickOnce')).toBe(false)
    // kebab-case option
    expect(isEmitListener(options, 'onTestEvent')).toBe(true)
    // camelCase option
    expect(isEmitListener(options, 'onFooBar')).toBe(true)
    // PascalCase option
    expect(isEmitListener(options, 'onFooBaz')).toBe(true)
    // event name `once`
    expect(isEmitListener(options, 'onOnce')).toBe(true)
    // event name `once` with `.once` modifier
    expect(isEmitListener(options, 'onOnceOnce')).toBe(true)
  })

  // 测试场景：卸载后没有 emit。
  test('does not emit after unmount', async () => {
    const fn = vi.fn()
    const Foo = defineComponent({
      emits: ['closing'],
      async beforeUnmount() {
        await this.$nextTick()
        this.$emit('closing', true)
      },
      render() {
        return h('div')
      },
    })
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

  // 测试场景：合并字符串数组emits。
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

  // 测试场景：对象形式的 emits 能与 mixin、extends 中的声明正确合并。
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

  // 测试场景：合并 emits 为也用作 mixin 的组件。
  test('merging emits for a component that is also used as a mixin', () => {
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
      created(this) {
        this.$emit('one', 1)
      },
      render,
    })

    const app = createApp({
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
