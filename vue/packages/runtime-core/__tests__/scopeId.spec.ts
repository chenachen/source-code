import {
  Fragment,
  Suspense,
  createBlock,
  createCommentVNode,
  createVNode,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  openBlock,
  popScopeId,
  pushScopeId,
  ref,
  render,
  renderSlot,
  serializeInner,
  withScopeId,
} from '@vue/runtime-test'
import { withCtx } from '../src/componentRenderContext'
import { PatchFlags } from '@vue/shared'

// VNode 的 scopeId 写入宿主元素，并在组件根和插槽内容之间传递。
describe('scopeId runtime support', () => {
  // 组件渲染的各个元素都带上自身 scopeId。
  test('should attach scopeId', () => {
    const App = {
      __scopeId: 'parent',
      /** 在 parent scopeId 上下文创建嵌套两个 div，供每个元素标记比较。 */
      render: () => h('div', [h('div')]),
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div parent><div parent></div></div>`)
  })

  // 子组件根元素同时带上自己的 scopeId 和父组件 scopeId。
  test('should attach scopeId to components in parent component', () => {
    const Child = {
      __scopeId: 'child',
      /** 在 child scopeId 上下文返回单 div 根，供父/子作用域合并。 */
      render: () => h('div'),
    }
    const App = {
      __scopeId: 'parent',
      /** 在 parent scopeId 下创建 div 与 Child，构造跨组件根标记。 */
      render: () => h('div', [h(Child)]),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(
      `<div parent><div child parent></div></div>`,
    )
  })

  // #5148
  // Suspense 的 fallback 和异步内容解析后的根元素都继承父 scopeId。
  test('should attach scopeId to suspense content', async () => {
    const deps: Promise<any>[] = []
    const Child = {
      /** 等待短延迟 Promise，登记外部 deps 后返回 async 文本 div，构造 Suspense 异步内容。 */
      async setup() {
        const p = new Promise(r => setTimeout(r, 1))
        deps.push(p.then(() => Promise.resolve()))

        await p
        return () => h('div', 'async')
      },
    }

    const Wrapper = {
      /** 把 Child VNode 作为 Component 插槽 prop 传给父 default，构造跨包装层的作用域传递。 */
      setup(_: any, { slots }: any) {
        return () => slots.default({ Component: h(Child) })
      },
    }

    const App = {
      __scopeId: 'parent',
      /** 返回 Wrapper，并在父渲染上下文中创建 Suspense 的内容与 fallback，保留 parent scopeId。 */
      setup() {
        return () =>
          h(Wrapper, null, {
            default: withCtx(({ Component }: any) =>
              h(Suspense, null, {
                default: h(Component),
                fallback: h('div', 'fallback'),
              }),
            ),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div parent>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div parent>async</div>`)
  })

  // :slotted 的基本组合。
  // 插槽内容带声明方 scopeId 和接收方的 slotted scopeId；插槽中的组件根还带自身 scopeId。
  test('should work on slots', () => {
    const Child = {
      __scopeId: 'child',
      /** 把 default 插槽交给 renderSlot 并包 div，构造 child-s 的插槽接收方。 */
      render(this: any) {
        return h('div', renderSlot(this.$slots, 'default'))
      },
    }
    const Child2 = {
      __scopeId: 'child2',
      /** 在 child2 scopeId 下返回 span，供插槽内组件的三种标记比较。 */
      render: () => h('span'),
    }
    const App = {
      __scopeId: 'parent',
      /** 在父 withCtx 插槽中创建 div 与 Child2，再交给 Child，保留插槽声明方作用域。 */
      render: () => {
        return h(
          Child,
          withCtx(() => {
            return [h('div'), h(Child2)]
          }),
        )
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)
    // 插槽内容同时获得：
    // - 声明方 parent 的 scopeId。
    // - 接收方 child 的 child-s 标记。
    expect(serializeInner(root)).toBe(
      `<div child parent>` +
        `<div parent child-s></div>` +
        // 插槽内组件根同时获得：
        // - 模板声明上下文的 scopeId。
        // - 插槽接收方的 slotted scopeId。
        // - 自身组件的 scopeId。
        `<span child2 parent child-s></span>` +
        `</div>`,
    )
  })

  // #2892
  // 转发 slot 时仍传递 slotted scopeId；插槽渲染 Wrapper 时，标记落在它的根元素，不扩散到其子树。
  test(':slotted on forwarded slots', async () => {
    const Wrapper = {
      __scopeId: 'wrapper',
      /** 用 noSlotted:true 转发 default 插槽并包 wrapper div，避免该包装层额外加 slotted 标记。 */
      render(this: any) {
        // <div class="wrapper"><slot/></div>
        return h('div', { class: 'wrapper' }, [
          renderSlot(
            this.$slots,
            'default',
            {},
            undefined,
            true /* noSlotted */,
          ),
        ])
      },
    }

    const Slotted = {
      __scopeId: 'slotted',
      /** 把当前 default 插槽再转交 Wrapper，构造 slotted 的转发链。 */
      render(this: any) {
        // <Wrapper><slot/></Wrapper>
        return h(Wrapper, null, {
          default: withCtx(() => [renderSlot(this.$slots, 'default')]),
        })
      },
    }

    // 模拟 render 外创建的提升节点。
    pushScopeId('root')
    const hoisted = h('div', 'hoisted')
    popScopeId()

    const Root = {
      __scopeId: 'root',
      /** 向 Slotted 返回提升 div 与动态 div，供比较声明方及接收方作用域。 */
      render(this: any) {
        // <Slotted><div>hoisted</div><div>{{ dynamic }}</div></Slotted>
        return h(Slotted, null, {
          default: withCtx(() => {
            return [hoisted, h('div', 'dynamic')]
          }),
        })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Root), root)
    expect(serializeInner(root)).toBe(
      `<div wrapper slotted root class="wrapper">` +
        `<div root slotted-s>hoisted</div>` +
        `<div root slotted-s>dynamic</div>` +
        `</div>`,
    )

    const Root2 = {
      __scopeId: 'root',
      /** 把 Wrapper 组件本身放入 Slotted 插槽，供区分组件根与内部子树的 slotted 传播。 */
      render(this: any) {
        // <Slotted>
        //  <Wrapper>
        //    <div>hoisted</div><div>{{ dynamic }}</div>
        //  </Wrapper>
        // </Slotted>
        return h(Slotted, null, {
          default: withCtx(() => [
            h(Wrapper, null, {
              default: withCtx(() => [hoisted, h('div', 'dynamic')]),
            }),
          ]),
        })
      },
    }
    const root2 = nodeOps.createElement('div')
    render(h(Root2), root2)
    expect(serializeInner(root2)).toBe(
      `<div wrapper slotted root class="wrapper">` +
        `<div wrapper root slotted-s class="wrapper">` +
        `<div root>hoisted</div>` +
        `<div root>dynamic</div>` +
        `</div>` +
        `</div>`,
    )
  })

  // #1988
  // 嵌套函数式组件即使关闭 inheritAttrs，最终根元素仍继承父 scopeId。
  test('should inherit scopeId through nested HOCs with inheritAttrs: false', () => {
    const App = {
      __scopeId: 'parent',
      /** 渲染函数式 Child 高阶组件，构造 parent scopeId 的根传递。 */
      render: () => {
        return h(Child)
      },
    }

    /** 函数式高阶组件将 class:foo 传给 Child2，构造作用域跨两层根传递。 */
    function Child() {
      return h(Child2, { class: 'foo' })
    }

    /** 返回 div 根，外部关闭 inheritAttrs，供区分 scopeId 与 attrs。 */
    function Child2() {
      return h('div')
    }
    Child2.inheritAttrs = false

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div parent></div>`)
  })

  // inheritAttrs: false 时，嵌套 DEV_ROOT_FRAGMENT 中的有效根元素仍继承父 scopeId。
  test('should inherit scopeId through nested DEV_ROOT_FRAGMENT with inheritAttrs: false', async () => {
    const Parent = {
      __scopeId: 'parent',
      /** 带 parent scopeId 渲染 Child，并传 class，构造开发根 Fragment 的父层。 */
      render() {
        return h(Child, { class: 'foo' })
      },
    }

    const ok = ref(true)
    const Child = defineComponent({
      inheritAttrs: false,
      /** 按 ok 切换单元素根与嵌套 DEV_ROOT_FRAGMENT 根，检查有效根仍获得父 scopeId。 */
      render() {
        return (
          openBlock(),
          createBlock(
            Fragment,
            null,
            [
              createCommentVNode('comment1'),
              ok.value
                ? (openBlock(), createBlock('div', { key: 0 }, 'div1'))
                : (openBlock(),
                  createBlock(
                    Fragment,
                    { key: 1 },
                    [
                      createCommentVNode('comment2'),
                      createVNode('div', null, 'div2'),
                    ],
                    PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
                  )),
            ],
            PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
          )
        )
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<!--comment1--><div parent>div1</div>`)

    ok.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<!--comment1--><!--comment2--><div parent>div2</div>`,
    )
  })
})

// 兼容 Vue <=3.0.7 编译产物使用的 withScopeId 包装方式。
describe('backwards compat with <=3.0.7', () => {
  const withParentId = withScopeId('parent')
  const withChildId = withScopeId('child')

  // withScopeId 包装的渲染函数仍为各个元素写入 scopeId。
  test('should attach scopeId', () => {
    const App = {
      __scopeId: 'parent',
      render: withParentId(() => {
        return h('div', [h('div')])
      }),
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div parent><div parent></div></div>`)
  })

  // 旧式 withScopeId 包装下，子组件根元素也同时带自身和父 scopeId。
  test('should attach scopeId to components in parent component', () => {
    const Child = {
      __scopeId: 'child',
      render: withChildId(() => {
        return h('div')
      }),
    }
    const App = {
      __scopeId: 'parent',
      render: withParentId(() => {
        return h('div', [h(Child)])
      }),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(
      `<div parent><div child parent></div></div>`,
    )
  })

  // 旧式 withScopeId 包装下，插槽内容仍带声明方和 slotted scopeId。
  test('should work on slots', () => {
    const Child = {
      __scopeId: 'child',
      render: withChildId(function (this: any) {
        return h('div', renderSlot(this.$slots, 'default'))
      }),
    }
    const withChild2Id = withScopeId('child2')
    const Child2 = {
      __scopeId: 'child2',
      render: withChild2Id(() => h('span')),
    }
    const App = {
      __scopeId: 'parent',
      render: withParentId(() => {
        return h(
          Child,
          withParentId(() => {
            return [h('div'), h(Child2)]
          }),
        )
      }),
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)
    // 插槽内容同时获得：
    // - 声明方 parent 的 scopeId。
    // - 接收方 child 的 child-s 标记。
    expect(serializeInner(root)).toBe(
      `<div child parent>` +
        `<div parent child-s></div>` +
        // 插槽内组件根同时获得：
        // - 模板声明上下文的 scopeId。
        // - 插槽接收方的 slotted scopeId。
        // - 自身组件的 scopeId。
        `<span child2 parent child-s></span>` +
        `</div>`,
    )
  })

  // #1988
  // 旧式 withScopeId 包装与嵌套函数式组件、inheritAttrs: false 一起使用时仍继承父 scopeId。
  test('should inherit scopeId through nested HOCs with inheritAttrs: false', () => {
    const withParentId = withScopeId('parent')
    const App = {
      __scopeId: 'parent',
      render: withParentId(() => {
        return h(Child)
      }),
    }

    /** 旧 withScopeId 夹具的函数式高阶组件，将 class 传给 Child2。 */
    function Child() {
      return h(Child2, { class: 'foo' })
    }

    /** 旧 withScopeId 夹具的终端 div 根，外部关闭 inheritAttrs。 */
    function Child2() {
      return h('div')
    }
    Child2.inheritAttrs = false

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div parent></div>`)
  })

  // render 外创建的提升节点通过 pushScopeId/popScopeId 保留创建时的 scopeId。
  test('hoisted nodes', async () => {
    pushScopeId('foobar')
    const hoisted = h('div', 'hello')
    popScopeId()

    const App = {
      __scopeId: 'foobar',
      /** 把创建于 foobar 作用域的 hoisted 节点放入 div，供提升节点标记保留。 */
      render: () => h('div', [hoisted]),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(root)).toBe(
      `<div foobar><div foobar>hello</div></div>`,
    )
  })
})
