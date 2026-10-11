import {
  type Ref,
  type SetupContext,
  type VNode,
  h,
  inject,
  nextTick,
  nodeOps,
  onMounted,
  provide,
  ref,
  render,
  serializeInner,
  watch,
} from '@vue/runtime-test'

// 组件的挂载、更新与宿主根节点引用。
describe('renderer: component', () => {
  /** Parent 仅渲染 Child，Child 独立状态从 div 切到 span；检查 DOM 与 Parent VNode.el 都指向新 Child 根，验证高阶组件宿主引用同步。 */
  test('should update parent(hoc) component host el when child component self update', async () => {
    const value = ref(true)
    let parentVnode: VNode
    let childVnode1: VNode
    let childVnode2: VNode

    const Parent = {
      /** 保存并返回 Child 组件 VNode，让测试可比较高阶组件的宿主 el 引用。 */
      render: () => {
        // 保存父组件 VNode，供随后比较其 el。
        return (parentVnode = h(Child))
      },
    }

    const Child = {
      /** 按 value 切换 div/span 并分别保存子 VNode，构造子自更新的根替换。 */
      render: () => {
        return value.value
          ? (childVnode1 = h('div'))
          : (childVnode2 = h('span'))
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div></div>`)
    expect(parentVnode!.el).toBe(childVnode1!.el)

    value.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<span></span>`)
    expect(parentVnode!.el).toBe(childVnode2!.el)
  })

  /** 组件仅渲染 div，父传 id:foo/class:bar；检查宿主属性，验证未声明 attrs 下传单根。 */
  it('should create an Component with props', () => {
    const Comp = {
      /** 提供单 div 根，供父传 id/class attrs 透传。 */
      render: () => {
        return h('div')
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp, { id: 'foo', class: 'bar' }), root)
    expect(serializeInner(root)).toBe(`<div id="foo" class="bar"></div>`)
  })

  /** 组件渲染 div/test，父传 id/class；检查属性及文本同时存在，验证单根 attrs 与自身内容并存。 */
  it('should create an Component with direct text children', () => {
    const Comp = {
      /** 提供 div/test 根，供自身内容与父 attrs 同时提交。 */
      render: () => {
        return h('div', 'test')
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp, { id: 'foo', class: 'bar' }), root)
    expect(serializeInner(root)).toBe(`<div id="foo" class="bar">test</div>`)
  })

  /** 先挂载渲染 div/foo 的 Comp1，再换成 span/foo 的 Comp2；检查两次输出，验证不同组件类型替换。 */
  it('should update an Component tag which is already mounted', () => {
    const Comp1 = {
      /** 提供旧 div/foo 根，供组件类型替换比较。 */
      render: () => {
        return h('div', 'foo')
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp1), root)
    expect(serializeInner(root)).toBe('<div>foo</div>')

    const Comp2 = {
      /** 提供新 span/foo 根，供组件类型替换比较。 */
      render: () => {
        return h('span', 'foo')
      },
    }
    render(h(Comp2), root)
    expect(serializeInner(root)).toBe('<span>foo</span>')
  })

  // #2072
  /** 声明 emits:foo 的组件先后收到不同 onFoo 函数；检查 updated 未调用，验证只改声明事件监听器不触发组件更新。 */
  it('should not update Component if only changed props are declared emit listeners', () => {
    const Comp1 = {
      emits: ['foo'],
      updated: vi.fn(),
      /** 返回 null，仅让 updated spy 观察声明事件监听器变化。 */
      render: () => null,
    }
    const root = nodeOps.createElement('div')
    render(
      h(Comp1, {
        /** 第一份空 foo 监听器，以函数身份构造初次组件输入。 */
        onFoo: () => {},
      }),
      root,
    )
    render(
      h(Comp1, {
        /** 第二份空 foo 监听器，以不同函数身份构造仅事件监听器变化。 */
        onFoo: () => {},
      }),
      root,
    )
    expect(Comp1.updated).not.toHaveBeenCalled()
  })

  // #2043
  /** 父提供 ref:0，Child setup 注入后同步加1；检查首次父0/子1、刷新后都为1，验证挂载期间子写父状态会安排父重渲染。 */
  test('component child synchronously updating parent state should trigger parent re-render', async () => {
    const App = {
      /** 创建并 provide 父级 n:0，返回同时读取 n 和挂载 Child 的 render。 */
      setup() {
        const n = ref(0)
        provide('foo', n)
        return () => {
          return [h('div', n.value), h(Child)]
        }
      },
    }

    const Child = {
      /** 注入父 ref 并在 setup 同步递增，返回读取该 ref 的 div，构造挂载期间写父状态。 */
      setup() {
        const n = inject<Ref<number>>('foo')!
        n.value++

        return () => {
          return h('div', n.value)
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div>0</div><div>1</div>`)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1</div><div>1</div>`)
  })

  // #2170
  /** 组件分别监听 testProp 与 testData，挂载后修改 prop 再修改 data；检查两种回调都收到公共实例 $el，验证 Options watcher 的宿主访问。 */
  test('instance.$el should be exposed to watch options', async () => {
    /** 返回调用者 this；spy 主要记录传入的 $el，函数不改变实例。 */
    function returnThis(this: any, _arg: any) {
      return this
    }
    const propWatchSpy = vi.fn(returnThis)
    const dataWatchSpy = vi.fn(returnThis)
    let instance: any
    const Comp = {
      props: {
        testProp: String,
      },

      /** 提供初始 undefined 的 testData，供 Options watcher 监听。 */
      data() {
        return {
          testData: undefined,
        }
      },

      watch: {
        /** 把 this.$el 交给 propWatchSpy，供检查 prop watcher 的宿主访问。 */
        testProp() {
          // @ts-expect-error
          propWatchSpy(this.$el)
        },
        /** 把 this.$el 交给 dataWatchSpy，供检查 data watcher 的宿主访问。 */
        testData() {
          // @ts-expect-error
          dataWatchSpy(this.$el)
        },
      },

      /** 保存公共实例 this，供后续修改 data 与比较 $el。 */
      created() {
        instance = this
      },

      /** 提供单 div 根，供 watcher 获取稳定宿主节点。 */
      render() {
        return h('div')
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    await nextTick()
    expect(propWatchSpy).not.toHaveBeenCalled()
    expect(dataWatchSpy).not.toHaveBeenCalled()

    render(h(Comp, { testProp: 'prop ' }), root)
    await nextTick()
    expect(propWatchSpy).toHaveBeenCalledWith(instance.$el)

    instance.testData = 1
    await nextTick()
    expect(dataWatchSpy).toHaveBeenCalledWith(instance.$el)
  })

  // #2200
  /** 父 outer 变化作为 Child prop，Child pre watcher emit 写回父 inner；刷新后检查两处都为1，验证 pre 阶段写父状态不会丢更新。 */
  test('component child updating parent state in pre-flush should trigger parent re-render', async () => {
    const outer = ref(0)
    const App = {
      /** 创建父 inner 并接收 Child update 事件，返回同时显示 inner 与传 outer prop 的子树。 */
      setup() {
        const inner = ref(0)

        return () => {
          return [
            h('div', inner.value),
            h(Child, {
              value: outer.value,
              /** 将 Child emit 的载荷写回父 inner，构造 pre watcher 同步写父状态。 */
              onUpdate: (val: number) => (inner.value = val),
            }),
          ]
        }
      },
    }

    const Child = {
      props: ['value'],
      /** 监听 props.value 并 emit update，返回该 prop 的 div，构造 pre watcher 写父状态。 */
      setup(props: any, { emit }: SetupContext) {
        watch(
          () => props.value,
          (val: number) => emit('update', val),
        )

        return () => {
          return h('div', props.value)
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div>0</div><div>0</div>`)

    outer.value++
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1</div><div>1</div>`)
  })

  /** 父子都读取同一 ref，父同时把它作 count prop；递增后检查调用列表只新增一次父/子渲染，验证多路径触发去重。 */
  test('child only updates once when triggered in multiple ways', async () => {
    const a = ref(0)
    const calls: string[] = []

    const Parent = {
      /** 返回记录父渲染并传 count/插槽的函数，两条依赖都读取 a。 */
      setup() {
        return () => {
          calls.push('render parent')
          return h(Child, { count: a.value }, () => a.value)
        }
      },
    }

    const Child = {
      props: ['count'],
      /** 返回记录子渲染并同时读取 props.count 与 a 的函数，构造多路径更新。 */
      setup(props: any) {
        return () => {
          calls.push('render child')
          return `${props.count} - ${a.value}`
        }
      },
    }

    render(h(Parent), nodeOps.createElement('div'))
    expect(calls).toEqual(['render parent', 'render child'])

    // 同一 ref 既直接触发子 render，也通过父传 prop 触发子更新。
    a.value++
    await nextTick()
    expect(calls).toEqual([
      'render parent',
      'render child',
      'render parent',
      'render child',
    ])
  })

  // #7745
  /** Parent 局部计数变化触发 Child watcher 写全局计数；检查父、watcher、子、根的精确调用序列，验证追加父更新没有重复子渲染。 */
  test(`an earlier update doesn't lead to excessive subsequent updates`, async () => {
    const globalCount = ref(0)
    const parentCount = ref(0)
    const calls: string[] = []

    const Root = {
      /** 返回记录根渲染并传 globalCount prop 的函数，供追加父任务顺序比较。 */
      setup() {
        return () => {
          calls.push('render root')
          return h(Parent, { count: globalCount.value })
        }
      },
    }

    const Parent = {
      props: ['count'],
      /** 返回读取全局/传入 count 并传 parentCount 给 Child 的 render，记录父执行顺序。 */
      setup(props: any) {
        return () => {
          calls.push('render parent')
          return [
            `${globalCount.value} - ${props.count}`,
            h(Child, { count: parentCount.value }),
          ]
        }
      },
    }

    const Child = {
      props: ['count'],
      /** 监听 props.count 写回 globalCount 并记录 watcher；render 另记子执行，构造更新期间写祖先状态。 */
      setup(props: any) {
        watch(
          () => props.count,
          () => {
            calls.push('child watcher')
            globalCount.value = props.count
          },
        )

        return () => {
          calls.push('render child')
        }
      },
    }

    render(h(Root), nodeOps.createElement('div'))
    expect(calls).toEqual(['render root', 'render parent', 'render child'])

    parentCount.value++
    await nextTick()
    expect(calls).toEqual([
      'render root',
      'render parent',
      'render child',
      'render parent',
      'child watcher',
      'render child',
      'render root',
      'render parent',
    ])
  })

  // #2521
  /** Child 的 immediate watcher 与 created 读取其 count，随后只改 Child count；检查 App.updated 始终0次，验证 Options 初始化不把子状态收进父依赖。 */
  test('should pause tracking deps when initializing legacy options', async () => {
    let childInstance = null as any
    const Child = {
      props: ['foo'],
      /** 初始化 Child.count:0，供检查初始化期间依赖隔离。 */
      data() {
        return {
          count: 0,
        }
      },
      watch: {
        foo: {
          immediate: true,
          /** immediate watcher 读取 this.count，故意构造 Options 初始化的依赖读取。 */
          handler() {
            ;(this as any).count
          },
        },
      },
      /** 保存 Child 公共实例并读取 count，供验证 created 的依赖读取不会订阅父。 */
      created() {
        childInstance = this as any
        childInstance.count
      },
      /** 渲染 Child 自身 count，保证后续递增只更新 Child。 */
      render() {
        return h('h1', (this as any).count)
      },
    }

    const App = {
      /** 返回挂载 Child 的 render，父自身不读取 Child.count。 */
      setup() {
        return () => h(Child)
      },
      updated: vi.fn(),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(App.updated).toHaveBeenCalledTimes(0)

    childInstance.count++
    await nextTick()
    expect(App.updated).toHaveBeenCalledTimes(0)
  })

  // 渲染时的组件公开属性访问缓存。
  describe('render with access caches', () => {
    // #3297
    /** 生产态 data() 在返回 foo:1 前读取 this.foo，挂载后检查 h1/1，验证过早读取未缓存缺失结果。 */
    test('should not set the access cache in the data() function (production mode)', () => {
      const Comp = {
        /** 先读尚未返回的 this.foo，再提供 foo:1，构造访问缓存过早缺失。 */
        data() {
          ;(this as any).foo
          return { foo: 1 }
        },
        /** 从公开代理读取 foo 渲染 h1，检查初始化后的解析结果。 */
        render() {
          return h('h1', (this as any).foo)
        },
      }
      const root = nodeOps.createElement('div')

      __DEV__ = false
      render(h(Comp), root)
      __DEV__ = true
      expect(serializeInner(root)).toBe(`<h1>1</h1>`)
    })
  })

  /** 同一组件 VNode 数组复用三次后卸载，检查三根输出与连续独立 uid 的卸载记录，验证复用创建三个实例。 */
  test('the component VNode should be cloned when reusing it', () => {
    const App = {
      /** 创建一份组件 VNode 数组并重复返回三次，构造已使用 VNode 的复用。 */
      render() {
        const c = [h(Comp)]
        return [c, c, c]
      },
    }

    const ids: number[] = []
    const Comp = {
      /** 返回 h1 空根，供同一组件 VNode 复用三次的实例统计。 */
      render: () => h('h1'),
      /** 卸载前记录内部 uid，供确认三个复用位置拥有不同实例。 */
      beforeUnmount() {
        ids.push((this as any).$.uid)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<h1></h1><h1></h1><h1></h1>`)

    render(null, root)
    expect(serializeInner(root)).toBe(``)
    expect(ids).toEqual([ids[0], ids[0] + 1, ids[0] + 2])
  })

  /** 父把 text:0 更新为1，子 render 计数；检查宿主变化且总渲染次数由1到2，验证 props 更新不重复执行子。 */
  test('child component props update should not lead to double update', async () => {
    const text = ref(0)
    const spy = vi.fn()

    const App = {
      /** 把外部 text ref 作为子组件 prop，构造父驱动更新。 */
      render() {
        return h(Comp, { text: text.value })
      },
    }

    const Comp = {
      props: ['text'],
      /** 记录子 render 后输出 this.text，供比较更新次数与 DOM。 */
      render(this: any) {
        spy()
        return h('h1', this.text)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<h1>0</h1>`)
    expect(spy).toHaveBeenCalledTimes(1)

    text.value++
    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>1</h1>`)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  /** setup 标记 __isScriptSetup，render 读取 this.$attrs.id；检查 this 访问警告，验证脚本 setup 模板的开发诊断。 */
  it('should warn accessing `this` in a <script setup> template', () => {
    const App = {
      /** 返回 __isScriptSetup 标记，模拟 script setup 公开状态。 */
      setup() {
        return {
          __isScriptSetup: true,
        }
      },

      /** 通过 this 读取 $attrs.id，故意触发脚本 setup 模板访问诊断。 */
      render(this: any) {
        return this.$attrs.id
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(
      `Property '$attrs' was accessed via 'this'. Avoid using 'this' in templates.`,
    ).toHaveBeenWarned()
  })

  /** ClientOnly mounted 后展开包含动态 span 和固定 style 子组件的插槽，修改文本；检查 span 更新且子 render 仍1次，验证等值 style 不触发子更新。 */
  test('should not update child component if style is not changed', async () => {
    const text = ref(0)
    const spy = vi.fn()

    const ClientOnly = {
      /** mounted 后打开 default 插槽，构造首次空分支与随后插槽渲染。 */
      setup(_: any, { slots }: SetupContext) {
        const mounted = ref(false)
        onMounted(() => {
          mounted.value = true
        })
        return () => {
          if (mounted.value) {
            return slots.default!()
          }
        }
      },
    }

    const App = {
      /** 返回含动态 span 和固定 width 样式子组件的插槽，构造等值 style 重建。 */
      render() {
        return h(ClientOnly, null, {
          /** 返回动态 text span 与固定 width 样式 Comp，构造兄弟文本更新时的等值 style 比较。 */
          default: () => [
            h('span', null, [text.value]),
            h(Comp, { style: { width: '100%' } }),
          ],
        })
      },
    }

    const Comp = {
      /** 调用 spy 后返回 null，只记录子渲染次数。 */
      render(this: any) {
        spy()
        return null
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<!---->`)
    await nextTick()

    expect(serializeInner(root)).toBe(`<span>0</span><!---->`)
    expect(spy).toHaveBeenCalledTimes(1)

    text.value++
    await nextTick()
    expect(serializeInner(root)).toBe(`<span>1</span><!---->`)
    // Comp 的等值 style 不导致额外渲染。
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
