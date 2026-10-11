/**
 * jsdom 容器先写入 SSR HTML，mountWithHydration 再用 createSSRApp 认领；用例比较节点引用与最终 DOM。
 * 模板用例开启静态提升并注册编译器；beforeEach 清空 document.body，避免目标元素和页面节点跨用例残留。
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
 * 把模板编译成可执行 render，并写入 _rc 供运行时编译代理识别。默认 hoistStatic:true，调用方 options 可覆盖默认配置；编译结果通过 runtimeDom 注入执行，返回 InternalRenderFunction。
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
 * 以给定 SSR HTML 预填一个脱离文档的 div，再用 createSSRApp 的根 render 水合该 DOM。
 *
 * @param html 由测试手写或 server-renderer 产生的初始标记
 * @param render 客户端预期 VNode 内容，既用于水合也用于后续响应式更新
 * @returns 根组件 subTree VNode 与容器；调用方可比较 el/anchor 的 DOM 身份、认领内容和后续变更。
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

  // 以 SSR 文本 foo 水合读取 msg 的根 render，确认复用首节点；把 msg 改为 bar 并刷新后，容器文本也变为 bar。
  test('text', async () => {
    const msg = ref('foo')
    const { vnode, container } = mountWithHydration('foo', () => msg.value)
    expect(vnode.el).toBe(container.firstChild)
    expect(container.textContent).toBe('foo')
    msg.value = 'bar'
    await nextTick()
    expect(container.textContent).toBe('bar')
  })

  // SSR 空 div 对应客户端空 Text child，水合后内容仍为空且没有 children mismatch 警告；本例未单独断言新建 Text 的节点类型。
  test('empty text', async () => {
    const { container } = mountWithHydration('<div></div>', () =>
      h('div', createTextVNode('')),
    )
    expect(container.textContent).toBe('')
    expect(`Hydration children mismatch in <div>`).not.toHaveBeenWarned()
  })

  // SSR 文本使用 LF，客户端分别使用 CRLF 与 CR，水合后不报告 text mismatch，检查换行归一比较。
  test('text w/ newlines', async () => {
    mountWithHydration('<div>1\n2\n3</div>', () => h('div', '1\r\n2\r3'))
    expect(`Hydration text mismatch`).not.toHaveBeenWarned()
  })

  // 以 SSR 空注释水合返回 null 的根，断言复用原首节点且其 nodeType 为 8。
  test('comment', () => {
    const { vnode, container } = mountWithHydration('<!---->', () => null)
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.el.nodeType).toBe(8) // 注释节点。
  })

  // 客户端创建数量为 1 的空内容 Static VNode，水合认领 SSR div；el/anchor 指向原首节点，children 采用其 HTML。
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

  // 两个 Static 元素夹在 hi/ho div 之间，水合后分别核对邻接节点、Static 起止引用和采用的静态 HTML，检查按数量推进游标。
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
  // Static 范围从 Text 起始并包含 span 与尾 Text，水合后 el/anchor 指向容器首尾且无 node mismatch 警告。
  test('static (with text node as starting node)', () => {
    const html = ` A <span>foo</span> B`
    const { vnode, container } = mountWithHydration(html, () =>
      createStaticVNode(` A <span>foo</span> B`, 3),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(vnode.anchor).toBe(container.lastChild)
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
  })

  // 客户端 Static 内容为空而数量为 3，水合认领 SSR Text/span/Text 范围并把原 HTML 写入 vnode.children；起止引用与警告均核对。
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

  // 水合 SSR class/text 为 foo 的 div 并确认复用根；msg 改 bar 后刷新，class 与文本一起更新为 bar。
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
  // SSR 合并文本 foo0o 对应字符串、Text VNode 和数字等连续 children，水合后文本仍为 foo0o；本例没有匹配失配警告。
  test('element with multiple continuous text vnodes', async () => {
    // 连续 Text children 对应 SSR 合并文本；此处只匹配最终 textContent。
    const { container } = mountWithHydration('<div>foo0o</div>', () =>
      h('div', ['fo', createTextVNode('o'), 0, 'o']),
    )
    expect(container.textContent).toBe('foo0o')
  })

  // SSR 两个 span 被客户端子 VNode 逐一认领，点击现有 class=foo 的节点触发 spy；msg 改 bar 后两个 span 的文本/class 更新。
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

    // 在已认领的节点上派发 click，检查监听器已绑定。
    triggerEvent('click', vnode.el.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(vnode.el.innerHTML).toBe(`<span>bar</span><span class="bar"></span>`)
  })

  // SSR div 经客户端 ref 绑定水合，根 el 复用首节点，ref.value 与该节点为同一对象。
  test('element with ref', () => {
    const el = ref()
    const { vnode, container } = mountWithHydration('<div></div>', () =>
      h('div', { ref: el }),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(el.value).toBe(vnode.el)
  })

  // SSR 两层 Fragment 注释包围两个 span，水合逐项核对两组起止锚点与子节点；点击及 msg 更新后仍保留正确 Fragment 结构。
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

    // 外层 Fragment 的起始锚点。
    const fragment1 = (vnode.children as VNode[])[0]
    expect(fragment1.el).toBe(vnode.el.childNodes[0])
    const fragment1Children = fragment1.children as VNode[]

    // 外层第一个 span 应认领相同 DOM。
    expect(fragment1Children[0].el!.tagName).toBe('SPAN')
    expect(fragment1Children[0].el).toBe(vnode.el.childNodes[1])

    // 内层 Fragment 的起始锚点。
    const fragment2 = fragment1Children[1]
    expect(fragment2.el).toBe(vnode.el.childNodes[2])
    const fragment2Children = fragment2.children as VNode[]

    // 内层 span 应认领相同 DOM。
    expect(fragment2Children[0].el!.tagName).toBe('SPAN')
    expect(fragment2Children[0].el).toBe(vnode.el.childNodes[3])

    // 内层 Fragment 的结束锚点。
    expect(fragment2.anchor).toBe(vnode.el.childNodes[4])

    // 外层 Fragment 的结束锚点。
    expect(fragment1.anchor).toBe(vnode.el.childNodes[5])

    // 在已认领的节点上派发 click，检查监听器已绑定。
    triggerEvent('click', vnode.el.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(vnode.el.innerHTML).toBe(
      `<!--[--><span>bar</span><!--[--><span class="bar"></span><!--]--><!--]-->`,
    )
  })

  // #7285
  // SSR Fragment 中合并文本 fooo 对应多个连续 Text children，水合后 textContent 为 fooo；此例没有检查警告调用。
  test('Fragment (multiple continuous text vnodes)', async () => {
    // 连续 Text children 对应 SSR 合并文本；此处只匹配最终 textContent。
    const { container } = mountWithHydration('<!--[-->fooo<!--]-->', () => [
      'fo',
      createTextVNode('o'),
      'o',
    ])
    expect(container.textContent).toBe('fooo')
  })

  // 主树只有 Teleport 占位，#teleport 预填两个 span 与目标锚点；水合核对主树/目标引用，随后点击和 msg 更新修改目标内容。
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

    // 在已认领的节点上派发 click，检查监听器已绑定。
    triggerEvent('click', teleportContainer.querySelector('.foo')!)
    expect(fn).toHaveBeenCalled()

    msg.value = 'bar'
    await nextTick()
    expect(teleportContainer.innerHTML).toBe(
      `<!--teleport start anchor--><span>bar</span><span class="bar"></span><!--teleport anchor-->`,
    )
  })

  // 两个 Teleport 的 SSR 输出共享 #teleport2，水合按目标锚点认领各自范围；分别点击与更新 msg，检查两组内容及监听器不串用。
  test('Teleport (multiple + integration)', async () => {
    const msg = ref('foo')
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 返回两个指向同一 #teleport2 的 Teleport；分别绑定 msg、msg+2 和独立 click spy，供 SSR 目标锚点分段认领与后续两组交互检查。
     */
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

    // 在已认领的节点上派发 click，检查监听器已绑定。
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

  // disabled Teleport 的 SSR children 位于主树，水合认领主树锚点/相邻节点及空目标锚点；两组点击和 msg 更新仍作用于原地内容。
  test('Teleport (disabled)', async () => {
    const msg = ref('foo')
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    /**
     * 返回 div、disabled Teleport 与相邻 div；Teleport children 留在主树，两个 click spy 和 msg 更新检查水合游标没有跨越主树锚点。
     */
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

    // 在已认领的节点上派发 click，检查监听器已绑定。
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
  // 父 Fragment 内以 disabled Teleport 作为组件根，水合后 body 仍空、主容器结构保留且无总失配警告，检查根范围游标。
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

  // wrapper 以 Teleport 为唯一根，水合后 wrapper.el/subTree.el 对准主树起点，subTree.anchor 对准终点，后继 div 仍认领正确。
  test('Teleport (as component root)', () => {
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'teleport4'
    teleportContainer.innerHTML = `<!--teleport start anchor-->hello<!--teleport anchor-->`
    document.body.appendChild(teleportContainer)

    const wrapper = {
      /**
       * 把 Teleport 作为 wrapper 的唯一根，向 #teleport4 提供 hello；外层比较组件 el 与 Teleport 起止锚点，以及相邻 div 的认领位置。
       */
      render() {
        return h(Teleport, { to: '#teleport4' }, ['hello'])
      },
    }

    const { vnode, container } = mountWithHydration(
      '<div><!--teleport start--><!--teleport end--><div></div></div>',
      () => h('div', [h(wrapper), h('div')]),
    )
    expect(vnode.el).toBe(container.firstChild)
    // 组件根 el 与 Teleport 主树起点是同一节点。
    const wrapperVNode = (vnode as any).children[0]
    const tpStart = container.firstChild?.firstChild
    const tpEnd = tpStart?.nextSibling
    expect(wrapperVNode.el).toBe(tpStart)
    expect(wrapperVNode.component.subTree.el).toBe(tpStart)
    expect(wrapperVNode.component.subTree.anchor).toBe(tpEnd)
    // Teleport 结束后，后继 div 仍从正确游标认领。
    const nextVNode = (vnode as any).children[1]
    expect(nextVNode.el).toBe(container.firstChild?.lastChild)
  })

  // 两个嵌套 Teleport 共享预填目标，水合后核对外层 div、内层占位及内层目标 children/anchor 引用，检查目标范围推进。
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

  // onServerPrefetch 将服务端 flag 设 false，客户端新 flag 为 true；data-allow-mismatch 允许修补分支，调用客户端 foo 后刷新又变为空 v-if。
  test('with data-allow-mismatch component when using onServerPrefetch', async () => {
    const Comp = {
      template: `
        <div>Comp2</div>
      `,
    }
    let foo: any
    const App = {
      /**
       * 创建初始 true 的 flag，提供外层 foo 关闭它，并在 SSR onServerPrefetch 中关闭它；客户端返回新 flag，模板借 data-allow-mismatch 接纳 SSR/客户端分支差异。
       */
      setup() {
        const flag = ref(true)
        /**
         * 关闭本次 App 初始化产生的 flag；SSR 与客户端分别执行 setup，外层保存的是最近一次客户端闭包。
         */
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
    // 客户端用 createSSRApp 接管已有 SSR DOM。
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

  // 完整 SSR 同时填充主树与 Teleport 目标，水合无 children mismatch；关闭 toggle 切换 Comp2 后，主树正确替换且目标清空。
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
      /**
       * 把外层 toggle 提供给模板，令初始分支渲染带 Teleport 的 Comp1，之后由测试切换为 Comp2 检查卸载清理。
       */
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'target'
    document.body.appendChild(teleportContainer)

    // 先生成 SSR 标记，作为客户端水合输入。
    const ctx: SSRContext = {}
    container.innerHTML = await renderToString(h(App), ctx)
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    teleportContainer.innerHTML = ctx.teleports!['#target']

    // 客户端用 createSSRApp 接管已有 SSR DOM。
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

  // SSR 主树含 Teleport 占位而目标未填，水合补建内容并警告；随后切换 Comp2，目标仍被完整清空。
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
      /**
       * 返回控制 Comp1/Comp2 分支的 toggle；SSR 未填 Teleport 目标以制造 children 失配，客户端修补后仍需通过 toggle 卸载目标内容。
       */
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    const teleportContainer = document.createElement('div')
    teleportContainer.id = 'target'
    document.body.appendChild(teleportContainer)

    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer.innerHTML).toBe('')

    // 客户端用 createSSRApp 接管已有 SSR DOM。
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

  // SSR disabled Teleport 原地展示 A/B/C，水合后改目标并启用，把 Fragment 移往第二容器；再关闭根 toggle，整棵主树变为 v-if 注释。
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
      /**
       * 建立 A/B/C 顺序数组，并返回 target、disabled、order；客户端先把原地水合的 children 移往新目标，再卸载整棵树。
       */
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
      /**
       * 返回根 v-if 使用的 toggle；测试关闭它，让包含 disabled Teleport 与两个目标容器的 Comp 整体卸载。
       */
      setup() {
        return { toggle }
      },
    }

    const container = document.createElement('div')
    document.body.appendChild(container)

    // 先生成 SSR 标记，作为客户端水合输入。
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

    // 客户端用 createSSRApp 接管已有 SSR DOM。
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

  // Teleport 的两个目标初始均空，客户端水合补入第一个目标并警告；把 to 改为第二目标后，旧目标清空、新目标拥有 Teleported span。
  test('Teleport target change (mismatch + full integration)', async () => {
    const target = ref('#target1')
    const Comp = {
      template: `
        <Teleport :to="target"> 
          <span>Teleported</span>
        </Teleport>
      `,
      /**
       * 返回响应式 target 供 Teleport 的 to 使用；测试从空 #target1 水合并补建内容，再切换 #target2 检查节点移动。
       */
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

    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toBe(
      '<div><!--teleport start--><!--teleport end--></div>',
    )
    expect(teleportContainer1.innerHTML).toBe('')
    expect(teleportContainer2.innerHTML).toBe('')

    // 客户端用 createSSRApp 接管已有 SSR DOM。
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

  // 同一模板分别生成 SSR 与客户端 render，水合后派发父 click、子计数/style/emit 及 input 事件，断言输出和回调；mounted 记录未被匹配。
  test('full compiler integration', async () => {
    const mounted: string[] = []
    const log = vi.fn()
    const toggle = ref(true)

    const Child = {
      /**
       * 提供 count=0、text=hello 与 red 样式作为子组件每实例 data；模板按钮、emit 与 v-model 分别修改这些状态。
       */
      data() {
        return {
          count: 0,
          text: 'hello',
          style: {
            color: 'red',
          },
        }
      },
      /**
       * 把 child 追加到 mounted 记录数组；完整编译集成用例未对该数组作 matcher，不据此验证挂载钩子顺序。
       */
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
      /**
       * 返回 toggle 给父模板，控制包含 Child 与父 click 按钮的分支；当前用例只检查事件、插值、style 和 v-model，不切换此开关。
       */
      setup() {
        return { toggle }
      },
      /**
       * 把 parent 追加到 mounted 记录；该集成场景没有匹配该数组，钩子顺序不是本例有效断言。
       */
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
    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    // 客户端用 createSSRApp 接管已有 SSR DOM。
    createSSRApp(App).mount(container)

    // 按真实事件检查水合后交互。
    // 父按钮 click 应调用 log(click)。
    triggerEvent('click', container.querySelector('.parent-click')!)
    expect(log).toHaveBeenCalledWith('click')

    // 子按钮递增 count，并刷新文本插值。
    const count = container.querySelector('.count') as HTMLElement
    expect(count.textContent).toBe(`0`)
    triggerEvent('click', container.querySelector('.inc')!)
    await nextTick()
    expect(count.textContent).toBe(`1`)

    // 子按钮修改 style.color，刷新后读取实际 DOM style。
    expect(count.style.color).toBe('red')
    triggerEvent('click', container.querySelector('.change')!)
    await nextTick()
    expect(count.style.color).toBe('green')

    // 子按钮发送 foo，父监听器接收并记录 child。
    triggerEvent('click', container.querySelector('.emit')!)
    expect(log).toHaveBeenCalledWith('child')

    // input 事件把用户值同步到文本状态与显示内容。
    const text = container.querySelector('.text')!
    const input = container.querySelector('input')!
    expect(text.textContent).toBe('hello')
    input.value = 'bye'
    triggerEvent('input', input)
    await nextTick()
    expect(text.textContent).toBe('bye')
  })

  // SSR button 水合后绑定抛错 click 方法，派发原生 click 使 errorHandler spy 被调用；未检查错误消息或实例参数。
  test('handle click error in ssr mode', async () => {
    const App = {
      /**
       * 返回会抛错的 throwError 给 click 模板处理器；SSR 不触发它，水合后派发 click 才进入 app.config.errorHandler。
       */
      setup() {
        /**
         * 点击时抛出 Sentry Error；应用 errorHandler 的 spy 检查事件错误已被接收，不比较该错误消息或实例参数。
         */
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
    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    // 客户端用 createSSRApp 接管已有 SSR DOM。
    const app = createSSRApp(App)
    const handler = (app.config.errorHandler = vi.fn())
    app.mount(container)
    // 按真实事件检查水合后交互。
    // 派发原生 click，触发模板中的事件处理器。
    triggerEvent('click', container.querySelector('.parent-click')!)
    expect(handler).toHaveBeenCalled()
  })

  // SSR input 水合后绑定抛错 blur 方法，派发原生 blur 使 errorHandler spy 被调用；只确认事件错误接收。
  test('handle blur error in ssr mode', async () => {
    const App = {
      /**
       * 返回 throwError 给 blur 模板处理器，水合后由原生 blur 事件触发错误管道。
       */
      setup() {
        /**
         * blur 时故意抛出 Sentry Error；供外层检查 app.config.errorHandler 被调用。
         */
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
    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    // 客户端用 createSSRApp 接管已有 SSR DOM。
    const app = createSSRApp(App)
    const handler = (app.config.errorHandler = vi.fn())
    app.mount(container)
    // 按真实事件检查水合后交互。
    // 派发原生 blur，检查非 click 事件同样进入错误管道。
    triggerEvent('blur', container.querySelector('.parent-click')!)
    expect(handler).toHaveBeenCalled()
  })

  // Suspense 中 async setup 返回计数 span，先确认边界 el 认领 SSR 节点；等待水合完成后点击，输出从 0 更新为 1。
  test('Suspense', async () => {
    const AsyncChild = {
      /**
       * async setup 以已兑现 Promise 返回读取 count 的 span render；Suspense 水合完成后，点击既有 span 增加 count。
       */
      async setup() {
        const count = ref(0)
        return () =>
          h(
            'span',
            {
              /**
               * 点击水合后的 span 时递增 count，让依赖它的 render 更新已有 DOM。
               */
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
    // 等待异步水合/提交完成，再检查 DOM 或派发事件。
    await new Promise(r => setTimeout(r))
    triggerEvent('click', container.querySelector('span')!)
    await nextTick()
    expect(container.innerHTML).toBe(`<span>1</span>`)
  })

  // #6638
  // 异步 loader 在 Suspense 中解析计数 span，记录子 setup 执行时边界尚未 resolve，等待后边界已 resolve；点击现有 span 能递增。
  test('Suspense + async component', async () => {
    let isSuspenseResolved = false
    let isSuspenseResolvedInChild: any
    const AsyncChild = defineAsyncComponent(() =>
      Promise.resolve(
        defineComponent({
          /**
           * 记录子 setup 执行时 Suspense 是否已 resolve，再返回 count span 的 render；外层检查子初始化先于 resolve 事件。
           */
          setup() {
            isSuspenseResolvedInChild = isSuspenseResolved
            const count = ref(0)
            return () =>
              h(
                'span',
                {
                  /**
                   * 递增当前异步加载子组件的 count，检查 Suspense resolve 后监听器已绑定。
                   */
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
          /**
           * 把 isSuspenseResolved 置 true，作为边界 resolve 事件已经发生的探针。
           */
          onResolve() {
            isSuspenseResolved = true
          },
        },
        () => h(AsyncChild),
      ),
    )
    expect(vnode.el).toBe(container.firstChild)
    // 等待异步水合/提交完成，再检查 DOM 或派发事件。
    await new Promise(r => setTimeout(r))

    expect(isSuspenseResolvedInChild).toBe(false)
    expect(isSuspenseResolved).toBe(true)

    // 点击已经水合的节点，检查响应式更新。
    triggerEvent('click', container.querySelector('span')!)
    await nextTick()
    expect(container.innerHTML).toBe(`<span>1</span>`)
  })

  // SSR 两个 async setup 子组件分别等待 n*10ms，客户端挂载时 mounted 仍缓冲；等待全部依赖后检查钩子记录与 DOM，再分别点击递增两个计数。
  test('Suspense (full integration)', async () => {
    const mountedCalls: number[] = []
    const asyncDeps: Promise<any>[] = []

    const AsyncChild = defineComponent({
      props: ['n'],
      /**
       * 以 props.n 建立计数状态，await 前登记 mounted，并把按 n*10ms 延迟的 Promise 加入 asyncDeps；完成后返回可点击递增的 span，外层等待全部依赖检查缓冲钩子与交互。
       */
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
              /**
               * 递增当前 n 对应子组件的局部 count，分别检查两个异步子树完成水合后的独立交互。
               */
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
    // 先生成 SSR 标记，作为客户端水合输入。
    container.innerHTML = await renderToString(h(App))
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div><span>1</span><span>2</span></div>"`,
    )
    // 清空 SSR setup 登记的 Promise，只等待本次客户端的两个依赖。
    asyncDeps.length = 0
    // 客户端用 createSSRApp 接管已有 SSR DOM。
    createSSRApp(App).mount(container)

    expect(mountedCalls.length).toBe(0)
    expect(asyncDeps.length).toBe(2)

    // 等待客户端全部 async setup Promise，再让提交队列完成。
    await Promise.all(asyncDeps)
    await new Promise(r => setTimeout(r))

    // 边界完成后，缓冲的 mounted 钩子已释放。
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

  // 服务端和客户端使用独立可手动 resolve 的 loader；客户端未 resolve 时既有 button 点击不触发 spy，resolve 并等待后点击才触发。
  test('async component', async () => {
    const spy = vi.fn()
    /**
     * 返回带 click spy 的 hello! button；分别由服务端和客户端异步 loader resolve，使外层比较水合前后监听器是否接管已有节点。
     */
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
      /**
       * 返回 hello、AsyncComp 和 world 三个 Fragment children；未解析的中间异步组件不得影响两侧文本水合。
       */
      render() {
        return ['hello', h(AsyncComp), 'world']
      },
    }

    // 先生成 SSR 标记，作为客户端水合输入。
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(
      `"<!--[-->hello<button>hello!</button>world<!--]-->"`,
    )

    // 开始客户端水合；服务端与客户端的 loader 实例分别控制。
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

    // 客户端 loader 尚未解析，现有 button 还没有被绑定监听器。
    triggerEvent('click', container.querySelector('button')!)
    expect(spy).not.toHaveBeenCalled()

    // 手动完成客户端 loader，让已有 DOM 可以被接管。
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // 依赖完成后，检查当前 DOM 或监听器已接管。
    triggerEvent('click', container.querySelector('button')!)
    expect(spy).toHaveBeenCalled()
  })

  // #15091
  /**
   * 复现可见性惰性水合中 SSR DOM 已断开的竞态。替换 IntersectionObserver 以捕获回调，先 SSR、清空 render spy，再开始水合；分别移除根元素或祖先容器并发送可见通知，断言不抛错且不执行组件。finally 恢复全局构造器。
   *
   * @param detached root 只移除组件根，ancestor 移除承载它的容器；两者均让原 SSR 元素断开文档连接。
   */
  async function assertSkipLazyHydration(detached: 'root' | 'ancestor') {
    let observer!: IntersectionObserver
    let observerCallback!: IntersectionObserverCallback
    const originalIntersectionObserver = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      /**
       * 保存假 observer 实例与 hydrateOnVisible 注册的回调；测试通过它们手动派发 isIntersecting=true，控制 DOM 断开后的通知时点。
       */
      constructor(callback: IntersectionObserverCallback) {
        observer = this as any
        observerCallback = callback
      }
      /**
       * 假 observer 的空 disconnect，用于满足可见性策略清理协议；本例只检查跳过水合，不统计断开调用。
       */
      disconnect() {}
      /**
       * 假 observer 的空 observe，接纳策略注册的元素；测试直接调用保存的回调，不启动浏览器观察。
       */
      observe() {}
    } as any

    try {
      const Comp = vi.fn(() => h('p', 'hello'))
      const AsyncComp = defineAsyncComponent({
        /**
         * 返回已兑现的 Comp Promise；该用例把等待窗口放在 hydrateOnVisible 策略，不以 loader 未完成制造断开竞态。
         */
        loader: () => Promise.resolve(Comp),
        hydrate: hydrateOnVisible(),
      })
      /**
       * 以 AsyncComp 为唯一根，供 SSR 与客户端共用组件包装器；loader resolve 后仍须等待手动可见通知才水合。
       */
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

  // 分别移除 SSR 根节点或其祖先容器，再手动通知 hydrateOnVisible 已可见；断言回调不抛错且组件 render 未执行，检查断开 DOM 时跳过惰性水合。
  test.each(['root', 'ancestor'] as const)(
    'skip lazy hydration when the SSR %s is detached',
    assertSkipLazyHydration,
  )

  // 父 mounted 关闭 toggle，使异步包装器 resolve 前先排队更新；resolve 后左文本从 hello 变 world、h1 仍水合正确且无 node mismatch。
  test('update async wrapper before resolve', async () => {
    const Comp = {
      /**
       * 渲染 Async component h1，作为两个独立异步 loader 的 resolve 结果。
       */
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
      /**
       * mounted 同步关闭 toggle，使父级更新排队于 AsyncComp 客户端 resolve 前；render 保留同一异步包装器，仅把左侧文本从 hello 改为 world。
       */
      setup() {
        onMounted(() => {
          // mounted 中修改状态，使异步包装器在 loader 完成前先收到更新。
          // 随后手动 resolve，检查包装器仍能接管正确的节点范围。
          toggle.value = false
        })

        return () => {
          return [toggle.value ? 'hello' : 'world', h(AsyncComp)]
        }
      },
    }

    // 先生成 SSR 标记，作为客户端水合输入。
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(
      `"<!--[-->hello<h1>Async component</h1><!--]-->"`,
    )

    // 开始客户端水合；服务端与客户端的 loader 实例分别控制。
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

    // 手动完成客户端 loader，让已有 DOM 可以被接管。
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // 依赖完成后，检查当前 DOM 或监听器已接管。
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<!--[-->world<h1>Async component</h1><!--]-->"`,
    )
  })

  // #13510
  // 父 mounted 在 nextTick 改变 AsyncComp 的 toggle prop，客户端 loader 再 resolve；断言跳过惰性水合提示和最新 h1 内容，且无 node mismatch。
  test('update async component after parent mount before async component resolve', async () => {
    const Comp = {
      props: ['toggle'],
      /**
       * 读取最新 toggle prop 渲染 h1，分别输出初始或 Updated async component；用于检查父级先更新的输入在 resolve 后生效。
       */
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
      /**
       * mounted 内通过 nextTick 关闭 toggle，再把当前值传给 AsyncComp；resolve 与父级更新交错时应跳过旧的惰性水合并渲染最新内容。
       */
      setup() {
        onMounted(() => {
          // mounted 后另排 nextTick 修改状态，制造父更新先于异步组件最终渲染的窗口。
          nextTick(() => (toggle.value = false))
        })

        return () => {
          return h(AsyncComp, { toggle: toggle.value })
        }
      },
    }

    // 先生成 SSR 标记，作为客户端水合输入。
    const htmlPromise = renderToString(h(App))
    serverResolve(Comp)
    const html = await htmlPromise
    expect(html).toMatchInlineSnapshot(`"<h1>Async component</h1>"`)

    // 开始客户端水合；服务端与客户端的 loader 实例分别控制。
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

    // 手动完成客户端 loader，让已有 DOM 可以被接管。
    clientResolve(Comp)
    await new Promise(r => setTimeout(r))

    // 组件已先经历更新，旧惰性水合应被跳过并给出相应提示。
    expect('Skipping lazy hydration for component').toHaveBeenWarned()
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<h1>Updated async component</h1>"`,
    )
  })

  // 兄弟 setup 在 async setup 的 10ms 等待内关闭 toggle，wrapper 的透传 prop 从 hello 变 world；客户端最终 h1 使用 world。
  test('hydrate safely when property used by async setup changed before render', async () => {
    const toggle = ref(true)

    const AsyncComp = {
      /**
       * 等待 10ms 后才返回 h1 render，保留尚未建立 render effect 的窗口；兄弟 setup 在窗口内修改父级传入的属性。
       */
      async setup() {
        await new Promise<void>(r => setTimeout(r, 10))
        return () => h('h1', 'Async component')
      },
    }

    const AsyncWrapper = {
      /**
       * 以 AsyncComp 为唯一根的同步 wrapper，外部 prop 经 attrs 透传至最终 h1；测试在 async setup 等待期间改变输入。
       */
      render() {
        return h(AsyncComp)
      },
    }

    const SiblingComp = {
      /**
       * 初始化时立即关闭共享 toggle，再返回空 span；人为在兄弟 async setup 完成前改变 wrapper 的透传属性。
       */
      setup() {
        toggle.value = false
        return () => h('span')
      },
    }

    const App = {
      /**
       * 返回含 Suspense 的 main 树：前置 AsyncWrapper 使用 toggle 选择 hello/world 属性，后置 SiblingComp 初始化时关闭 toggle。
       */
      setup() {
        return () =>
          h(
            Suspense,
            {},
            {
              /**
               * Suspense 默认插槽按当轮 toggle 生成 AsyncWrapper 的 prop，并跟随 SiblingComp；返回单个 main 作为边界内容根。
               */
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

    // 先生成 SSR 标记，作为客户端水合输入。
    const html = await renderToString(h(App))

    expect(html).toMatchInlineSnapshot(
      `"<main><h1 prop="hello">Async component</h1><span></span></main>"`,
    )

    expect(toggle.value).toBe(false)

    // 开始客户端水合；服务端与客户端的 loader 实例分别控制。

    // SSR 中兄弟 setup 已关闭 toggle；客户端重新从 true 开始复现交错。
    toggle.value = true
    expect(toggle.value).toBe(true)

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    await new Promise(r => setTimeout(r, 10))

    expect(toggle.value).toBe(false)

    // 依赖完成后，检查当前 DOM 或监听器已接管。
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<main><h1 prop="world">Async component</h1><span></span></main>"`,
    )
  })

  // 增加两层同步 wrapper 后重复兄弟先改值、异步根后 render 的交错，SSR prop 为 hello，客户端最终为 world，检查深层根链透传。
  test('hydrate safely when property used by deep nested async setup changed before render', async () => {
    const toggle = ref(true)

    const AsyncComp = {
      /**
       * 等待 10ms 后返回 h1，给外层两层同步 wrapper 留出输入先更新、异步根后完成的交错窗口。
       */
      async setup() {
        await new Promise<void>(r => setTimeout(r, 10))
        return () => h('h1', 'Async component')
      },
    }

    const AsyncWrapper = {
      /** 返回 AsyncComp，组成深层 attrs 透传链的最内 wrapper。 */ render: () =>
        h(AsyncComp)
    }
    const AsyncWrapperWrapper = {
      /** 返回 AsyncWrapper，多增加一层同步包装，使最新 prop 必须沿两层根链透传。 */ render:
        () => h(AsyncWrapper)
    }

    const SiblingComp = {
      /**
       * 在兄弟初始化中关闭 toggle 并返回 span，触发深层异步 wrapper 的透传输入从 hello 变为 world。
       */
      setup() {
        toggle.value = false
        return () => h('span')
      },
    }

    const App = {
      /**
       * 构造 AsyncWrapperWrapper 与 SiblingComp 共处的 Suspense/main；render 根据 toggle 传 prop，检查深层异步 resolve 后采用最新输入。
       */
      setup() {
        return () =>
          h(
            Suspense,
            {},
            {
              /**
               * 返回包含深层 wrapper 与切换状态兄弟的 main，读取 toggle 生成 hello/world prop。
               */
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

    // 先生成 SSR 标记，作为客户端水合输入。
    const html = await renderToString(h(App))

    expect(html).toMatchInlineSnapshot(
      `"<main><h1 prop="hello">Async component</h1><span></span></main>"`,
    )

    expect(toggle.value).toBe(false)

    // 开始客户端水合；服务端与客户端的 loader 实例分别控制。

    // SSR 中兄弟 setup 已关闭 toggle；客户端重新从 true 开始复现交错。
    toggle.value = true
    expect(toggle.value).toBe(true)

    const container = document.createElement('div')
    container.innerHTML = html
    createSSRApp(App).mount(container)

    await new Promise(r => setTimeout(r, 10))

    expect(toggle.value).toBe(false)

    // 依赖完成后，检查当前 DOM 或监听器已接管。
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<main><h1 prop="world">Async component</h1><span></span></main>"`,
    )
  })

  // #3787
  // 客户端以未完成 loader 认领 SSR 异步 div，先关闭 show 并刷新替换为 hi，再调用迟到 resolve；只直接匹配替换后的 DOM。
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
      /**
       * 按 show 在未解析 AsyncComp 与 hi div 之间切换；用于检查 loader 尚未完成时能移除 SSR 异步根。
       */
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
  // Toggle 与两层异步 Wrapper 包裹 Child，水合后 mounted 使 vShow 开启并递增 count；刷新后 DOM 为 1，Child 的 fn 只调用一次。
  test('nested async wrapper', async () => {
    const Toggle = defineAsyncComponent(
      () =>
        new Promise(r => {
          r(
            defineComponent({
              /**
               * loader resolve 后的同步 setup 登记 mounted 的 nextTick，把 vShow 从 false 改 true，并通过 renderSlot 消费 default slot。
               */
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
            /**
             * 转发当前 $slots.default 到内层 renderSlot Fragment；两层 Wrapper 让异步包装器沿嵌套 slot 链认领已有 DOM。
             */
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
      /**
       * mounted 时调用 fn 并递增 count，render 读取 count；外层检查嵌套异步包装器水合后该钩子只执行一次。
       */
      setup() {
        onMounted(() => {
          fn()
          count.value++
        })
        return () => h('div', count.value)
      },
    }

    const App = {
      /**
       * 依次提供 Toggle、两层 Wrapper 与 Child 的 default slots；SSR 产生多层 Fragment 标记，客户端沿同一结构认领并更新。
       */
      render() {
        return h(Toggle, null, {
          /**
           * 把 Wrapper 作为 Toggle 的 default 内容，继续提供第二层 Wrapper 的插槽。
           */
          default: () =>
            h(Wrapper, null, {
              /**
               * 向外层 Wrapper 的 default 再提供内层 Wrapper，保留嵌套 Fragment 水合结构。
               */
              default: () =>
                h(Wrapper, null, {
                  /**
                   * 内层 Wrapper 的 default 内容为 Child，mounted 探针从这里进入最终子树。
                   */
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

  // 未完成异步 wrapper 的 SSR 根为 Fragment，关闭 show 并刷新后整个范围替换为 hi div，再调用迟到 resolve；不直接检查 resolve 后快照。
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
      /**
       * 按 show 在 Fragment 根的未解析 AsyncComp 与 hi div 间切换；先卸载 SSR Fragment 范围，再由外层迟到 resolve。
       */
      render() {
        return h('div', [show.value ? h(AsyncComp) : h('div', 'hi')])
      },
    }).mount(root)

    show.value = false
    await nextTick()
    expect(root.innerHTML).toBe('<div><div>hi</div></div>')
    resolve({})
  })

  // SSR animateTransform 与客户端同名驼峰标签水合，断言根节点复用且无 node mismatch；本例未单独读取 namespaceURI。
  test('elements with camel-case in svg ', () => {
    const { vnode, container } = mountWithHydration(
      '<animateTransform></animateTransform>',
      () => h('animateTransform'),
    )
    expect(vnode.el).toBe(container.firstChild)
    expect(`Hydration node mismatch`).not.toHaveBeenWarned()
  })

  // 把 g 的 SSR 标记放入名为 svg 的容器并挂载，代码计算 instanceof SVGElement；只有 expect(...) 没有 matcher，此例未有效断言命名空间结果。
  test('SVG as a mount container', () => {
    const svgContainer = document.createElement('svg')
    svgContainer.innerHTML = '<g></g>'
    const app = createSSRApp({
      /**
       * 为 svgContainer 生成 g 根；本例虽然计算 instanceof SVGElement，但没有 matcher，不能据此判断命名空间结果。
       */
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

  // SSR checkbox 没有 indeterminate property，客户端以 .indeterminate=true 强制写入，水合后读取该 DOM property 为 true。
  test('force hydrate prop with `.prop` modifier', () => {
    const { container } = mountWithHydration('<input type="checkbox">', () =>
      h('input', {
        type: 'checkbox',
        '.indeterminate': true,
      }),
    )
    expect((container.firstChild! as any).indeterminate).toBe(true)
  })

  // SSR checkbox 的 true-value 标记对应客户端 Boolean true，PROPS 动态键与 vModelCheckbox 水合后，内部 _trueValue 保留非字符串 true。
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

  // SSR input 初始值为 server value，水合前用户已输入 user value；水合并刷新后，input.value 和共享 state.text 都保留用户值。
  test('preserves text entered before v-model hydration', async () => {
    const state = reactive({ text: 'server value' })
    const App = {
      /**
       * 把外层 reactive state 直接作为 setup 绑定，让 v-model 水合前的用户文本回写同一 state.text。
       */
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

  // CACHED checkbox VNode 声明 indeterminate 空字符串，水合 SSR 同名 attribute 后必须写 DOM property，断言其为 true。
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

  // SSR option 的 value 字符串为 true，客户端缓存 VNode 使用 Boolean true；水合后内部 _value 是 Boolean，而不是仅保留 attribute 字符串。
  test('force hydrate select option with non-string value bindings', () => {
    const { container } = mountWithHydration(
      '<select><option value="true">ok</option></select>',
      () =>
        h('select', [
          // 绑定值是常量，模拟编译器缓存的 option VNode。
          createVNode('option', { value: true }, null, -1 /* HOISTED */),
        ]),
    )
    expect((container.firstChild!.firstChild as any)._value).toBe(true)
  })

  // #7203
  // 注册带 foo 空字段的自定义 HTMLElement，SSR 元素无 foo，客户端绑定 bar；水合后 DOM property foo 等于 msg.value。
  test('force hydrate custom element with dynamic props', () => {
    /**
     * 自定义 HTMLElement 夹具，foo 初始为空字符串，使水合需要通过 DOM property 写入 bar；注册名限定在该用例。
     */
    class MyElement extends HTMLElement {
      foo = ''
      /**
       * 调用 HTMLElement 父构造器，创建可注册的原生自定义元素实例；foo 字段初始化由类字段完成。
       */
      constructor() {
        super()
      }
    }
    customElements.define('my-element-7203', MyElement)

    const msg = ref('bar')
    const container = document.createElement('div')
    container.innerHTML = '<my-element-7203></my-element-7203>'
    const app = createSSRApp({
      /**
       * 为自定义元素生成动态 foo=msg.value，水合时应写入 MyElement 的 DOM property。
       */
      render: () => h('my-element-7203', { foo: msg.value }),
    })
    app.mount(container)
    expect((container.firstChild as any).foo).toBe(msg.value)
  })

  // #14274
  // 自定义元素同时有 ref 与 innerHTML，水合后 HTML 无 ref attribute，root.value 仍指向现有元素，检查 ref 由引用协议消费。
  test('should not render ref on custom element during hydration', () => {
    const container = document.createElement('div')
    container.innerHTML = '<my-element>hello</my-element>'
    const root = ref()
    const app = createSSRApp({
      /**
       * 生成自定义元素并登记模板 ref 与 innerHTML，ref 由实例引用协议消费，不应出现在宿主 attribute。
       */
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
  // SSR 只有 slot Fragment 锚点，客户端 fallback 为空 Text；水合后共有三节点，空 Text 位于中间，组件子树的 child.el 指向它。
  test('empty text node in slot', () => {
    const Comp = {
      /**
       * 调用 renderSlot，并以空 Text VNode 作为缺失 default slot 的 fallback；外层检查 Fragment 起点、补建空 Text 与组件子树引用。
       */
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
    // 沿组件实例、slot Fragment、空 Text 的引用链核对同一节点。
    expect((vnode as any).component?.subTree.children[0].el).toBe(text)
  })

  // #7215
  // SSR 空 p 对应客户端单个空字符串 child，水合保留 p 并补一个 nodeType=3 的 Text，检查空文本不会被忽略。
  test('empty text node', () => {
    const Comp = {
      /**
       * 返回 children 为一个空字符串的 p，让水合在 SSR 空 p 内补建 Text 节点。
       */
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
  // 关闭开发模式，用 STYLE 标记的优化 div 水合响应式 red 样式；修改对象 color 为 green 并刷新，DOM 样式跟随更新，finally 恢复开发标志。
  test('object style value tracking in prod', async () => {
    __DEV__ = false
    try {
      const style = reactive({ color: 'red' })
      const Comp = {
        /**
         * 返回 STYLE 标记的优化 div，并通过 normalizeStyle 读取响应式 style 对象；生产水合后修改 color 应仍触发渲染。
         */
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

  // 水合 button 的 App expose count=0，挂载后容器 _vnode 已登记；app.unmount 后 _vnode 为 null，本例没有直接匹配 DOM 是否清空。
  test('app.unmount()', async () => {
    const container = document.createElement('DIV')
    container.innerHTML = '<button></button>'
    const App = defineComponent({
      /**
       * expose count 并返回 button 的 click render；外层只检查公开 count 与 app 卸载后容器 _vnode 清空，没有触发该 button。
       */
      setup(_, { expose }) {
        const count = ref(0)

        expose({ count })

        return () =>
          h('button', {
            /**
             * 递增 expose 的 count；本例未触发点击，仅保留水合事件入口。
             */
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
  // SSR Fragment 包围一个 div，客户端为一个 stringified Static VNode；水合不报告 mismatch，检查静态范围与外层标记兼容。
  test('stringified root fragment', () => {
    mountWithHydration(`<!--[--><div></div><!--]-->`, () =>
      createStaticVNode(`<div></div>`, 1),
    )
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // SSR template 包装 foo div，客户端 Transition appear 水合后替换 wrapper；快照含进入阶段 class，vnode.el 指向真实首节点且无 mismatch。
  test('transition appear', () => {
    const { vnode, container } = mountWithHydration(
      `<template><div>foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            /**
             * 提供 foo div 作为 Transition appear 内容，SSR 的 template wrapper 随水合被真实 div 替换。
             */
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

  // 同样的 appear 输入已有 foo class，水合后快照同时含原 class 与进入阶段 class，真实根 el 认领正确。
  test('transition appear work with pre-existing class', () => {
    const { vnode, container } = mountWithHydration(
      `<template><div class="foo">foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            /**
             * 提供已有 foo class 的 div，appear class 应叠加而非丢失原 class。
             */
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
  // SSR template 内为 Comment，Transition 的空 slot 初始仍为 Comment；关闭 show 并刷新后改为 foo Text，无初始 mismatch。
  test('transition appear work with empty content', async () => {
    const show = ref(true)
    const { vnode, container } = mountWithHydration(
      `<template><!----></template>`,
      function (this: any) {
        return h(
          Transition,
          { appear: true },
          {
            /**
             * show 为 true 时渲染缺失 slot 的 Comment，变 false 后返回 foo Text；外层检查 template 包装下节点替换。
             */
            default: () =>
              show.value
                ? renderSlot(this.$slots, 'default')
                : createTextVNode('foo'),
          },
        )
      },
    )

    // 缺失 slot 的初始内容按 Comment 认领。
    expect(container.firstChild!.nodeType).toBe(Node.COMMENT_NODE)
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()

    show.value = false
    await nextTick()
    expect(container.innerHTML).toBe('foo')
  })

  // 固定 show=false 的 v-if 分支以 Comment 水合 template 空内容，核对注释节点快照、el 和无 mismatch；本例不切换分支。
  test('transition appear with v-if', () => {
    const show = false
    const { vnode, container } = mountWithHydration(
      `<template><!----></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            /**
             * 固定 show=false 时返回 Comment VNode，供 appear 的空 v-if 初始分支认领；本例不切换 show。
             */
            default: () => (show ? h('div', 'foo') : createCommentVNode('')),
          },
        ),
    )
    expect(container.firstChild).toMatchInlineSnapshot('<!---->')
    expect(vnode.el).toBe(container.firstChild)
    expect(`mismatch`).not.toHaveBeenWarned()
  })

  // 固定 vShow=false 的 foo div 在 appear 水合后同时保留 display:none 与进入 class，原 display 记录为空；不直接执行 display 切换。
  test('transition appear with v-show', () => {
    const show = false
    const { vnode, container } = mountWithHydration(
      `<template><div style="display: none;">foo</div></template>`,
      () =>
        h(
          Transition,
          { appear: true },
          {
            /**
             * 给 foo div 应用 vShow(false)，appear class 与 display:none 需在水合后共存。
             */
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

  // Transition appear 接管 SSR button 后，进入 class 保持在快照中；派发 click 并刷新，计数文本从 0 变 1。
  test('transition appear w/ event listener', async () => {
    const container = document.createElement('div')
    container.innerHTML = `<template><button>0</button></template>`
    createSSRApp({
      /**
       * 为 Transition appear 模板提供 count=0；已有 button 被接管后 click 增加它，外层比较过渡 class 与文本快照。
       */
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

  // 同步 Suspense 内容包裹 Transition appear，水合 template 后等待，快照含进入 class 且 vnode.el 与真实首节点在刷新后仍一致。
  test('Suspense + transition appear', async () => {
    const { vnode, container } = mountWithHydration(
      `<template><div>foo</div></template>`,
      () =>
        h(Suspense, {}, () =>
          h(
            Transition,
            { appear: true },
            {
              /**
               * 在同步 Suspense 内容中提供 appear 的 foo div，外层检查 template 替换后的 el 引用与过渡 class。
               */
              default: () => h('div', 'foo'),
            },
          ),
        ),
    )

    expect(vnode.el).toBe(container.firstChild)
    // 等待异步水合/提交完成，再检查 DOM 或派发事件。
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
  // 生产优化水合的 STABLE slot 同时含 items 文本和 clicked 的嵌套 v-if；mounted 改 items，再改 show/clicked 后检查最终 DOM。async 函数的 not.toThrow 不单独证明异步错误不存在。
  test('update component stable slot (prod + optimized mode)', async () => {
    __DEV__ = false
    try {
      const container = document.createElement('div')
      container.innerHTML = `<template><div show="false"><!--[--><div><div><!----></div></div><div>0</div><!--]--></div></template>`
      const Comp = {
        /**
         * 生成优化 div 根并调用 default slot；Wrapper 的 STABLE 标记使更新走稳定插槽快路径。
         */
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
        /**
         * mounted 把 items 改为 [1]，返回 STABLE 默认插槽的编译产物；插槽同时读取 clicked 控制嵌套 v-if，与外层 show 透传共同复现水合后插入位置回归。
         */
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
        /**
         * 返回外层 show ref 给模板，让传入 Wrapper 的 show 随测试变为 true；该属性透传到 Comp 的 div 根。
         */
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

  // SSR 的 KeepAlive 缓存 Child 先输出 foo，水合后 reload 同一 __hmrId 为 bar；刷新主容器也为 bar，检查缓存子组件 HMR。
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

  // SSR 根 App 的 __hmrId 被 HMR 登记，水合后 reload 根模板从 foo 变 bar；刷新后 DOM 使用新根内容。
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
    // SSR Text foo 与客户端 bar 失配，水合修为 bar 并报告 text mismatch，检查文本修补与诊断。
    test('text node', () => {
      const { container } = mountWithHydration(`foo`, () => 'bar')
      expect(container.textContent).toBe('bar')
      expect(`Hydration text mismatch`).toHaveBeenWarned()
    })

    // SSR div 文本 foo 与客户端 bar 失配，水合后为 bar 并报告 text content mismatch。
    test('element text content', () => {
      const { container } = mountWithHydration(`<div>foo</div>`, () =>
        h('div', 'bar'),
      )
      expect(container.innerHTML).toBe('<div>bar</div>')
      expect(`Hydration text content mismatch`).toHaveBeenWarned()
    })

    // SSR 空 div 少于客户端两个 span，水合补建 foo/bar children，并报告 children mismatch。
    test('not enough children', () => {
      const { container } = mountWithHydration(`<div></div>`, () =>
        h('div', [h('span', 'foo'), h('span', 'bar')]),
      )
      expect(container.innerHTML).toBe(
        '<div><span>foo</span><span>bar</span></div>',
      )
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // SSR div 有 foo/bar 两个 span，客户端仅要 foo；水合删除多余 bar，并报告 children mismatch。
    test('too many children', () => {
      const { container } = mountWithHydration(
        `<div><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('span', 'foo')]),
      )
      expect(container.innerHTML).toBe('<div><span>foo</span></div>')
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // SSR 三个 span 多于客户端一个，spy 检查同一父元素 data-allow-mismatch 的存在性只查询一次；修补后只剩 foo，children 警告也只一次。
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

    // SSR 空 div 少于客户端三个 span，补建后 foo/bar/baz 齐全；同一父元素 data-allow-mismatch 的存在性查询与 children 警告都只一次。
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

    // SSR 两个 span 对应客户端 div/p，水合替换两种错误标签，最终结构正确并报告两次 node mismatch。
    test('complete mismatch', () => {
      const { container } = mountWithHydration(
        `<div><span>foo</span><span>bar</span></div>`,
        () => h('div', [h('div', 'foo'), h('p', 'bar')]),
      )
      expect(container.innerHTML).toBe('<div><div>foo</div><p>bar</p></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarnedTimes(2)
    })

    // SSR Fragment 内两个 div 被客户端一个 span 替代，水合删除整个旧范围及锚点，输出 replaced span 并报告 node mismatch。
    test('fragment mismatch removal', () => {
      const { container } = mountWithHydration(
        `<div><!--[--><div>foo</div><div>bar</div><!--]--></div>`,
        () => h('div', [h('span', 'replaced')]),
      )
      expect(container.innerHTML).toBe('<div><span>replaced</span></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // SSR Fragment 只有 foo div，客户端需要 foo/bar 且外有 baz；水合补入 bar，保留 Fragment 锚点和 baz，并报告 node mismatch。
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

    // SSR Fragment 比客户端多一个 bar div，水合后只剩 foo 与外侧 baz；分别匹配游标错位引起的 text content 警告和多余 children 警告。
    test('fragment too many children', () => {
      const { container } = mountWithHydration(
        `<div><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div><!--[--><div>foo</div><!--]--><div>baz</div></div>',
      )
      // 客户端 Fragment 提早结束，游标暂落在 SSR 多余的 bar；
      // 后继 baz 对它水合时产生文本内容差异。
      expect(`Hydration text content mismatch`).toHaveBeenWarned()
      // 随后移除 SSR 剩余 children，分别检查结构失配警告。
      expect(`Hydration children mismatch`).toHaveBeenWarned()
    })

    // Teleport 主树有占位而目标为空，客户端需要 value span；水合补入目标并报告 children mismatch。
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

    // SSR span 对应客户端 hi Comment，水合替换为注释并报告 node mismatch。
    test('comment mismatch (element)', () => {
      const { container } = mountWithHydration(`<div><span></span></div>`, () =>
        h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe('<div><!--hi--></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // SSR 元素内文本 foobar 对应客户端 hi Comment，水合改为注释并报告 node mismatch。
    test('comment mismatch (text)', () => {
      const { container } = mountWithHydration(`<div>foobar</div>`, () =>
        h('div', [createCommentVNode('hi')]),
      )
      expect(container.innerHTML).toBe('<div><!--hi--></div>')
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // SSR class=foo bar 对应数组、对象、字符串、SVG 与逆序 token 均不警告；客户端只剩 foo 时报告 class mismatch，检查按 token 集合比较。
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
      // SVG 元素使用相同的 class token 集合比较。
      mountWithHydration(`<svg class="foo bar"></svg>`, () =>
        h('svg', { class: 'foo bar' }),
      )
      // 仅 token 顺序不同应视为相同 class。
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: 'bar foo' }),
      )
      expect(`Hydration class mismatch`).not.toHaveBeenWarned()
      mountWithHydration(`<div class="foo bar"></div>`, () =>
        h('div', { class: 'foo' }),
      )
      expect(`Hydration class mismatch`).toHaveBeenWarned()
    })

    // SSR red 样式对应同值对象/字符串、逆序属性及 vShow(false) 均不警告；客户端 green 才报告一次 style mismatch。
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

    // SSR div 无 style、客户端要求 red，水合诊断报告一次 style mismatch；本例只匹配警告，不判断样式是否被重写。
    test('style mismatch when no style attribute is present', () => {
      mountWithHydration(`<div></div>`, () =>
        h('div', { style: { color: 'red' } }),
      )
      expect(`Hydration style mismatch`).toHaveBeenWarnedTimes(1)
    })

    // vShow(false) 对应 SSR 已有 display:none 时无 style 警告；SSR 缺 display:none 时诊断一次 mismatch，检查指令参与样式比较。
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

    // 相同 id、spellcheck、缺省 undefined 与等价 multiple Boolean 输入不警告；SSR 缺 id 或 id=bar 而客户端为 foo，分别累计属性警告。
    test('attr mismatch', () => {
      mountWithHydration(`<div id="foo"></div>`, () => h('div', { id: 'foo' }))
      mountWithHydration(`<div spellcheck></div>`, () =>
        h('div', { spellcheck: '' }),
      )
      mountWithHydration(`<div></div>`, () => h('div', { id: undefined }))
      // Boolean multiple 的存在性输入。
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

    // SSR textarea 的文本与客户端 value 相同或同为空时无 attribute 警告；foo 对 bar 时报告属性失配，检查 textarea 的特殊值比较。
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
    // SSR 与客户端共享以 LF 开头的 textarea render，水合不报告 text content mismatch，检查 HTML 解析器首换行处理。
    test('<textarea> with newlines at the beginning', async () => {
      /**
       * 返回以换行开头的 textarea 文本，供 SSR 与客户端共用；检查 HTML 解析器剥离首个换行后的水合文本归一。
       */
      const render = () => h('textarea', null, '\nhello')
      const html = await renderToString(createSSRApp({ render }))
      mountWithHydration(html, render)
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
    })

    // SSR 与客户端共享仅含 LF 的 pre render，水合不报告 text content mismatch。
    test('<pre> with newlines at the beginning', async () => {
      /**
       * 返回只含换行的 pre，SSR 与客户端共享此 render；外层只检查不出现文本内容失配警告。
       */
      const render = () => h('pre', null, '\n')
      const html = await renderToString(createSSRApp({ render }))
      mountWithHydration(html, render)
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
    })

    // SSR readonly 缺失对应 false、存在或 readonly 字符串对应 true，水合均不报告 attribute mismatch，检查 Boolean 存在性语义。
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

    // SSR hidden 的缺省、普通 true/string 和 until-found（含大小写变体）对应等价客户端状态时均无属性警告，检查枚举归一。
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

    // hidden 为客户端 0/NaN 对应缺失、1 或字符串0 对应存在，四组水合均无属性警告，检查数字与字符串状态不同。
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

    // SSR hidden=until-found 对客户端 true、SSR hidden 存在对客户端0，两组分别累计一条属性失配警告。
    test('hidden state mismatch', () => {
      mountWithHydration(`<div hidden="until-found"></div>`, () =>
        h('div', { hidden: true }),
      )
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(1)

      mountWithHydration(`<div hidden></div>`, () => h('div', { hidden: 0 }))
      expect(`Hydration attribute mismatch`).toHaveBeenWarnedTimes(2)
    })

    // SSR 不含 draggable/type，客户端分别为 undefined/null，水合均不报告属性警告，检查空值应按缺失处理。
    test('client value is null or undefined', () => {
      mountWithHydration(`<div></div>`, () =>
        h('div', { draggable: undefined }),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()

      mountWithHydration(`<input />`, () => h('input', { type: null }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // SSR input 不含 from，客户端 from 为普通对象，水合不报告 attribute mismatch；此例不判断该对象最终如何写入。
    test('should not warn against object values', () => {
      mountWithHydration(`<input />`, () => h('input', { from: {} }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // SSR button 不含 href，客户端 href=undefined，水合不报告属性警告；href 不是该元素的 DOM property，避免误诊缺省值。
    test('should not warn on falsy bindings of non-property keys', () => {
      mountWithHydration(`<button />`, () => h('button', { href: undefined }))
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // SSR option 只有 hello 文本、客户端 value 为数组，水合不报告 attribute mismatch，检查不可序列化为该 SSR value 的输入不误报。
    test('should not warn on non-renderable option values', () => {
      mountWithHydration(`<select><option>hello</option></select>`, () =>
        h('select', [h('option', { value: ['foo'] }, 'hello')]),
      )
      expect(`Hydration attribute mismatch`).not.toHaveBeenWarned()
    })

    // SSR 已有 --foo:red 与 color:var(--foo)，客户端 useCssVars 提供同值并渲染 var() 样式，水合不误报 style mismatch。
    test('should not warn css v-bind', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="--foo:red;color:var(--foo);" />`
      const app = createSSRApp({
        /**
         * 登记 foo=red 的 CSS 变量并返回读取 var(--foo) 的 div；SSR 已带同值自定义属性，外层检查不误报 style 差异。
         */
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

    // #10317 — 用例来自 #10325
    // SSR CSS 变量只在根、内层 div 使用 var(--foo)，客户端注册相同变量并生成相同层级，水合无 style 警告；此例不直接断言变量写入位置。
    test('css vars should only be added to expected on component root dom', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="--foo:red;"><div style="color:var(--foo);" /></div>`
      const app = createSSRApp({
        /**
         * 登记根的 foo CSS 变量，render 让内层 div 使用 var(--foo)；本例只检查 style 警告，不直接断言变量被写入的位置。
         */
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
    // 父 useCssVars 提供 foo=red，唯一 Child 根有 padding:4px；SSR 已合并变量，水合无 style mismatch，检查跨组件根的样式比较。
    test('css vars support fallthrough', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="padding: 4px;--foo:red;"></div>`
      const app = createSSRApp({
        /**
         * 在父 setup 登记 foo=red，并以 Child 为唯一渲染根，检查 CSS 变量透传参与水合样式比较。
         */
        setup() {
          useCssVars(() => ({
            foo: 'red',
          }))
          return () => h(Child)
        },
      })
      const Child = {
        /**
         * 返回 padding:4px 的 div 根；由父级 useCssVars 向此根提供 --foo，外层只匹配 style 警告。
         */
        setup() {
          return () => h('div', { style: 'padding: 4px' })
        },
      }
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // #11189
    // SSR class 为 test red，created 指令给客户端 test 根追加 red；水合没有 style mismatch 警告，本例未单独匹配 class/attribute 警告。
    test('should not warn for directives that mutate DOM in created', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div class="test red"></div>`
      const vColor: ObjectDirective = {
        /**
         * created 阶段把 binding.value 加到元素 classList；为 hydrateElement 的“存在 created 指令则跳过 prop 失配诊断”分支提供输入。
         */
        created(el, binding) {
          el.classList.add(binding.value)
        },
      }
      const app = createSSRApp({
        /**
         * 返回带 test class 和 vColor(red) 的 div，既有 SSR class 为 test red；外层实际只匹配 style mismatch 警告。
         */
        setup() {
          return () =>
            withDirectives(h('div', { class: 'test' }), [[vColor, 'red']])
        },
      })
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // disabled Teleport 的 to 为 undefined，SSR isOpen=false；水合后改 true 并刷新，Menu 内容在主树锚点内原地显示。
    test('with disabled teleport + undefined target', async () => {
      const container = document.createElement('div')
      const isOpen = ref(false)
      const App = {
        /**
         * 把 isOpen 返回给 disabled Teleport 模板；即使 to 为 undefined，分支开启时内容仍应在主树原地挂载。
         */
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

    // SSR 使用转义的 --foo.bar 名称，父 useCssVars 提供同名 red 变量并透传至 Child 根，水合无 style mismatch；不直接读取变量值。
    test('escape css var name', () => {
      const container = document.createElement('div')
      container.innerHTML = `<div style="padding: 4px;--foo\\.bar:red;"></div>`
      const app = createSSRApp({
        /**
         * 登记带点号名称 foo.bar 的 CSS 变量，并以 Child 为根；SSR 使用转义名称，外层检查不误报 style mismatch。
         */
        setup() {
          useCssVars(() => ({
            'foo.bar': 'red',
          }))
          return () => h(Child)
        },
      })
      const Child = {
        /**
         * 返回 padding:4px 的 div 根，承接父级含点号名称的 CSS 变量；本例不直接读取自定义属性值。
         */
        setup() {
          return () => h('div', { style: 'padding: 4px' })
        },
      }
      app.mount(container)
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })
  })

  // 测试组：data-allow-mismatch 抑制相应检查路径的警告，文本和结构仍按客户端修正。
  describe('data-allow-mismatch', () => {
    // SSR div 用 data-allow-mismatch=text 允许 foo/bar 文本差异，水合仍修为 bar，但不报告 text content mismatch。
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

    // 父元素允许 children 差异，SSR 空 div 对应两个 span；水合照常补建 foo/bar，但不报告 children mismatch。
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

    // 父元素允许 children 差异，SSR 多一个 bar span；水合照常删除它，且不报告 children mismatch。
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

    // 父元素允许 children 差异，SSR 两个 span 对应客户端 div/p；水合仍替换标签，且不报告 node mismatch。
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

    // 父元素允许 children 差异，SSR Fragment 范围被 replaced span 替换；旧节点与锚点清除，node mismatch 警告被抑制。
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

    // 父元素允许 children 差异，SSR Fragment 缺 bar、外侧已有 baz；水合补入 bar 并保留边界，不报告 node mismatch。
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

    // 父元素允许 children 差异，SSR Fragment 多 bar、外侧已有 baz；水合删去多余项，text content 与 children 两种警告均被抑制。
    test('fragment too many children', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch="children"><!--[--><div>foo</div><div>bar</div><!--]--><div>baz</div></div>`,
        () => h('div', [[h('div', 'foo')], h('div', 'baz')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="children"><!--[--><div>foo</div><!--]--><div>baz</div></div>',
      )
      // 客户端 Fragment 提早结束，游标暂落在 SSR 多余的 bar；
      // 后继 baz 对它水合时产生文本内容差异。
      expect(`Hydration text content mismatch`).not.toHaveBeenWarned()
      // 随后移除 SSR 剩余 children，分别检查结构失配警告。
      expect(`Hydration children mismatch`).not.toHaveBeenWarned()
    })

    // 父元素允许 children 差异，SSR span 与 hi Comment 类型冲突；水合仍替换为注释，node 警告被抑制。
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

    // SSR v-if Comment 对应带空 data-allow-mismatch 的 div/span，水合挂载客户端分支，允许标记在客户端 VNode 上即可抑制 node 警告。
    test('comment mismatch (v-if)', () => {
      const { container } = mountWithHydration(`<!--v-if-->`, () =>
        h('div', { 'data-allow-mismatch': '' }, [h('span', 'value')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch=""><span>value</span></div>',
      )
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // SSR div 带空 data-allow-mismatch，客户端变为 v-if Comment；水合删除原元素分支，SSR 元素自身允许标记抑制 node 警告。
    test('comment mismatch (v-if branch removed)', () => {
      const { container } = mountWithHydration(
        `<div data-allow-mismatch=""><span>value</span></div>`,
        () => createCommentVNode('v-if', true),
      )
      expect(container.innerHTML).toBe('<!--v-if-->')
      expect(`Hydration node mismatch`).not.toHaveBeenWarned()
    })

    // SSR span 与客户端 div 类型冲突，两侧均带空允许标记；水合采用 client 文本的 div，不报告 node mismatch。
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

    // SSR v-if Comment 对应只允许 class 差异的客户端 div/span；结构仍按客户端替换，class 许可不能抑制 node mismatch 警告。
    test('comment mismatch (v-if) only allows children mismatches', () => {
      const { container } = mountWithHydration(`<!--v-if-->`, () =>
        h('div', { 'data-allow-mismatch': 'class' }, [h('span', 'value')]),
      )
      expect(container.innerHTML).toBe(
        '<div data-allow-mismatch="class"><span>value</span></div>',
      )
      expect(`Hydration node mismatch`).toHaveBeenWarned()
    })

    // 父元素允许 children 差异，SSR foobar 文本对应 hi Comment；水合替换内容且不报告 node mismatch。
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

    // SSR foo bar class 允许 class 差异，客户端只要 foo；水合不报告 class mismatch，此例不检查 class 是否改写。
    test('class mismatch', () => {
      mountWithHydration(
        `<div class="foo bar" data-allow-mismatch="class"></div>`,
        () => h('div', { class: 'foo' }),
      )
      expect(`Hydration class mismatch`).not.toHaveBeenWarned()
    })

    // SSR red style 允许 style 差异，客户端 green；水合不报告 style mismatch，此例只验证诊断抑制。
    test('style mismatch', () => {
      mountWithHydration(
        `<div style="color:red;" data-allow-mismatch="style"></div>`,
        () => h('div', { style: { color: 'green' } }),
      )
      expect(`Hydration style mismatch`).not.toHaveBeenWarned()
    })

    // 允许 attribute 差异的 SSR div 分别缺 id 或 id=bar，客户端都为 foo；两次水合均不报告属性失配。
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
    // 生产模式 SSR 内层 div 的 innerHTML=server，客户端 PROPS 动态键包含 innerHTML=client；水合主动改为 client，finally 恢复开发标志。
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

    // 生产模式 SSR img.src 与客户端动态 src 都为 /foo.png，setter spy 未被调用且原 attribute 保留；检查同值资源属性跳过重复赋值。
    test('does not re-write unchanged resource props when hydrating', () => {
      __DEV__ = false
      try {
        const container = document.createElement('div')
        container.innerHTML = `<img src="/foo.png">`
        const el = container.firstChild as HTMLImageElement
        const setSrc = vi.fn()
        Object.defineProperty(el, 'src', {
          configurable: true,
          /**
           * 回读 SSR 的原始 src attribute，配合 setter spy 区分保持原资源值与重新写入 DOM property。
           */
          get: () => el.getAttribute('src'),
          set: setSrc,
        })
        createSSRApp({
          /**
           * 返回 PROPS 标记且 dynamicProps 包含 src 的 img；同值资源检查应跳过 src setter。
           */
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

    // 生产模式 SSR src=/server.png 与客户端动态 src=/client.png 不同，水合后 attribute 改为客户端值，检查资源优化仍修补差异。
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

    // 生产模式 SSR svg 尺寸/viewBox 为24，客户端动态值为48；水合后三个 attribute 都更新，namespaceURI 仍为 SVG。
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

    // 生产模式 SVG 内 foreignObject.width 从24变48，提供只读 width getter 补足 jsdom；水合后 attribute 为48，检查该元素自身按 SVG 命名空间写属性。
    test('force patch foreignObject dynamic props with correct namespace when hydrating', () => {
      __DEV__ = false
      try {
        const container = document.createElement('div')
        container.innerHTML =
          '<svg><foreignObject width="24"></foreignObject></svg>'
        const el = container.querySelector('foreignObject')!
        expect(el.namespaceURI).toContain('svg')
        // jsdom 未实现 SVGForeignObjectElement.width；补固定 getter，让用例能够复现该 property 存在的宿主形状。
        Object.defineProperty(el, 'width', {
          configurable: true,
          /**
           * 为 jsdom 缺失的 foreignObject.width property 提供固定 24；外层检查 SVG 动态属性写为 attribute 48，而非依赖该 property setter。
           */
          get: () => 24,
        })

        createSSRApp({
          /**
           * 返回 svg/foreignObject 两层优化 block，foreignObject 的 width 列入 dynamicProps；水合须按该元素的 SVG 命名空间写 attribute。
           */
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

    // SSR div 同时 id/value=server，客户端两者均为client但 dynamicProps 只有 id；水合后 id=client、value=server，允许属性差异只抑制警告不扩大修补集合。
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
