/**
 * 测试阅读说明：本文件验证 `runtime-core/apiExpose` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { createApp, nodeOps, render } from '@vue/runtime-test'
import { defineComponent, h, ref } from '../src'

// 测试组：api：暴露。
describe('api: expose', () => {
  // 测试场景：通过setup上下文。
  test('via setup context', () => {
    const Child = defineComponent({
      render() {},
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

  // 测试场景：通过选项。
  test('via options', () => {
    const Child = defineComponent({
      render() {},
      data() {
        return {
          foo: 1,
        }
      },
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

  // 测试场景：选项+上下文。
  test('options + context', () => {
    const Child = defineComponent({
      render() {},
      expose: ['foo'],
      data() {
        return {
          foo: 1,
        }
      },
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

  // 测试场景：选项：空。
  test('options: empty', () => {
    const Child = defineComponent({
      render() {},
      expose: [],
      data() {
        return {
          foo: 1,
        }
      },
    })

    const childRef = ref()
    const Parent = {
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect('foo' in childRef.value).toBe(false)
  })

  // 测试场景：选项：空 + setup 上下文。
  test('options: empty + setup context', () => {
    const Child = defineComponent({
      render() {},
      expose: [],
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
      },
    })

    const childRef = ref()
    const Parent = {
      setup() {
        return () => h(Child, { ref: childRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(childRef.value).toBeTruthy()
    expect(childRef.value.foo).toBe(1)
  })

  // 测试场景：与$parent/$root。
  test('with $parent/$root', () => {
    const Child = defineComponent({
      render() {
        expect((this.$parent! as any).foo).toBe(1)
        expect((this.$parent! as any).bar).toBe(undefined)
        expect((this.$root! as any).foo).toBe(1)
        expect((this.$root! as any).bar).toBe(undefined)
      },
    })

    const Parent = defineComponent({
      expose: [],
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
        return {
          bar: 2,
        }
      },
      render() {
        return h(Child)
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Parent), root)
  })

  // 测试场景：带挂载座。
  test('with mount', () => {
    const Component = defineComponent({
      setup(_, { expose }) {
        expose({
          foo: 1,
        })
        return {
          bar: 2,
        }
      },
      render() {
        return h('div')
      },
    })
    const root = nodeOps.createElement('div')
    const vm = createApp(Component).mount(root) as any
    expect(vm.foo).toBe(1)
    expect(vm.bar).toBe(undefined)
  })

  // 测试场景：组件调用 expose 后，外部仍可访问内置公共实例属性。
  test('expose should allow access to built-in instance properties', () => {
    const GrandChild = defineComponent({
      render() {
        return h('div')
      },
    })

    const grandChildRef = ref()
    const Child = defineComponent({
      render() {
        return h('div')
      },
      setup(_, { expose }) {
        expose({
          foo: 42,
        })
        return () => h(GrandChild, { ref: grandChildRef })
      },
    })

    const childRef = ref()
    const Parent = {
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

  // 测试场景：ref 的警告。
  test('warning for ref', () => {
    const Comp = defineComponent({
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

  // 测试场景：数组警告。
  test('warning for array', () => {
    const Comp = defineComponent({
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

  // 测试场景：功能警告。
  test('warning for function', () => {
    const Comp = defineComponent({
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
