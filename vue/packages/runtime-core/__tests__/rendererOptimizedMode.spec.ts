import {
  Fragment,
  type FunctionalComponent,
  type SetupContext,
  Teleport,
  type TestElement,
  type VNode,
  createApp,
  createBlock,
  createCommentVNode,
  createElementBlock,
  createElementVNode,
  createTextVNode,
  createVNode,
  defineComponent,
  h,
  serializeInner as inner,
  nextTick,
  nodeOps,
  onBeforeMount,
  onBeforeUnmount,
  onUnmounted,
  openBlock,
  ref,
  render,
  renderList,
  renderSlot,
  serialize,
  setBlockTracking,
  withCtx,
} from '@vue/runtime-test'
import { PatchFlags, SlotFlags, toDisplayString } from '@vue/shared'
import { SuspenseImpl } from '../src/components/Suspense'

// block 动态节点收集、patchFlag 分派与优化回退。
describe('renderer: optimized mode', () => {
  let root: TestElement
  let block: VNode | null = null

  beforeEach(() => {
    root = nodeOps.createElement('div')
    block = null
  })

  /** 先打开 block 再调用 renderChildren，把生成的 VNode 数组作为 div block 挂载并保存 block，供动态数组断言。 */
  const renderWithBlock = (renderChildren: () => VNode[]) => {
    render(
      (openBlock(), (block = createBlock('div', null, renderChildren()))),
      root,
    )
  }

  /** 创建 p/foo block，检查空 dynamicChildren 与宿主输出，验证无动态后代的基本 block。 */
  test('basic use of block', () => {
    render((openBlock(), (block = createBlock('p', null, 'foo'))), root)

    expect(block.dynamicChildren!.length).toBe(0)
    expect(inner(root)).toBe('<p>foo</p>')
  })

  /** 将 p/foo block 放在手写 div 子树中，检查动态数组为空与嵌套输出，验证 block 可出现在普通 VNode 树内。 */
  test('block can appear anywhere in the vdom tree', () => {
    render(
      h('div', (openBlock(), (block = createBlock('p', null, 'foo')))),
      root,
    )

    expect(block.dynamicChildren!.length).toBe(0)
    expect(inner(root)).toBe('<div><p>foo</p></div>')
  })

  /** 在 div block 中创建 TEXT p 与无标记 i，检查只收集 p 且对应宿主为 foo，验证动态标记筛选。 */
  test('block should collect dynamic vnodes', () => {
    renderWithBlock(() => [
      createVNode('p', null, 'foo', PatchFlags.TEXT),
      createVNode('i'),
    ])

    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p>foo</p>',
    )
  })

  /** openBlock(true) 下创建 TEXT p，检查动态数组为空，验证显式禁用本层收集。 */
  test('block can disable tracking', () => {
    render(
      // 关闭本层动态收集。
      (openBlock(true),
      (block = createBlock('div', null, [
        createVNode('p', null, 'foo', PatchFlags.TEXT),
      ]))),
      root,
    )

    expect(block.dynamicChildren!.length).toBe(0)
  })

  /** 父 block 中的子 block 从 key0/p 改为 key1/i，检查父收集子 block、子动态数组为空及新输出，验证嵌套 block 身份替换。 */
  test('block as dynamic children', () => {
    renderWithBlock(() => [
      (openBlock(), createBlock('div', { key: 0 }, [h('p')])),
    ])

    expect(block!.dynamicChildren!.length).toBe(1)
    expect(block!.dynamicChildren![0].dynamicChildren!.length).toBe(0)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<div><p></p></div>',
    )

    renderWithBlock(() => [
      (openBlock(), createBlock('div', { key: 1 }, [h('i')])),
    ])

    expect(block!.dynamicChildren!.length).toBe(1)
    expect(block!.dynamicChildren![0].dynamicChildren!.length).toBe(0)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<div><i></i></div>',
    )
  })

  /** TEXT p 从 foo 更新为 bar，检查输出与动态数组中的 p，验证动态文本补丁。 */
  test('PatchFlags: PatchFlags.TEXT', async () => {
    renderWithBlock(() => [createVNode('p', null, 'foo', PatchFlags.TEXT)])

    expect(inner(root)).toBe('<div><p>foo</p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p>foo</p>',
    )

    renderWithBlock(() => [createVNode('p', null, 'bar', PatchFlags.TEXT)])

    expect(inner(root)).toBe('<div><p>bar</p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p>bar</p>',
    )
  })

  /** CLASS p 的 class 从 foo 改为 bar，检查输出及动态数组，验证动态类补丁。 */
  test('PatchFlags: PatchFlags.CLASS', async () => {
    renderWithBlock(() => [
      createVNode('p', { class: 'foo' }, '', PatchFlags.CLASS),
    ])

    expect(inner(root)).toBe('<div><p class="foo"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p class="foo"></p>',
    )

    renderWithBlock(() => [
      createVNode('p', { class: 'bar' }, '', PatchFlags.CLASS),
    ])

    expect(inner(root)).toBe('<div><p class="bar"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p class="bar"></p>',
    )
  })

  /** STYLE p 从 red 改为 green，检查宿主样式与动态数组，验证动态样式补丁。 */
  test('PatchFlags: PatchFlags.STYLE', async () => {
    renderWithBlock(() => [
      createVNode('p', { style: 'color: red' }, '', PatchFlags.STYLE),
    ])

    expect(inner(root)).toBe('<div><p style="color: red"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p style="color: red"></p>',
    )

    renderWithBlock(() => [
      createVNode('p', { style: 'color: green' }, '', PatchFlags.STYLE),
    ])

    expect(inner(root)).toBe('<div><p style="color: green"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p style="color: green"></p>',
    )
  })

  /** PROPS p 指定 dynamicProps:[id]，id从foo改bar；检查宿主和动态数组，验证指定属性更新。 */
  test('PatchFlags: PatchFlags.PROPS', async () => {
    renderWithBlock(() => [
      createVNode('p', { id: 'foo' }, '', PatchFlags.PROPS, ['id']),
    ])

    expect(inner(root)).toBe('<div><p id="foo"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p id="foo"></p>',
    )

    renderWithBlock(() => [
      createVNode('p', { id: 'bar' }, '', PatchFlags.PROPS, ['id']),
    ])

    expect(inner(root)).toBe('<div><p id="bar"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p id="bar"></p>',
    )
  })

  /** FULL_PROPS 动态键从 foo 改为 bar，检查旧键消失、新键存在，验证键集合变化的完整 props diff。 */
  test('PatchFlags: PatchFlags.FULL_PROPS', async () => {
    let propName = 'foo'

    renderWithBlock(() => [
      createVNode('p', { [propName]: 'dynamic' }, '', PatchFlags.FULL_PROPS),
    ])

    expect(inner(root)).toBe('<div><p foo="dynamic"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p foo="dynamic"></p>',
    )

    propName = 'bar'
    renderWithBlock(() => [
      createVNode('p', { [propName]: 'dynamic' }, '', PatchFlags.FULL_PROPS),
    ])

    expect(inner(root)).toBe('<div><p bar="dynamic"></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p bar="dynamic"></p>',
    )
  })

  /** 固定两项 STABLE_FRAGMENT 的 foo/bar 文本分别重复两次，检查两项动态节点与输出，验证稳定位置更新。 */
  test('PatchFlags: PatchFlags.STABLE_FRAGMENT', async () => {
    let list = ['foo', 'bar']
    render(
      (openBlock(),
      (block = createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode('p', null, item, PatchFlags.TEXT)
        }),
        PatchFlags.STABLE_FRAGMENT,
      ))),
      root,
    )

    expect(inner(root)).toBe('<p>foo</p><p>bar</p>')
    expect(block.dynamicChildren!.length).toBe(2)
    expect(serialize(block.dynamicChildren![0].el as TestElement)).toBe(
      '<p>foo</p>',
    )
    expect(serialize(block.dynamicChildren![1].el as TestElement)).toBe(
      '<p>bar</p>',
    )

    list = list.map(item => item.repeat(2))
    render(
      (openBlock(),
      createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode('p', null, item, PatchFlags.TEXT)
        }),
        PatchFlags.STABLE_FRAGMENT,
      )),
      root,
    )

    expect(inner(root)).toBe('<p>foofoo</p><p>barbar</p>')
    expect(block.dynamicChildren!.length).toBe(2)
    expect(serialize(block.dynamicChildren![0].el as TestElement)).toBe(
      '<p>foofoo</p>',
    )
    expect(serialize(block.dynamicChildren![1].el as TestElement)).toBe(
      '<p>barbar</p>',
    )
  })

  /** UNKEYED_FRAGMENT 从 p/foo 前插 i/bar，检查新顺序与空动态数组，验证列表全量按位置更新。 */
  test('PatchFlags: PatchFlags.UNKEYED_FRAGMENT', async () => {
    const list = [{ tag: 'p', text: 'foo' }]
    render(
      (openBlock(true),
      (block = createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode(item.tag, null, item.text)
        }),
        PatchFlags.UNKEYED_FRAGMENT,
      ))),
      root,
    )

    expect(inner(root)).toBe('<p>foo</p>')
    expect(block.dynamicChildren!.length).toBe(0)

    list.unshift({ tag: 'i', text: 'bar' })
    render(
      (openBlock(true),
      createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode(item.tag, null, item.text)
        }),
        PatchFlags.UNKEYED_FRAGMENT,
      )),
      root,
    )

    expect(inner(root)).toBe('<i>bar</i><p>foo</p>')
    expect(block.dynamicChildren!.length).toBe(0)
  })

  /** KEYED_FRAGMENT 从 p/foo 前插 key:i 的 i/bar，检查顺序与空动态数组，验证列表完整 keyed diff。 */
  test('PatchFlags: PatchFlags.KEYED_FRAGMENT', async () => {
    const list = [{ tag: 'p', text: 'foo' }]
    render(
      (openBlock(true),
      (block = createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode(item.tag, { key: item.tag }, item.text)
        }),
        PatchFlags.KEYED_FRAGMENT,
      ))),
      root,
    )

    expect(inner(root)).toBe('<p>foo</p>')
    expect(block.dynamicChildren!.length).toBe(0)

    list.unshift({ tag: 'i', text: 'bar' })
    render(
      (openBlock(true),
      createBlock(
        Fragment,
        null,
        list.map(item => {
          return createVNode(item.tag, { key: item.tag }, item.text)
        }),
        PatchFlags.KEYED_FRAGMENT,
      )),
      root,
    )

    expect(inner(root)).toBe('<i>bar</i><p>foo</p>')
    expect(block.dynamicChildren!.length).toBe(0)
  })

  /** NEED_PATCH p 没有动态 props，依赖 count 递增；检查 mounted一次、beforeUpdate一次及动态数组，验证仅钩子也需参与更新。 */
  test('PatchFlags: PatchFlags.NEED_PATCH', async () => {
    const spyMounted = vi.fn()
    const spyUpdated = vi.fn()
    const count = ref(0)
    const Comp = {
      /** render 读取 count 建立依赖，并生成带 NEED_PATCH 与 mounted/beforeUpdate hooks 的 p，观察无动态 props 的更新。 */
      setup() {
        return () => {
          count.value
          return (
            openBlock(),
            (block = createBlock('div', null, [
              createVNode(
                'p',
                { onVnodeMounted: spyMounted, onVnodeBeforeUpdate: spyUpdated },
                '',
                PatchFlags.NEED_PATCH,
              ),
            ]))
          )
        }
      },
    }

    render(h(Comp), root)

    expect(inner(root)).toBe('<div><p></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p></p>',
    )
    expect(spyMounted).toHaveBeenCalledTimes(1)
    expect(spyUpdated).toHaveBeenCalledTimes(0)

    count.value++
    await nextTick()

    expect(inner(root)).toBe('<div><p></p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(serialize(block!.dynamicChildren![0].el as TestElement)).toBe(
      '<p></p>',
    )
    expect(spyMounted).toHaveBeenCalledTimes(1)
    expect(spyUpdated).toHaveBeenCalledTimes(1)
  })

  /** 旧 div block 含未收集 p/foo，新 block 标 BAIL 改为 i/bar；检查新输出与 dynamicChildren:null，验证退出快路径。 */
  test('PatchFlags: PatchFlags.BAIL', async () => {
    render(
      (openBlock(),
      (block = createBlock('div', null, [createVNode('p', null, 'foo')]))),
      root,
    )

    expect(inner(root)).toBe('<div><p>foo</p></div>')
    expect(block!.dynamicChildren!.length).toBe(0)

    render(
      (openBlock(),
      (block = createBlock(
        'div',
        null,
        [createVNode('i', null, 'bar')],
        PatchFlags.BAIL,
      ))),
      root,
    )

    expect(inner(root)).toBe('<div><i>bar</i></div>')
    expect(block!.dynamicChildren).toBe(null)
  })

  // #1980
  /** 稳定 slot 经 Comp 转成 div 的普通 children，foo0到1；检查 Fragment 动态层级和新文本，验证插槽展开没有漏收集动态节点。 */
  test('dynamicChildren should be tracked correctly when normalizing slots to plain children', async () => {
    let block: VNode
    const Comp = defineComponent({
      /** 返回带 FORWARDED 插槽的 div block，内部用 renderSlot 转发父 slot 并保存 block 树。 */
      setup(_props, { slots }) {
        return () => {
          const vnode =
            (openBlock(),
            (block = createBlock('div', null, {
              default: withCtx(() => [renderSlot(slots, 'default')]),
              _: SlotFlags.FORWARDED,
            })))

          return vnode
        }
      },
    })

    const foo = ref(0)
    const App = {
      /** 提供稳定插槽，在 Comp 渲染调用时读取 foo 并生成 TEXT p，驱动插槽展开后的文本更新。 */
      setup() {
        return () => {
          return createBlock(Comp, null, {
            default: withCtx(() => [
              createVNode('p', null, foo.value, PatchFlags.TEXT),
            ]),
            // 标记为稳定插槽，保留编译优化条件。
            _: SlotFlags.STABLE,
          })
        }
      },
    }

    render(h(App), root)
    expect(inner(root)).toBe('<div><p>0</p></div>')
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(block!.dynamicChildren![0].type).toBe(Fragment)
    expect(block!.dynamicChildren![0].dynamicChildren!.length).toBe(1)
    expect(
      serialize(
        block!.dynamicChildren![0].dynamicChildren![0].el as TestElement,
      ),
    ).toBe('<p>0</p>')

    foo.value++
    await nextTick()

    expect(inner(root)).toBe('<div><p>1</p></div>')
  })

  // #2169
  /** 动态 STYLE div 内含 Child，挂载后整棵卸载；检查 onBeforeUnmount 仅一次，验证动态树卸载不重复遍历组件。 */
  test('should not perform unnecessary unmount traversals', () => {
    const spy = vi.fn()
    const Child = {
      /** 登记 onBeforeUnmount spy 后返回 child 文本，供重复卸载遍历检测。 */
      setup() {
        onBeforeUnmount(spy)
        return () => 'child'
      },
    }
    /** 将 Child 放在带 STYLE 的动态 div 中再包根 block，构造动态节点与其组件后代。 */
    const Parent = () => (
      openBlock(),
      createBlock('div', null, [
        createVNode('div', { style: {} }, [createVNode(Child)], 4 /* STYLE */),
      ])
    )
    render(h(Parent), root)
    render(null, root)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  /** 已有 foo VNode 内含 Child，再用 createBlock(foo) 挂载并关闭 show；检查 onUnmounted一次，验证复用 block 仍清理组件后代。 */
  test('should call onUnmounted hook for dynamic components receiving an existing vnode w/ component children', async () => {
    const spy = vi.fn()
    const show = ref(1)
    const Child = {
      /** 登记 onUnmounted spy 后返回文本，供已有 VNode block 的卸载清理。 */
      setup() {
        onUnmounted(spy)
        return () => 'child'
      },
    }
    const foo = h('div', null, h(Child))
    const app = createApp({
      /** 按 show 切换含复用 foo VNode block 的子树与 v-if 注释，触发内部 Child 卸载。 */
      render() {
        return show.value
          ? (openBlock(),
            createBlock('div', null, [(openBlock(), createBlock(foo))]))
          : createCommentVNode('v-if', true)
      },
    })

    app.mount(root)
    show.value = 0
    await nextTick()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  // #2444
  /** KEYED_FRAGMENT 与 UNKEYED_FRAGMENT 各含一个组件，挂载后卸载；检查两者卸载前钩子各一次，验证非稳定 Fragment 的完整清理。 */
  test('non-stable Fragment always need to diff its children', () => {
    const spyA = vi.fn()
    const spyB = vi.fn()
    const ChildA = {
      /** 登记 ChildA 卸载前 spy，供 KEYED_FRAGMENT 清理次数检查。 */
      setup() {
        onBeforeUnmount(spyA)
        return () => 'child'
      },
    }
    const ChildB = {
      /** 登记 ChildB 卸载前 spy，供 UNKEYED_FRAGMENT 清理次数检查。 */
      setup() {
        onBeforeUnmount(spyB)
        return () => 'child'
      },
    }
    /** 创建两个禁用本层收集的 key/无 key Fragment，分别含 ChildA/B，供整棵树卸载检查。 */
    const Parent = () => (
      openBlock(),
      createBlock('div', null, [
        (openBlock(true),
        createBlock(
          Fragment,
          null,
          [createVNode(ChildA, { key: 0 })],
          128 /* KEYED_FRAGMENT */,
        )),
        (openBlock(true),
        createBlock(
          Fragment,
          null,
          [createVNode(ChildB)],
          256 /* UNKEYED_FRAGMENT */,
        )),
      ])
    )
    render(h(Parent), root)
    render(null, root)
    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)
  })

  // #2893
  /** Wrapper 手动选取编译 slot 的 Hello/World 组件，state0到1；检查文本切换，验证手动出口后的更新回退。 */
  test('manually rendering the optimized slots should allow subsequent updates to exit the optimized mode correctly', async () => {
    const state = ref(0)

    const CompA = {
      name: 'A',
      /** 用 renderSlot 返回包 div 的 block，供编译插槽通过正常出口渲染。 */
      setup(props: any, { slots }: SetupContext) {
        return () => {
          return (
            openBlock(),
            createBlock('div', null, [renderSlot(slots, 'default')])
          )
        }
      },
    }

    const Wrapper = {
      name: 'Wrapper',
      /** 手动调用 default 插槽并按 state 取其中一个 VNode，构造绕过 renderSlot 的优化回退。 */
      setup(props: any, { slots }: SetupContext) {
        // 手写 render 直接调用编译插槽。
        // 其后更新须使用适合手动调用结果的完整补丁路径。
        return () => {
          return slots.default!()[state.value]
        }
      },
    }

    const app = createApp({
      name: 'App',
      /** 提供 Hello/World 两个稳定编译插槽组件，交给手动选择内容的 Wrapper。 */
      setup() {
        return () => {
          return (
            openBlock(),
            createBlock(Wrapper, null, {
              default: withCtx(() => [
                createVNode(CompA, null, {
                  default: withCtx(() => [createTextVNode('Hello')]),
                  _: 1 /* STABLE */,
                }),
                createVNode(CompA, null, {
                  default: withCtx(() => [createTextVNode('World')]),
                  _: 1 /* STABLE */,
                }),
              ]),
              _: 1 /* STABLE */,
            })
          )
        }
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<div>Hello</div>')

    state.value = 1
    await nextTick()
    expect(inner(root)).toBe('<div>World</div>')
  })

  //#3623
  /** 嵌套两个 Teleport 都指向同一 target，检查源/目标初始输出后卸载；目标应为空，验证优化模式完整清理嵌套传送内容。 */
  test('nested teleport unmount need exit the optimization mode', async () => {
    const target = nodeOps.createElement('div')
    const root = nodeOps.createElement('div')

    render(
      (openBlock(),
      createBlock('div', null, [
        (openBlock(),
        createBlock(
          Teleport as any,
          {
            to: target,
          },
          [
            createVNode('div', null, [
              (openBlock(),
              createBlock(
                Teleport as any,
                {
                  to: target,
                },
                [createVNode('div', null, 'foo')],
              )),
            ]),
          ],
        )),
      ])),
      root,
    )
    await nextTick()
    expect(inner(target)).toMatchInlineSnapshot(
      `"<div><!--teleport start--><!--teleport end--></div><div>foo</div>"`,
    )
    expect(inner(root)).toMatchInlineSnapshot(
      `"<div><!--teleport start--><!--teleport end--></div>"`,
    )

    render(null, root)
    expect(inner(target)).toBe('')
  })

  // #3548
  /** CLASS 表达式内手动调用父编译 slot，检查最终输出与 block/Fragment 动态数组仅包含指定 dynamicVNode，验证表达式调用隔离块收集。 */
  test('should not track dynamic children when the user calls a compiled slot inside template expression', () => {
    const Comp = {
      /** 用 section block 包 renderSlot 并保存 block，供动态数组比较。 */
      setup(props: any, { slots }: SetupContext) {
        return () => {
          return (
            openBlock(),
            (block = createBlock('section', null, [
              renderSlot(slots, 'default'),
            ]))
          )
        }
      },
    }

    let dynamicVNode: VNode
    const Wrapper = {
      /** 创建 CLASS div，其 class 表达式手动调用父 slot，构造表达式内的 block 跟踪隔离。 */
      setup(props: any, { slots }: SetupContext) {
        return () => {
          return (
            openBlock(),
            createBlock(Comp, null, {
              default: withCtx(() => {
                return [
                  (dynamicVNode = createVNode(
                    'div',
                    {
                      class: {
                        foo: !!slots.default!(),
                      },
                    },
                    null,
                    PatchFlags.CLASS,
                  )),
                ]
              }),
              _: 1,
            })
          )
        }
      },
    }
    const app = createApp({
      /** 向 Wrapper 提供返回空组件 VNode 的编译 slot，触发表达式内调用路径。 */
      render() {
        return (
          openBlock(),
          createBlock(Wrapper, null, {
            default: withCtx(() => {
              return [createVNode({}) /* 组件 VNode */]
            }),
            _: 1,
          })
        )
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<section><div class="foo"></div></section>')
    /* 父 block(section) → 插槽 Fragment → dynamicVNode。 */
    expect(block!.dynamicChildren!.length).toBe(1)
    expect(block!.dynamicChildren![0].dynamicChildren!.length).toBe(1)
    expect(block!.dynamicChildren![0].dynamicChildren![0]).toEqual(
      dynamicVNode!,
    )
  })

  /** Foo 手动选择两个相同 key0 的编译 p block，index0→1→0；检查1/2/1输出，验证手动调用后的完整更新。 */
  test('should force bailout when the user manually calls the slot function', async () => {
    const index = ref(0)
    const Foo = {
      /** 手动调用 default 插槽并按 index 选节点，构造多个同 key block 的往返选择。 */
      setup(props: any, { slots }: SetupContext) {
        return () => {
          return slots.default!()[index.value]
        }
      },
    }

    const app = createApp({
      /** 返回含1/2两项编译 slot 的 Foo block，两个 p 都使用 key0，供手动调用后完整更新。 */
      setup() {
        return () => {
          return (
            openBlock(),
            createBlock(Foo, null, {
              default: withCtx(() => [
                true
                  ? (openBlock(), createBlock('p', { key: 0 }, '1'))
                  : createCommentVNode('v-if', true),
                true
                  ? (openBlock(), createBlock('p', { key: 0 }, '2'))
                  : createCommentVNode('v-if', true),
              ]),
              _: 1 /* STABLE */,
            })
          )
        }
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<p>1</p>')

    index.value = 1
    await nextTick()
    expect(inner(root)).toBe('<p>2</p>')

    index.value = 0
    await nextTick()
    expect(inner(root)).toBe('<p>1</p>')
  })

  // #3779
  /** 父先生成读取 loading 的 span，再用手写 slot 转发两层；loading false到true，检查 loaded到loading，验证手写 slot 视为动态。 */
  test('treat slots manually written by the user as dynamic', async () => {
    const Middle = {
      /** 直接返回 default 插槽函数作为 render，构造手写插槽接收组件。 */
      setup(props: any, { slots }: any) {
        return slots.default!
      },
    }

    const Comp = {
      /** 通过 Middle 转发父插槽，并用 FORWARDED 标记构造多层传播。 */
      setup(props: any, { slots }: any) {
        return () => {
          return (
            openBlock(),
            createBlock('div', null, [
              createVNode(Middle, null, {
                default: withCtx(
                  () => [
                    createVNode('div', null, [renderSlot(slots, 'default')]),
                  ],
                  undefined,
                ),
                _: 3 /* FORWARDED */,
              }),
            ])
          )
        }
      },
    }

    const loading = ref(false)
    const app = createApp({
      /** 先在父 render 创建依赖 loading 的 content，再由手写 default 闭包返回，构造父依赖与动态插槽。 */
      setup() {
        return () => {
          // 先在父 render 中创建 content，确保 loading 被父依赖收集。
          const content = h('span', loading.value ? 'loading' : 'loaded')
          return h(Comp, null, {
            /** 返回父 render 已创建的 content VNode；依赖 loading 在父创建阶段读取，使手写插槽更新可被观察。 */
            default: () => content,
          })
        }
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<div><div><span>loaded</span></div></div>')

    loading.value = true
    await nextTick()
    expect(inner(root)).toBe('<div><div><span>loading</span></div></div>')
  })

  // #6385
  /** 普通 div/id:placeholder 更新为 CLASS block/class:resolved，检查旧id移除、新class及children，验证非同构旧树触发完整props补丁。 */
  test('should fully diff props when falling back from a non-isomorphic block', () => {
    render(h('div', { id: 'placeholder' }), root)

    render(
      (openBlock(),
      createElementBlock(
        'div',
        { class: 'resolved' },
        [
          createTextVNode('hello '),
          createElementVNode('button', null, '0', PatchFlags.TEXT),
        ],
        PatchFlags.CLASS,
      )),
      root,
    )

    expect(inner(root)).toBe(
      '<div class="resolved">hello <button>0</button></div>',
    )
  })

  // #3828
  /** STABLE_FRAGMENT 中 Suspense 默认分支嵌套 TEXT 节点，show false到true；检查两层div文本，验证边界内动态补丁。 */
  test('patch Suspense in optimized mode w/ nested dynamic nodes', async () => {
    const show = ref(false)

    const app = createApp({
      /** 返回稳定 Fragment 包 Suspense，默认分支含读取 show 的嵌套 TEXT 节点。 */
      render() {
        return (
          openBlock(),
          createBlock(
            Fragment,
            null,
            [
              (openBlock(),
              createBlock(SuspenseImpl, null, {
                default: withCtx(() => [
                  createVNode('div', null, [
                    createVNode('div', null, show.value, PatchFlags.TEXT),
                  ]),
                ]),
                _: SlotFlags.STABLE,
              })),
            ],
            PatchFlags.STABLE_FRAGMENT,
          )
        )
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<div><div>false</div></div>')

    show.value = true
    await nextTick()
    expect(inner(root)).toBe('<div><div>true</div></div>')
  })

  // #13305
  /** Suspense 下三个 async Item 初始Loading，解析后列表[1,2,3]改为[3,1,2]；检查完整列表与外部文本，验证优化异步列表重排。 */
  test('patch Suspense nested in list nodes in optimized mode', async () => {
    const deps: Promise<any>[] = []

    const Item = {
      props: {
        someId: { type: Number, required: true },
      },
      /** async setup 等待短计时器并登记 deps，返回读取 someId 的 li/p block，构造异步列表项。 */
      async setup(props: any) {
        const p = new Promise(resolve => setTimeout(resolve, 1))
        deps.push(p)

        await p
        return () => (
          openBlock(),
          createElementBlock('li', null, [
            createElementVNode(
              'p',
              null,
              String(props.someId),
              PatchFlags.TEXT,
            ),
          ])
        )
      },
    }

    const list = ref([1, 2, 3])
    const App = {
      /** 显示 list 文本并在 ol/Suspense 下创建 keyed Item 列表和 Loading fallback，构造优化列表重排。 */
      setup() {
        return () => (
          openBlock(),
          createElementBlock(
            Fragment,
            null,
            [
              createElementVNode(
                'p',
                null,
                JSON.stringify(list.value),
                PatchFlags.TEXT,
              ),
              createElementVNode('ol', null, [
                (openBlock(),
                createBlock(SuspenseImpl, null, {
                  fallback: withCtx(() => [
                    createElementVNode('li', null, 'Loading…'),
                  ]),
                  default: withCtx(() => [
                    (openBlock(true),
                    createElementBlock(
                      Fragment,
                      null,
                      renderList(list.value, id => {
                        return (
                          openBlock(),
                          createBlock(
                            Item,
                            {
                              key: id,
                              'some-id': id,
                            },
                            null,
                            PatchFlags.PROPS,
                            ['some-id'],
                          )
                        )
                      }),
                      PatchFlags.KEYED_FRAGMENT,
                    )),
                  ]),
                  _: 1 /* STABLE */,
                })),
              ]),
            ],
            PatchFlags.STABLE_FRAGMENT,
          )
        )
      },
    }

    const app = createApp(App)
    app.mount(root)
    expect(inner(root)).toBe(`<p>[1,2,3]</p>` + `<ol><li>Loading…</li></ol>`)

    await Promise.all(deps)
    await nextTick()
    expect(inner(root)).toBe(
      `<p>[1,2,3]</p>` +
        `<ol>` +
        `<li><p>1</p></li>` +
        `<li><p>2</p></li>` +
        `<li><p>3</p></li>` +
        `</ol>`,
    )

    list.value = [3, 1, 2]
    await nextTick()
    expect(inner(root)).toBe(
      `<p>[3,1,2]</p>` +
        `<ol>` +
        `<li><p>3</p></li>` +
        `<li><p>1</p></li>` +
        `<li><p>2</p></li>` +
        `</ol>`,
    )
  })

  // #4183
  /** 含转发 Suspense 的 Parent 与 Child 从 show true切false，检查v-if注释及卸载一次，验证边界不跳过组件清理。 */
  test('should not take unmount children fast path /w Suspense', async () => {
    const show = ref(true)
    const spyUnmounted = vi.fn()

    const Parent = {
      /** 将父 slot 转入 Suspense default，保留 FORWARDED 标记，构造卸载清理边界。 */
      setup(props: any, { slots }: SetupContext) {
        return () => (
          openBlock(),
          createBlock(SuspenseImpl, null, {
            default: withCtx(() => [renderSlot(slots, 'default')]),
            _: SlotFlags.FORWARDED,
          })
        )
      },
    }

    const Child = {
      /** 登记 onUnmounted 后返回读取 show 的 TEXT div，供 Suspense 内组件卸载次数检查。 */
      setup() {
        onUnmounted(spyUnmounted)
        return () => createVNode('div', null, show.value, PatchFlags.TEXT)
      },
    }

    const app = createApp({
      /** 按 show 切换带稳定 Child 插槽的 Parent block 与注释，构造 Suspense 子树卸载。 */
      render() {
        return show.value
          ? (openBlock(),
            createBlock(
              Parent,
              { key: 0 },
              {
                default: withCtx(() => [createVNode(Child)]),
                _: SlotFlags.STABLE,
              },
            ))
          : createCommentVNode('v-if', true)
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<div>true</div>')

    show.value = false
    await nextTick()
    expect(inner(root)).toBe('<!--v-if-->')
    expect(spyUnmounted).toHaveBeenCalledTimes(1)
  })

  // #3881
  /** 程序化调用的编译slot包含稳定Fragment和Dummy，先force更新再toggle卸载；检查dummy输出及最终空占位，验证回退后正常卸载。 */
  test('fragments inside programmatically invoked compiled slot should de-opt properly', async () => {
    /** 函数组件直接调用 default slot，构造程序化编译插槽出口。 */
    const Parent: FunctionalComponent = (_, { slots }) => slots.default!()
    /** 返回 dummy 文本的最小子组件，让卸载遍历确实包含组件实例。 */
    const Dummy = () => 'dummy'

    const toggle = ref(true)
    const force = ref(0)

    const app = createApp({
      /** 按 toggle 挂载含稳定列表 Fragment 的 Parent；force 作为 prop 强制先更新，再卸载子树。 */
      render() {
        if (!toggle.value) {
          return null
        }
        return h(
          Parent,
          { n: force.value },
          {
            default: withCtx(
              () => [
                createVNode('ul', null, [
                  (openBlock(),
                  createBlock(
                    Fragment,
                    null,
                    renderList(1, item => {
                      return createVNode('li', null, [createVNode(Dummy)])
                    }),
                    64 /* STABLE_FRAGMENT */,
                  )),
                ]),
              ],
              undefined,
              true,
            ),
            _: 1 /* STABLE */,
          },
        )
      },
    })

    app.mount(root)

    // 先用 prop 强制一次更新。
    force.value++
    await nextTick()
    expect(inner(root)).toBe(`<ul><li>dummy</li></ul>`)

    // 卸载
    toggle.value = false
    await nextTick()
    // 随后卸载应完成，输出空占位。
    expect(inner(root)).toBe(`<!---->`)
  })

  // #10870
  /** 生产态两层手动/正常编译slot先挂载，再改动态foo并关闭条件根；检查errorHandler未调用，验证这组挂载/更新不会发生运行时错误。 */
  test('should bail manually rendered compiler slots for both mount and update', async () => {
    // 切换到可重现该回归的生产分支。
    __DEV__ = false
    /** 直接调用 default 插槽，构造生产态程序化插槽根。 */
    function Outer(_: any, { slots }: any) {
      return slots.default()
    }
    const Mid = {
      /** 用 ctx.$slots 经 renderSlot 渲染 div block，构造外层手动调用后的正常插槽出口。 */
      render(ctx: any) {
        return (
          openBlock(),
          createElementBlock('div', null, [renderSlot(ctx.$slots, 'default')])
        )
      },
    }
    const state1 = ref(true)
    const state2 = ref(true)
    const App = {
      /** 构造两层稳定编译插槽，state1 更新动态 foo、state2 切换条件根，观察生产态挂载/更新错误。 */
      render() {
        return (
          openBlock(),
          createBlock(Outer, null, {
            default: withCtx(() => [
              createVNode(
                Mid,
                { foo: state2.value },
                {
                  default: withCtx(() => [
                    createElementVNode('div', null, [
                      createElementVNode('div', null, [
                        state2.value
                          ? (openBlock(),
                            createElementBlock(
                              'div',
                              {
                                key: 0,
                                id: 'if',
                                foo: state1.value,
                              },
                              null,
                              8 /* PROPS */,
                              ['foo'],
                            ))
                          : createCommentVNode('v-if', true),
                      ]),
                    ]),
                  ]),
                  _: 1 /* STABLE */,
                },
                8 /* PROPS */,
                ['foo'],
              ),
            ]),
            _: 1 /* STABLE */,
          })
        )
      },
    }

    const app = createApp(App)
    app.config.errorHandler = vi.fn()

    try {
      app.mount(root)

      state1.value = false
      await nextTick()

      state2.value = false
      await nextTick()
    } finally {
      __DEV__ = true
      expect(app.config.errorHandler).not.toHaveBeenCalled()
    }
  })

  // #11336
  /** 生产态手动slot根先用n强制更新、随后show挂载条件项；检查errorHandler未调用，验证重新分配slot后仍可更新。 */
  test('should bail manually rendered compiler slots for both mount and update (2)', async () => {
    // 切换到可重现该回归的生产分支。
    __DEV__ = false
    const n = ref(0)
    /** 读取 n 建立强制更新依赖后手动调用 default，构造生产态插槽重新分配。 */
    function Outer(_: any, { slots }: any) {
      n.value // 读取 n 以收集渲染依赖
      return slots.default()
    }
    const Mid = {
      /** 通过 renderSlot 渲染收到的编译插槽，供强制父更新后的标记回退测试。 */
      render(ctx: any) {
        return (
          openBlock(),
          createElementBlock('div', null, [renderSlot(ctx.$slots, 'default')])
        )
      },
    }
    const show = ref(false)
    const App = {
      /** 提供包含条件项1和静态2/3/4的嵌套稳定插槽，构造重新分配后条件挂载。 */
      render() {
        return (
          openBlock(),
          createBlock(Outer, null, {
            default: withCtx(() => [
              createVNode(Mid, null, {
                default: withCtx(() => [
                  createElementVNode('div', null, [
                    show.value
                      ? (openBlock(),
                        createElementBlock('div', { key: 0 }, '1'))
                      : createCommentVNode('v-if', true),
                    createElementVNode('div', null, '2'),
                    createElementVNode('div', null, '3'),
                  ]),
                  createElementVNode('div', null, '4'),
                ]),
                _: 1 /* STABLE */,
              }),
            ]),
            _: 1 /* STABLE */,
          })
        )
      },
    }

    const app = createApp(App)
    app.config.errorHandler = vi.fn()

    try {
      app.mount(root)

      // 先强制 Outer 更新，重新向 Mid 分配 slots。
      // 后续条件更新应仍正常执行。

      n.value++
      await nextTick()

      show.value = true
      await nextTick()
    } finally {
      __DEV__ = true
      expect(app.config.errorHandler).not.toHaveBeenCalled()
    }
  })

  /** default slot 在有效bar Fragment与注释间切换，fallback为foo且两者内部key均0；检查bar→foo→bar，验证正文/回退身份区分。 */
  test('diff slot and slot fallback node', async () => {
    const Comp = {
      props: ['show'],
      /** 将 props.show 反转成 slot hide 参数，并提供 foo fallback Fragment，构造同 key 正文/回退切换。 */
      setup(props: any, { slots }: SetupContext) {
        return () => {
          return (
            openBlock(),
            createElementBlock('div', null, [
              renderSlot(slots, 'default', { hide: !props.show }, () => [
                (openBlock(),
                (block = createElementBlock(
                  Fragment,
                  { key: 0 },
                  [createTextVNode('foo')],
                  PatchFlags.STABLE_FRAGMENT,
                ))),
              ]),
            ])
          )
        }
      },
    }

    const show = ref(true)
    const app = createApp({
      /** 返回动态 show prop 的 Comp block，slot 按 hide 返回 bar Fragment 或注释，构造正文有效性变化。 */
      render() {
        return (
          openBlock(),
          createBlock(
            Comp,
            { show: show.value },
            {
              default: withCtx(({ hide }: { hide: boolean }) => [
                !hide
                  ? (openBlock(),
                    createElementBlock(
                      Fragment,
                      { key: 0 },
                      [
                        createCommentVNode('comment'),
                        createElementVNode(
                          'div',
                          null,
                          'bar',
                          PatchFlags.CACHED,
                        ),
                      ],
                      PatchFlags.STABLE_FRAGMENT,
                    ))
                  : createCommentVNode('v-if', true),
              ]),
              _: SlotFlags.STABLE,
            },
            PatchFlags.PROPS,
            ['show'],
          )
        )
      },
    })

    app.mount(root)
    expect(inner(root)).toBe('<div><!--comment--><div>bar</div></div>')
    expect(block).toBe(null)

    show.value = false
    await nextTick()
    expect(inner(root)).toBe('<div>foo</div>')

    show.value = true
    await nextTick()
    expect(inner(root)).toBe('<div><!--comment--><div>bar</div></div>')
  })

  /** cache[0] 缓存含 Child 的后代树，show两次隐藏/恢复；检查每次输出与卸载累计2次，验证卸载清除缓存并完整清理。 */
  test('should not take unmount children fast path if children contain cached nodes', async () => {
    const show = ref(true)
    const spyUnmounted = vi.fn()

    const Child = {
      /** 登记 onUnmounted spy 并返回 Child div，供缓存后代完整清理。 */
      setup() {
        onUnmounted(spyUnmounted)
        return () => createVNode('div', null, 'Child')
      },
    }

    const app = createApp({
      /** 按 show 缓存含 Child 的 VNode 并标记 cacheIndex，构造两次挂载/卸载检验缓存清除。 */
      render(_: any, cache: any) {
        return show.value
          ? (openBlock(),
            createBlock('div', null, [
              createVNode('div', null, [
                cache[0] ||
                  (setBlockTracking(-1, true),
                  ((cache[0] = createVNode('div', null, [
                    createVNode(Child),
                  ])).cacheIndex = 0),
                  setBlockTracking(1),
                  cache[0]),
              ]),
            ]))
          : createCommentVNode('v-if', true)
      },
    })

    app.mount(root)
    expect(inner(root)).toBe(
      '<div><div><div><div>Child</div></div></div></div>',
    )

    show.value = false
    await nextTick()
    expect(inner(root)).toBe('<!--v-if-->')
    expect(spyUnmounted).toHaveBeenCalledTimes(1)

    show.value = true
    await nextTick()
    expect(inner(root)).toBe(
      '<div><div><div><div>Child</div></div></div></div>',
    )

    // 再次卸载计数递增，检查上次缓存已清除。
    show.value = false
    await nextTick()
    expect(inner(root)).toBe('<!--v-if-->')
    expect(spyUnmounted).toHaveBeenCalledTimes(2)
  })

  // #12371
  /** Wrapper 文本表达式手调header且renderSlot调用content，show false→true→false；检查输出和Child挂载/卸载前次数，验证混合slot调用后的清理。 */
  test('unmount children when the user calls a compiled slot', async () => {
    const beforeMountSpy = vi.fn()
    const beforeUnmountSpy = vi.fn()

    const Child = {
      /** 登记 beforeMount/beforeUnmount spies 后返回 child 文本，供手动 slot 调用后的生命周期计数。 */
      setup() {
        onBeforeMount(beforeMountSpy)
        onBeforeUnmount(beforeUnmountSpy)
        return () => 'child'
      },
    }

    const Wrapper = {
      /** 在文本表达式手动调用 header slot，同时经 renderSlot 渲染 content，构造混合调用后卸载。 */
      setup(_: any, { slots }: SetupContext) {
        return () => (
          openBlock(),
          createElementBlock('section', null, [
            (openBlock(),
            createElementBlock('div', { key: 1 }, [
              createTextVNode(slots.header!() ? 'foo' : 'bar', 1 /* TEXT */),
              renderSlot(slots, 'content'),
            ])),
          ])
        )
      },
    }

    const show = ref(false)
    const app = createApp({
      /** 按 show 切换 Wrapper block 与注释，提供 header/content 两个编译 slot。 */
      render() {
        return show.value
          ? (openBlock(),
            createBlock(Wrapper, null, {
              header: withCtx(() => [createVNode({})]),
              content: withCtx(() => [createVNode(Child)]),
              _: 1,
            }))
          : createCommentVNode('v-if', true)
      },
    })

    app.mount(root)
    expect(inner(root)).toMatchInlineSnapshot(`"<!--v-if-->"`)
    expect(beforeMountSpy).toHaveBeenCalledTimes(0)
    expect(beforeUnmountSpy).toHaveBeenCalledTimes(0)

    show.value = true
    await nextTick()
    expect(inner(root)).toMatchInlineSnapshot(
      `"<section><div>foochild</div></section>"`,
    )
    expect(beforeMountSpy).toHaveBeenCalledTimes(1)

    show.value = false
    await nextTick()
    expect(inner(root)).toBe('<!--v-if-->')
    expect(beforeUnmountSpy).toHaveBeenCalledTimes(1)
  })

  // #12411
  /** 普通foo数组从空被直接写成三项，count递增驱动更新；检查原0到1及三项文本，验证STABLE_FRAGMENT动态数组数量变化的回退。 */
  test('handle patch stable fragment with non-reactive v-for source', async () => {
    const count = ref(0)
    const foo: any = []
    /** 把普通非响应式 foo 数组写为1_foo至3_foo，需靠另一个响应式 count 触发渲染。 */
    function updateFoo() {
      for (let n = 0; n < 3; n++) {
        foo[n] = n + 1 + '_foo'
      }
    }
    const Comp = {
      /** 返回同时读取 count 与遍历普通 foo 的 STABLE_FRAGMENT 树，构造动态 children 数量变化。 */
      setup() {
        return () => {
          // <div>{{ count }}</div>
          // <div v-for='item in foo'>{{ item }}</div>
          return (
            openBlock(),
            createElementBlock(
              Fragment,
              null,
              [
                createElementVNode(
                  'div',
                  null,
                  toDisplayString(count.value),
                  PatchFlags.TEXT,
                ),
                (openBlock(),
                createElementBlock(
                  Fragment,
                  null,
                  renderList(foo, item => {
                    return createElementVNode(
                      'div',
                      null,
                      toDisplayString(item),
                      PatchFlags.TEXT,
                    )
                  }),
                  PatchFlags.STABLE_FRAGMENT,
                )),
              ],
              PatchFlags.STABLE_FRAGMENT,
            )
          )
        }
      },
    }

    render(h(Comp), root)
    expect(inner(root)).toBe('<div>0</div>')
    updateFoo()
    count.value++
    await nextTick()
    expect(inner(root)).toBe(
      '<div>1</div><div>1_foo</div><div>2_foo</div><div>3_foo</div>',
    )
  })
})
