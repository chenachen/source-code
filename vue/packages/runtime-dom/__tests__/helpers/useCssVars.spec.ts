import {
  type ComponentOptions,
  type FunctionalComponent,
  Suspense,
  Teleport,
  createStaticVNode,
  defineCustomElement,
  h,
  nextTick,
  onMounted,
  reactive,
  ref,
  render,
  useCssVars,
} from '@vue/runtime-dom'

// 测试组：各fixture在setup注册state→CSS变量getter，更新color后读取真实根节点style；覆盖Fragment、组件、Suspense、Teleport、静态根和钩子读取时机。
describe('useCssVars', () => {
  /** 用getApp(state)创建fixture，state.color从red改green；两次等待更新后遍历所有实际根元素，检查--color随状态变化。 */
  async function assertCssVars(getApp: (state: any) => ComponentOptions) {
    const state = reactive({ color: 'red' })
    const App = getApp(state)
    const root = document.createElement('div')

    render(h(App), root)
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    state.color = 'green'
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('green')
    }
  }

  /** 测试场景：单 div 根组件从 setup 注册 ctx→state 变量 getter；共享 helper 首次检查 --color=red，state.color 改 green 后检查根变量更新。 */
  test('basic', async () => {
    await assertCssVars(state => ({
      /** 执行useCssVars(回调)。setup返回state。 */
      setup() {
        // 变量 getter 接收组件渲染上下文 ctx。
        useCssVars((ctx: any) => ({
          color: ctx.color,
        }))
        return state
      },
      /** 渲染'div'节点。 */
      render() {
        return h('div')
      },
    }))
  })

  /** 测试场景：组件返回两个 div 的 Fragment，注册 state getter；共享 helper 检查每个实际根的 --color 从 red 更新到 green。 */
  test('on fragment root', async () => {
    await assertCssVars(state => ({
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组['div'节点、'div'节点]。 */
      setup() {
        useCssVars(() => state)
        return () => [h('div'), h('div')]
      },
    }))
  })

  /** 测试场景：App 以 HOC Child 为根，Child 返回两个 div；共享 helper 检查变量沿组件子树写到两个实际根，状态更新后均变 green。 */
  test('on HOCs', async () => {
    /** 返回根数组['div'节点、'div'节点]。 */
    const Child = () => [h('div'), h('div')]

    await assertCssVars(state => ({
      /** 执行useCssVars(回调)。setup返回渲染函数：Child节点。 */
      setup() {
        useCssVars(() => state)
        return () => h(Child)
      },
    }))
  })

  /** 测试场景：App 根为 Suspense，异步内容未就绪时检查 fallback 的 --color=red；完成 Promise 并刷新 effects 后检查内容根仍为 red，随后更新为 green。 */
  test('on suspense root', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')

    let resolveAsync: any
    let asyncPromise: any

    const AsyncComp = {
      /** 返回待完成的asyncPromise，把resolveAsync保存为提供default p渲染函数的完成入口；让Suspense先显示fallback。 */
      setup() {
        asyncPromise = new Promise(r => {
          /** 完成保存的async setup Promise并提供输出default p的渲染函数，让Suspense登记的依赖进入提交。 */
          resolveAsync = () => {
            r(() => h('p', 'default'))
          }
        })
        return asyncPromise
      },
    }

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：Suspense节点（null；插槽{default: h(AsyncComp)，fallback: h('div', 'fallback')}）。 */
      setup() {
        useCssVars(() => state)
        return () =>
          h(Suspense, null, {
            default: h(AsyncComp),
            fallback: h('div', 'fallback'),
          })
      },
    }

    render(h(App), root)
    await nextTick()
    // 检查当前可见根元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }
    // 完成 async setup 的等待任务。
    resolveAsync()
    await asyncPromise.then(() => {})
    // 刷新边界放行的 post effects。
    await nextTick()
    // 检查已恢复内容元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    state.color = 'green'
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('green')
    }
  })

  /** 测试场景：已展示的 Suspense div 内初始只有同步 p，show=true 才挂载注册 useCssVars 的异步组件；Promise 完成后子 p 获得 red，随后响应式变量更新为 green。 */
  test('with v-if & async component & suspense', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const show = ref(false)
    let resolveAsync: any
    let asyncPromise: any

    const AsyncComp = {
      /** 先注册state的CSS变量getter，再返回待完成的asyncPromise；保存resolveAsync完成入口，使未完成的异步子组件在resolve后输出default p。 */
      setup() {
        useCssVars(() => state)
        asyncPromise = new Promise(r => {
          /** 完成保存的async setup Promise并提供输出default p的渲染函数，让Suspense登记的依赖进入提交。 */
          resolveAsync = () => {
            r(() => h('p', 'default'))
          }
        })
        return asyncPromise
      },
    }

    const App = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', {}, show.value ? h(AsyncComp) : h('p'))}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', {}, show.value ? h(AsyncComp) : h('p')),
          })
      },
    }

    render(h(App), root)
    await nextTick()
    // 完成 async setup 的等待任务。
    show.value = true
    await nextTick()
    resolveAsync()
    await asyncPromise.then(() => {})
    // 刷新边界放行的 post effects。
    await nextTick()
    // 检查已恢复内容元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect(
        ((c as any).children[0] as HTMLElement).style.getPropertyValue(
          `--color`,
        ),
      ).toBe(`red`)
    }

    state.color = 'green'
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect(
        ((c as any).children[0] as HTMLElement).style.getPropertyValue(
          `--color`,
        ),
      ).toBe('green')
    }
  })

  /** 测试场景：注册变量的组件根从单 div Fragment 变为双 div；更新前后每个实际根都有 --color=red，验证新根补写变量。 */
  test('with subTree changed', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(true)
    const root = document.createElement('div')

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：value.value决定根数组['div'节点]或根数组['div'节点、'div'节点]。 */
      setup() {
        useCssVars(() => state)
        return () => (value.value ? [h('div')] : [h('div'), h('div')])
      },
    }

    render(h(App), root)
    await nextTick()
    // 检查当前可见根元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    value.value = false
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  // #3894
  /** 测试场景：HOC 返回调用方插槽，插槽从单 div 变双 div；变量越过 HOC 写到所有新根，更新后仍为 red。 */
  test('with subTree change inside HOC', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(true)
    const root = document.createElement('div')

    /** 返回slots.default!()。 */
    const Child: FunctionalComponent = (_, { slots }) => slots.default!()

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：Child节点（null；渲染函数：value.value决定根数组['div'节点]或根数组['div'节点、'div'节点]）。 */
      setup() {
        useCssVars(() => state)
        return () =>
          h(Child, null, () =>
            value.value ? [h('div')] : [h('div'), h('div')],
          )
      },
    }

    render(h(App), root)
    await nextTick()
    // 检查当前可见根元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    value.value = false
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：根数组含普通 div 与两根静态 HTML 片段；挂载后每个顶层元素都有 --color=red，验证静态锚点区间遍历。 */
  test('with createStaticVNode', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组['div'节点、createStaticVNode('<div>1</div><div><span>2</span></div>', 2)、'div'节点]。 */
      setup() {
        useCssVars(() => state)
        return () => [
          h('div'),
          createStaticVNode('<div>1</div><div><span>2</span></div>', 2),
          h('div'),
        ]
      },
    }

    render(h(App), root)
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：根子树为指向 body 的 Teleport；挂载后逐个检查目标元素 --color=red，验证远端宿主接受变量。 */
  test('with teleport', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组[Teleport节点（属性{to: target}；根数组['div'节点]）]。 */
      setup() {
        useCssVars(() => state)
        return () => [h(Teleport, { to: target }, [h('div')])]
      },
    }

    render(h(App), root)
    await nextTick()
    for (const c of [].slice.call(target.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：HOC Child 的插槽里放指向 body 的 Teleport；挂载后目标 div 获得 --color=red，验证插槽所属组件的远端变量更新。 */
  test('with teleport in child slot', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    /** 返回'div'节点（slots.default && slots.default()）。 */
    const Child: FunctionalComponent = (_, { slots }) => {
      return h('div', slots.default && slots.default())
    }

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：Child节点（渲染函数：根数组[Teleport节点（属性{to: target}；根数组['div'节点]）]）。 */
      setup() {
        useCssVars(() => state)
        return () => h(Child, () => [h(Teleport, { to: target }, [h('div')])])
      },
    }

    render(h(App), root)
    await nextTick()
    for (const c of [].slice.call(target.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：Teleport 目标初始一 div，toggle=true 新增另一 div；目标元素数从1变2且全部保持 --color=red，验证新远端元素补写变量。 */
  test('with teleport(change subTree)', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body
    const toggle = ref(false)

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组[Teleport节点（属性{to: target}；根数组['div'节点、toggle.value决定'div'节点或null]）]。 */
      setup() {
        useCssVars(() => state)
        return () => [
          h(Teleport, { to: target }, [
            h('div'),
            toggle.value ? h('div') : null,
          ]),
        ]
      },
    }

    render(h(App), root)
    await nextTick()
    expect(target.children.length).toBe(1)
    for (const c of [].slice.call(target.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }

    toggle.value = true
    await nextTick()
    expect(target.children.length).toBe(2)
    for (const c of [].slice.call(target.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：注册变量的 Teleport disabled=true；渲染不抛 TypeError、body 无子元素且主容器元素带 data-v-owner，检查本地挂载的 owner 标记。 */
  test('with teleport(disabled)', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组[Teleport节点（属性{to: target，disabled: true}；根数组['div'节点]）]。 */
      setup() {
        useCssVars(() => state)
        return () => [h(Teleport, { to: target, disabled: true }, [h('div')])]
      },
    }

    expect(() => render(h(App), root)).not.toThrow(TypeError)
    await nextTick()
    expect(target.children.length).toBe(0)
    expect(root.children[0].outerHTML.includes('data-v-owner')).toBe(true)
  })

  /** 测试场景：根 div 初始无 style，随后切换为 pointer-events 字符串；两次检查 --color=red，确认 cssText 更新保留 CSS 变量。 */
  test('with string style', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const disabled = ref(false)

    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：根数组['div'节点（属性{style: disabled.value ? 'pointer-events: none' : undefined}；'foo'）]。 */
      setup() {
        useCssVars(() => state)
        return () => [
          h(
            'div',
            { style: disabled.value ? 'pointer-events: none' : undefined },
            'foo',
          ),
        ]
      },
    }
    render(h(App), root)
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
    disabled.value = true
    await nextTick()

    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  /** 测试场景：根从 span 延迟切成 Child div；更新后新根具有 red，且 Child 的 onMounted 当场读到 red，核对变量写入先于子挂载回调。 */
  test('with delay mount child', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(false)
    const root = document.createElement('div')

    const Child = {
      /** 注册onMounted。setup返回渲染函数：'div'节点（属性{id: 'childId'}）。 */
      setup() {
        onMounted(() => {
          const childEl = root.children[0]
          expect(getComputedStyle(childEl!).getPropertyValue(`--color`)).toBe(
            `red`,
          )
        })
        return () => h('div', { id: 'childId' })
      },
    }
    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：value.value决定Child节点或根数组['span'节点]。 */
      setup() {
        useCssVars(() => state)
        return () => (value.value ? h(Child) : [h('span')])
      },
    }

    render(h(App), root)
    await nextTick()
    // 检查当前可见根元素的 CSS 变量。
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    // 状态切换后才挂载 Child。
    value.value = true
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }
  })

  // #8826
  /** 测试场景：含样式的自定义元素 setup 注册变量 getter；插入文档并等待更新后 host style 含 --color:red，验证变量写到宿主。 */
  test('with custom element', async () => {
    const state = reactive({ color: 'red' })
    const container = document.createElement('div')
    const App = defineCustomElement({
      styles: [`div { color: red; }`],
      /** 执行useCssVars(回调)。setup返回渲染函数：'div'节点（'hello'）。 */
      setup() {
        useCssVars(() => state)
        return () => {
          return h('div', 'hello')
        }
      },
    })
    customElements.define('css-vars-ce', App)
    container.innerHTML = `<css-vars-ce></css-vars-ce>`
    document.body.appendChild(container)
    await nextTick()
    expect(container.innerHTML).toBe(
      `<css-vars-ce style="--color: red;"></css-vars-ce>`,
    )
  })

  /** 测试场景：同一组件先 useCssVars 再注册 onMounted，首次渲染时后注册钩子读取根 --color=red；验证本组件挂载回调的注册顺序。 */
  test('should set vars before child component onMount hook', () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    let colorInOnMount

    const App = {
      /** 先useCssVars注册state变量getter，再注册onMounted读取根--color并保存colorInOnMount；返回div根以核对同组件钩子执行顺序。 */
      setup() {
        useCssVars(() => state)
        onMounted(() => {
          colorInOnMount = (
            root.children[0] as HTMLElement
          ).style.getPropertyValue(`--color`)
        })
        return () => h('div')
      },
    }

    render(h(App), root)
    expect(colorInOnMount).toBe(`red`)
  })

  /** 测试场景：变量 getter 返回 foo=undefined、bar=null；挂载刷新后二者的 CSS 自定义属性均为 initial，仅验证 nullish 转换结果。 */
  test('should set vars as `initial` for nullish values', async () => {
    // getPropertyValue 对空白值的读取结果不适合验证正规化，且 jsdom 的行为与浏览器存在差异；
    // 此例只检查 nullish 值转换为
    // initial 的结果。
    // 字符串值正规化另见 packages/shared/__tests__/cssVars.spec.ts。
    const state = reactive<Record<string, unknown>>({
      foo: undefined,
      bar: null,
    })
    const root = document.createElement('div')
    const App = {
      /** 执行useCssVars(回调)。setup返回渲染函数：'div'节点。 */
      setup() {
        useCssVars(() => state)
        return () => h('div')
      },
    }
    render(h(App), root)
    await nextTick()
    const style = (root.children[0] as HTMLElement).style
    expect(style.getPropertyValue('--foo')).toBe('initial')
    expect(style.getPropertyValue('--bar')).toBe('initial')
  })
})
