import {
  KeepAlive,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  reactive,
  ref,
  render,
  serializeInner,
  shallowRef,
  watch,
} from '@vue/runtime-test'

// 模板 ref 的目标、切换时机、数组维护和异步组件转发。
describe('api: template refs', () => {
  // 字符串 ref 挂载后同步到 setup 返回的同名 Ref。
  it('string ref mount', () => {
    const root = nodeOps.createElement('div')
    const el = ref(null)

    const Comp = {
      /** 把外部 el ref 以 refKey 返回 setupState，供字符串模板 ref 回写。 */
      setup() {
        return {
          refKey: el,
        }
      },
      /** 渲染 ref:refKey 的 div，连接到同名 setup ref。 */
      render() {
        return h('div', { ref: 'refKey' })
      },
    }
    render(h(Comp), root)
    expect(el.value).toBe(root.children[0])
  })

  // 字符串名称从 foo 切到 bar 时，清空旧 Ref 并把节点写入新 Ref。
  it('string ref update', async () => {
    const root = nodeOps.createElement('div')
    const fooEl = ref(null)
    const barEl = ref(null)
    const refKey = ref('foo')

    const Comp = {
      /** 返回 foo/bar 两个 setup ref，供动态名称切换。 */
      setup() {
        return {
          foo: fooEl,
          bar: barEl,
        }
      },
      /** 按 refKey.value 渲染字符串 ref，保持 div 元素类型不变。 */
      render() {
        return h('div', { ref: refKey.value })
      },
    }
    render(h(Comp), root)
    expect(fooEl.value).toBe(root.children[0])
    expect(barEl.value).toBe(null)

    refKey.value = 'bar'
    await nextTick()
    expect(fooEl.value).toBe(null)
    expect(barEl.value).toBe(root.children[0])
  })

  // 字符串 ref 对应的节点卸载后，同名 Ref 清空为 null。
  it('string ref unmount', async () => {
    const root = nodeOps.createElement('div')
    const el = ref(null)
    const toggle = ref(true)

    const Comp = {
      /** 把 el ref 暴露为 refKey，供条件卸载清空。 */
      setup() {
        return {
          refKey: el,
        }
      },
      /** 按 toggle 渲染带字符串 ref 的 div 或 null，构造卸载。 */
      render() {
        return toggle.value ? h('div', { ref: 'refKey' }) : null
      },
    }
    render(h(Comp), root)
    expect(el.value).toBe(root.children[0])

    toggle.value = false
    await nextTick()
    expect(el.value).toBe(null)
  })

  // 函数 ref 在挂载时收到宿主节点。
  it('function ref mount', () => {
    const root = nodeOps.createElement('div')
    const fn = vi.fn()

    const Comp = defineComponent(() => () => h('div', { ref: fn }))
    render(h(Comp), root)
    expect(fn.mock.calls[0][0]).toBe(root.children[0])
  })

  // 更换函数 ref 时，只调用新回调写入当前节点，不额外调用旧回调清空。
  it('function ref update', async () => {
    const root = nodeOps.createElement('div')
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    const fn = ref(fn1)

    const Comp = defineComponent(() => () => h('div', { ref: fn.value }))

    render(h(Comp), root)
    expect(fn1.mock.calls).toHaveLength(1)
    expect(fn1.mock.calls[0][0]).toBe(root.children[0])
    expect(fn2.mock.calls).toHaveLength(0)

    fn.value = fn2
    await nextTick()
    expect(fn1.mock.calls).toHaveLength(1)
    expect(fn2.mock.calls).toHaveLength(1)
    expect(fn2.mock.calls[0][0]).toBe(root.children[0])
  })

  // 节点卸载时，函数 ref 收到 null。
  it('function ref unmount', async () => {
    const root = nodeOps.createElement('div')
    const fn = vi.fn()
    const toggle = ref(true)

    const Comp = defineComponent(
      () => () => (toggle.value ? h('div', { ref: fn }) : null),
    )
    render(h(Comp), root)
    expect(fn.mock.calls[0][0]).toBe(root.children[0])
    toggle.value = false
    await nextTick()
    expect(fn.mock.calls[1][0]).toBe(null)
  })

  // render 直接传入 Ref 对象时，节点写入它的 value。
  it('render function ref mount', () => {
    const root = nodeOps.createElement('div')
    const el = ref(null)

    const Comp = {
      /** 返回直接以 el 作 ref 的 div render，构造对象 ref 设置。 */
      setup() {
        return () => h('div', { ref: el })
      },
    }
    render(h(Comp), root)
    expect(el.value).toBe(root.children[0])
  })

  // 直接 Ref 从 foo 切到 bar 时，旧 value 清空，新 value 指向节点。
  it('render function ref update', async () => {
    const root = nodeOps.createElement('div')
    const refs = {
      foo: ref(null),
      bar: ref(null),
    }
    const refKey = ref<keyof typeof refs>('foo')

    const Comp = {
      /** 返回按 refKey 从 refs 表选择直接 Ref 的 div render，构造对象目标切换。 */
      setup() {
        return () => h('div', { ref: refs[refKey.value] })
      },
    }
    render(h(Comp), root)
    expect(refs.foo.value).toBe(root.children[0])
    expect(refs.bar.value).toBe(null)

    refKey.value = 'bar'
    await nextTick()
    expect(refs.foo.value).toBe(null)
    expect(refs.bar.value).toBe(root.children[0])
  })

  // 直接 Ref 对应的节点卸载后，value 清空为 null。
  it('render function ref unmount', async () => {
    const root = nodeOps.createElement('div')
    const el = ref(null)
    const toggle = ref(true)

    const Comp = {
      /** 返回条件 div/null render，使直接 Ref 在卸载时被清空。 */
      setup() {
        return () => (toggle.value ? h('div', { ref: el }) : null)
      },
    }
    render(h(Comp), root)
    expect(el.value).toBe(root.children[0])

    toggle.value = false
    await nextTick()
    expect(el.value).toBe(null)
  })

  // #12639
  // 同一更新周期内先更新再卸载子组件，取消待执行的 ref 赋值，最终保持 null。
  it('update and unmount child in the same tick', async () => {
    const root = nodeOps.createElement('div')
    const el = ref(null)
    const toggle = ref(true)
    const show = ref(true)

    const Comp = defineComponent({
      emits: ['change'],
      props: ['show'],
      /** 监听 show prop 并 emit change，返回 div/hi，构造更新中通知父卸载。 */
      setup(props, { emit }) {
        watch(
          () => props.show,
          () => {
            emit('change')
          },
        )
        return () => h('div', 'hi')
      },
    })

    const App = {
      /** 以 refKey 暴露 el，供同批更新/卸载后的引用清空。 */
      setup() {
        return {
          refKey: el,
        }
      },
      /** 按 toggle 渲染带字符串 ref 的 Comp，change 处理器关掉 toggle，构造待设置引用的取消。 */
      render() {
        return toggle.value
          ? h(Comp, {
              ref: 'refKey',
              show: show.value,
              /** 收到 Child change 后立即关闭 toggle，触发同批子更新与卸载。 */
              onChange: () => (toggle.value = false),
            })
          : null
      },
    }
    render(h(App), root)
    expect(el.value).not.toBe(null)

    show.value = false
    await nextTick()
    expect(el.value).toBe(null)
  })

  // 同一更新周期内先设置 a 再切换到 b，updated 钩子看到旧目标清空、新目标已赋值。
  it('set and change ref in the same tick', async () => {
    const root = nodeOps.createElement('div')
    const show = ref(false)
    const refName = ref('a')

    const Child = defineComponent({
      /** setup 中把 refName 从 a 改为 b，返回空 render，构造挂载期间 ref 名称变化。 */
      setup() {
        refName.value = 'b'
        return () => {}
      },
    })

    const Comp = {
      /** 把动态 refName 作为 Child 引用，供 a/b 同批切换。 */
      render() {
        return h(Child, {
          ref: refName.value,
        })
      },
      /** updated 内检查旧 a 已清空、新 b 已赋值，验证引用任务早于普通更新钩子。 */
      updated(this: any) {
        expect(this.$refs.a).toBe(null)
        expect(this.$refs.b).not.toBe(null)
      },
    }

    const App = {
      /** 按 show 首次挂载 Comp，触发 Child setup 修改引用键。 */
      render() {
        return show.value ? h(Comp) : null
      },
    }

    render(h(App), root)
    expect(refName.value).toBe('a')

    show.value = true
    await nextTick()
    expect(refName.value).toBe('b')
  })

  // 新 VNode 删除 ref prop 或将它设为 undefined 时，都清空旧 Ref。
  it('unset old ref when new ref is absent', async () => {
    const root1 = nodeOps.createElement('div')
    const root2 = nodeOps.createElement('div')
    const el1 = ref(null)
    const el2 = ref(null)
    const toggle = ref(true)

    const Comp1 = {
      /** 切换是否保留 ref:el1 属性，构造 ref 从存在到完全缺失。 */
      setup() {
        return () => (toggle.value ? h('div', { ref: el1 }) : h('div'))
      },
    }

    const Comp2 = {
      /** 把 el2/undefined 作为 ref 值切换，构造显式空引用。 */
      setup() {
        return () => h('div', { ref: toggle.value ? el2 : undefined })
      },
    }

    render(h(Comp1), root1)
    render(h(Comp2), root2)

    expect(el1.value).toBe(root1.children[0])
    expect(el2.value).toBe(root2.children[0])

    toggle.value = false
    await nextTick()
    expect(el1.value).toBe(null)
    expect(el2.value).toBe(null)
  })

  // 插槽内的字符串 ref 写回声明插槽的组件，mounted 时可从它的 $refs 读取。
  test('string ref inside slots', async () => {
    const root = nodeOps.createElement('div')
    const spy = vi.fn()
    const Child = {
      /** 直接调用 default 插槽，使 ref 所有者来自插槽声明方。 */
      render(this: any) {
        return this.$slots.default()
      },
    }

    const Comp = {
      /** 返回在 Child 插槽内带 foo ref 的 div，构造插槽内字符串引用。 */
      render() {
        return h(Child, () => {
          return h('div', { ref: 'foo' })
        })
      },
      /** 读取声明方 $refs.foo.tag 并交给 spy，供 mounted 引用可见性检查。 */
      mounted(this: any) {
        spy(this.$refs.foo.tag)
      },
    }
    render(h(Comp), root)

    expect(spy).toHaveBeenCalledWith('div')
  })

  // 开发构建仍会写入 setup 返回的 reactive 属性，同时警告该目标不是 Ref。
  it('should work with direct reactive property', () => {
    const root = nodeOps.createElement('div')
    const state = reactive({
      refKey: null,
    })

    const Comp = {
      /** 返回 reactive state 作为 setupState，故意把普通属性作为字符串 ref 目标。 */
      setup() {
        return state
      },
      /** 渲染 refKey 字符串引用，构造非 Ref setup 属性的开发态回写与警告。 */
      render() {
        return h('div', { ref: 'refKey' })
      },
    }
    render(h(Comp), root)
    expect(state.refKey).toBe(root.children[0])
    expect('Template ref "refKey" used on a non-ref value').toHaveBeenWarned()
  })

  // 多根 Fragment 中的三个 ref 分别指向各自元素，跳过 Fragment 起始锚点。
  test('multiple root refs', () => {
    const root = nodeOps.createElement('div')
    const refKey1 = ref(null)
    const refKey2 = ref(null)
    const refKey3 = ref(null)

    const Comp = {
      /** 暴露三个独立 setup ref，供 Fragment 多根定位。 */
      setup() {
        return {
          refKey1,
          refKey2,
          refKey3,
        }
      },
      /** 返回三个带不同字符串 ref 的 div，构造 Fragment 锚点之外的宿主引用。 */
      render() {
        return [
          h('div', { ref: 'refKey1' }),
          h('div', { ref: 'refKey2' }),
          h('div', { ref: 'refKey3' }),
        ]
      },
    }
    render(h(Comp), root)
    expect(refKey1.value).toBe(root.children[1])
    expect(refKey2.value).toBe(root.children[2])
    expect(refKey3.value).toBe(root.children[3])
  })

  // #1505
  // 首次渲染时模板 ref 尚未赋值；赋值触发下一轮更新，模板随后能读取节点属性。
  test('reactive template ref in the same template', async () => {
    const Comp = {
      /** 创建并返回 el ref，供同模板读写引发的后续更新。 */
      setup() {
        const el = ref()
        return { el }
      },
      /** 同时设置 el 字符串引用并读取其 props.id，首次为空、赋值后显示 foo。 */
      render(this: any) {
        return h('div', { id: 'foo', ref: 'el' }, this.el && this.el.props.id)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    // 首次 render 的 ref 尚为空；后续 ref 赋值应安排更新。
    expect(serializeInner(root)).toBe(`<div id="foo"></div>`)
    await nextTick()
    // 引用赋值后的 render 可读取宿主 id。
    expect(serializeInner(root)).toBe(`<div id="foo">foo</div>`)
  })

  // #1834
  // 两个节点交换字符串 ref 名称后，各名称都指向对应的新节点。
  test('exchange refs', async () => {
    const refToggle = ref(false)
    const spy = vi.fn()

    const Comp = {
      /** 按 refToggle 交换 p/i 的 foo/bar 名称，构造先清旧再设新。 */
      render(this: any) {
        return [
          h('p', { ref: refToggle.value ? 'foo' : 'bar' }),
          h('i', { ref: refToggle.value ? 'bar' : 'foo' }),
        ]
      },
      /** mounted 时记录 foo/bar 的标签，供初始引用表比较。 */
      mounted(this: any) {
        spy(this.$refs.foo.tag, this.$refs.bar.tag)
      },
      /** updated 时记录 foo/bar 的标签，供交换后的引用表比较。 */
      updated(this: any) {
        spy(this.$refs.foo.tag, this.$refs.bar.tag)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(spy.mock.calls[0][0]).toBe('i')
    expect(spy.mock.calls[0][1]).toBe('p')
    refToggle.value = true
    await nextTick()
    expect(spy.mock.calls[1][0]).toBe('p')
    expect(spy.mock.calls[1][1]).toBe('i')
  })

  // #1789
  // 同名 ref 从 i 切到 p 时，先清空旧节点，再在 updated 前写入新节点。
  test('toggle the same ref to different elements', async () => {
    const refToggle = ref(false)
    const spy = vi.fn()

    const Comp = {
      /** 按 refToggle 把同名 foo 引用从 i 换到 p，构造目标元素替换。 */
      render(this: any) {
        return refToggle.value ? h('p', { ref: 'foo' }) : h('i', { ref: 'foo' })
      },
      /** mounted 时记录 foo 当前元素标签，供初始 i 断言。 */
      mounted(this: any) {
        spy(this.$refs.foo.tag)
      },
      /** updated 时记录 foo 当前元素标签，供替换后 p 断言。 */
      updated(this: any) {
        spy(this.$refs.foo.tag)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(spy.mock.calls[0][0]).toBe('i')
    refToggle.value = true
    await nextTick()
    expect(spy.mock.calls[1][0]).toBe('p')
  })

  // #2078
  // 以已有组件 VNode 创建新 VNode 时，两个合并的 Ref 同步指向同一实例，并一起切换和清空。
  test('handling multiple merged refs', async () => {
    const Foo = {
      /** 提供 div/foo 根，供合并组件 ref 的初始实例比较。 */
      render: () => h('div', 'foo'),
    }
    const Bar = {
      /** 提供 div/bar 根，供合并组件 ref 的类型切换比较。 */
      render: () => h('div', 'bar'),
    }

    const viewRef = shallowRef<any>(Foo)
    const elRef1 = ref()
    const elRef2 = ref()

    const App = {
      /** 无 view 时返回 null，否则从组件 VNode 再创建 VNode 并追加第二 ref，构造合并引用。 */
      render() {
        if (!viewRef.value) {
          return null
        }
        const view = h(viewRef.value, { ref: elRef1 })
        return h(view, { ref: elRef2 })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(elRef1.value.$el)).toBe('foo')
    expect(elRef1.value).toBe(elRef2.value)

    viewRef.value = Bar
    await nextTick()
    expect(serializeInner(elRef1.value.$el)).toBe('bar')
    expect(elRef1.value).toBe(elRef2.value)

    viewRef.value = null
    await nextTick()
    expect(elRef1.value).toBeNull()
    expect(elRef1.value).toBe(elRef2.value)
  })

  // 模拟 script setup inline 模式的直接 Ref/ref_key 编译输出。
  // 直接 Ref 配合 ref_key，同一节点同时写入 Ref.value 和 $refs 中的字符串键。
  test('raw ref with ref_key', () => {
    let refs: any

    const el = ref()

    const App = {
      /** 保存公共 $refs 对象，供直接 ref_key 的字符串入口比较。 */
      mounted() {
        refs = (this as any).$refs
      },
      /** 渲染直接 el ref 与 ref_key:el 的 div/hello，构造对象和字符串双入口。 */
      render() {
        return h(
          'div',
          {
            ref: el,
            ref_key: 'el',
          },
          'hello',
        )
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(el.value)).toBe('hello')
    expect(serializeInner(refs.el)).toBe('hello')
  })

  // 模拟 v-for 与模板 ref 的编译输出。
  // ref_for 将直接 Ref 维护为节点数组，新增追加、删除移除，整组卸载后清空数组。
  test('ref in v-for', async () => {
    const show = ref(true)
    const list = reactive([1, 2, 3])
    const listRefs = ref([])
    /** 把 listRefs 中的节点内容序列化为数组，供列表增删和整组卸载比较。 */
    const mapRefs = () => listRefs.value.map(n => serializeInner(n))

    const App = {
      /** 按 show 渲染 li 列表，全部使用直接 listRefs/ref_for，构造共享引用数组。 */
      render() {
        return show.value
          ? h(
              'ul',
              list.map(i =>
                h(
                  'li',
                  {
                    ref: listRefs,
                    ref_for: true,
                  },
                  i,
                ),
              ),
            )
          : null
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(mapRefs()).toMatchObject(['1', '2', '3'])

    list.push(4)
    await nextTick()
    expect(mapRefs()).toMatchObject(['1', '2', '3', '4'])

    list.shift()
    await nextTick()
    expect(mapRefs()).toMatchObject(['2', '3', '4'])

    show.value = !show.value
    await nextTick()

    expect(mapRefs()).toMatchObject([])

    show.value = !show.value
    await nextTick()
    expect(mapRefs()).toMatchObject(['2', '3', '4'])
  })

  // v-for 中的字符串 ref 同步维护 setup 返回的同名 Ref 数组。
  test('named ref in v-for', async () => {
    const show = ref(true)
    const list = reactive([1, 2, 3])
    const listRefs = ref([])
    /** 序列化同名字符串列表引用，供内容顺序断言。 */
    const mapRefs = () => listRefs.value.map(n => serializeInner(n))

    const App = {
      /** 将 listRefs 暴露到 setupState，让字符串 ref 可回写同名数组。 */
      setup() {
        return { listRefs }
      },
      /** 按 show 渲染带 listRefs 字符串 ref/ref_for 的 li，构造列表引用维护。 */
      render() {
        return show.value
          ? h(
              'ul',
              list.map(i =>
                h(
                  'li',
                  {
                    ref: 'listRefs',
                    ref_for: true,
                  },
                  i,
                ),
              ),
            )
          : null
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(mapRefs()).toMatchObject(['1', '2', '3'])

    list.push(4)
    await nextTick()
    expect(mapRefs()).toMatchObject(['1', '2', '3', '4'])

    list.shift()
    await nextTick()
    expect(mapRefs()).toMatchObject(['2', '3', '4'])

    show.value = !show.value
    await nextTick()

    expect(mapRefs()).toMatchObject([])

    show.value = !show.value
    await nextTick()
    expect(mapRefs()).toMatchObject(['2', '3', '4'])
  })

  // #6697：检查列表引用在渲染中的响应式表现。
  // 模板读取字符串 ref 对应的节点数组时，数组赋值和删除都能触发视图更新。
  test('named ref in v-for , should be responsive when rendering', async () => {
    const list = ref([1, 2, 3])
    const listRefs = ref([])
    const App = {
      /** 将 listRefs 返回 setupState，供模板同时读取并由 ref_for 写入。 */
      setup() {
        return { listRefs }
      },
      /** 显示 listRefs 字符串并渲染共享字符串 ref 的列表，构造引用数组的响应式视图。 */
      render() {
        return h('div', null, [
          h('div', null, String(listRefs.value)),
          h(
            'ul',
            list.value.map(i =>
              h(
                'li',
                {
                  ref: 'listRefs',
                  ref_for: true,
                },
                i,
              ),
            ),
          ),
        ])
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)

    await nextTick()
    expect(String(listRefs.value)).toBe(
      '[object Object],[object Object],[object Object]',
    )
    expect(serializeInner(root)).toBe(
      '<div><div>[object Object],[object Object],[object Object]</div><ul><li>1</li><li>2</li><li>3</li></ul></div>',
    )

    list.value.splice(0, 1)
    await nextTick()
    expect(String(listRefs.value)).toBe('[object Object],[object Object]')
    expect(serializeInner(root)).toBe(
      '<div><div>[object Object],[object Object]</div><ul><li>2</li><li>3</li></ul></div>',
    )
  })

  // KeepAlive 中的异步组件解析后 ref 指向真实公开实例，缓存重新激活时也恢复该目标。
  test('with async component which nested in KeepAlive', async () => {
    const AsyncComp = defineAsyncComponent(
      () =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve(
              defineComponent({
                /** 异步加载完成后 expose name:AsyncComp，返回 div，供引用指向真实 exposeProxy。 */
                setup(_, { expose }) {
                  expose({
                    name: 'AsyncComp',
                  })
                  return () => h('div')
                },
              }) as any,
            ),
          ),
        ),
    )

    const Comp = defineComponent({
      /** expose name:Comp 并返回 div，供 KeepAlive 同步/异步分支切换比较。 */
      setup(_, { expose }) {
        expose({
          name: 'Comp',
        })
        return () => h('div')
      },
    })

    const toggle = ref(false)
    const instanceRef = ref<any>(null)

    const App = {
      /** 在 KeepAlive 默认插槽中切换同步/异步组件，二者共用 instanceRef，构造缓存激活后的引用恢复。 */
      render: () => {
        return h(KeepAlive, () =>
          toggle.value
            ? h(AsyncComp, { ref: instanceRef })
            : h(Comp, { ref: instanceRef }),
        )
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(instanceRef.value.name).toBe('Comp')

    // 切换到尚未解析的异步组件。
    toggle.value = true
    await nextTick()
    expect(instanceRef.value).toBe(null)

    await new Promise(r => setTimeout(r))
    expect(instanceRef.value.name).toBe('AsyncComp')

    // 切回已缓存的同步组件。
    toggle.value = false
    await nextTick()
    expect(instanceRef.value.name).toBe('Comp')

    // 再次激活已经解析的异步组件。
    toggle.value = true
    await nextTick()
    expect(instanceRef.value.name).toBe('AsyncComp')
  })
})
