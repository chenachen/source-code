/**
 * 测试阅读说明：本文件验证 `runtime-dom/helpers/useCssVars` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
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

// 测试组：useCssVars 将响应式 CSS 变量同步到不同组件根节点的行为。
describe('useCssVars', () => {
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

  // 测试场景：组件状态变化时，把 useCssVars 生成的变量写入并更新根元素 style。
  test('basic', async () => {
    await assertCssVars(state => ({
      setup() {
        // test receiving render context
        useCssVars((ctx: any) => ({
          color: ctx.color,
        }))
        return state
      },
      render() {
        return h('div')
      },
    }))
  })

  // 测试场景：组件根为 Fragment 时，把 CSS 变量应用到其中每个实际元素根。
  test('on fragment root', async () => {
    await assertCssVars(state => ({
      setup() {
        useCssVars(() => state)
        return () => [h('div'), h('div')]
      },
    }))
  })

  // 测试场景：组件被高阶组件（HOC）包裹时，CSS 变量仍能定位实际 DOM 根节点。
  test('on HOCs', async () => {
    const Child = () => [h('div'), h('div')]

    await assertCssVars(state => ({
      setup() {
        useCssVars(() => state)
        return () => h(Child)
      },
    }))
  })

  // 测试场景：组件根为 Suspense 时，在内容分支切换后继续同步 CSS 变量。
  test('on suspense root', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')

    let resolveAsync: any
    let asyncPromise: any

    const AsyncComp = {
      setup() {
        asyncPromise = new Promise(r => {
          resolveAsync = () => {
            r(() => h('p', 'default'))
          }
        })
        return asyncPromise
      },
    }

    const App = {
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
    // css vars use with fallback tree
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }
    // AsyncComp resolve
    resolveAsync()
    await asyncPromise.then(() => {})
    // Suspense effects flush
    await nextTick()
    // css vars use with default tree
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    state.color = 'green'
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('green')
    }
  })

  // 测试场景：带有 v-if & 异步组件 & suspense。
  test('with v-if & async component & suspense', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const show = ref(false)
    let resolveAsync: any
    let asyncPromise: any

    const AsyncComp = {
      setup() {
        useCssVars(() => state)
        asyncPromise = new Promise(r => {
          resolveAsync = () => {
            r(() => h('p', 'default'))
          }
        })
        return asyncPromise
      },
    }

    const App = {
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', {}, show.value ? h(AsyncComp) : h('p')),
          })
      },
    }

    render(h(App), root)
    await nextTick()
    // AsyncComp resolve
    show.value = true
    await nextTick()
    resolveAsync()
    await asyncPromise.then(() => {})
    // Suspense effects flush
    await nextTick()
    // css vars use with default tree
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

  // 测试场景：组件 subTree 根节点更换后，把变量迁移到新的实际元素。
  test('with subTree changed', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(true)
    const root = document.createElement('div')

    const App = {
      setup() {
        useCssVars(() => state)
        return () => (value.value ? [h('div')] : [h('div'), h('div')])
      },
    }

    render(h(App), root)
    await nextTick()
    // css vars use with fallback tree
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
  // 测试场景：用subTree改里面的HOC。
  test('with subTree change inside HOC', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(true)
    const root = document.createElement('div')

    const Child: FunctionalComponent = (_, { slots }) => slots.default!()

    const App = {
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
    // css vars use with fallback tree
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    value.value = false
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe('red')
    }
  })

  // 测试场景：根节点来自 createStaticVNode 时，也能找到静态片段中的元素并写入变量。
  test('with createStaticVNode', async () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')

    const App = {
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

  // 测试场景：根子树含 Teleport 时，同时更新目标容器中的远端元素变量。
  test('with teleport', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    const App = {
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

  // 测试场景：子slot中带有teleport。
  test('with teleport in child slot', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    const Child: FunctionalComponent = (_, { slots }) => {
      return h('div', slots.default && slots.default())
    }

    const App = {
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

  // 测试场景：含 Teleport 的 subTree 更换后，清理旧目标并更新新目标中的变量。
  test('with teleport(change subTree)', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body
    const toggle = ref(false)

    const App = {
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

  // 测试场景：与 teleport（已禁用）。
  test('with teleport(disabled)', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const target = document.body

    const App = {
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

  // 测试场景：带字符串样式。
  test('with string style', async () => {
    document.body.innerHTML = ''
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    const disabled = ref(false)

    const App = {
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

  // 测试场景：带延迟挂载子项。
  test('with delay mount child', async () => {
    const state = reactive({ color: 'red' })
    const value = ref(false)
    const root = document.createElement('div')

    const Child = {
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
      setup() {
        useCssVars(() => state)
        return () => (value.value ? h(Child) : [h('span')])
      },
    }

    render(h(App), root)
    await nextTick()
    // css vars use with fallback tree
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }

    // mount child
    value.value = true
    await nextTick()
    for (const c of [].slice.call(root.children as any)) {
      expect((c as HTMLElement).style.getPropertyValue(`--color`)).toBe(`red`)
    }
  })

  // #8826
  // 测试场景：带有自定义元素。
  test('with custom element', async () => {
    const state = reactive({ color: 'red' })
    const container = document.createElement('div')
    const App = defineCustomElement({
      styles: [`div { color: red; }`],
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

  // 测试场景：应该在子组件 onMount 钩子之前设置变量。
  test('should set vars before child component onMount hook', () => {
    const state = reactive({ color: 'red' })
    const root = document.createElement('div')
    let colorInOnMount

    const App = {
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

  // 测试场景：应该将 vars 设置为 `initial` 以获得空值。
  test('should set vars as `initial` for nullish values', async () => {
    // `getPropertyValue` cannot reflect the real value for white spaces and JSDOM also
    // doesn't 100% reflect the real behavior of browsers, so we only keep the test for
    // `initial` value here.
    // The value normalization is tested in packages/shared/__tests__/cssVars.spec.ts.
    const state = reactive<Record<string, unknown>>({
      foo: undefined,
      bar: null,
    })
    const root = document.createElement('div')
    const App = {
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
