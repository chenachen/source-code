/**
 * 从组件 ref、父实例引用和 app.mount 返回值观察 expose 的可见字段与内置公共属性。
 */
import { createApp, nodeOps, render } from '@vue/runtime-test'
import { defineComponent, h, ref } from '../src'

// expose 约束外部取得的组件公共实例。
describe('api: expose', () => {
  // setup 调用 expose 后，组件 ref 只读到公开的 foo、bar；bar ref 自动解包，未公开的 baz 不可见。
  test('via setup context', () => {
    const Child = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 调用 `expose({ foo: 1, bar: ref(2), })` 完成本例的初始化登记或读取；返回 `bar`、`baz` 作为后续渲染可读的绑定。
       */
      setup(_, { expose }) {
        expose({
          foo: 1,
          bar: ref(2),
        })
        return {
          bar: ref(3),
          baz: ref(4),
        }
      },
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect(childRef.value.foo).toBe(1)
    expect(childRef.value.bar).toBe(2)
    expect(childRef.value.baz).toBeUndefined()
  })

  // expose 选项列出 data 的 foo 和 setup 的 bar，组件 ref 可读二者并解包 bar，不能读取 baz。
  test('via options', () => {
    const Child = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
      /**
       * 返回 `bar`、`baz` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          bar: ref(2),
          baz: ref(3),
        }
      },
      expose: ['foo', 'bar'],
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect(childRef.value.foo).toBe(1)
    expect(childRef.value.bar).toBe(2)
    expect(childRef.value.baz).toBeUndefined()
  })

  // expose 选项与 setup 的 expose 合并公开字段，组件 ref 同时可读 foo、bar，baz 仍不可见。
  test('options + context', () => {
    const Child = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      expose: ['foo'],
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
      /**
       * 调用 `expose({ bar: ref(2), })` 完成本例的初始化登记或读取；返回 `bar`、`baz` 作为后续渲染可读的绑定。
       */
      setup(_, { expose }) {
        expose({
          bar: ref(2),
        })
        return {
          bar: ref(3),
          baz: ref(4),
        }
      },
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect(childRef.value.foo).toBe(1)
    expect(childRef.value.bar).toBe(2)
    expect(childRef.value.baz).toBeUndefined()
  })

  // expose: [] 仍返回可用的组件 ref，但 data 中的 foo 不对外公开。
  test('options: empty', () => {
    const Child = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      expose: [],
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect('foo' in childRef.value).toBe(false)
  })

  // expose: [] 不阻止 setup 再调用 expose，组件 ref 仍能读取显式公开的 foo。
  test('options: empty + setup context', () => {
    const Child = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      expose: [],
      /**
       * 调用 `expose({ foo: 1, })` 完成本例的初始化登记或读取。
       */
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
      },
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect(childRef.value.foo).toBe(1)
  })

  // 子组件通过 $parent 与 $root 获得父组件的暴露代理，只能读取公开的 foo。
  test('with $parent/$root', () => {
    const Child = defineComponent({
      /**
       * 渲染阶段执行 `expect((this.$parent! as any).foo).toBe(1)`、`expect((this.$parent! as any).bar).toBe(undefined)`、`expect((this.$root! as any).foo).toBe(1)`；不返回宿主内容。
       */
      render() {
        expect((this.$parent! as any).foo).toBe(1)
        expect((this.$parent! as any).bar).toBe(undefined)
        expect((this.$root! as any).foo).toBe(1)
        expect((this.$root! as any).bar).toBe(undefined)
      },
    })

    const Parent = defineComponent({
      expose: [],
      /**
       * 调用 `expose({ foo: 1, })` 完成本例的初始化登记或读取；返回 `bar` 作为后续渲染可读的绑定。
       */
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
        return {
          bar: 2,
        }
      },
      /**
       * 渲染结果为 `h(Child)`。
       */
      render() {
        return h(Child)
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
  })

  // app.mount 返回根组件的暴露代理，可读取 expose 的 foo，不能读取未公开的 setup 字段 bar。
  test('with mount', () => {
    const Component = defineComponent({
      /**
       * 调用 `expose({ foo: 1, })` 完成本例的初始化登记或读取；返回 `bar` 作为后续渲染可读的绑定。
       */
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
        return {
          bar: 2,
        }
      },
      /**
       * 渲染结果为 `h('div')`。
       */
      render() {
        return h('div')
      },
    })
    const root = nodeOps.createElement('div')
    const vm = createApp(Component).mount(root) as any
    expect(vm.foo).toBe(1)
    expect(vm.bar).toBe(undefined)
  })

  // 公开 foo 后仍可访问 $el；孙组件的 $parent 指向该暴露代理，父级与根级引用保持正确关系。
  test('expose should allow access to built-in instance properties', () => {
    const GrandChild = defineComponent({
      /**
       * 渲染结果为 `h('div')`。
       */
      render() {
        return h('div')
      },
    })

    const grandChildRef = ref()
    const Child = defineComponent({
      /**
       * 渲染结果为 `h('div')`。
       */
      render() {
        return h('div')
      },
      /**
       * 调用 `expose({ foo: 42, })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(GrandChild, { ref: grandChildRef })`。
       */
      setup(_, { expose }) {
        expose({
          foo: 42,
        })
        return () => h(GrandChild, { ref: grandChildRef })
      },
    })

    const childRef = ref()
    const Parent = {
      /**
       * 返回渲染闭包，执行时产出 `h(Child, { ref: childRef })`。
       */
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect('$el' in childRef.value).toBe(true)
    expect(childRef.value.$el.tag).toBe('div')
    expect('foo' in childRef.value).toBe(true)
    expect('$parent' in grandChildRef.value).toBe(true)
    expect(grandChildRef.value.$parent).toBe(childRef.value)
    expect(grandChildRef.value.$parent.$parent).toBe(grandChildRef.value.$root)
  })

  // 直接把 ref 传给 expose 时，发出“应传入普通对象”的类型警告。
  test('warning for ref', () => {
    const Comp = defineComponent({
      /**
       * 调用 `expose(ref(1))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup(_, { expose }) {
        expose(ref(1))
        return () => null
      },
    })
    render(h(Comp), nodeOps.createElement('div'))
    expect(
      'expose() should be passed a plain object, received ref',
    ).toHaveBeenWarned()
  })

  // 直接把数组传给 expose 时，发出“应传入普通对象”的类型警告。
  test('warning for array', () => {
    const Comp = defineComponent({
      /**
       * 调用 `expose(['focus'])` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup(_, { expose }) {
        expose(['focus'])
        return () => null
      },
    })
    render(h(Comp), nodeOps.createElement('div'))
    expect(
      'expose() should be passed a plain object, received array',
    ).toHaveBeenWarned()
  })

  // 直接把函数传给 expose 时，发出“应传入普通对象”的类型警告。
  test('warning for function', () => {
    const Comp = defineComponent({
      /**
       * 调用 `expose(() => null)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup(_, { expose }) {
        expose(() => null)
        return () => null
      },
    })
    render(h(Comp), nodeOps.createElement('div'))
    expect(
      'expose() should be passed a plain object, received function',
    ).toHaveBeenWarned()
  })
})
