/**
 * 测试阅读说明：本文件验证 `runtime-core/hydration` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
/**
 * @vitest-environment jsdom
 */

import {
  type ObjectDirective,
  Suspense,
  Teleport,
  Transition,
  type VNode,
  createBlock,
  createCommentVNode,
  createElementBlock,
  createElementVNode,
  createSSRApp,
  createStaticVNode,
  createTextVNode,
  createVNode,
  defineAsyncComponent,
  defineComponent,
  h,
  hydrateOnVisible,
  nextTick,
  onMounted,
  onServerPrefetch,
  openBlock,
  reactive,
  ref,
  registerRuntimeCompiler,
  renderSlot,
  useCssVars,
  vModelCheckbox,
  vShow,
  withCtx,
  withDirectives,
} from '@vue/runtime-dom'
import * as runtimeDom from '@vue/runtime-dom'
import type { HMRRuntime } from '../src/hmr'
import type { InternalRenderFunction } from '../src/component'
import { type SSRContext, renderToString } from '@vue/server-renderer'
import { type CompilerOptions, compile } from '@vue/compiler-dom'
import { PatchFlags, normalizeStyle } from '@vue/shared'
import { vShowOriginalDisplay } from '../../runtime-dom/src/directives/vShow'

/** Vue 在开发环境注入到全局的 HMR 运行时；水合测试借它模拟组件热更新。 */
declare var __VUE_HMR_RUNTIME__: HMRRuntime

/** 水合回归用到的 HMR 注册与整组件重载入口。 */
const { createRecord, reload } = __VUE_HMR_RUNTIME__

registerRuntimeCompiler(compileToFunction)

/**
 * 把模板编译为可直接交给运行时执行的 render 函数。
 *
 * 测试开启静态提升，以覆盖编译器优化产物参与水合时的真实路径。
 */
function compileToFunction(template: string, options?: CompilerOptions) {
  const { code } = compile(
    template,
    Object.assign({ hoistStatic: true }, options),
  )
  const render = new Function('Vue', code)(runtimeDom) as InternalRenderFunction
  render._rc = true
  return render
}

/**
 * 用给定的服务端 HTML 和客户端 render 函数完成一次水合挂载。
 * 返回根 VNode 与容器，方便同时断言节点复用和最终 DOM 内容。
 */
function mountWithHydration(html: string, render: () => any) {
  const container = document.createElement('div')
  container.innerHTML = html
  const app = createSSRApp({
    render,
  })
  return {
    vnode: app.mount(container).$.subTree as VNode<Node, Element> & {
      el: Element
    },
    container,
  }
}

/** 在指定元素上派发原生事件，用于验证水合后监听器是否已经接管现有 DOM。 */
const triggerEvent = (type: string, el: Element) => {
  const event = new Event(type)
  el.dispatchEvent(event)
}

// 测试组：SSR 水合。
describe('SSR hydration', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  // 测试场景：复用服务端文本节点，并在响应式更新后修改其内容。
  test('text', async () => {
    const msg = ref('foo')
    const { vnode, container } = mountWithHydration('foo', () => msg.value)
    expect(vnode.el).toBe(container.firstChild)
    expect(container.textContent).toBe('foo')
    msg.value = 'bar'
    await nextTick()
    expect(container.textContent).toBe('bar')
  })

  // 测试场景：客户端期望空文本时，正确处理服务端缺失或已有的文本节点。
  test('empty text', async () => {
    const { container } = mountWithHydration('<div></div>', () =>
      h('div', createTextVNode('')),
    )
    expect(container.textContent).toBe('')
    expect(`Hydration children mismatch in <div>`).not.toHaveBeenWarned()
  })

  // 测试场景：带换行符的文本。
  test('text w/ newlines', async () => {
    mountWithHydration('<div>1\n2\n3</div>', () => h('div', '1\r\n2\r3'))
    expect(`Hydration text mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：复用服务端注释节点作为客户端 Comment VNode。
  test('comment', () => {
    const { vnode, container } = mountWithHydration('<!---->', () => null)
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.el.nodeType).toBe(8) // comment
  })

  // 测试场景：按静态节点数量认领服务端 DOM，并保存静态片段内容。
  test('static', () => {
    const html = '<div><span>hello</span></div>'
    const { vnode, container } = mountWithHydration(html, () =>
      createStaticVNode('', 1),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.el.outerHTML).toBe(html)
    expect(vnode.anchor).toBe(container.firstChild)
    expect(vnode.children).toBe(html)
  })

  // 测试场景：静态（多个元素）。
  test('static (multiple elements)', () => {
    const staticContent = '<div></div><span>hello</span>'
    const html = `<div><div>hi</div>` + staticContent + `<div>ho</div></div>`

    const n1 = h('div', 'hi')
    const s = createStaticVNode('', 2)
    const n2 = h('div', 'ho')

    const { container } = mountWithHydration(html, () => h('div', [n1, s, n2]))

    const div = container.firstChild!

    expect(n1.el).toBe(div.firstChild)
    expect(n2.el).toBe(div.lastChild)
    expect(s.el).toBe(div.childNodes[1])
    expect(s.anchor).toBe(div.childNodes[2])
    expect(s.children).toBe(staticContent)
  })

  // #6008
  // 测试场景：static（以文本节点作为起始节点）。
  test('static (with text node as starting node)', () => {
    const html = ` A <span>foo</span> B`
    const { vnode, container } = mountWithHydration(html, () =>
      createStaticVNode(` A <span>foo</span> B`, 3),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.anchor).toBe(container.lastChild)
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：内容采用静态。
  test('static with content adoption', () => {
    const html = ` A <span>foo</span> B`
    const { vnode, container } = mountWithHydration(html, () =>
      createStaticVNode(``, 3),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.anchor).toBe(container.lastChild)
    expect(vnode.children).toBe(html)
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：带有文本子元素的元素。
  test('element with text children', async () => {
    const msg = ref('foo')
    const { vnode, container } = mountWithHydration(
      '<div class="foo">foo</div>',
      () => h('div', { class: msg.value }, msg.value),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(container.firstChild!.textContent).toBe('foo')
    msg.value = 'bar'
    await nextTick()
    expect(container.innerHTML).toBe(`<div class="bar">bar</div>`)
  })

  // #7285
  // 测试场景：具有多个连续文本vnode的元素。
  test('element with multiple continuous text vnodes', async () => {
    // should no mismatch warning
    const { container } = mountWithHydration('<div>foo0o</div>', () =>
      h('div', ['fo', createTextVNode('o'), 0, 'o']),
    )
    expect(container.textContent).toBe('foo0o')
  })

  // 测试场景：带有子元素的元素。
  test('element with elements children', async () => {
    const msg = ref('foo')
    const fn = vi.fn()
    const { vnode, container } = mountWithHydration(
      '<div><span>foo</span><span class="foo"></span></div>',
      () =>
        h('div', [
          h('span', msg.value),
          h('span', { class: msg.value, onClick: fn }),
        ]),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect((vnode.children as VNode[])[0].el).toBe(
      container.firstChild!.childNodes[0],
    )
    expect((vnode.children as VNode[])[1].el).toBe(
      container.firstChild!.childNodes[1],
    )

    // event handler
    triggerEvent('click', vnode.el.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(vnode.el.innerHTML).toBe(`<span>bar</span><span class="bar"></span>`)
  })

  // 测试场景：带有ref的元素。
  test('element with ref', () => {
    const el = ref()
    const { vnode, container } = mountWithHydration('<div></div>', () =>
      h('div', { ref: el }),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(el.value).toBe(vnode.el)
  })

  // 测试场景：水合由注释锚点包围的 Fragment，并复用其中已有节点。
  test('Fragment', async () => {
    const msg = ref('foo')
    const fn = vi.fn()
    const { vnode, container } = mountWithHydration(
      '<div><!--[--><span>foo</span><!--[--><span class="foo"></span><!--]--><!--]--></div>',
      () =>
        h('div', [
          [
            h('span', msg.value),
            [h('span', { class: msg.value, onClick: fn })],
          ],
        ]),
    )
    expect(vnode.el).toBe(container.firstChild)

    expect(vnode.el.innerHTML).toBe(
      `<!--[--><span>foo</span><!--[--><span class="foo"></span><!--]--><!--]-->`,
    )

    // start fragment 1
    const fragment1 = (vnode.children as VNode[])[0]
    expect(fragment1.el).toBe(vnode.el.childNodes[0])
    const fragment1Children = fragment1.children as VNode[]

    // first <span>
    expect(fragment1Children[0].el!.tagName).toBe('SPAN')
    expect(fragment1Children[0].el).toBe(vnode.el.childNodes[1])

    // start fragment 2
    const fragment2 = fragment1Children[1]
    expect(fragment2.el).toBe(vnode.el.childNodes[2])
    const fragment2Children = fragment2.children as VNode[]

    // second <span>
    expect(fragment2Children[0].el!.tagName).toBe('SPAN')
    expect(fragment2Children[0].el).toBe(vnode.el.childNodes[3])

    // end fragment 2
    expect(fragment2.anchor).toBe(vnode.el.childNodes[4])

    // end fragment 1
    expect(fragment1.anchor).toBe(vnode.el.childNodes[5])

    // event handler
    triggerEvent('click', vnode.el.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(vnode.el.innerHTML).toBe(
      `<!--[--><span>bar</span><!--[--><span class="bar"></span><!--]--><!--]-->`,
    )
  })

  // #7285
  // 测试场景：Fragment（多个连续文本vnode）。
  test('Fragment (multiple continuous text vnodes)', async () => {
    // should no mismatch warning
    const { container } = mountWithHydration('<!--[-->fooo<!--]-->', () => [
      'fo',
      createTextVNode('o'),
      'o',
    ])
    expect(container.textContent).toBe('fooo')
  })

  // 测试场景：同时水合主视图占位符与目标容器中的 Teleport children。
  test('Teleport', async () => {
    const msg = ref('foo')
    const fn = vi.fn()
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport'
    teleportContainer.innerHTML = `<!--teleport start anchor--><span>foo</span><span class="foo"></span><!--teleport anchor-->`
    document.body.appendChild(teleportContainer)

    const { vnode, container } = mountWithHydration(
      '<!--teleport start--><!--teleport end-->',
      () =>
        h(Teleport, { to: '#teleport' }, [
          h('span', msg.value),
          h('span', { class: msg.value, onClick: fn }),
        ]),
    )

    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.anchor).toBe(container.lastChild)

    expect(vnode.target).toBe(teleportContainer)
    expect(vnode.targetStart).toBe(teleportContainer.childNodes[0])
    expect((vnode.children as VNode[])[0].el).toBe(
      teleportContainer.childNodes[1],
    )
    expect((vnode.children as VNode[])[1].el).toBe(
      teleportContainer.childNodes[2],
    )
    expect(vnode.targetAnchor).toBe(teleportContainer.childNodes[3])

    // event handler
    triggerEvent('click', teleportContainer.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(teleportContainer.innerHTML).toBe(
      `<!--teleport start anchor--><span>bar</span><span class="bar"></span><!--teleport anchor-->`,
    )
  })

  // 测试场景：Teleport（多个+积分）。
  test('Teleport (multiple + integration)', async () => {
    const msg = ref('foo')
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const Comp = () => [
      h(Teleport, { to: '#teleport2' }, [
        h('span', msg.value),
        h('span', { class: msg.value, onClick: fn1 }),
      ]),
      h(Teleport, { to: '#teleport2' }, [
        h('span', msg.value + '2'),
        h('span', { class: msg.value + '2', onClick: fn2 }),
      ]),
    ]

    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport2'
    const ctx: SSRContext = {}
    const mainHtml = await renderToString(h(Comp), ctx)
    expect(mainHtml).toMatchInlineSnapshot(
      `"<!--[--><!--teleport start--><!--teleport end--><!--teleport start--><!--teleport end--><!--]-->"`,
    )

    const teleportHtml = ctx.teleports!['#teleport2']
    expect(teleportHtml).toMatchInlineSnapshot(
      `"<!--teleport start anchor--><span>foo</span><span class="foo"></span><!--teleport anchor--><!--teleport start anchor--><span>foo2</span><span class="foo2"></span><!--teleport anchor-->"`,
    )

    teleportContainer.innerHTML = teleportHtml
    document.body.appendChild(teleportContainer)

    const { vnode, container } = mountWithHydration(mainHtml, Comp)
    expect(vnode.el).toBe(container.firstChild)
    const teleportVnode1 = (vnode.children as VNode[])[0]
    const teleportVnode2 = (vnode.children as VNode[])[1]
    expect(teleportVnode1.el).toBe(container.childNodes[1])
    expect(teleportVnode1.anchor).toBe(container.childNodes[2])
    expect(teleportVnode2.el).toBe(container.childNodes[3])
    expect(teleportVnode2.anchor).toBe(container.childNodes[4])

    expect(teleportVnode1.target).toBe(teleportContainer)
    expect(teleportVnode1.targetStart).toBe(teleportContainer.childNodes[0])
    expect((teleportVnode1 as any).children[0].el).toBe(
      teleportContainer.childNodes[1],
    )
    expect(teleportVnode1.targetAnchor).toBe(teleportContainer.childNodes[3])

    expect(teleportVnode2.target).toBe(teleportContainer)
    expect(teleportVnode2.targetStart).toBe(teleportContainer.childNodes[4])
    expect((teleportVnode2 as any).children[0].el).toBe(
      teleportContainer.childNodes[5],
    )
    expect(teleportVnode2.targetAnchor).toBe(teleportContainer.childNodes[7])

    // // event handler
    triggerEvent('click', teleportContainer.querySelector('.foo')!)
    expect(fn1).toHaveBeenCalled()

    triggerEvent('click', teleportContainer.querySelector('.foo2')!)
    expect(fn2).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(teleportContainer.innerHTML).toMatchInlineSnapshot(
      `"<!--teleport start anchor--><span>bar</span><span class="bar"></span><!--teleport anchor--><!--teleport start anchor--><span>bar2</span><span class="bar2"></span><!--teleport anchor-->"`,
    )
  })

  // 测试场景：禁用的 Teleport 在主容器原地水合 children，而不迁往目标。
  test('Teleport (disabled)', async () => {
    const msg = ref('foo')
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const Comp = () => [
      h('div', 'foo'),
      h(Teleport, { to: '#teleport3', disabled: true }, [
        h('span', msg.value),
        h('span', { class: msg.value, onClick: fn1 }),
      ]),
      h('div', { class: msg.value + '2', onClick: fn2 }, 'bar'),
    ]

    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport3'
    const ctx: SSRContext = {}
    const mainHtml = await renderToString(h(Comp), ctx)
    expect(mainHtml).toMatchInlineSnapshot(
      `"<!--[--><div>foo</div><!--teleport start--><span>foo</span><span class="foo"></span><!--teleport end--><div class="foo2">bar</div><!--]-->"`,
    )

    const teleportHtml = ctx.teleports!['#teleport3']
    expect(teleportHtml).toMatchInlineSnapshot(
      `"<!--teleport start anchor--><!--teleport anchor-->"`,
    )

    teleportContainer.innerHTML = teleportHtml
    document.body.appendChild(teleportContainer)

    const { vnode, container } = mountWithHydration(mainHtml, Comp)
    expect(vnode.el).toBe(container.firstChild)
    const children = vnode.children as VNode[]

    expect(children[0].el).toBe(container.childNodes[1])

    const teleportVnode = children[1]
    expect(teleportVnode.el).toBe(container.childNodes[2])
    expect((teleportVnode.children as VNode[])[0].el).toBe(
      container.childNodes[3],
    )
    expect((teleportVnode.children as VNode[])[1].el).toBe(
      container.childNodes[4],
    )
    expect(teleportVnode.anchor).toBe(container.childNodes[5])
    expect(children[2].el).toBe(container.childNodes[6])

    expect(teleportVnode.target).toBe(teleportContainer)
    expect(teleportVnode.targetStart).toBe(teleportContainer.childNodes[0])
    expect(teleportVnode.targetAnchor).toBe(teleportContainer.childNodes[1])

    // // event handler
    triggerEvent('click', container.querySelector('.foo')!)
    expect(fn1).toHaveBeenCalled()

    triggerEvent('click', container.querySelector('.foo2')!)
    expect(fn2).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<!--[--><div>foo</div><!--teleport start--><span>bar</span><span class="bar"></span><!--teleport end--><div class="bar2">bar</div><!--]-->"`,
    )
  })

  // #6152
  // 测试场景：Teleport（禁用+作为组件根）。
  test('Teleport (disabled + as component root)', () => {
    const { container } = mountWithHydration(
      '<!--[--><div>Parent fragment</div><!--teleport start--><div>Teleport content</div><!--teleport end--><!--]-->',
      () => [
        h('div', 'Parent fragment'),
        h(() =>
          h(Teleport, { to: 'body', disabled: true }, [
            h('div', 'Teleport content'),
          ]),
        ),
      ],
    )
    expect(document.body.innerHTML).toBe('')
    expect(container.innerHTML).toBe(
      '<!--[--><div>Parent fragment</div><!--teleport start--><div>Teleport content</div><!--teleport end--><!--]-->',
    )
    expect(
      `Hydration completed but contains mismatches.`,
    ).not.toHaveBeenWarned()
  })

  // 测试场景：Teleport（作为组件根）。
  test('Teleport (as component root)', () => {
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport4'
    teleportContainer.innerHTML = `<!--teleport start anchor-->hello<!--teleport anchor-->`
    document.body.appendChild(teleportContainer)

    const wrapper = {
      render() {
        return h(Teleport, { to: '#teleport4' }, ['hello'])
      },
    }

    const { vnode, container } = mountWithHydration(
      '<div><!--teleport start--><!--teleport end--><div></div></div>',
      () => h('div', [h(wrapper), h('div')]),
    )
    expect(vnode.el).toBe(container.firstChild)
    // component el
    const wrapperVNode = (vnode as any).children[0]
    const tpStart = container.firstChild?.firstChild
    const tpEnd = tpStart?.nextSibling
    expect(wrapperVNode.el).toBe(tpStart)
    expect(wrapperVNode.component.subTree.el).toBe(tpStart)
    expect(wrapperVNode.component.subTree.anchor).toBe(tpEnd)
    // next node hydrate properly
    const nextVNode = (vnode as any).children[1]
    expect(nextVNode.el).toBe(container.firstChild?.lastChild)
  })

  // 测试场景：嵌套 Teleport 分别认领各自目标中的服务端节点与锚点。
  test('Teleport (nested)', () => {
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport5'
    teleportContainer.innerHTML = `<!--teleport start anchor--><div><!--teleport start--><!--teleport end--></div><!--teleport anchor--><!--teleport start anchor--><div>child</div><!--teleport anchor-->`
    document.body.appendChild(teleportContainer)

    const { vnode, container } = mountWithHydration(
      '<!--teleport start--><!--teleport end-->',
      () =>
        h(Teleport, { to: '#teleport5' }, [
          h('div', [h(Teleport, { to: '#teleport5' }, [h('div', 'child')])]),
        ]),
    )

    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.anchor).toBe(container.lastChild)

    const childDivVNode = (vnode as any).children[0]
    const div = teleportContainer.childNodes[1]
    expect(childDivVNode.el).toBe(div)
    expect(vnode.targetAnchor).toBe(div?.nextSibling)

    const childTeleportVNode = childDivVNode.children[0]
    expect(childTeleportVNode.el).toBe(div?.firstChild)
    expect(childTeleportVNode.anchor).toBe(div?.lastChild)

    expect(childTeleportVNode.targetAnchor).toBe(teleportContainer.lastChild)
    expect(childTeleportVNode.children[0].el).toBe(
      teleportContainer.lastChild?.previousSibling,
    )
  })

  // 测试场景：使用 onServerPrefetch 时带有数据允许不匹配组件。
  test('with data-allow-mismatch component when using onServerPrefetch', async () => {
    const Comp = {
      template: `
        <div>Comp2</div>
      `,
    }
    let foo: any
    const App = {
      setup() {
        const flag = ref(true)
        foo = () => {
          flag.value = false
        }
        onServerPrefetch(() => (flag.value = false))
        return { flag }
      },
      components: {
        Comp,
      },
      template: `
        <span data-allow-mismatch>
          <Comp v-if="flag"></Comp>
        </span>
      `,
    }
    // hydrate
    const container = document.createElement('div')
    container.innerHTML = await renderToString(h(App))
    createSSRApp(App).mount(container)
    expect(container.innerHTML).toBe(
      '<span data-allow-mismatch=""><div>Comp2</div></span>',
    )
    foo()
    await nextTick()
    expect(container.innerHTML).toBe(
      '<span data-allow-mismatch=""><!--v-if--></span>',
    )
  })

  // 测试场景：Teleport 卸载（完全集成）。
  test('Teleport unmount (full integration)', async () => {
    const Comp1 = {
      template: `
        <Teleport to="#target"> 
          <span>Teleported Comp1</span>
        </Teleport>
      `,
    }
    const Comp2 = {
      template: `
        <div>Comp2</div>
      `,
    }

    const toggle = ref(true)
    const App = {
      template: `
        <div>
          <Comp1 v-if="toggle"/>
          <Comp2 v-else/>
        </div>
      `,
      components: {
        Comp1,
        Comp2,
      },
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'target'
    document.body.appendChild(teleportContainer)

    // server render
    const ctx: SSRContext = {}
    container.innerHTML = await renderToString(h(App), ctx)
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    teleportContainer.innerHTML = ctx.teleports!['#target']

    // hydrate
    createSSRApp(App).mount(container)
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer.innerHTML).toBe(
      '<!--teleport start anchor--><span>Teleported Comp1</span><!--teleport anchor-->',
    )
    expect(`Hydration children mismatch`).not.toHaveBeenWarned()

    toggle.value = false
    await nextTick()
    expect(container.innerHTML).toBe('<div><div>Comp2</div></div>')
    expect(teleportContainer.innerHTML).toBe('')
  })

  // 测试场景：Teleport 卸载（不匹配+完全集成）。
  test('Teleport unmount (mismatch + full integration)', async () => {
    const Comp1 = {
      template: `
        <Teleport to="#target"> 
          <span>Teleported Comp1</span>
        </Teleport>
      `,
    }
    const Comp2 = {
      template: `
        <div>Comp2</div>
      `,
    }

    const toggle = ref(true)
    const App = {
      template: `
        <div>
          <Comp1 v-if="toggle"/>
          <Comp2 v-else/>
        </div>
      `,
      components: {
        Comp1,
        Comp2,
      },
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'target'
    document.body.appendChild(teleportContainer)

    // server render
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer.innerHTML).toBe('')

    // hydrate
    createSSRApp(App).mount(container)
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer.innerHTML).toBe('<span>Teleported Comp1</span>')
    expect(`Hydration children mismatch`).toHaveBeenWarned()

    toggle.value = false
    await nextTick()
    expect(container.innerHTML).toBe('<div><div>Comp2</div></div>')
    expect(teleportContainer.innerHTML).toBe('')
  })

  // 测试场景：Teleport 卸载（禁用+完全集成）。
  test('Teleport unmount (disabled + full integration)', async () => {
    const disabled = ref(true)
    const target = ref('#teleport001')
    const toggle = ref(true)

    const Comp = {
      template: `
      <div>
        <div id="teleport001">
          <Teleport
            :to="target"
            :disabled="disabled"
          >
            <template v-for="section in order">
              <div>{{section}}</div>
            </template>
          </Teleport>
        </div>
        <div id="teleport002"></div>
      </div>
      `,
      setup() {
        const order = ref(['A', 'B', 'C'])
        return { target, disabled, order }
      },
    }
    const App = {
      template: `<Comp v-if="toggle"/>`,
      components: {
        Comp,
      },
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    document.body.appendChild(container)

    // server render
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toBe(
      `<div>` +
        `<div id="teleport001">` +
        `<!--teleport start-->` +
        `<!--[--><div>A</div><div>B</div><div>C</div><!--]-->` +
        `<!--teleport end-->` +
        `</div>` +
        `<div id="teleport002"></div>` +
        `</div>`,
    )

    // hydrate
    createSSRApp(App).mount(container)
    expect(`Hydration children mismatch`).not.toHaveBeenWarned()

    target.value = '#teleport002'
    disabled.value = false
    await nextTick()
    expect(container.querySelector('#teleport001')!.innerHTML).toBe(
      '<!--teleport start--><!--teleport end-->',
    )
    expect(container.querySelector('#teleport002')!.innerHTML).toBe(
      '<!--[--><div>A</div><div>B</div><div>C</div><!--]-->',
    )

    toggle.value = false
    await nextTick()
    expect(container.innerHTML).toBe('<!--v-if-->')
  })

  // 测试场景：Teleport 目标更改（不匹配+完全集成）。
  test('Teleport target change (mismatch + full integration)', async () => {
    const target = ref('#target1')
    const Comp = {
      template: `
        <Teleport :to="target"> 
          <span>Teleported</span>
        </Teleport>
      `,
      setup() {
        return { target }
      },
    }

    const App = {
      template: `
        <div>
          <Comp />
        </div>
      `,
      components: {
        Comp,
      },
    }

    const container = document.createElement('div')
    const teleportContainer1 = document.createElement('div')
    teleportContainer1.id = 'target1'
    const teleportContainer2 = document.createElement('div')
    teleportContainer2.id = 'target2'
    document.body.appendChild(teleportContainer1)
    document.body.appendChild(teleportContainer2)

    // server render
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer1.innerHTML).toBe('')
    expect(teleportContainer2.innerHTML).toBe('')

    // hydrate
    createSSRApp(App).mount(container)
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer1.innerHTML).toBe('<span>Teleported</span>')
    expect(teleportContainer2.innerHTML).toBe('')
    expect(`Hydration children mismatch`).toHaveBeenWarned()

    target.value = '#target2'
    await nextTick()
    expect(teleportContainer1.innerHTML).toBe('')
    expect(teleportContainer2.innerHTML).toBe('<span>Teleported</span>')
  })

  // compile SSR + client render fn from the same template & hydrate
  // 测试场景：完整的编译器集成。
  test('full compiler integration', async () => {
    const mounted: string[] = []
    const log = vi.fn()
    const toggle = ref(true)

    const Child = {
      data() {
        return {
          count: 0,
          text: 'hello',
          style: {
            color: 'red',
          },
        }
      },
      mounted() {
        mounted.push('child')
      },
      template: `
      <div>
        <span class="count" :style="style">{{ count }}</span>
        <button class="inc" @click="count++">inc</button>
        <button class="change" @click="style.color = 'green'" >change color</button>
        <button class="emit" @click="$emit('foo')">emit</button>
        <span class="text">{{ text }}</span>
        <input v-model="text">
      </div>
      `,
    }

    const App = {
      setup() {
        return { toggle }
      },
      mounted() {
        mounted.push('parent')
      },
      template: `
        <div>
          <span>hello</span>
          <template v-if="toggle">
            <Child @foo="log('child')"/>
            <template v-if="true">
              <button class="parent-click" @click="log('click')">click me</button>
            </template>
          </template>
          <span>hello</span>
        </div>`,
      components: {
        Child,
      },
      methods: {
        log,
      },
    }

    const container = document.createElement('div')
    // server render
    container.innerHTML = await renderToString(h(App))
    // hydrate
    createSSRApp(App).mount(container)

    // assert interactions
    // 1. parent button click
    triggerEvent('click', container.querySelector('.parent-click')!)
    expect(log).toHaveBeenCalledWith('click')

    // 2. child inc click + text interpolation
    const count = container.querySelector('.count') as HTMLElement
    expect(count.textContent).toBe(`0`)
    triggerEvent('click', container.querySelector('.inc')!)
    await nextTick()
    expect(count.textContent).toBe(`1`)

    // 3. child color click + style binding
    expect(count.style.color).toBe('red')
    triggerEvent('click', container.querySelector('.change')!)
    await nextTick()
    expect(count.style.color).toBe('green')

    // 4. child event emit
    triggerEvent('click', container.querySelector('.emit')!)
    expect(log).toHaveBeenCalledWith('child')

    // 5. child v-model
    const text = container.querySelector('.text')!
    const input = container.querySelector('input')!
    expect(text.textContent).toBe('hello')
    input.value = 'bye'
    triggerEvent('input', input)
    await nextTick()
    expect(text.textContent).toBe('bye')
  })

  // 测试场景：处理ssr模式下的点击错误。
  test('handle click error in ssr mode', async () => {
    const App = {
      setup() {
        const throwError = () => {
          throw new Error('Sentry Error')
        }
        return { throwError }
      },
      template: `
        <div>
          <button class="parent-click" @click="throwError">click me</button>
        </div>`,
    }

    const container = document.createElement('div')
    // server render
    container.innerHTML = await renderToString(h(App))
    // hydrate
    const app = createSSRApp(App)
    const handler = (app.config.errorHandler = vi.fn())
    app.mount(container)
    // assert interactions
    // parent button click
    triggerEvent('click', container.querySelector('.parent-click')!)
    expect(handler).toHaveBeenCalled()
  })

  // 测试场景：ssr 模式下处理模糊错误。
  test('handle blur error in ssr mode', async () => {
    const App = {
      setup() {
        const throwError = () => {
          throw new Error('Sentry Error')
        }
        return { throwError }
      },
      template: `
        <div>
          <input class="parent-click" @blur="throwError"/>
        </div>`,
    }

    const container = document.createElement('div')
    // server render
    container.innerHTML = await renderToString(h(App))
    // hydrate
    const app = createSSRApp(App)
    const handler = (app.config.errorHandler = vi.fn())
    app.mount(container)
    // assert interactions
    // parent blur event
    triggerEvent('blur', container.querySelector('.parent-click')!)
    expect(handler).toHaveBeenCalled()
  })

  // 测试场景：水合包含异步依赖的 Suspense，并在 resolve 后保持 DOM 一致。
  test('Suspense', async () => {
    const AsyncChild = {
      async setup() {
        const count = ref(0)
        return () =>
          h(
            'span',
            {
              onClick: () => {
                count.value++
              },
            },
            count.value,
          )
      },
    }
    const { vnode, container } = mountWithHydration('<span>0</span>', () =>
      h(Suspense, () => h(AsyncChild)),
    )
    expect(vnode.el).toBe(container.firstChild)
    // wait for hydration to finish
    await new Promise(r => setTimeout(r))
    triggerEvent('click', container.querySelector('span')!)
    await nextTick()
    expect(container.innerHTML).toBe(`<span>1</span>`)
  })

  // #6638
  // 测试场景：Suspense + 异步组件。
  test('Suspense + async component', async () => {
    let isSuspenseResolved = false
    let isSuspenseResolvedInChild: any
    const AsyncChild = defineAsyncComponent(() =>
      Promise.resolve(
        defineComponent({
          setup() {
            isSuspenseResolvedInChild = isSuspenseResolved
            const count = ref(0)
            return () =>
              h(
                'span',
                {
                  onClick: () => {
                    count.value++
                  },
                },
                count.value,
              )
          },
        }),
      ),
    )
    const { vnode, container } = mountWithHydration('<span>0</span>', () =>
      h(
        Suspense,
        {
          onResolve() {
            isSuspenseResolved = true
          },
        },
        () => h(AsyncChild),
      ),
    )
    expect(vnode.el).toBe(container.firstChild)
    // wait for hydration to finish
    await new Promise(r => setTimeout(r))

    expect(isSuspenseResolvedInChild).toBe(false)
    expect(isSuspenseResolved).toBe(true)

    // assert interaction
    triggerEvent('click', container.querySelector('span')!)
    await nextTick()
    expect(container.innerHTML).toBe(`<span>1</span>`)
  })

  // 测试场景：Suspense（完全集成）。
  test('Suspense (full integration)', async () => {
    const mountedCalls: number[] = []
    const asyncDeps: Promise<any>[] = []

    const AsyncChild = defineComponent({
      props: ['n'],
      async setup(props) {
        const count = ref(props.n)
        onMounted(() => {
          mountedCalls.push(props.n)
        })
        const p = new Promise(r => setTimeout(r, props.n * 10))
        asyncDeps.push(p)
        await p
        return () =>
          h(
            'span',
            {
              onClick: () => {
                count.value++
              },
            },
            count.value,
          )
      },
    })

    const done = vi.fn()
    const App = {
      template: `
      <Suspense @resolve="done">
        <div>
          <AsyncChild :n="1" />
          <AsyncChild :n="2" />
        </div>
      </Suspense>`,
      components: {
        AsyncChild,
      },
      methods: {
        done,
      },
    }

    const container = document.createElement('div')
    // server render
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div><span>1</span><span>2</span></div>"`,
    )
    // reset asyncDeps from ssr
    asyncDeps.length = 0
    // hydrate
    createSSRApp(App).mount(container)

    expect(mountedCalls.length).toBe(0)
    expect(asyncDeps.length).toBe(2)

    // wait for hydration to complete
    await Promise.all(asyncDeps)
    await new Promise(r => setTimeout(r))

    // should flush buffered effects
    expect(mountedCalls).toMatchObject([1, 2])
    expect(container.innerHTML).toMatch(
      `<div><span>1</span><span>2</span></div>`,
    )

    const span1 = container.querySelector('span')!
    triggerEvent('click', span1)
    await nextTick()
    expect(container.innerHTML).toMatch(
      `<div><span>2</span><span>2</span></div>`,
    )

    const span2 = span1.nextSibling as Element
    triggerEvent('click', span2)
    await nextTick()
    expect(container.innerHTML).toMatch(
      `<div><span>2</span><span>3</span></div>`,
    )
  })

  // 测试场景：异步组件。
  test('async component', async () => {
    const spy = vi.fn()
    const Comp = () =>
      h(
        'button',
        {
          onClick: spy,
        },
        'hello!',
      )

    let serverResolve: any
    let AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          serverResolve = r
        }),
    )

    const App = {
      render() {
        return ['hello', h(AsyncComp), 'world']
      },
    }

    // server render
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(
      `"<!--[-->hello<button>hello!</button>world<!--]-->"`,
    )

    // hydration
    let clientResolve: any
    AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          clientResolve = r
        }),
    )

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    // hydration not complete yet
    triggerEvent('click', container.querySelector('button')!)
    expect(spy).not.toHaveBeenCalled()

    // resolve
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // should be hydrated now
    triggerEvent('click', container.querySelector('button')!)
    expect(spy).toHaveBeenCalled()
  })

  // #15091
  async function assertSkipLazyHydration(detached: 'root' | 'ancestor') {
    let observer!: IntersectionObserver
    let observerCallback!: IntersectionObserverCallback
    const originalIntersectionObserver = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) {
        observer = this as any
        observerCallback = callback
      }
      disconnect() {}
      observe() {}
    } as any

    try {
      const Comp = vi.fn(() => h('p', 'hello'))
      const AsyncComp = defineAsyncComponent({
        loader: () => Promise.resolve(Comp),
        hydrate: hydrateOnVisible(),
      })
      const App = () => h(AsyncComp)
      const container = document.createElement('div')

      container.innerHTML = await renderToString(h(App))
      document.body.appendChild(container)
      Comp.mockClear()
      createSSRApp(App).mount(container)

      const el = container.firstElementChild!
      if (detached === 'root') {
        el.remove()
      } else {
        container.remove()
      }
      expect(el.isConnected).toBe(false)

      expect(() =>
        observerCallback(
          [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
          observer,
        ),
      ).not.toThrow()
      expect(Comp).not.toHaveBeenCalled()
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver
    }
  }

  // 测试场景：当 SSR %s 分离时跳过惰性水合。
  test.each(['root', 'ancestor'] as const)(
    'skip lazy hydration when the SSR %s is detached',
    assertSkipLazyHydration,
  )

  // 测试场景：在解析之前更新异步包装器。
  test('update async wrapper before resolve', async () => {
    const Comp = {
      render() {
        return h('h1', 'Async component')
      },
    }
    let serverResolve: any
    let AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          serverResolve = r
        }),
    )

    const toggle = ref(true)
    const App = {
      setup() {
        onMounted(() => {
          // change state, this makes updateComponent(AsyncComp) execute before
          // the async component is resolved
          toggle.value = false
        })

        return () => {
          return [toggle.value ? 'hello' : 'world', h(AsyncComp)]
        }
      },
    }

    // server render
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(
      `"<!--[-->hello<h1>Async component</h1><!--]-->"`,
    )

    // hydration
    let clientResolve: any
    AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          clientResolve = r
        }),
    )

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    // resolve
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // should be hydrated now
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<!--[-->world<h1>Async component</h1><!--]-->"`,
    )
  })

  // #13510
  // 测试场景：在异步组件解析之前父挂载后更新异步组件。
  test('update async component after parent mount before async component resolve', async () => {
    const Comp = {
      props: ['toggle'],
      render(this: any) {
        return h('h1', [
          this.toggle ? 'Async component' : 'Updated async component',
        ])
      },
    }
    let serverResolve: any
    let AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          serverResolve = r
        }),
    )

    const toggle = ref(true)
    const App = {
      setup() {
        onMounted(() => {
          // change state, after mount and before async component resolve
          nextTick(() => (toggle.value = false))
        })

        return () => {
          return h(AsyncComp, { toggle: toggle.value })
        }
      },
    }

    // server render
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(`"<h1>Async component</h1>"`)

    // hydration
    let clientResolve: any
    AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          clientResolve = r
        }),
    )

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    // resolve
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // prevent lazy hydration since the component has been patched
    expect('Skipping lazy hydration for component').toHaveBeenWarned()
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<h1>Updated async component</h1>"`,
    )
  })

  // 测试场景：当异步 setup 使用的属性在渲染前更改时安全地水合。
  test('hydrate safely when property used by async setup changed before render', async () => {
    const toggle = ref(true)

    const AsyncComp = {
      async setup() {
        await new Promise<void>(r => setTimeout(r, 10))
        return () => h('h1', 'Async component')
      },
    }

    const AsyncWrapper = {
      render() {
        return h(AsyncComp)
      },
    }

    const SiblingComp = {
      setup() {
        toggle.value = false
        return () => h('span')
      },
    }

    const App = {
      setup() {
        return () =>
          h(
            Suspense,
            {},
            {
              default: () => [
                h('main', {}, [
                  h(AsyncWrapper, {
                    prop: toggle.value ? 'hello' : 'world',
                  }),
                  h(SiblingComp),
                ]),
              ],
            },
          )
      },
    }

    // server render
    const html = await renderToString(h(App))

    expect(html).toMatchInlineSnapshot(
      `"<main><h1 prop="hello">Async component</h1><span></span></main>"`,
    )

    expect(toggle.value).toBe(false)

    // hydration

    // reset the value
    toggle.value = true
    expect(toggle.value).toBe(true)

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    await new Promise(r => setTimeout(r, 10))

    expect(toggle.value).toBe(false)

    // should be hydrated now
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<main><h1 prop="world">Async component</h1><span></span></main>"`,
    )
  })

  // 测试场景：当深度嵌套异步 setup 使用的属性在渲染之前发生更改时，安全地水合。
  test('hydrate safely when property used by deep nested async setup changed before render', async () => {
    const toggle = ref(true)

    const AsyncComp = {
      async setup() {
        await new Promise<void>(r => setTimeout(r, 10))
        return () => h('h1', 'Async component')
      },
    }

    const AsyncWrapper = { render: () => h(AsyncComp) }
    const AsyncWrapperWrapper = { render: () => h(AsyncWrapper) }

    const SiblingComp = {
      setup() {
        toggle.value = false
        return () => h('span')
      },
    }

    const App = {
      setup() {
        return () =>
          h(
            Suspense,
            {},
            {
              default: () => [
                h('main', {}, [
                  h(AsyncWrapperWrapper, {
                    prop: toggle.value ? 'hello' : 'world',
                  }),
                  h(SiblingComp),
                ]),
              ],
            },
          )
      },
    }

    // server render
    const html = await renderToString(h(App))

    expect(html).toMatchInlineSnapshot(
      `"<main><h1 prop="hello">Async component</h1><span></span></main>"`,
    )

    expect(toggle.value).toBe(false)

    // hydration

    // reset the value
    toggle.value = true
    expect(toggle.value).toBe(true)

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    await new Promise(r => setTimeout(r, 10))

    expect(toggle.value).toBe(false)

    // should be hydrated now
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<main><h1 prop="world">Async component</h1><span></span></main>"`,
    )
  })

  // #3787
  // 测试场景：加载前卸载异步包装器。
  test('unmount async wrapper before load', async () => {
    let resolve: any
    const AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )

    const show = ref(true)
    const root = document.createElement('div')
    root.innerHTML = '<div><div>async</div></div>'

    createSSRApp({
      render() {
        return h('div', [show.value ? h(AsyncComp) : h('div', 'hi')])
      },
    }).mount(root)

    show.value = false
    await nextTick()
    expect(root.innerHTML).toBe('<div><div>hi</div></div>')
    resolve({})
  })

  //#12362
  // 测试场景：嵌套异步包装器。
  test('nested async wrapper', async () => {
    const Toggle = defineAsyncComponent(
      () =>
        new Promise(r => {
          r(
            defineComponent({
              setup(_, { slots }) {
                const show = ref(false)
                onMounted(() => {
                  nextTick(() => {
                    show.value = true
                  })
                })
                return () =>
                  withDirectives(
                    h('div', null, [renderSlot(slots, 'default')]),
                    [[vShow, show.value]],
                  )
              },
            }) as any,
          )
        }),
    )

    const Wrapper = defineAsyncComponent(() => {
      return new Promise(r => {
        r(
          defineComponent({
            render(this: any) {
              return renderSlot(this.$slots, 'default')
            },
          }) as any,
        )
      })
    })

    const count = ref(0)
    const fn = vi.fn()
    const Child = {
      setup() {
        onMounted(() => {
          fn()
          count.value++
        })
        return () => h('div', count.value)
      },
    }

    const App = {
      render() {
        return h(Toggle, null, {
          default: () =>
            h(Wrapper, null, {
              default: () =>
                h(Wrapper, null, {
                  default: () => h(Child),
                }),
            }),
        })
      },
    }

    const root = document.createElement('div')
    root.innerHTML = await renderToString(h(App))
    expect(root.innerHTML).toMatchInlineSnapshot(
      `"<div style="display:none;"><!--[--><!--[--><!--[--><div>0</div><!--]--><!--]--><!--]--></div>"`,
    )

    createSSRApp(App).mount(root)
    await nextTick()
    await nextTick()
    expect(root.innerHTML).toMatchInlineSnapshot(
      `"<div style=""><!--[--><!--[--><!--[--><div>1</div><!--]--><!--]--><!--]--></div>"`,
    )
    expect(fn).toBeCalledTimes(1)
  })

  // 测试场景：加载前卸载异步包装器 (fragment)。
  test('unmount async wrapper before load (fragment)', async () => {
    let resolve: any
    const AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r
        }),
    )

    const show = ref(true)
    const root = document.createElement('div')
    root.innerHTML = '<div><!--[-->async<!--]--></div>'

    createSSRApp({
      render() {
        return h('div', [show.value ? h(AsyncComp) : h('div', 'hi')])
      },
    }).mount(root)

    show.value = false
    await nextTick()
    expect(root.innerHTML).toBe('<div><div>hi</div></div>')
    resolve({})
  })

  // 测试场景：svg 中驼峰式大小写的元素。
  test('elements with camel-case in svg ', () => {
    const { vnode, container } = mountWithHydration(
      '<animateTransform></animateTransform>',
      () => h('animateTransform'),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：SVG 作为挂载容器。
  test('SVG as a mount container', () => {
    const svgContainer = document.createElement('svg')
    svgContainer.innerHTML = '<g></g>'
    const app = createSSRApp({
      render: () => h('g'),
    })

    expect(
      (
        app.mount(svgContainer).$.subTree as VNode<Node, Element> & {
          el: Element
        }
      ).el instanceof SVGElement,
    )
  })

  // 测试场景：带有`.prop`改性剂的强制水合物支柱。
  test('force hydrate prop with `.prop` modifier', () => {
    const { container } = mountWithHydration('<input type="checkbox">', () =>
      h('input', {
        type: 'checkbox',
        '.indeterminate': true,
      }),
    )
    expect((container.firstChild! as any).indeterminate).toBe(true)
  })

  // 测试场景：强制水合物输入 v-model 与非字符串值绑定。
  test('force hydrate input v-model with non-string value bindings', () => {
    const { container } = mountWithHydration(
      '<input type="checkbox" value="true">',
      () =>
        withDirectives(
          createVNode(
            'input',
            { type: 'checkbox', 'true-value': true },
            null,
            PatchFlags.PROPS,
            ['true-value'],
          ),
          [[vModelCheckbox, true]],
        ),
    )
    expect((container.firstChild as any)._trueValue).toBe(true)
  })

  // 测试场景：保留 v-model 水合之前输入的文本。
  test('preserves text entered before v-model hydration', async () => {
    const state = reactive({ text: 'server value' })
    const App = {
      setup: () => state,
      template: `<input v-model="text">`,
    }
    const container = document.createElement('div')
    container.innerHTML = await renderToString(h(App))
    const input = container.firstChild as HTMLInputElement
    input.value = 'user value'

    createSSRApp(App).mount(container)
    await nextTick()

    expect(input.value).toBe('user value')
    expect(state.text).toBe('user value')
  })

  // 测试场景：强制水合物复选框不确定。
  test('force hydrate checkbox with indeterminate', () => {
    const { container } = mountWithHydration(
      '<input type="checkbox" indeterminate>',
      () =>
        createVNode(
          'input',
          { type: 'checkbox', indeterminate: '' },
          null,
          PatchFlags.CACHED,
        ),
    )
    expect((container.firstChild as any).indeterminate).toBe(true)
  })

  // 测试场景：使用非字符串值绑定强制水合物选择选项。
  test('force hydrate select option with non-string value bindings', () => {
    const { container } = mountWithHydration(
      '<select><option value="true">ok</option></select>',
      () =>
        h('select', [
          // hoisted because bound value is a constant...
          createVNode('option', { value: true }, null, -1 /* HOISTED */),
        ]),
    )
    expect((container.firstChild!.firstChild as any)._value).toBe(true)
  })

  // #7203
  // 测试场景：使用动态 props 强制水合自定义元素。
  test('force hydrate custom element with dynamic props', () => {
    class MyElement extends HTMLElement {
      foo = ''
      constructor() {
        super()
      }
    }
    customElements.define('my-element-7203', MyElement)

    const msg = ref('bar')
    const container = document.createElement('div')
    container.innerHTML = '<my-element-7203></my-element-7203>'
    const app = createSSRApp({
      render: () => h('my-element-7203', { foo: msg.value }),
    })
    app.mount(container)
    expect((container.firstChild as any).foo).toBe(msg.value)
  })

  // #14274
  // 测试场景：水合作用期间不应在自定义元素上渲染 ref。
  test('should not render ref on custom element during hydration', () => {
    const container = document.createElement('div')
    container.innerHTML = '<my-element>hello</my-element>'
    const root = ref()
    const app = createSSRApp({
      render: () =>
        h('my-element', {
          ref: root,
          innerHTML: 'hello',
        }),
    })
    app.mount(container)
    expect(container.innerHTML).toBe('<my-element>hello</my-element>')
    expect((container.firstChild as Element).hasAttribute('ref')).toBe(false)
    expect(root.value).toBe(container.firstChild)
  })

  // #5728
  // 测试场景：slot 中的空文本节点。
  test('empty text node in slot', () => {
    const Comp = {
      render(this: any) {
        return renderSlot(this.$slots, 'default', {}, () => [
          createTextVNode(''),
        ])
      },
    }
    const { container, vnode } = mountWithHydration('<!--[--><!--]-->', () =>
      h(Comp),
    )
    expect(container.childNodes.length).toBe(3)
    const text = container.childNodes[1]
    expect(text.nodeType).toBe(3)
    expect(vnode.el).toBe(container.childNodes[0])
    // component => slot fragment => text node
    expect((vnode as any).component?.subTree.children[0].el).toBe(text)
  })

  // #7215
  // 测试场景：空文本节点。
  test('empty text node', () => {
    const Comp = {
      render(this: any) {
        return h('p', [''])
      },
    }
    const { container } = mountWithHydration('<p></p>', () => h(Comp))
    expect(container.childNodes.length).toBe(1)
    const p = container.childNodes[0]
    expect(p.childNodes.length).toBe(1)
    const text = p.childNodes[0]
    expect(text.nodeType).toBe(3)
  })

  // #11372
  // 测试场景：产品中的对象样式值跟踪。
  test('object style value tracking in prod', async () => {
    __DEV__ = false
    try {
      const style = reactive({ color: 'red' })
      const Comp = {
        render(this: any) {
          return (
            openBlock(),
            createElementBlock(
              'div',
              {
                style: normalizeStyle(style),
              },
              null,
              4 /* STYLE */,
            )
          )
        },
      }
      const { container } = mountWithHydration(
        `<div style="color: red;"></div>`,
        () => h(Comp),
      )
      style.color = 'green'
      await nextTick()
      expect(container.innerHTML).toBe(`<div style="color: green;"></div>`)
    } finally {
      __DEV__ = true
    }
  })

  // 测试场景：水合创建的应用调用 app.unmount() 后完整移除已接管 DOM。
  test('app.unmount()', async () => {
    const container = document.createElement('DIV')
    container.innerHTML = '<button></button>'
    const App = defineComponent({
      setup(_, { expose }) {
        const count = ref(0)

        expose({ count })

        return () =>
          h('button', {
            onClick: () => count.value++,
          })
      },
    })

    const app = createSSRApp(App)
    const vm = app.mount(container)
    await nextTick()
    expect((container as any)._vnode).toBeDefined()
    // @ts-expect-error - expose()'d properties are not available on vm type
    expect(vm.count).toBe(0)

    app.unmount()
    expect((container as any)._vnode).toBe(null)
  })

  // #6637
  // 测试场景：字符串化根fragment。
  test('stringified root fragment', () => {
    mountWithHydration(`<!--[--><div></div><!--]-->`, () =>
      createStaticVNode(`<div></div>`, 1),
    )
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：水合首次挂载开启 transition appear 时执行出现过渡钩子。
  test('transition appear', () => {
    const { vnode, container } = mountWithHydration(
      `<template><div>foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            default: () => h('div', 'foo'),
          },
        ),
    )
    expect(container.firstChild).toMatchInlineSnapshot(`
      <div
        class="v-enter-from v-enter-active"
      >
        foo
      </div>
    `)
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：transition 出现与预先存在的类一起工作。
  test('transition appear work with pre-existing class', () => {
    const { vnode, container } = mountWithHydration(
      `<template><div class="foo">foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            default: () => h('div', { class: 'foo' }, 'foo'),
          },
        ),
    )
    expect(container.firstChild).toMatchInlineSnapshot(`
      <div
        class="foo v-enter-from v-enter-active"
      >
        foo
      </div>
    `)
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // #13394
  // 测试场景：transition 出现空内容工作。
  test('transition appear work with empty content', async () => {
    const show = ref(true)
    const { vnode, container } = mountWithHydration(
      `<template><!----></template>`,
      function (this: any) {
        return h(
          Transition,
          { appear: true },
          {
            default: () =>
              show.value
                ? renderSlot(this.$slots, 'default')
                : createTextVNode('foo'),
          },
        )
      },
    )

    // empty slot render as a comment node
    expect(container.firstChild!.nodeType).toBe(Node.COMMENT_NODE)
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()

    show.value = false
    await nextTick()
    expect(container.innerHTML).toBe('foo')
  })

  // 测试场景：transition 与 v-if 一起出现。
  test('transition appear with v-if', () => {
    const show = false
    const { vnode, container } = mountWithHydration(
      `<template><!----></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            default: () => (show ? h('div', 'foo') : createCommentVNode('')),
          },
        ),
    )
    expect(container.firstChild).toMatchInlineSnapshot('<!---->')
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：transition 与 v-show 一起出现。
  test('transition appear with v-show', () => {
    const show = false
    const { vnode, container } = mountWithHydration(
      `<template><div style="display: none;">foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            default: () =>
              withDirectives(createVNode('div', null, 'foo'), [[vShow, show]]),
          },
        ),
    )
    expect(container.firstChild).toMatchInlineSnapshot(`
      <div
        class="v-enter-from v-enter-active"
        style="display: none;"
      >
        foo
      </div>
    `)
    expect((container.firstChild as any)[vShowOriginalDisplay]).toBe('')
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // 测试场景：Transition 首次出现（appear）时，同时正确绑定并触发事件监听器。
  test('transition appear w/ event listener', async () => {
    const container = document.createElement('div')
    container.innerHTML = `<template><button>0</button></template>`
    createSSRApp({
      data() {
        return {
          count: 0,
        }
      },
      template: `
        <Transition appear>
          <button @click="count++">{{count}}</button>
        </Transition>
      `,
    }).mount(container)

    expect(container.firstChild).toMatchInlineSnapshot(`
      <button
        class="v-enter-from v-enter-active"
      >
        0
      </button>
    `)

    triggerEvent('click', container.querySelector('button')!)
    await nextTick()
    expect(container.firstChild).toMatchInlineSnapshot(`
      <button
        class="v-enter-from v-enter-active"
      >
        1
      </button>
    `)
  })

  // 测试场景：Suspense 内容 resolve 后，为水合节点执行 transition appear 钩子。
  test('Suspense + transition appear', async () => {
    const { vnode, container } = mountWithHydration(
      `<template><div>foo</div></template>`,
      () =>
        h(Suspense, {}, () =>
          h(
            Transition,
            { appear: true },
            {
              default: () => h('div', 'foo'),
            },
          ),
        ),
    )

    expect(vnode.el).toBe(container.firstChild)
    // wait for hydration to finish
    await new Promise(r => setTimeout(r))

    expect(container.firstChild).toMatchInlineSnapshot(`
      <div
        class="v-enter-from v-enter-active"
      >
        foo
      </div>
    `)
    await nextTick()
    expect(vnode.el).toBe(container.firstChild)
  })

  // #10607
  // 测试场景：生产构建的优化模式下，组件更新后稳定 slot 仍保持正确内容。
  test('update component stable slot (prod + optimized mode)', async () => {
    __DEV__ = false
    try {
      const container = document.createElement('div')
      container.innerHTML = `<template><div show="false"><!--[--><div><div><!----></div></div><div>0</div><!--]--></div></template>`
      const Comp = {
        render(this: any) {
          return (
            openBlock(),
            createElementBlock('div', null, [
              renderSlot(this.$slots, 'default'),
            ])
          )
        },
      }
      const show = ref(false)
      const clicked = ref(false)

      const Wrapper = {
        setup() {
          const items = ref<number[]>([])
          onMounted(() => {
            items.value = [1]
          })
          return () => {
            return (
              openBlock(),
              createBlock(Comp, null, {
                default: withCtx(() => [
                  createElementVNode('div', null, [
                    createElementVNode('div', null, [
                      clicked.value
                        ? (openBlock(),
                          createElementBlock('div', { key: 0 }, 'foo'))
                        : createCommentVNode('v-if', true),
                    ]),
                  ]),
                  createElementVNode(
                    'div',
                    null,
                    items.value.length,
                    1 /* TEXT */,
                  ),
                ]),
                _: 1 /* STABLE */,
              })
            )
          }
        },
      }
      createSSRApp({
        components: { Wrapper },
        data() {
          return { show }
        },
        template: `<Wrapper :show="show"/>`,
      }).mount(container)

      await nextTick()
      expect(container.innerHTML).toBe(
        `<div show="false"><!--[--><div><div><!----></div></div><div>1</div><!--]--></div>`,
      )

      show.value = true
      await nextTick()
      expect(async () => {
        clicked.value = true
        await nextTick()
      }).not.toThrow("Cannot read properties of null (reading 'insertBefore')")

      await nextTick()
      expect(container.innerHTML).toBe(
        `<div show="true"><!--[--><div><div><div>foo</div></div></div><div>1</div><!--]--></div>`,
      )
    } catch (e) {
      throw e
    } finally {
      __DEV__ = true
    }
  })

  // 测试场景：hmr 重新加载包裹在 KeepAlive 中的子项。
  test('hmr reload child wrapped in KeepAlive', async () => {
    const id = 'child-reload'
    const Child = {
      __hmrId: id,
      template: `<div>foo</div>`,
    }
    createRecord(id, Child)

    const appId = 'test-app-id'
    const App = {
      __hmrId: appId,
      components: { Child },
      template: `
      <div>
        <KeepAlive>
          <Child />
        </KeepAlive>
      </div>
      `,
    }

    const root = document.createElement('div')
    root.innerHTML = await renderToString(h(App))
    createSSRApp(App).mount(root)
    expect(root.innerHTML).toBe('<div><div>foo</div></div>')

    reload(id, {
      __hmrId: id,
      template: `<div>bar</div>`,
    })
    await nextTick()
    expect(root.innerHTML).toBe('<div><div>bar</div></div>')
  })

  // 测试场景：hmr 根重新加载。
  test('hmr root reload', async () => {
    const appId = 'test-app-id'
    const App = {
      __hmrId: appId,
      template: `<div>foo</div>`,
    }

    const root = document.createElement('div')
    root.innerHTML = await renderToString(h(App))
    createSSRApp(App).mount(root)
    expect(root.innerHTML).toBe('<div>foo</div>')

    reload(appId, {
      __hmrId: appId,
      template: `<div>bar</div>`,
    })
    await nextTick()
    expect(root.innerHTML).toBe('<div>bar</div>')
  })

  // 测试组：不匹配处理。
  describe('mismatch handling', () => {
    // 测试场景：文本节点。
    test('text node', () => {
      const { container } = mountWithHydration(`foo`, () => 'bar')
      expect(container.textContent).toBe('bar')
      expect(`Hydration text mismatch`).toHaveBeenWarned()
    })

    // 测试场景：元素文本内容。
    test('element text content', () => {
      const { container } = mountWithHydration(`<div>foo</div>`, () =>
        h('div', 'bar'),
      )
      expect(container.innerHTML).toBe('<div>bar</div>')
      expect(`Hydration text content mismatch`).toHaveBeenWarned()
    })

    // 测试场景：服务端 DOM 的 children 少于客户端 VNode。
    test('not enough children', () => {
      const { container } = mountWithHydration(`<div></div>`, () =>
        h('div', [h('span', 'foo'), h('span', 'bar')]),
      )
      expect(container.innerHTML).toBe(
        '<div><span>foo</span><span>bar</span></div>',
      )
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // 测试场景：服务端 DOM 的 children 多于客户端 VNode。
    test('too many children', () => {
      const { container } = mountWithHydration(
        `<div><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('span', 'foo')]),
      )
      expect(container.innerHTML).toBe('<div><span>foo</span></div>')
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // 测试场景：删除多余节点时检查一次子项不匹配。
    test('children mismatch is checked once when removing excess nodes', () => {
      const hasAttribute = vi.spyOn(Element.prototype, 'hasAttribute')

      try {
        const { container } = mountWithHydration(
          `<div><span>foo</span><span>bar</span><span>baz</span></div>`,
          () => h('div', [h('span', 'foo')]),
        )
        const el = container.firstChild as Element
        const allowMismatchCheckCount = hasAttribute.mock.calls.filter(
          ([key], i) =>
            key === 'data-allow-mismatch' &&
            hasAttribute.mock.contexts[i] === el,
        ).length

        expect(container.innerHTML).toBe('<div><span>foo</span></div>')
        expect(`Hydration children mismatch`).toHaveBeenWarnedTimes(1)
        expect(allowMismatchCheckCount).toBe(1)
      } finally {
        hasAttribute.mockRestore()
      }
    })

    // 测试场景：挂载缺失节点时检查一次子项不匹配。
    test('children mismatch is checked once when mounting missing nodes', () => {
      const hasAttribute = vi.spyOn(Element.prototype, 'hasAttribute')

      try {
        const { container } = mountWithHydration(`<div></div>`, () =>
          h('div', [h('span', 'foo'), h('span', 'bar'), h('span', 'baz')]),
        )
        const el = container.firstChild as Element
        const allowMismatchCheckCount = hasAttribute.mock.calls.filter(
          ([key], i) =>
            key === 'data-allow-mismatch' &&
            hasAttribute.mock.contexts[i] === el,
        ).length

        expect(container.innerHTML).toBe(
          '<div><span>foo</span><span>bar</span><span>baz</span></div>',
        )
        expect(`Hydration children mismatch`).toHaveBeenWarnedTimes(1)
        expect(allowMismatchCheckCount).toBe(1)
      } finally {
        hasAttribute.mockRestore()
      }
    })

    // 测试场景：完全不匹配。
    test('complete mismatch', () => {
      const { container } = mountWithHydration(
        `<div><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('div', 'foo'), h('p', 'bar')]),
      )
      expect(container.innerHTML).toBe('<div><div>foo</div><p>bar</p></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarnedTimes(2)
    })

    // 测试场景：fragment 不匹配消除。
    test('fragment mismatch removal', () => {
      const { container } = mountWithHydration(
        `<div><!--[--><div>foo</div><div>bar</div><!--]--></div>`,
        () => h('div', [h('span', 'replaced')]),
      )
      expect(container.innerHTML).toBe('<div><span>replaced</span></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 测试场景：服务端 Fragment 的 children 少于客户端 VNode。
    test('fragment not enough children', () => {
      const { container } = mountWithHydration(
        `<div><!--[--><div>foo</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo'), h('div', 'bar')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>',
      )
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 测试场景：服务端 Fragment 的 children 多于客户端 VNode。
    test('fragment too many children', () => {
      const { container } = mountWithHydration(
        `<div><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div><!--[--><div>foo</div><!--]--><div>baz</div></div>',
      )
      // fragment ends early and attempts to hydrate the extra <div>bar</div>
      // as 2nd fragment child.
      expect(`Hydration text content mismatch`).toHaveBeenWarned()
      // excessive children removal
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // 测试场景：Teleport 目标有空子项。
    test('Teleport target has empty children', () => {
      const teleportContainer = document.createElement('div')
      teleportContainer.id = 'teleport'
      document.body.appendChild(teleportContainer)

      mountWithHydration('<!--teleport start--><!--teleport end-->', () =>
        h(Teleport, { to: '#teleport' }, [h('span', 'value')]),
      )
      expect(teleportContainer.innerHTML).toBe(`<span>value</span>`)
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（元素）。
    test('comment mismatch (element)', () => {
      const { container } = mountWithHydration(`<div><span></span></div>`, () =>
        h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe('<div><!--hi--></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（文本）。
    test('comment mismatch (text)', () => {
      const { container } = mountWithHydration(`<div>foobar</div>`, () =>
        h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe('<div><!--hi--></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 测试场景：类别不匹配。
    test('class mismatch', () => {
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: ['foo', 'bar'] }),
      )
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: { foo: true, bar: true } }),
      )
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: 'foo bar' }),
      )
      // SVG classes
      mountWithHydration(`<svg class="foo bar"></svg>`, () =>
        h('svg', { class: 'foo bar' }),
      )
      // class with different order
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: 'bar foo' }),
      )
      expect(`Hydration class mismatch`).not.toHaveBeenWarned()
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: 'foo' }),
      )
      expect(`Hydration class mismatch`).toHaveBeenWarned()
    })

    // 测试场景：检测并报告服务端与客户端的 style 不匹配。
    test('style mismatch', () => {
      mountWithHydration(`<div style="color:red;"></div>`, () =>
        h('div', { style: { color: 'red' } }),
      )
      mountWithHydration(`<div style="color:red;"></div>`, () =>
        h('div', { style: `color:red;` }),
      )
      mountWithHydration(
        `<div style="color:red; font-size: 12px;"></div>`,
        () => h('div', { style: `font-size: 12px; color:red;` }),
      )
      mountWithHydration(`<div style="color:red;display:none;"></div>`, () =>
        withDirectives(createVNode('div', { style: 'color: red' }, ''), [
          [vShow, false],
        ]),
      )
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
      mountWithHydration(`<div style="color:red;"></div>`, () =>
        h('div', { style: { color: 'green' } }),
      )
      expect(`Hydration style mismatch`).toHaveBeenWarnedTimes(1)
    })

    // 测试场景：服务端节点没有 style attribute 时，水合过程仍能检测样式不匹配。
    test('style mismatch when no style attribute is present', () => {
      mountWithHydration(`<div></div>`, () =>
        h('div', { style: { color: 'red' } }),
      )
      expect(`Hydration style mismatch`).toHaveBeenWarnedTimes(1)
    })

    // 测试场景：v-show 改写 display 时仍能正确判断 style 是否不匹配。
    test('style mismatch w/ v-show', () => {
      mountWithHydration(`<div style="color:red;display:none"></div>`, () =>
        withDirectives(createVNode('div', { style: 'color: red' }, ''), [
          [vShow, false],
        ]),
      )
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
      mountWithHydration(`<div style="color:red;"></div>`, () =>
        withDirectives(createVNode('div', { style: 'color: red' }, ''), [
          [vShow, false],
        ]),
      )
      expect(`Hydration style mismatch`).toHaveBeenWarnedTimes(1)
    })

    // 测试场景：属性不匹配。
    test('attr mismatch', () => {
      mountWithHydration(`<div id="foo"></div>`, () => h('div', { id: 'foo' }))
      mountWithHydration(`<div spellcheck></div>`, () =>
        h('div', { spellcheck: '' }),
      )
      mountWithHydration(`<div></div>`, () => h('div', { id: undefined }))
      // boolean
      mountWithHydration(`<select multiple></div>`, () =>
        h('select', { multiple: true }),
      )
      mountWithHydration(`<select multiple></div>`, () =>
        h('select', { multiple: 'multiple' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div></div>`, () => h('div', { id: 'foo' }))
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(1)

      mountWithHydration(`<div id="bar"></div>`, () => h('div', { id: 'foo' }))
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(2)
    })

    // 测试场景：attr 特殊情况：textarea 值。
    test('attr special case: textarea value', () => {
      mountWithHydration(`<textarea>foo</textarea>`, () =>
        h('textarea', { value: 'foo' }),
      )
      mountWithHydration(`<textarea></textarea>`, () =>
        h('textarea', { value: '' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<textarea>foo</textarea>`, () =>
        h('textarea', { value: 'bar' }),
      )
      expect(`Hydration attribute mismatch`).toHaveBeenWarned()
    })

    // #11873
    // 测试场景：<textarea> 开头有换行符。
    test('<textarea> with newlines at the beginning', async () => {
      const render = () => h('textarea', null, '\nhello')
      const html = await renderToString(createSSRApp({ render }))
      mountWithHydration(html, render)
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：<pre> 开头有换行符。
    test('<pre> with newlines at the beginning', async () => {
      const render = () => h('pre', null, '\n')
      const html = await renderToString(createSSRApp({ render }))
      mountWithHydration(html, render)
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：布尔属性处理。
    test('boolean attr handling', () => {
      mountWithHydration(`<input />`, () => h('input', { readonly: false }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<input readonly />`, () =>
        h('input', { readonly: true }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<input readonly="readonly" />`, () =>
        h('input', { readonly: true }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：隐藏枚举属性。
    test('hidden enumerated attribute', () => {
      mountWithHydration(`<div></div>`, () => h('div', { hidden: false }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden></div>`, () => h('div', { hidden: true }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden></div>`, () =>
        h('div', { hidden: 'hidden' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden="anything"></div>`, () =>
        h('div', { hidden: true }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden="until-found"></div>`, () =>
        h('div', { hidden: 'until-found' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden="UNTIL-FOUND"></div>`, () =>
        h('div', { hidden: 'until-found' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：隐藏数值。
    test('hidden numeric values', () => {
      mountWithHydration(`<div></div>`, () => h('div', { hidden: 0 }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div></div>`, () => h('div', { hidden: NaN }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden></div>`, () => h('div', { hidden: 1 }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<div hidden="0"></div>`, () =>
        h('div', { hidden: '0' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：隐藏状态不匹配。
    test('hidden state mismatch', () => {
      mountWithHydration(`<div hidden="until-found"></div>`, () =>
        h('div', { hidden: true }),
      )
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(1)

      mountWithHydration(`<div hidden></div>`, () => h('div', { hidden: 0 }))
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(2)
    })

    // 测试场景：客户端值为空或未定义。
    test('client value is null or undefined', () => {
      mountWithHydration(`<div></div>`, () =>
        h('div', { draggable: undefined }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<input />`, () => h('input', { type: null }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：不应针对对象值发出警告。
    test('should not warn against object values', () => {
      mountWithHydration(`<input />`, () => h('input', { from: {} }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：falsey 值绑定到非 attribute DOM property 时不应产生错误警告。
    test('should not warn on falsy bindings of non-property keys', () => {
      mountWithHydration(`<button />`, () => h('button', { href: undefined }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：不应对不可渲染的选项值发出警告。
    test('should not warn on non-renderable option values', () => {
      mountWithHydration(`<select><option>hello</option></select>`, () =>
        h('select', [h('option', { value: ['foo'] }, 'hello')]),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：不应警告 css v-bind。
    test('should not warn css v-bind', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="--foo:red;color:var(--foo);" />`
      const app = createSSRApp({
        setup() {
          useCssVars(() => ({
            foo: 'red',
          }))
          return () => h('div', { style: { color: 'var(--foo)' } })
        },
      })
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // #10317 - test case from #10325
    // 测试场景：css 变量只能添加到组件根 dom 上的预期位置。
    test('css vars should only be added to expected on component root dom', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="--foo:red;"><div style="color:var(--foo);" /></div>`
      const app = createSSRApp({
        setup() {
          useCssVars(() => ({
            foo: 'red',
          }))
          return () =>
            h('div', null, [h('div', { style: { color: 'var(--foo)' } })])
        },
      })
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // #11188
    // 测试场景：css 变量支持失败。
    test('css vars support fallthrough', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="padding: 4px;--foo:red;"></div>`
      const app = createSSRApp({
        setup() {
          useCssVars(() => ({
            foo: 'red',
          }))
          return () => h(Child)
        },
      })
      const Child = {
        setup() {
          return () => h('div', { style: 'padding: 4px' })
        },
      }
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // #11189
    // 测试场景：不应该对创建的 DOM 变异的指令发出警告。
    test('should not warn for directives that mutate DOM in created', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div class="test red"></div>`
      const vColor: ObjectDirective = {
        created(el, binding) {
          el.classList.add(binding.value)
        },
      }
      const app = createSSRApp({
        setup() {
          return () =>
            withDirectives(h('div', { class: 'test' }), [[vColor, 'red']])
        },
      })
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：禁用 teleport + 未定义目标。
    test('with disabled teleport + undefined target', async () => {
      const container = document.createElement('div')
      const isOpen = ref(false)
      const App = {
        setup() {
          return { isOpen }
        },
        template: `
          <Teleport :to="undefined" :disabled="true">
            <div v-if="isOpen">
              Menu is open...
            </div>
          </Teleport>`,
      }
      container.innerHTML = await renderToString(h(App))
      const app = createSSRApp(App)
      app.mount(container)
      isOpen.value = true
      await nextTick()
      expect(container.innerHTML).toBe(
        `<!--teleport start--><div> Menu is open... </div><!--teleport end-->`,
      )
    })

    // 测试场景：转义CSS变量名称。
    test('escape css var name', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="padding: 4px;--foo\\.bar:red;"></div>`
      const app = createSSRApp({
        setup() {
          useCssVars(() => ({
            'foo.bar': 'red',
          }))
          return () => h(Child)
        },
      })
      const Child = {
        setup() {
          return () => h('div', { style: 'padding: 4px' })
        },
      }
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })
  })

  // 测试组：数据允许不匹配。
  describe('data-allow-mismatch', () => {
    // 测试场景：元素文本内容。
    test('element text content', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="text">foo</div>`,
        () => h('div', 'bar'),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="text">bar</div>',
      )
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：允许 children 差异时，服务端 DOM 节点不足不会警告。
    test('not enough children', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"></div>`,
        () => h('div', [h('span', 'foo'), h('span', 'bar')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><span>foo</span><span>bar</span></div>',
      )
      expect(`Hydration children mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：允许 children 差异时，服务端 DOM 节点过多不会警告。
    test('too many children', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('span', 'foo')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><span>foo</span></div>',
      )
      expect(`Hydration children mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：完全不匹配。
    test('complete mismatch', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('div', 'foo'), h('p', 'bar')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><div>foo</div><p>bar</p></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：fragment 不匹配消除。
    test('fragment mismatch removal', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><!--[--><div>foo</div><div>bar</div><!--]--></div>`,
        () => h('div', [h('span', 'replaced')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><span>replaced</span></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：允许 children 差异时，服务端 Fragment 节点不足不会警告。
    test('fragment not enough children', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><!--[--><div>foo</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo'), h('div', 'bar')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：允许 children 差异时，服务端 Fragment 节点过多不会警告。
    test('fragment too many children', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><!--[--><div>foo</div><!--]--><div>baz</div></div>',
      )
      // fragment ends early and attempts to hydrate the extra <div>bar</div>
      // as 2nd fragment child.
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
      // excessive children removal
      expect(`Hydration children mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（元素）。
    test('comment mismatch (element)', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><span></span></div>`,
        () => h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><!--hi--></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：注释不匹配 (v-if)。
    test('comment mismatch (v-if)', () => {
      const { container } = mountWithHydration(`<!--v-if-->`, () =>
        h('div', { 'data-allow-mismatch': '' }, [h('span', 'value')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch=""><span>value</span></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（v-if 分支已删除）。
    test('comment mismatch (v-if branch removed)', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch=""><span>value</span></div>`,
        () => createCommentVNode('v-if', true),
      )
      expect(container.innerHTML).toBe('<!--v-if-->')
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：节点不匹配（v-else 分支）。
    test('node mismatch (v-else branches)', () => {
      const { container } = mountWithHydration(
        `<span data-allow-mismatch="">server</span>`,
        () => h('div', { 'data-allow-mismatch': '' }, 'client'),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="">client</div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（v-if）只允许子项不匹配。
    test('comment mismatch (v-if) only allows children mismatches', () => {
      const { container } = mountWithHydration(`<!--v-if-->`, () =>
        h('div', { 'data-allow-mismatch': 'class' }, [h('span', 'value')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="class"><span>value</span></div>',
      )
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 测试场景：注释不匹配（文本）。
    test('comment mismatch (text)', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children">foobar</div>`,
        () => h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><!--hi--></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：类别不匹配。
    test('class mismatch', () => {
      mountWithHydration(
        `<div class="foo bar" data-allow-mismatch="class"></div>`,
        () => h('div', { class: 'foo' }),
      )
      expect(`Hydration class mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：data-allow-mismatch 允许忽略 style 差异。
    test('style mismatch', () => {
      mountWithHydration(
        `<div style="color:red;" data-allow-mismatch="style"></div>`,
        () => h('div', { style: { color: 'green' } }),
      )
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // 测试场景：属性不匹配。
    test('attr mismatch', () => {
      mountWithHydration(`<div data-allow-mismatch="attribute"></div>`, () =>
        h('div', { id: 'foo' }),
      )
      mountWithHydration(
        `<div id="bar" data-allow-mismatch="attribute"></div>`,
        () => h('div', { id: 'foo' }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // #9033
    // 测试场景：水合时强制贴片动态props。
    test('force patch dynamic props when hydrating', () => {
      __DEV__ = false
      try {
        const { container } = mountWithHydration(
          `<div><div>server</div></div>`,
          () => (
            openBlock(),
            createElementBlock('div', null, [
              createElementVNode(
                'div',
                { innerHTML: 'client' },
                null,
                PatchFlags.PROPS,
                ['innerHTML'],
              ),
            ])
          ),
        )
        expect(container.innerHTML).toBe(`<div><div>client</div></div>`)
      } finally {
        __DEV__ = true
      }
    })

    // 测试场景：水合时不重写未更改的资源props。
    test('does not re-write unchanged resource props when hydrating', () => {
      __DEV__ = false
      try {
        const container = document.createElement('div')
        container.innerHTML = `<img src="/foo.png">`
        const el = container.firstChild as HTMLImageElement
        const setSrc = vi.fn()
        Object.defineProperty(el, 'src', {
          configurable: true,
          get: () => el.getAttribute('src'),
          set: setSrc,
        })
        createSSRApp({
          render: () =>
            createElementVNode(
              'img',
              { src: '/foo.png' },
              null,
              PatchFlags.PROPS,
              ['src'],
            ),
        }).mount(container)
        expect(setSrc).not.toHaveBeenCalled()
        expect(el.getAttribute('src')).toBe('/foo.png')
      } finally {
        __DEV__ = true
      }
    })

    // 测试场景：当服务器和客户端值不同时仍然修补资源 props。
    test('still patches resource props when server and client values differ', () => {
      __DEV__ = false
      try {
        const { container } = mountWithHydration(
          `<img src="/server.png">`,
          () =>
            createElementVNode(
              'img',
              { src: '/client.png' },
              null,
              PatchFlags.PROPS,
              ['src'],
            ),
        )
        const el = container.firstChild as HTMLImageElement
        expect(el.getAttribute('src')).toBe('/client.png')
      } finally {
        __DEV__ = true
      }
    })

    // 测试场景：在水合时强制修补 svg 动态 props 具有正确的命名空间。
    test('force patch svg dynamic props with correct namespace when hydrating', () => {
      __DEV__ = false
      try {
        const { container } = mountWithHydration(
          `<svg width="24" height="24" viewBox="0 0 24 24"></svg>`,
          () =>
            createElementVNode(
              'svg',
              { width: 48, height: 48, viewBox: '0 0 48 48' },
              null,
              PatchFlags.PROPS,
              ['width', 'height', 'viewBox'],
            ),
        )
        const el = container.firstChild as Element
        expect(el.namespaceURI).toContain('svg')
        expect(el.getAttribute('width')).toBe('48')
        expect(el.getAttribute('height')).toBe('48')
        expect(el.getAttribute('viewBox')).toBe('0 0 48 48')
      } finally {
        __DEV__ = true
      }
    })

    // 测试场景：在水合时使用正确的命名空间强制修补 foreignObject 动态 props。
    test('force patch foreignObject dynamic props with correct namespace when hydrating', () => {
      __DEV__ = false
      try {
        const container = document.createElement('div')
        container.innerHTML =
          '<svg><foreignObject width="24"></foreignObject></svg>'
        const el = container.querySelector('foreignObject')!
        expect(el.namespaceURI).toContain('svg')
        // jsdom doesn't implement SVGForeignObjectElement.width.
        Object.defineProperty(el, 'width', {
          configurable: true,
          get: () => 24,
        })

        createSSRApp({
          render: () => (
            openBlock(),
            createElementBlock('svg', null, [
              (openBlock(),
              createElementBlock(
                'foreignObject',
                { width: 48 },
                null,
                PatchFlags.PROPS,
                ['width'],
              )),
            ])
          ),
        }).mount(container)

        expect(el.getAttribute('width')).toBe('48')
      } finally {
        __DEV__ = true
      }
    })

    // 测试场景：仅水合阶段声明为动态的 props 也必须执行必要修补。
    test('only patches declared dynamic props when hydrating', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="attribute" id="server" value="server"></div>`,
        () =>
          createVNode(
            'div',
            {
              'data-allow-mismatch': 'attribute',
              id: 'client',
              value: 'client',
            },
            null,
            PatchFlags.PROPS,
            ['id'],
          ),
      )
      const el = container.firstChild as Element

      expect(el.getAttribute('id')).toBe('client')
      expect(el.getAttribute('value')).toBe('server')
    })
  })
})
