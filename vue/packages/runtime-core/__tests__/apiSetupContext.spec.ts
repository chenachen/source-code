/**
 * 通过 setup 返回值与上下文驱动渲染，检查 props、attrs、slots 更新及 emit 到父监听器的传参。
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

// setup 的返回值，以及 props、attrs、slots、emit 上下文。
describe('api: setup context', () => {
  // setup 返回 ref、响应式对象与普通值，渲染通过 this 读取；ref 自动解包，对象仍可读取内部字段。
  it('should expose return values to template render context', () => {
    const Comp = defineComponent({
      /**
       * 返回 `ref`、`object`、`value` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          // 公共实例自动解包 ref 的 value。
          ref: ref('foo'),
          // 对象仍保留响应式引用，通过内部 msg 属性读取。
          object: reactive({ msg: 'bar' }),
          // 普通值直接进入 setupState。
          value: 'baz',
        }
      },
      /**
       * 渲染结果为 `` `${this.ref} ${this.object.msg} ${this.value}` ``。
       */
      render() {
        return `${this.ref} ${this.object.msg} ${this.value}`
      },
    })
    expect(renderToString(h(Comp))).toMatch(`foo bar baz`)
  })

  // setup 返回渲染函数，该函数直接作为组件 render 并输出 hello。
  it('should support returning render function', () => {
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `h('div', 'hello')`。
       */
      setup() {
        return () => {
          return h('div', 'hello')
        }
      },
    }
    expect(renderToString(h(Comp))).toMatch(`hello`)
  })

  // setup 捕获的 props 随父组件 count 更新，watchEffect 与渲染函数都读取到新值。
  it('props', async () => {
    const count = ref(0)
    let dummy

    const Parent = {
      /**
       * 渲染结果为 `h(Child, { count: count.value })`。
       */
      render: () => h(Child, { count: count.value }),
    }

    const Child = defineComponent({
      props: { count: Number },
      /**
       * 调用 `watchEffect(() => { dummy = props.count; })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', props.count)`。
       */
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

    // 父级 count 改变后，同一 setup props 视图与 watchEffect 都取得新值。
    count.value++
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>1</div>`)
    expect(dummy).toBe(1)
  })

  // Child 未声明 props 且关闭自动透传，显式把 attrs 传给 div；父级切换输入后删除 id 并添加 class。
  it('context.attrs', async () => {
    const toggle = ref(true)

    const Parent = {
      /**
       * 渲染结果为 `h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' })`。
       */
      render: () => h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' }),
    }

    const Child = {
      // 未声明 props，收到的输入全部进入 attrs；关闭自动透传后由 render 显式绑定。
      inheritAttrs: false,
      /**
       * 返回渲染闭包，执行时产出 `h('div', attrs)`。
       */
      setup(props: any, { attrs }: any) {
        return () => h('div', attrs)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div id="foo"></div>`)

    // 容器映射保持引用，依赖变化与父级更新仍应刷新子树。
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div class="baz"></div>`)
  })

  // #4161
  // attrs 在转交给 Wrapper 的稳定 slot 内读取；父级切换输入后，优化模式下的子树仍更新 id/class。
  it('context.attrs in child component slots', async () => {
    const toggle = ref(true)

    const Parent = {
      /**
       * 渲染结果为 `h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' })`。
       */
      render: () => h(Child, toggle.value ? { id: 'foo' } : { class: 'baz' }),
    }

    const Wrapper = {
      /**
       * 渲染结果为 `this.$slots.default()`。
       */
      render(this: any) {
        return this.$slots.default()
      },
    }

    const Child = {
      inheritAttrs: false,
      /**
       * 返回渲染闭包，执行时产出 `vnode`。
       */
      setup(_: any, { attrs }: any) {
        return () => {
          const vnode = h(Wrapper, null, {
            /**
             * 默认插槽 返回 `[h('div', attrs)]`。
             */
            default: () => [h('div', attrs)],
            _: 1, // mark stable slots
          })
          vnode.dynamicChildren = [] // 提供动态子列表以走 optimized 更新路径。
          return vnode
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div id="foo"></div>`)

    // 容器映射保持引用，依赖变化与父级更新仍应刷新子树。
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div class="baz"></div>`)
  })

  // 子组件渲染调用 foo、bar slots；foo 内读取的 id 改变后，子组件输出从 foobar 更新为 bazbar。
  it('context.slots', async () => {
    const id = ref('foo')

    const Parent = {
      /**
       * 渲染结果为 `h(Child, null, { foo: () => id.value, bar: () => 'bar', })`。
       */
      render: () =>
        h(Child, null, {
          /**
           * 返回 `id.value`。
           */
          foo: () => id.value,
          /**
           * 返回 `'bar'`。
           */
          bar: () => 'bar',
        }),
    }

    const Child = {
      /**
       * 返回渲染闭包，执行时产出 `h('div', [...slots.foo(), ...slots.bar()])`。
       */
      setup(props: any, { slots }: any) {
        return () => h('div', [...slots.foo(), ...slots.bar()])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div>foobar</div>`)

    // 容器映射保持引用，依赖变化与父级更新仍应刷新子树。
    id.value = 'baz'
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>bazbar</div>`)
  })

  // 点击 Child 后，emit 把 count + 1 交给父监听器，父级改值再驱动 Child 从 0 渲染为 1。
  it('context.emit', async () => {
    const count = ref(0)
    const spy = vi.fn()

    const Parent = {
      /**
       * 渲染结果为 `h(Child, { count: count.value, onInc: (newVal: number) => { spy(); count.value = newVal; }, })`。
       */
      render: () =>
        h(Child, {
          count: count.value,
          /**
           * 修改或记录 `count.value`；执行 `spy()`。
           */
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
      /**
       * 返回渲染闭包，执行时产出 `h('div', { onClick: () => emit('inc', props.count + 1), }, props.count)`。
       */
      setup(props, { emit }) {
        return () =>
          h(
            'div',
            {
              /**
               * 返回 `emit('inc', props.count + 1)`。
               */
              onClick: () => emit('inc', props.count + 1),
            },
            props.count,
          )
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toMatch(`<div>0</div>`)

    // 点击时发送 inc，由父监听器把新值写回 count。
    triggerEvent(root.children[0] as TestElement, 'click')
    expect(spy).toHaveBeenCalled()
    await nextTick()
    expect(serializeInner(root)).toMatch(`<div>1</div>`)
  })
})
