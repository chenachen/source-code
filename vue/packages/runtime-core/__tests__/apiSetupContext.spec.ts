/**
 * 测试阅读说明：本文件验证 `runtime-core/apiSetupContext` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { reactive, ref } from '@vue/reactivity'
import {
  type TestElement,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  render,
  renderToString,
  serializeInner,
  triggerEvent,
  watchEffect,
} from '@vue/runtime-test'

// 测试组：api：setup 上下文。
describe('api: setup context', () => {
  // 测试场景：应该将返回值暴露给模板渲染上下文。
  it('should expose return values to template render context', () => {
    const Comp = defineComponent({
      setup() {
        return {
          // ref should auto-unwrap
          ref: ref('foo'),
          // object exposed as-is
          object: reactive({ msg: 'bar' }),
          // primitive value exposed as-is
          value: 'baz',
        }
      },
      render() {
        return `${this.ref} ${this.object.msg} ${this.value}`
      },
    })
    expect(renderToString(h(Comp))).toMatch(`foo bar baz`)
  })

  // 测试场景：应该支持返回渲染函数。
  it('should support returning render function', () => {
    const Comp = {
      setup() {
        return () => {
          return h('div', 'hello')
        }
      },
    }
    expect(renderToString(h(Comp))).toMatch(`hello`)
  })

  // 测试场景：setup 接收的 props 保持浅只读，并随父组件输入更新。
  it('props', async () => {
    const count = ref(0)
    let dummy

    const Parent = {
      render: () => h(Child, { count: count.value }),
    }

    const Child = defineComponent({
      props: { count: Number },
      setup(props) {
        watchEffect(() => {
          dummy = props.count
        })
        return () => h('div', props.count)
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div>0</div>`)
    expect(dummy).toBe(0)

    // props should be reactive
    count.value++
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>1</div>`)
    expect(dummy).toBe(1)
  })

  // 测试场景：上下文.attrs。
  it('context.attrs', async () => {
    const toggle = ref(true)

    const Parent = {
      render: () => h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' }),
    }

    const Child = {
      // explicit empty props declaration
      // puts everything received in attrs
      // disable implicit fallthrough
      inheritAttrs: false,
      setup(props: any, { attrs }: any) {
        return () => h('div', attrs)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div id="foo"></div>`)

    // should update even though it's not reactive
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div class="baz"></div>`)
  })

  // #4161
  // 测试场景：子组件slots中的context.attrs。
  it('context.attrs in child component slots', async () => {
    const toggle = ref(true)

    const Parent = {
      render: () => h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' }),
    }

    const Wrapper = {
      render(this: any) {
        return this.$slots.default()
      },
    }

    const Child = {
      inheritAttrs: false,
      setup(_: any, { attrs }: any) {
        return () => {
          const vnode = h(Wrapper, null, {
            default: () => [h('div', attrs)],
            _: 1, // mark stable slots
          })
          vnode.dynamicChildren = [] // force optimized mode
          return vnode
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div id="foo"></div>`)

    // should update even though it's not reactive
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div class="baz"></div>`)
  })

  // 测试场景：上下文.slots。
  it('context.slots', async () => {
    const id = ref('foo')

    const Parent = {
      render: () =>
        h(Child, null, {
          foo: () => id.value,
          bar: () => 'bar',
        }),
    }

    const Child = {
      setup(props: any, { slots }: any) {
        return () => h('div', [...slots.foo(), ...slots.bar()])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div>foobar</div>`)

    // should update even though it's not reactive
    id.value = 'baz'
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>bazbar</div>`)
  })

  // 测试场景：setup context.emit 能正确派发组件事件并传递参数。
  it('context.emit', async () => {
    const count = ref(0)
    const spy = vi.fn()

    const Parent = {
      render: () =>
        h(Child, {
          count: count.value,
          onInc: (newVal: number) => {
            spy()
            count.value = newVal
          },
        }),
    }

    const Child = defineComponent({
      props: {
        count: {
          type: Number,
          default: 1,
        },
      },
      setup(props, { emit }) {
        return () =>
          h(
            'div',
            {
              onClick: () => emit('inc', props.count + 1),
            },
            props.count,
          )
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div>0</div>`)

    // emit should trigger parent handler
    triggerEvent(root.children[0] as TestElement, 'click')
    expect(spy).toHaveBeenCalled()
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>1</div>`)
  })
})
