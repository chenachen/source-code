/**
 * 在 runtime-test 父子组件之间接线 props 与 update 事件，观察 model ref、渲染次数和宿主输出。
 * 缺少 prop 或监听器、命名转换、读写转换器及输入值回退用独立夹具验证。
 */
import {
  Fragment,
  type Ref,
  type TestElement,
  createApp,
  createBlock,
  createElementBlock,
  createElementVNode,
  createVNode,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  openBlock,
  ref,
  render,
  serializeInner,
  watch,
} from '@vue/runtime-test'
import { useModel } from '../../src/helpers/useModel'

// useModel 在父子 props、update 事件和本地 model ref 之间同步状态。
describe('useModel', () => {
  // 完整 v-model 接线下，子写入通过 update 事件回流 props，父修改也同步到 model ref。
  test('basic', async () => {
    let foo: any
    /** 把子模型写为 bar，触发 useModel setter，供完整父子回流断言。 */
    const update = () => {
      foo.value = 'bar'
    }

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['modelValue'],
      emits: ['update:modelValue'],
      /** 从 modelValue props 建立模型 ref，返回计数并读取模型的 render。 */
      setup(props) {
        foo = useModel(props, 'modelValue')
        return () => {
          compRender()
          return foo.value
        }
      },
    })

    const msg = ref('')
    const setValue = vi.fn(v => (msg.value = v))
    const root = nodeOps.createElement('div')
    createApp(() =>
      h(Comp, {
        modelValue: msg.value,
        'onUpdate:modelValue': setValue,
      }),
    ).mount(root)

    expect(foo.value).toBe('')
    expect(msg.value).toBe('')
    expect(setValue).not.toBeCalled()
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('')

    // 子级写入。
    update()

    await nextTick()
    expect(msg.value).toBe('bar')
    expect(foo.value).toBe('bar')
    expect(setValue).toBeCalledTimes(1)
    expect(compRender).toBeCalledTimes(2)
    expect(serializeInner(root)).toBe('bar')

    // 父级修改。
    msg.value = 'qux'
    expect(msg.value).toBe('qux')

    await nextTick()
    expect(msg.value).toBe('qux')
    expect(foo.value).toBe('qux')
    expect(setValue).toBeCalledTimes(1)
    expect(compRender).toBeCalledTimes(3)
    expect(serializeInner(root)).toBe('qux')
  })

  // 父只传 update 监听器而不传 prop 时，子立即修改本地值并仍通知监听器。
  test('without parent value (local mutation)', async () => {
    let foo: any
    /** 把未传父值的 foo 模型写为 bar，触发本地修改路径。 */
    const update = () => {
      foo.value = 'bar'
    }

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['foo'],
      emits: ['update:foo'],
      /** 从 foo props 建立模型并在 render 记录次数，观察缺少父值时的本地更新。 */
      setup(props) {
        foo = useModel(props, 'foo')
        return () => {
          compRender()
          return foo.value
        }
      },
    })

    const root = nodeOps.createElement('div')
    const updateFoo = vi.fn()
    render(h(Comp, { 'onUpdate:foo': updateFoo }), root)
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('<!---->')

    expect(foo.value).toBeUndefined()
    update()
    // 父没有传原始 prop 值，允许本地修改。
    expect(foo.value).toBe('bar')

    await nextTick()
    expect(updateFoo).toBeCalledTimes(1)
    expect(compRender).toBeCalledTimes(2)
    expect(serializeInner(root)).toBe('bar')
  })

  // 父只提供初始 prop 而不监听 update 时，子写入立即修改本地值。
  test('without parent listener (local mutation)', async () => {
    let foo: any
    /** 把缺少父监听器的 foo 模型写为 bar，触发本地修改路径。 */
    const update = () => {
      foo.value = 'bar'
    }

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['foo'],
      emits: ['update:foo'],
      /** 从 foo props 建立模型并记录 render 次数，观察缺少父监听器时的更新。 */
      setup(props) {
        foo = useModel(props, 'foo')
        return () => {
          compRender()
          return foo.value
        }
      },
    })

    const root = nodeOps.createElement('div')
    // 父提供初始 prop 值。
    render(h(Comp, { foo: 'initial' }), root)
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('initial')

    expect(foo.value).toBe('initial')
    update()
    // 父没有传 update 监听器，允许本地修改。
    expect(foo.value).toBe('bar')

    await nextTick()
    expect(compRender).toBeCalledTimes(2)
    expect(serializeInner(root)).toBe('bar')
  })

  // 横线 prop 名配合驼峰 update 监听器被识别为完整 v-model，不立即覆盖本地值。
  test('kebab-case v-model (should not be local)', async () => {
    let foo: any

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['foo-bar'],
      emits: ['update:foo-bar'],
      /** 以 foo-bar 名称创建模型并计数渲染，供驼峰监听器匹配测试。 */
      setup(props) {
        foo = useModel(props, 'foo-bar')
        return () => {
          compRender()
          return foo.value
        }
      },
    })

    const updateFooBar = vi.fn()
    const root = nodeOps.createElement('div')
    // v-model:foo-bar 编译为 foo-bar 与 onUpdate:fooBar。
    render(
      h(Comp, { 'foo-bar': 'initial', 'onUpdate:fooBar': updateFooBar }),
      root,
    )
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('initial')

    expect(foo.value).toBe('initial')
    foo.value = 'bar'
    // 完整受控接线下，子值须等待父 prop 回流。
    expect(foo.value).toBe('initial')

    await nextTick()
    expect(compRender).toBeCalledTimes(1)
    expect(updateFooBar).toBeCalledTimes(1)
    expect(updateFooBar).toHaveBeenCalledWith('bar')
    expect(foo.value).toBe('initial')
    expect(serializeInner(root)).toBe('initial')
  })

  // 手写横线 update 监听器也能匹配完整 v-model，子值等待父 prop 回流。
  test('kebab-case update listener (should not be local)', async () => {
    let foo: any

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['foo-bar'],
      emits: ['update:foo-bar'],
      /** 以 foo-bar 名称创建模型并计数渲染，供手写横线监听器匹配测试。 */
      setup(props) {
        foo = useModel(props, 'foo-bar')
        return () => {
          compRender()
          return foo.value
        }
      },
    })

    const updateFooBar = vi.fn()
    const root = nodeOps.createElement('div')
    // 模板编译器通常生成驼峰监听器，这里手写横线名称验证运行时匹配。
    render(
      h(Comp, { 'foo-bar': 'initial', 'onUpdate:foo-bar': updateFooBar }),
      root,
    )
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('initial')

    expect(foo.value).toBe('initial')
    foo.value = 'bar'
    // 完整受控接线下，子值须等待父 prop 回流。
    expect(foo.value).toBe('initial')

    await nextTick()
    expect(compRender).toBeCalledTimes(1)
    expect(updateFooBar).toBeCalledTimes(1)
    expect(updateFooBar).toHaveBeenCalledWith('bar')
    expect(foo.value).toBe('initial')
    expect(serializeInner(root)).toBe('initial')
  })

  // 未传 model prop 时以 prop 默认值初始化，本地写入仍触发 update 监听器。
  test('default value', async () => {
    let count: any
    /** 递增 count 模型 ref，供默认值与本地模式测试。 */
    const inc = () => {
      count.value++
    }

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: { count: { default: 0 } },
      emits: ['update:count'],
      /** 从 count props 创建模型并计数渲染，观察默认0与第一次递增。 */
      setup(props) {
        count = useModel(props, 'count')
        return () => {
          compRender()
          return count.value
        }
      },
    })

    const root = nodeOps.createElement('div')
    const updateCount = vi.fn()
    render(h(Comp, { 'onUpdate:count': updateCount }), root)
    expect(compRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('0')

    expect(count.value).toBe(0)

    inc()
    // 父没有传原始 prop 值，默认值不会关闭本地修改。
    expect(count.value).toBe(1)

    await nextTick()

    expect(updateCount).toBeCalledTimes(1)
    expect(compRender).toBeCalledTimes(2)
    expect(serializeInner(root)).toBe('1')
  })

  // 父 watcher 把负数归零，子 model 通过后续 props 回流读取父级修正值。
  test('parent limiting child value', async () => {
    let childCount: Ref<number>

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['count'],
      emits: ['update:count'],
      /** 从 count props 保存子模型，返回计数并读取模型的 render。 */
      setup(props) {
        childCount = useModel(props, 'count')
        return () => {
          compRender()
          return childCount.value
        }
      },
    })

    const Parent = defineComponent({
      /** 创建父 count 和负数归零 watcher，返回连接 count/update:count 的子组件渲染。 */
      setup() {
        const count = ref(0)
        watch(count, () => {
          if (count.value < 0) {
            count.value = 0
          }
        })
        return () =>
          h(Comp, {
            count: count.value,
            /** 将子 update:count 的载荷写回父 count ref，完成受控模型回流。 */
            'onUpdate:count': val => {
              count.value = val
            },
          })
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toBe('0')

    // 子级写入。
    childCount!.value = 1
    // 父 prop 尚未刷新。
    expect(childCount!.value).toBe(0)

    await nextTick()
    expect(childCount!.value).toBe(1)
    expect(serializeInner(root)).toBe('1')

    // 子级写入负数。
    childCount!.value = -1
    // 父 prop 尚未刷新。
    expect(childCount!.value).toBe(1)

    await nextTick()
    // 父 watcher 已将负数修正为0。
    expect(childCount!.value).toBe(0)
    expect(serializeInner(root)).toBe('0')
  })

  // 父移除 prop 和监听器后，model 先同步为 undefined，后续写入转为本地修改。
  test('has parent value -> no parent value', async () => {
    let childCount: Ref<number>

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['count'],
      emits: ['update:count'],
      /** 从 count props 保存子模型并渲染当前值，供父接线移除后的切换测试。 */
      setup(props) {
        childCount = useModel(props, 'count')
        return () => {
          compRender()
          return childCount.value
        }
      },
    })

    const toggle = ref(true)
    const Parent = defineComponent({
      /** 根据 toggle 决定是否传 count 与监听器，构造受控模式到本地模式的转换。 */
      setup() {
        const count = ref(0)
        return () =>
          toggle.value
            ? h(Comp, {
                count: count.value,
                /** 将子 update:count 的载荷写回父 count ref，完成受控模型回流。 */
                'onUpdate:count': val => {
                  count.value = val
                },
              })
            : h(Comp)
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toBe('0')

    // 子级写入。
    childCount!.value = 1
    // 父 prop 尚未刷新。
    expect(childCount!.value).toBe(0)

    await nextTick()
    expect(childCount!.value).toBe(1)
    expect(serializeInner(root)).toBe('1')

    // 父移除接线。
    toggle.value = false

    await nextTick()
    // 缺失 prop 将本地值同步为 undefined。
    expect(childCount!.value).toBeUndefined()
    expect(serializeInner(root)).toBe('<!---->')

    // 之后子写入按本地模式更新。
    childCount!.value = 2
    expect(childCount!.value).toBe(2)

    await nextTick()
    expect(serializeInner(root)).toBe('2')
  })

  // #9838
  // 优化模式中，model 值经插槽使用，父 prop 回流仍能更新子组件与插槽内容。
  test('pass modelValue to slot (optimized mode) ', async () => {
    let foo: any
    /** 将模型写为 bar，触发优化插槽场景的父级回流。 */
    const update = () => {
      foo.value = 'bar'
    }

    const Comp = {
      /** 直接调用 default 插槽，构造模型在插槽中被读取的组件。 */
      render(this: any) {
        return this.$slots.default()
      },
    }

    const childRender = vi.fn()
    const slotRender = vi.fn()
    const Child = defineComponent({
      props: ['modelValue'],
      emits: ['update:modelValue'],
      /** 从 modelValue 创建模型，返回带 STABLE 插槽的 Fragment，并分别记录子渲染与插槽调用。 */
      setup(props) {
        foo = useModel(props, 'modelValue')
        return () => {
          childRender()
          return (
            openBlock(),
            createElementBlock(Fragment, null, [
              createVNode(Comp, null, {
                /** 计数插槽调用并返回读取模型值的 div VNode，观察优化模式下的模型依赖更新。 */
                default: () => {
                  slotRender()
                  return createElementVNode('div', null, foo.value)
                },
                _: 1 /* STABLE */,
              }),
            ])
          )
        }
      },
    })

    const msg = ref('')
    const setValue = vi.fn(v => (msg.value = v))
    const root = nodeOps.createElement('div')
    createApp({
      /** 构造仅 modelValue 为动态 prop 的 Child block，连接父 msg 与 update 监听器。 */
      render() {
        return (
          openBlock(),
          createBlock(
            Child,
            {
              modelValue: msg.value,
              'onUpdate:modelValue': setValue,
            },
            null,
            8 /* PROPS */,
            ['modelValue'],
          )
        )
      },
    }).mount(root)

    expect(foo.value).toBe('')
    expect(msg.value).toBe('')
    expect(setValue).not.toBeCalled()
    expect(childRender).toBeCalledTimes(1)
    expect(slotRender).toBeCalledTimes(1)
    expect(serializeInner(root)).toBe('<div></div>')

    // 子级写入。
    update()

    await nextTick()
    expect(msg.value).toBe('bar')
    expect(foo.value).toBe('bar')
    expect(setValue).toBeCalledTimes(1)
    expect(childRender).toBeCalledTimes(2)
    expect(slotRender).toBeCalledTimes(2)
    expect(serializeInner(root)).toBe('<div>bar</div>')
  })

  // v-model 修饰符配合 get/set 转换器，分别转换组件读取值与发给父级的值。
  test('with modifiers & transformers', async () => {
    let childMsg: Ref<string>
    let childModifiers: Record<string, true | undefined>

    const compRender = vi.fn()
    const Comp = defineComponent({
      props: ['msg', 'msgModifiers'],
      emits: ['update:msg'],
      /** 解构模型及修饰符，安装小写读取/大写写入转换，再返回计数渲染模型的函数。 */
      setup(props) {
        ;[childMsg, childModifiers] = useModel(props, 'msg', {
          /** 把父传入值转换为小写供组件读取，不修改父模型。 */
          get(val) {
            return val.toLowerCase()
          },
          /** upper 修饰符存在时把子输入转换为大写，作为 emit 载荷；其他情况返回 undefined。 */
          set(val) {
            if (childModifiers.upper) {
              return val.toUpperCase()
            }
          },
        })
        return () => {
          compRender()
          return childMsg.value
        }
      },
    })

    const msg = ref('HI')
    const Parent = defineComponent({
      /** 将父 msg 与 upper 修饰符传给 Comp，并把 update:msg 写回父 ref。 */
      setup() {
        return () =>
          h(Comp, {
            msg: msg.value,
            msgModifiers: { upper: true },
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
            },
          })
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    // 读取转换器返回小写。
    expect(serializeInner(root)).toBe('hi')

    // 子级写入。
    childMsg!.value = 'Hmm'

    await nextTick()
    expect(childMsg!.value).toBe('hmm')
    expect(serializeInner(root)).toBe('hmm')
    // 父收到大写 emit 载荷。
    expect(msg.value).toBe('HMM')

    // 父级修改。
    msg.value = 'Ughh'
    await nextTick()
    expect(serializeInner(root)).toBe('ughh')
    expect(msg.value).toBe('Ughh')

    // 子级再次写入。
    childMsg!.value = 'ughh'
    await nextTick()
    expect(msg.value).toBe('UGHH')
  })

  // #10279
  // setter 把不同输入折叠成同一值时，强制子更新修正 input；重复同一输入不再次更新。
  test('force local update when setter formats value to the same value', async () => {
    let childMsg: Ref<string>
    let childModifiers: Record<string, true | undefined>

    const compRender = vi.fn()
    const parentRender = vi.fn()

    const Comp = defineComponent({
      props: ['msg', 'msgModifiers'],
      emits: ['update:msg'],
      /** 安装数字字符过滤 setter，返回模拟 v-model 的 input 与渲染计数。 */
      setup(props) {
        ;[childMsg, childModifiers] = useModel(props, 'msg', {
          /** number 修饰符存在时删除非数字字符，产生供父级 number 转换处理的载荷。 */
          set(val) {
            if (childModifiers.number) {
              return val.replace(/\D+/g, '')
            }
          },
        })
        return () => {
          compRender()
          return h('input', {
            // 用 VNode 钩子模拟 v-model 的 value 写回。
            /** 挂载 input 前把模型值写入测试宿主的 value，模拟 v-model 指令。 */
            onVnodeBeforeMount(vnode) {
              ;(vnode.el as TestElement).props.value = childMsg.value
            },
            /** 更新 input 前把模型值写回测试宿主 value，供格式化回退断言。 */
            onVnodeBeforeUpdate(vnode) {
              ;(vnode.el as TestElement).props.value = childMsg.value
            },
            /** 把模拟输入值写入子模型，触发 useModel setter。 */
            onInput(value: any) {
              childMsg.value = value
            },
          })
        }
      },
    })

    const msg = ref(1)
    const Parent = defineComponent({
      /** 计数父渲染并连接 msg、number 修饰符与 update:msg 写回。 */
      setup() {
        return () => {
          parentRender()
          return h(Comp, {
            msg: msg.value,
            msgModifiers: { number: true },
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
            },
          })
        }
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    expect(parentRender).toHaveBeenCalledTimes(1)
    expect(compRender).toHaveBeenCalledTimes(1)
    expect(serializeInner(root)).toBe('<input value=1></input>')

    const input = root.children[0] as TestElement

    // 同时修改宿主 value 并通知模型，模拟输入。
    input.props.onInput((input.props.value = '2'))
    await nextTick()
    expect(msg.value).toBe(2)
    expect(parentRender).toHaveBeenCalledTimes(2)
    expect(compRender).toHaveBeenCalledTimes(2)
    expect(serializeInner(root)).toBe('<input value=2></input>')

    input.props.onInput((input.props.value = '2a'))
    await nextTick()
    expect(msg.value).toBe(2)
    expect(parentRender).toHaveBeenCalledTimes(2)
    // 转换载荷没变，但子 input 需修正为模型值。
    expect(compRender).toHaveBeenCalledTimes(3)
    expect(serializeInner(root)).toBe('<input value=2></input>')

    input.props.onInput((input.props.value = '2a'))
    await nextTick()
    expect(parentRender).toHaveBeenCalledTimes(2)
    // 重复同一原始输入不再强制子更新。
    expect(compRender).toHaveBeenCalledTimes(3)
  })

  // #13524
  // 多个输入事件在父更新前恢复原 model 值，子仍更新 input 以清除中间输入文本。
  test('force local update when an intermediate model value is reverted before parent update', async () => {
    let childMsg: Ref<string>

    const compRender = vi.fn()
    const parentRender = vi.fn()

    const Comp = defineComponent({
      props: ['msg'],
      emits: ['update:msg'],
      /** 创建 msg 模型，返回 input 的模型监听和恢复原值监听，构造同一批输入往返。 */
      setup(props) {
        childMsg = useModel(props, 'msg')
        return () => {
          compRender()
          return h('input', {
            // 用 VNode 钩子模拟 v-model 的 value 写回。
            /** 挂载前写入模型值，模拟 input 的 v-model 提交。 */
            onVnodeBeforeMount(vnode) {
              ;(vnode.el as TestElement).props.value = childMsg.value
            },
            /** 更新前写回模型值，清理同批事件留下的中间输入文本。 */
            onVnodeBeforeUpdate(vnode) {
              ;(vnode.el as TestElement).props.value = childMsg.value
            },
            /** 把本次输入值写入子模型，模拟模型监听器。 */
            onModelInput(value: any) {
              childMsg.value = value
            },
            /** 把模型立即恢复为 a，模拟同事件的另一个监听器。 */
            onInput() {
              childMsg.value = 'a'
            },
          })
        }
      },
    })

    const msg = ref('a')
    const Parent = defineComponent({
      /** 计数父渲染并将 msg/update:msg 接线，观察往返值的单批更新。 */
      setup() {
        return () => {
          parentRender()
          return h(Comp, {
            msg: msg.value,
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
            },
          })
        }
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    expect(parentRender).toHaveBeenCalledTimes(1)
    expect(compRender).toHaveBeenCalledTimes(1)
    expect(serializeInner(root)).toBe('<input value="a"></input>')

    const input = root.children[0] as TestElement

    // 模拟浏览器在同事件监听器之间不刷新微任务。
    ;['ab', 'ac', 'ad'].forEach(value => {
      input.props.onModelInput((input.props.value = value))
      input.props.onInput()
    })
    await nextTick()

    expect(msg.value).toBe('a')
    expect(parentRender).toHaveBeenCalledTimes(2)
    expect(compRender).toHaveBeenCalledTimes(2)
    expect(serializeInner(root)).toBe('<input value="a"></input>')
  })

  // 第一次写入未变值不 emit；同一批先修改再恢复原值时，两次 update 都通知父级。
  test('set no change value', async () => {
    let changeChildMsg!: (val: string) => void

    const setValue = vi.fn()
    const Comp = defineComponent({
      props: ['msg'],
      emits: ['update:msg'],
      /** 创建 msg 模型并暴露写入闭包，返回模型文本供受控值去重测试。 */
      setup(props) {
        const childMsg = useModel(props, 'msg')
        /** 把用例传入值写入闭包中的子模型 ref，暴露 setter 操作而不直接写父模型。 */
        changeChildMsg = (val: string) => (childMsg.value = val)
        return () => {
          return childMsg.value
        }
      },
    })

    const defaultVal = 'defaultVal'
    const msg = ref(defaultVal)
    const Parent = defineComponent({
      /** 将子 emit 值写回父 msg 并调用 setValue，供通知次数比较。 */
      setup() {
        return () =>
          h(Comp, {
            msg: msg.value,
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
              setValue()
            },
          })
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    expect(setValue).toBeCalledTimes(0)

    changeChildMsg(defaultVal)
    expect(setValue).toBeCalledTimes(0)

    changeChildMsg('changed')
    changeChildMsg(defaultVal)
    expect(setValue).toBeCalledTimes(2)
    expect(msg.value).toBe(defaultVal)
  })

  // #11526
  // 自定义 getter 转换读取值，setter 将组件写入值反向转换后通知父级。
  test('custom getter', () => {
    let changeChildMsg!: (val: boolean) => void
    /** 反转布尔父值，供读取转换与 setter 对称性的测试。 */
    const getter = (value: boolean) => !value

    const Comp = defineComponent({
      props: ['msg'],
      emits: ['update:msg'],
      /** 创建反转读写的模型并暴露写入闭包，返回转换后的子值。 */
      setup(props) {
        const childMsg = useModel(props, 'msg', {
          get: getter,
          /** 反转布尔子输入作为 update 载荷，与自定义 getter 构成对称转换。 */
          set: value => !value,
        })
        /** 把用例传入值写入闭包中的子模型 ref，暴露 setter 操作而不直接写父模型。 */
        changeChildMsg = (val: boolean) => (childMsg.value = val)
        return () => {
          return childMsg.value
        }
      },
    })

    const defaultVal = false
    const msg = ref(defaultVal)
    const Parent = defineComponent({
      /** 把子 update:msg 结果写回父 ref，供自定义 getter 测试。 */
      setup() {
        return () =>
          h(Comp, {
            msg: msg.value,
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
            },
          })
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    changeChildMsg(!getter(msg.value))
    expect(msg.value).toBe(true)

    changeChildMsg(!getter(msg.value))
    expect(msg.value).toBe(false)
  })

  // #11541
  // 自定义 setter 可把重复输入转换为 null，父级监听器收到该转换结果。
  test('custom setter', () => {
    let changeChildMsg!: (val: boolean) => void

    const Comp = defineComponent({
      props: ['msg'],
      emits: ['update:msg'],
      /** 安装与父当前值相同时返回 null 的 setter，并暴露模型写入闭包。 */
      setup(props) {
        const childMsg = useModel(props, 'msg', {
          /** 反转布尔子输入作为 update 载荷，与自定义 getter 构成对称转换。 */
          set: value => {
            if (value === msg.value) {
              return null
            } else {
              return value
            }
          },
        })
        /** 把用例传入值写入闭包中的子模型 ref，暴露 setter 操作而不直接写父模型。 */
        changeChildMsg = (val: boolean) => (childMsg.value = val)
        return () => {
          return childMsg.value
        }
      },
    })

    const defaultVal = false
    const msg = ref(defaultVal)
    const Parent = defineComponent({
      /** 把 setter 转换结果写回父 msg，供重复输入转换成 null 的断言。 */
      setup() {
        return () =>
          h(Comp, {
            msg: msg.value,
            /** 将子 update:msg 载荷原样写回父 msg ref，完成该转换器场景的受控回流。 */
            'onUpdate:msg': val => {
              msg.value = val
            },
          })
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    changeChildMsg(true)
    expect(msg.value).toBe(true)

    changeChildMsg(true)
    expect(msg.value).toBe(null)
  })
})
