/**
 * 共享用例使用 runtime-test 的 nodeOps 创建主容器与目标容器，检查实际移动后的宿主树。
 * runSharedTests 分别执行 eager/defer 模式；DOM 用例另用 jsdom 验证选择器、SVG 和 HMR。
 */
/**
 * @vitest-environment jsdom
 */

import {
  Teleport,
  Text,
  createApp,
  defineComponent,
  markRaw,
  nextTick,
  nodeOps,
  onMounted,
  h as originalH,
  ref,
  render,
  serialize,
  serializeInner,
  useModel,
  withDirectives,
} from '@vue/runtime-test'
import {
  Fragment,
  createBlock,
  createCommentVNode,
  createTextVNode,
  createVNode,
  openBlock,
} from '../../src/vnode'
import { toDisplayString } from '@vue/shared'
import { compile, createApp as createDOMApp, render as domRender } from 'vue'
import type { HMRRuntime } from '../../src/hmr'

/** 开发环境 HMR 运行时，用于验证 Teleport 子树热更新后的目标内容。 */
declare var __VUE_HMR_RUNTIME__: HMRRuntime

/** Teleport 测试需要的 render 热替换与组件记录入口。 */
const { rerender, createRecord } = __VUE_HMR_RUNTIME__

// 测试组：Teleport 的目标挂载、禁用切换、移动、延迟和多实例协作。
describe('renderer: teleport', () => {
  // 测试组：Teleport 的 eager（立即挂载）模式。
  describe('eager mode', () => {
    runSharedTests(false)
  })

  // 测试组：延迟模式。
  describe('defer mode', () => {
    runSharedTests(true)

    const h = originalH

    /** 测试场景：defer Teleport 在同一渲染中先于 #target 创建；挂载返回后主树只留双注释，稍后创建的目标内已有 teleported div，验证 post 阶段解析目标。 */
    test('should be able to target content appearing later than the teleport with defer', () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      createDOMApp({
        /** 渲染根数组[Teleport节点（属性{to: '#target'，defer: true}；'div'节点（'teleported'））、'div'节点（属性{id: 'target'}）]。 */
        render() {
          return [
            h(Teleport, { to: '#target', defer: true }, h('div', 'teleported')),
            h('div', { id: 'target' }),
          ]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<!--teleport start--><!--teleport end--><div id="target"><div>teleported</div></div>"`,
      )
    })

    /** 测试场景：Suspense 默认 div 内含异步组件、defer Teleport 和后置目标；pending 时主树为注释，依赖完成并刷新 post 后目标内出现 teleported，验证边界提交后延迟任务执行。 */
    test('defer mode should work inside suspense', async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      let p: Promise<any>

      const Comp = defineComponent({
        template: `
        <suspense>
          <div>
            <async />
            <teleport defer to="#target-suspense">
              <div>teleported</div>
            </teleport>
            <div id="target-suspense" />
          </div>
        </suspense>`,
        components: {
          async: {
            /** 执行p=Promise.resolve(() => 'async')；安排Promise.resolve回调。setup返回p。 */
            setup() {
              p = Promise.resolve(() => 'async')
              return p
            },
          },
        },
      })

      domRender(h(Comp), root)
      expect(root.innerHTML).toBe(`<!---->`)

      await p!.then(() => Promise.resolve())
      await nextTick()
      expect(root.innerHTML).toBe(
        `<div>` +
          `async` +
          `<!--teleport start--><!--teleport end-->` +
          `<div id="target-suspense"><div>teleported</div></div>` +
          `</div>`,
      )
    })

    /** 测试场景：show 从 false 改 true 时创建 defer Teleport Header，兄弟 Footer.setup 将 foo 从 foo 改 bar；刷新后目标里 Header 显示 bar，确认挂载前更新使用最新 props。 */
    test('update before mounted with defer', async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      const show = ref(false)
      const foo = ref('foo')
      const Header = {
        props: { foo: String },
        /** setup返回渲染函数：'div'节点（props.foo）。 */
        setup(props: any) {
          return () => h('div', props.foo)
        },
      }
      const Footer = {
        /** 执行foo.value='bar'。setup返回渲染函数：'div'节点（'Footer'）。 */
        setup() {
          foo.value = 'bar'
          return () => h('div', 'Footer')
        },
      }
      createDOMApp({
        /** 渲染show.value决定根数组[Teleport节点（属性{to: '#targetId'，defer: true}；Header节点（属性{foo: foo.value}））、Footer节点、'div'节点（属性{id: 'targetId'}）]或根数组['div'节点]。 */
        render() {
          return show.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId', defer: true },
                  h(Header, { foo: foo.value }),
                ),
                h(Footer),
                h('div', { id: 'targetId' }),
              ]
            : [h('div')]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div></div>"`)

      show.value = true
      await nextTick()
      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<!--teleport start--><!--teleport end--><div>Footer</div><div id="targetId"><div>bar</div></div>"`,
      )
    })

    /** 测试场景：同轮 Step1 将 Teleport disabled=true、文本B并触发 Step2，Step2 再启用并改C；刷新后只显示 step2 且目标文本C，验证延迟更新以已挂载 VNode 为 patch 基准。 */
    test('should keep the mounted vnode as the patch base across deferred updates', async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      const show = ref(false)
      const disabled = ref(false)
      const text = ref('A')
      const phase = ref(0)

      const Step1 = {
        /** 执行disabled.value=true；text.value='B'；phase.value=1。setup返回渲染函数：'div'节点（'step1'）。 */
        setup() {
          disabled.value = true
          text.value = 'B'
          phase.value = 1
          return () => h('div', 'step1')
        },
      }

      const Step2 = {
        /** 执行disabled.value=false；text.value='C'。setup返回渲染函数：'div'节点（'step2'）。 */
        setup() {
          disabled.value = false
          text.value = 'C'
          return () => h('div', 'step2')
        },
      }

      createDOMApp({
        /** 渲染show.value决定根数组[Teleport节点（属性{to: '#targetId2'，defer: true，disabled: disabled.value}；'div'节点（text.value））、phase.value === 0决定Step1节点或Step2节点、'div'节点（属性{id: 'targetId2'}）]或根数组['div'节点]。 */
        render() {
          return show.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId2', defer: true, disabled: disabled.value },
                  h('div', text.value),
                ),
                phase.value === 0 ? h(Step1) : h(Step2),
                h('div', { id: 'targetId2' }),
              ]
            : [h('div')]
        },
      }).mount(root)

      show.value = true
      await nextTick()

      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<!--teleport start--><!--teleport end--><div>step2</div><div id="targetId2"><div>C</div></div>"`,
      )
    })

    /** 测试场景：showTeleport 打开后兄弟 Step.setup 在 defer mount 前设 disabled=true；最终内容落在主双锚点间、目标为空，确认挂载前禁用更新。 */
    test('should handle disabled teleport updates before deferred mount', async () => {
      const root = document.createElement('div')
      const target = document.createElement('div')
      target.id = 'targetId3'
      document.body.appendChild(root)
      document.body.appendChild(target)

      const showTeleport = ref(false)
      const disabled = ref(false)

      const Step = {
        /** 执行disabled.value=true。setup返回渲染函数：'div'节点（'step'）。 */
        setup() {
          disabled.value = true
          return () => h('div', 'step')
        },
      }

      createDOMApp({
        /** 渲染showTeleport.value决定根数组[Teleport节点（属性{to: '#targetId3'，defer: true，disabled: disabled.value}；'div'节点（'teleported'））、Step节点]或根数组['div'节点]。 */
        render() {
          return showTeleport.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId3', defer: true, disabled: disabled.value },
                  h('div', 'teleported'),
                ),
                h(Step),
              ]
            : [h('div')]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div></div>"`)
      expect(target.innerHTML).toBe(``)

      showTeleport.value = true
      await nextTick()

      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<!--teleport start--><div>teleported</div><!--teleport end--><div>step</div>"`,
      )
      expect(target.innerHTML).toBe(``)
    })

    /** 测试场景：打开 defer Teleport 后 Step1/Step2 连续更新并关闭 showTeleport；最终主树仅 done div、目标始终空，废弃任务不再挂载远端内容。 */
    test('should not mount discarded teleport after deferred updates', async () => {
      const root = document.createElement('div')
      const target = document.createElement('div')
      target.id = 'targetId4'
      document.body.appendChild(root)
      document.body.appendChild(target)

      const showTeleport = ref(false)
      const phase = ref(0)

      const Step1 = {
        /** 执行phase.value=1。setup返回渲染函数：'div'节点（'step1'）。 */
        setup() {
          phase.value = 1
          return () => h('div', 'step1')
        },
      }

      const Step2 = {
        /** 执行showTeleport.value=false。setup返回渲染函数：'div'节点（'step2'）。 */
        setup() {
          showTeleport.value = false
          return () => h('div', 'step2')
        },
      }

      createDOMApp({
        /** 渲染showTeleport.value决定根数组[Teleport节点（属性{to: '#targetId4'，defer: true}；'div'节点（'teleported'））、phase.value === 0决定Step1节点或Step2节点]或根数组['div'节点（'done'）]。 */
        render() {
          return showTeleport.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId4', defer: true },
                  h('div', 'teleported'),
                ),
                phase.value === 0 ? h(Step1) : h(Step2),
              ]
            : [h('div', 'done')]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)

      showTeleport.value = true
      await nextTick()

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)
    })

    // #14876
    /** 测试场景：打开带 Inner 子组件的 defer Teleport 后 Step1/Step2 连续更新并关闭；最终仅 done div 且目标为空，验证废弃的组件子树不会延迟挂载。 */
    test('should not mount discarded teleport with component child after deferred updates', async () => {
      const root = document.createElement('div')
      const target = document.createElement('div')
      target.id = 'targetId4-component'
      document.body.appendChild(root)
      document.body.appendChild(target)

      const showTeleport = ref(false)
      const phase = ref(0)

      const Inner = {
        /** 渲染'div'节点（'inner'）。 */
        render: () => h('div', 'inner'),
      }

      const Step1 = {
        /** 执行phase.value=1。setup返回渲染函数：'div'节点（'step1'）。 */
        setup() {
          phase.value = 1
          return () => h('div', 'step1')
        },
      }

      const Step2 = {
        /** 执行showTeleport.value=false。setup返回渲染函数：'div'节点（'step2'）。 */
        setup() {
          showTeleport.value = false
          return () => h('div', 'step2')
        },
      }

      createDOMApp({
        /** 渲染showTeleport.value决定根数组[Teleport节点（属性{to: '#targetId4-component'，defer: true}；Inner节点）、phase.value === 0决定Step1节点或Step2节点]或根数组['div'节点（'done'）]。 */
        render() {
          return showTeleport.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId4-component', defer: true },
                  h(Inner),
                ),
                phase.value === 0 ? h(Step1) : h(Step2),
              ]
            : [h('div', 'done')]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)

      showTeleport.value = true
      await nextTick()

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)
    })

    /** 测试场景：打开 defer Teleport 后 Step1 禁用并推进阶段，Step2 再关闭整个分支；最终仅 done div、目标为空，确认废弃的本地挂载任务也被跳过。 */
    test('should not mount discarded disabled teleport after deferred updates', async () => {
      const root = document.createElement('div')
      const target = document.createElement('div')
      target.id = 'targetId5'
      document.body.appendChild(root)
      document.body.appendChild(target)

      const showTeleport = ref(false)
      const disabled = ref(false)
      const phase = ref(0)

      const Step1 = {
        /** 执行disabled.value=true；phase.value=1。setup返回渲染函数：'div'节点（'step1'）。 */
        setup() {
          disabled.value = true
          phase.value = 1
          return () => h('div', 'step1')
        },
      }

      const Step2 = {
        /** 执行showTeleport.value=false。setup返回渲染函数：'div'节点（'step2'）。 */
        setup() {
          showTeleport.value = false
          return () => h('div', 'step2')
        },
      }

      createDOMApp({
        /** 渲染showTeleport.value决定根数组[Teleport节点（属性{to: '#targetId5'，defer: true，disabled: disabled.value}；'div'节点（'teleported'））、phase.value === 0决定Step1节点或Step2节点]或根数组['div'节点（'done'）]。 */
        render() {
          return showTeleport.value
            ? [
                h(
                  Teleport,
                  { to: '#targetId5', defer: true, disabled: disabled.value },
                  h('div', 'teleported'),
                ),
                phase.value === 0 ? h(Step1) : h(Step2),
              ]
            : [h('div', 'done')]
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)

      showTeleport.value = true
      await nextTick()

      expect(root.innerHTML).toMatchInlineSnapshot(`"<div>done</div>"`)
      expect(target.innerHTML).toBe(``)
    })

    // #13349
    /** 测试场景：定时打开 defer Teleport，同轮兄弟 useModel 写回2+，随后定时将文本3改3+；等待后目标 span 显示3+且组件 span 保留，核对挂载前后连续更新。 */
    test('handle deferred teleport updates before and after mount', async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      const show = ref(false)
      const data2 = ref('2')
      const data3 = ref('3')

      const Comp = {
        props: {
          modelValue: {},
          modelModifiers: {},
        },
        emits: ['update:modelValue'],
        /** 执行data2.value='2+'。setup返回渲染函数：'span'节点。 */
        setup(props: any) {
          const data2 = useModel(props, 'modelValue')
          data2.value = '2+'
          return () => h('span')
        },
      }

      createDOMApp({
        /** 注册两个定时更新：5ms打开show挂载defer Teleport，10ms把data3改3+；不返回渲染值，实际render由同组选项提供。 */
        setup() {
          setTimeout(() => (show.value = true), 5)
          setTimeout(() => (data3.value = '3+'), 10)
        },
        /** 渲染Fragment节点（null；根数组['span'节点（属性{id: 'targetId001'}）、show.value决定Fragment节点（null；根数组[Teleport节点（属性{to: '#targetId001'，defer: true}；根数组[createTextVNode(String(data3.value))]）、Comp节点（属性{modelValue: data2.value，'onUpdate:modelValue'回调}）]）或createCommentVNode('v-if')]）。 */
        render() {
          return h(Fragment, null, [
            h('span', { id: 'targetId001' }),
            show.value
              ? h(Fragment, null, [
                  h(Teleport, { to: '#targetId001', defer: true }, [
                    createTextVNode(String(data3.value)),
                  ]),
                  h(Comp, {
                    modelValue: data2.value,
                    /** 执行data2.value=event。返回data2.value = event。 */
                    'onUpdate:modelValue': (event: any) =>
                      (data2.value = event),
                  }),
                ])
              : createCommentVNode('v-if'),
          ])
        },
      }).mount(root)

      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<span id="targetId001"></span><!--v-if-->"`,
      )

      await new Promise(r => setTimeout(r, 10))
      expect(root.innerHTML).toMatchInlineSnapshot(
        `"<span id="targetId001">3+</span><!--teleport start--><!--teleport end--><span></span>"`,
      )
    })
  })

  /** 同一套目标/搬运/卸载断言在 eager 与 defer 两种模式各注册一次；defer 分支包装 h，仅为 Teleport props 注入 defer=true。 */
  function runSharedTests(deferMode: boolean) {
    const h = (deferMode
      ? (type: any, props: any, ...args: any[]) => {
          if (type === Teleport) {
            props.defer = true
          }
          return originalH(type, props, ...args)
        }
      : originalH) as unknown as typeof originalH

    /** 测试场景：eager/defer 两种共享模式挂载 Teleport 和普通 root div；主树保留双注释与 root，目标包含 teleported div，验证宿主位置。 */
    test('should work', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      render(
        h(() => [
          h(Teleport, { to: target }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )

      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)
    })

    /** 测试场景：eager/defer 两模式用模板 ref 获取 svg，再挂载 Teleport circle；两者 namespaceURI 均为 SVG 且 circle 位于 svg，确认按目标继承命名空间。 */
    test('should work with SVG', async () => {
      const root = document.createElement('div')
      const svg = ref()
      const circle = ref()

      const Comp = defineComponent({
        /** setup返回{svg，circle}。 */
        setup() {
          return {
            svg,
            circle,
          }
        },
        template: `
        <svg ref="svg"></svg>
        <teleport :to="svg" v-if="svg">
        <circle ref="circle"></circle>
        </teleport>`,
      })

      domRender(h(Comp), root)

      await nextTick()

      expect(root.innerHTML).toBe(
        `<svg><circle></circle></svg><!--teleport start--><!--teleport end-->`,
      )

      expect(svg.value.namespaceURI).toBe('http://www.w3.org/2000/svg')
      expect(circle.value.namespaceURI).toBe('http://www.w3.org/2000/svg')
    })

    /** 测试场景：eager/defer 两模式将响应式目标 A 改 B；主树锚点与 root 不动，A 内容清空、B 出现原 teleported div，验证目标切换搬运。 */
    test('should update target', async () => {
      const targetA = nodeOps.createElement('div')
      const targetB = nodeOps.createElement('div')
      const target = ref(targetA)
      const root = nodeOps.createElement('div')

      render(
        h(() => [
          h(Teleport, { to: target.value }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )

      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(targetA)).toBe(`<div>teleported</div>`)
      expect(serializeInner(targetB)).toBe(``)

      target.value = targetB
      await nextTick()

      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(targetA)).toBe(``)
      expect(serializeInner(targetB)).toBe(`<div>teleported</div>`)
    })

    /** 测试场景：eager/defer 两模式初始禁用，把缓存静态 Text 留在目标1的本地锚点间；同时切 to=目标2并启用后目标1只剩锚点、目标2含静态文本，确认缓存 Text 的 el 被继承并可移动。 */
    test('move cached text nodes', async () => {
      document.body.innerHTML = ''
      const root = document.createElement('div')
      document.body.appendChild(root)

      const to = ref('#teleport01')
      const disabled = ref(true)

      const App = defineComponent({
        /** setup返回{to，disabled，deferMode}。 */
        setup() {
          return { to, disabled, deferMode }
        },
        template: `  
          <div id="teleport01">
            <Teleport :to="to" :defer="deferMode" :disabled="disabled">
              static text
            </Teleport>
          </div>
          <div id="teleport02"></div>
        `,
      })

      domRender(h(App), root)
      await nextTick()

      const target1 = root.querySelector('#teleport01') as HTMLElement
      const target2 = root.querySelector('#teleport02') as HTMLElement
      expect(target1.innerHTML).toBe(
        '<!--teleport start--> static text <!--teleport end-->',
      )
      expect(target2.innerHTML).toBe('')

      to.value = '#teleport02'
      disabled.value = false

      await nextTick()
      expect(target1.innerHTML).toBe('<!--teleport start--><!--teleport end-->')
      expect(target2.innerHTML).toContain('static text')

      domRender(null, root)
      root.remove()
    })

    /** 测试场景：eager/defer 两模式将远端 children 从 div 改空数组再改 Text；目标分别显示 div、空、纯文本，验证更新与移除。 */
    test('should update children', async () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')
      const children = ref([h('div', 'teleported')])

      render(
        h(() => h(Teleport, { to: target }, children.value)),
        root,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)

      children.value = []
      await nextTick()

      expect(serializeInner(target)).toBe(``)

      children.value = [createVNode(Text, null, 'teleported')]
      await nextTick()

      expect(serializeInner(target)).toBe(`teleported`)
    })

    /** 测试场景：生产优化 block Teleport 内含静态注释，外部 count 更新0→1；主树文本更新，Teleport 新 VNode 的注释 el 仍是旧对象，验证静态节点宿主引用继承。 */
    test('should traverse comment node after updating in optimize mode', async () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')
      const count = ref(0)
      let teleport

      __DEV__ = false
      render(
        h(() => {
          teleport =
            (openBlock(),
            createBlock(Teleport, { to: target }, [
              createCommentVNode('comment in teleport'),
            ]))
          return h('div', null, [
            createTextVNode(toDisplayString(count.value)),
            teleport,
          ])
        }),
        root,
      )
      const commentNode = teleport!.children[0].el
      expect(serializeInner(root)).toBe(`<div>0</div>`)
      expect(serializeInner(target)).toBe(`<!--comment in teleport-->`)
      expect(serialize(commentNode)).toBe(`<!--comment in teleport-->`)

      count.value = 1
      await nextTick()
      __DEV__ = true
      expect(serializeInner(root)).toBe(`<div>1</div>`)
      expect(teleport!.children[0].el).toBe(commentNode)
    })

    /** 测试场景：两共享模式分别测试启用有效目标、禁用有效目标、禁用空目标；render(null) 后目标序列化为空且 childNodes 数为0，确认内容和目标锚点清理。 */
    test('should remove children when unmounted', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      /** 以给定目标和 disabled 配置挂载 Teleport，再 render(null)；断言目标内容及包括空 Text 锚点的全部 children 都被清理。 */
      function testUnmount(props: any) {
        render(
          h(() => [
            h(Teleport, props, h('div', 'teleported')),
            h('div', 'root'),
          ]),
          root,
        )
        expect(serializeInner(target)).toBe(
          props.disabled ? `` : `<div>teleported</div>`,
        )

        render(null, root)
        expect(serializeInner(target)).toBe('')
        expect(target.children.length).toBe(0)
      }

      testUnmount({ to: target, disabled: false })
      testUnmount({ to: target, disabled: true })
      testUnmount({ to: null, disabled: true })
    })

    // #10747
    /** 测试场景：生产优化 Teleport 含顶层注释，先更新外部 count 再整体卸载；root.children 长度为0，验证静态注释路径不残留主树节点。 */
    test('should unmount correctly when using top level comment in teleport', async () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')
      const count = ref(0)

      __DEV__ = false
      render(
        h(() => {
          return h('div', null, [
            createTextVNode(toDisplayString(count.value)),
            (openBlock(),
            createBlock(Teleport, { to: target }, [
              createCommentVNode('comment in teleport'),
            ])),
          ])
        }),
        root,
      )

      count.value = 1

      await nextTick()
      __DEV__ = true
      render(null, root)
      expect(root.children.length).toBe(0)
    })

    /** 测试场景：两模式 Teleport 子组件返回双 p Fragment；挂载目标有两个 p，整体卸载后目标为空，验证多根宿主区间清理。 */
    test('component with multi roots should be removed when unmounted', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      const Comp = {
        /** 渲染根数组['p'节点、'p'节点]。 */
        render() {
          return [h('p'), h('p')]
        },
      }

      render(
        h(() => [h(Teleport, { to: target }, h(Comp)), h('div', 'root')]),
        root,
      )
      expect(serializeInner(target)).toBe(`<p></p><p></p>`)

      render(null, root)
      expect(serializeInner(target)).toBe('')
    })

    // #6347
    /** 测试场景：禁用且 to=null 的 Teleport 子组件返回双 p；整体卸载后 beforeUnmount/unmounted 各一次，确认本地后代正常销毁。 */
    test('descendent component should be unmounted when teleport is disabled and unmounted', () => {
      const root = nodeOps.createElement('div')

      const CompWithHook = {
        /** 渲染根数组['p'节点、'p'节点]。 */
        render() {
          return [h('p'), h('p')]
        },
        beforeUnmount: vi.fn(),
        unmounted: vi.fn(),
      }

      render(
        h(() => [h(Teleport, { to: null, disabled: true }, h(CompWithHook))]),
        root,
      )
      expect(CompWithHook.beforeUnmount).toBeCalledTimes(0)
      expect(CompWithHook.unmounted).toBeCalledTimes(0)

      render(null, root)

      expect(CompWithHook.beforeUnmount).toBeCalledTimes(1)
      expect(CompWithHook.unmounted).toBeCalledTimes(1)
    })

    /** 测试场景：两模式两个 Teleport 共用 target；更新各自内容、移除并重新创建第一实例再移除第二实例，目标顺序按实际追加位置变化，实例锚点区间互不覆盖。 */
    test('multiple teleport with same target', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      render(
        h('div', [
          h(Teleport, { to: target }, h('div', 'one')),
          h(Teleport, { to: target }, 'two'),
        ]),
        root,
      )

      expect(serializeInner(root)).toBe(
        `<div><!--teleport start--><!--teleport end--><!--teleport start--><!--teleport end--></div>`,
      )
      expect(serializeInner(target)).toBe(`<div>one</div>two`)

      // 修补两个实例的现有内容。
      render(
        h('div', [
          h(Teleport, { to: target }, [h('div', 'one'), h('div', 'two')]),
          h(Teleport, { to: target }, 'three'),
        ]),
        root,
      )
      expect(serializeInner(target)).toBe(`<div>one</div><div>two</div>three`)

      // 移除第一个 Teleport。
      render(h('div', [null, h(Teleport, { to: target }, 'three')]), root)
      expect(serializeInner(root)).toBe(
        `<div><!----><!--teleport start--><!--teleport end--></div>`,
      )
      expect(serializeInner(target)).toBe(`three`)

      // 切回原分支。
      render(
        h('div', [
          h(Teleport, { to: target }, [h('div', 'one'), h('div', 'two')]),
          h(Teleport, { to: target }, 'three'),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<div><!--teleport start--><!--teleport end--><!--teleport start--><!--teleport end--></div>`,
      )
      // 重新创建的 Teleport 在目标末尾追加内容。
      expect(serializeInner(target)).toBe(`three<div>one</div><div>two</div>`)

      // 移除另一个 Teleport。
      render(
        h('div', [
          h(Teleport, { to: target }, [h('div', 'one'), h('div', 'two')]),
          null,
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<div><!--teleport start--><!--teleport end--><!----></div>`,
      )
      expect(serializeInner(target)).toBe(`<div>one</div><div>two</div>`)
    })

    /** 测试场景：模板 ref 目标初始 null且 Teleport 禁用，内容先在主锚点间；目标 ref 完成后启用，内容移入 ref div 而主树只留锚点。 */
    test('should work when using template ref as target', async () => {
      const root = nodeOps.createElement('div')
      const target = ref(null)
      const disabled = ref(true)

      const App = {
        /** setup返回渲染函数：Fragment节点（根数组['div'节点（属性{ref: target}）、Teleport节点（属性{to: target.value，disabled: disabled.value}；'div'节点（'teleported'））]）。 */
        setup() {
          return () =>
            h(Fragment, [
              h('div', { ref: target }),
              h(
                Teleport,
                { to: target.value, disabled: disabled.value },
                h('div', 'teleported'),
              ),
            ])
        },
      }
      render(h(App), root)
      expect(serializeInner(root)).toBe(
        `<div></div><!--teleport start--><div>teleported</div><!--teleport end-->`,
      )

      disabled.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(
        `<div><div>teleported</div></div><!--teleport start--><!--teleport end-->`,
      )
    })

    /** 测试场景：两模式从启用→禁用→启用；内容在 target 与主双锚点间往返，普通 root div 保持位置，验证 disabled 的位置切换。 */
    test('disabled', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      /** 构造 Teleport 与普通 root 的 Fragment；disabled 参数决定 teleported div 留在主树还是目标，用于三次往返位置断言。 */
      const renderWithDisabled = (disabled: boolean) => {
        return h(Fragment, [
          h(Teleport, { to: target, disabled }, h('div', 'teleported')),
          h('div', 'root'),
        ])
      }

      render(renderWithDisabled(false), root)
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)

      render(renderWithDisabled(true), root)
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><div>teleported</div><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(``)

      // 切回原分支。
      render(renderWithDisabled(false), root)
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)
    })

    /** 测试场景：两模式启用 Teleport 在 Fragment 中与 root div 互换顺序再复原；只移动主树双锚点，target 内容始终保持。 */
    test('moving teleport while enabled', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      render(
        h(Fragment, [
          h(Teleport, { to: target }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)

      render(
        h(Fragment, [
          h('div', 'root'),
          h(Teleport, { to: target }, h('div', 'teleported')),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<div>root</div><!--teleport start--><!--teleport end-->`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)

      render(
        h(Fragment, [
          h(Teleport, { to: target }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(`<div>teleported</div>`)
    })

    /** 测试场景：两模式禁用 Teleport 在 Fragment 中与 root div 互换顺序再复原；双锚点和本地 child 一起移动，target 始终空。 */
    test('moving teleport while disabled', () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')

      render(
        h(Fragment, [
          h(Teleport, { to: target, disabled: true }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><div>teleported</div><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe('')

      render(
        h(Fragment, [
          h('div', 'root'),
          h(Teleport, { to: target, disabled: true }, h('div', 'teleported')),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<div>root</div><!--teleport start--><div>teleported</div><!--teleport end-->`,
      )
      expect(serializeInner(target)).toBe('')

      render(
        h(Fragment, [
          h(Teleport, { to: target, disabled: true }, h('div', 'teleported')),
          h('div', 'root'),
        ]),
        root,
      )
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><div>teleported</div><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe('')
    })

    /** 测试场景：模板编译成 block，disabled false→true→false；内容容器随禁用切换，同时动态文本与 v-if span/注释正确更新，验证 block 结构与搬运协同。 */
    test('should work with block tree', async () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')
      const disabled = ref(false)

      const App = {
        /** setup返回{target: markRaw(target)，disabled}。 */
        setup() {
          return {
            target: markRaw(target),
            disabled,
          }
        },
        render: compile(`
        <teleport :to="target" :disabled="disabled">
          <div>teleported</div><span>{{ disabled }}</span><span v-if="disabled"/>
        </teleport>
        <div>root</div>
        `),
      }
      render(h(App), root)
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(
        `<div>teleported</div><span>false</span><!--v-if-->`,
      )

      disabled.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><div>teleported</div><span>true</span><span></span><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(``)

      // 切回原分支。
      disabled.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end--><div>root</div>`,
      )
      expect(serializeInner(target)).toBe(
        `<div>teleported</div><span>false</span><!--v-if-->`,
      )
    })

    // #3497
    /** 测试场景：两模式 Teleport div 绑定仅含 mounted/unmounted 的指令；挂载 mounted 一次，移除整个分支后 unmounted 一次、目标清空，此例没有 updated 钩子断言。 */
    test(`the dir hooks of the Teleport's children should be called correctly`, async () => {
      const target = nodeOps.createElement('div')
      const root = nodeOps.createElement('div')
      const toggle = ref(true)
      const dir = {
        mounted: vi.fn(),
        unmounted: vi.fn(),
      }

      const app = createApp({
        /** setup返回渲染函数：toggle.value决定Teleport节点（属性{to: target}；根数组[withDirectives(h('div', ['foo']), [[dir]])]）或null。 */
        setup() {
          return () => {
            return toggle.value
              ? h(Teleport, { to: target }, [
                  withDirectives(h('div', ['foo']), [[dir]]),
                ])
              : null
          }
        },
      })
      app.mount(root)

      expect(serializeInner(root)).toBe(
        `<!--teleport start--><!--teleport end-->`,
      )
      expect(serializeInner(target)).toBe(`<div>foo</div>`)
      await nextTick()
      expect(dir.mounted).toHaveBeenCalledTimes(1)
      expect(dir.unmounted).toHaveBeenCalledTimes(0)

      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`<!---->`)
      expect(serializeInner(target)).toBe(``)
      expect(dir.mounted).toHaveBeenCalledTimes(1)
      expect(dir.unmounted).toHaveBeenCalledTimes(1)
    })

    // #7835
    /** 测试场景：两模式先启用到 target1 再禁用，禁用时依次改 target2、target3；三个远端均为空，最后启用只 target3 有内容，确认延后采用最新 to。 */
    test(`ensure that target changes when disabled are updated correctly when enabled`, async () => {
      const root = nodeOps.createElement('div')
      const target1 = nodeOps.createElement('div')
      const target2 = nodeOps.createElement('div')
      const target3 = nodeOps.createElement('div')
      const target = ref(target1)
      const disabled = ref(true)

      const App = {
        /** setup返回渲染函数：Fragment节点（根数组[Teleport节点（属性{to: target.value，disabled: disabled.value}；'div'节点（'teleported'））]）。 */
        setup() {
          return () =>
            h(Fragment, [
              h(
                Teleport,
                { to: target.value, disabled: disabled.value },
                h('div', 'teleported'),
              ),
            ])
        },
      }
      render(h(App), root)
      disabled.value = false
      await nextTick()
      expect(serializeInner(target1)).toBe(`<div>teleported</div>`)
      expect(serializeInner(target2)).toBe(``)
      expect(serializeInner(target3)).toBe(``)

      disabled.value = true
      await nextTick()
      target.value = target2
      await nextTick()
      expect(serializeInner(target1)).toBe(``)
      expect(serializeInner(target2)).toBe(``)
      expect(serializeInner(target3)).toBe(``)

      target.value = target3
      await nextTick()
      expect(serializeInner(target1)).toBe(``)
      expect(serializeInner(target2)).toBe(``)
      expect(serializeInner(target3)).toBe(``)

      disabled.value = false
      await nextTick()
      expect(serializeInner(target1)).toBe(``)
      expect(serializeInner(target2)).toBe(``)
      expect(serializeInner(target3)).toBe(`<div>teleported</div>`)
    })

    //#9071
    /** 测试场景：Teleport 的 target 是自身挂载容器，从普通 foo div 切为 Teleport 再切回；每步 innerHTML 准确，验证共享容器中的移除/插入锚点。 */
    test('toggle sibling node inside target node', async () => {
      const root = document.createElement('div')
      const show = ref(false)
      const App = defineComponent({
        /** setup返回渲染函数：show.value决定Teleport节点（属性{to: root}；根数组['div'节点（'teleported'）]）或'div'节点（'foo'）。 */
        setup() {
          return () => {
            return show.value
              ? h(Teleport, { to: root }, [h('div', 'teleported')])
              : h('div', 'foo')
          }
        },
      })

      domRender(h(App), root)
      expect(root.innerHTML).toBe('<div>foo</div>')

      show.value = true
      await nextTick()

      expect(root.innerHTML).toBe(
        '<!--teleport start--><!--teleport end--><div>teleported</div>',
      )

      show.value = false
      await nextTick()

      expect(root.innerHTML).toBe('<div>foo</div>')
    })

    /** 测试场景：target 为主容器，条件 Fragment 内的 Teleport 组件先挂载再整体关闭；双注释和远端 foo 均被移除，最后仅 v-if 注释，验证父区间卸载顺序。 */
    test('unmount previous sibling node inside target node', async () => {
      const root = document.createElement('div')
      const parentShow = ref(false)
      const childShow = ref(true)

      const Comp = {
        /** setup返回渲染函数：Teleport节点（属性{to: root}；根数组['div'节点（'foo'）]）。 */
        setup() {
          return () => h(Teleport, { to: root }, [h('div', 'foo')])
        },
      }

      const App = defineComponent({
        /** setup返回渲染函数：parentShow.value决定Fragment节点（属性{key: 0}；根数组[childShow.value决定Comp节点或createCommentVNode('v-if')]）或createCommentVNode('v-if')。 */
        setup() {
          return () => {
            return parentShow.value
              ? h(Fragment, { key: 0 }, [
                  childShow.value ? h(Comp) : createCommentVNode('v-if'),
                ])
              : createCommentVNode('v-if')
          }
        },
      })

      domRender(h(App), root)
      expect(root.innerHTML).toBe('<!--v-if-->')

      parentShow.value = true
      await nextTick()
      expect(root.innerHTML).toBe(
        '<!--teleport start--><!--teleport end--><div>foo</div>',
      )

      parentShow.value = false
      await nextTick()
      expect(root.innerHTML).toBe('<!--v-if-->')
    })

    /** 测试场景：启用 Teleport 初始 to=null，报告 mount 警告且只挂主双锚点；随后移除子组件只留下 v-if 注释，确认未挂载 children 不走宿主移除。 */
    test('skip unmount children if teleport not disabled & target missing', async () => {
      const root = document.createElement('div')
      const childShow = ref(true)

      const Comp = {
        /** setup返回渲染函数：Teleport节点（属性{to: null}；根数组['div'节点（'foo'）]）。 */
        setup() {
          return () => h(Teleport, { to: null }, [h('div', 'foo')])
        },
      }

      const App = defineComponent({
        /** setup返回渲染函数：Fragment节点（属性{key: 0}；根数组[childShow.value决定Comp节点或createCommentVNode('v-if')]）。 */
        setup() {
          return () => {
            return h(Fragment, { key: 0 }, [
              childShow.value ? h(Comp) : createCommentVNode('v-if'),
            ])
          }
        },
      })

      domRender(h(App), root)
      expect('Invalid Teleport target: null').toHaveBeenWarned()
      expect('Invalid Teleport target on mount').toHaveBeenWarned()
      expect(root.innerHTML).toBe('<!--teleport start--><!--teleport end-->')

      childShow.value = false
      await nextTick()
      expect(root.innerHTML).toBe('<!--v-if-->')
    })

    /** 测试场景：先挂载到有效 target，再改 to=null并移除整个子组件；update 警告后旧目标已挂载内容仍被清理，最终 childNodes 为0。 */
    test('unmount mounted children after target becomes missing', async () => {
      const root = document.createElement('div')
      const target = document.createElement('div')
      const teleportTarget = ref<Element | null>(target)
      const childShow = ref(true)

      const Comp = {
        /** setup返回渲染函数：Teleport节点（属性{to: teleportTarget.value}；根数组['div'节点（'foo'）]）。 */
        setup() {
          return () =>
            h(Teleport, { to: teleportTarget.value }, [h('div', 'foo')])
        },
      }

      const App = defineComponent({
        /** setup返回渲染函数：Fragment节点（属性{key: 0}；根数组[childShow.value决定Comp节点或createCommentVNode('v-if')]）。 */
        setup() {
          return () => {
            return h(Fragment, { key: 0 }, [
              childShow.value ? h(Comp) : createCommentVNode('v-if'),
            ])
          }
        },
      })

      domRender(h(App), root)
      expect(root.innerHTML).toBe('<!--teleport start--><!--teleport end-->')
      expect(target.innerHTML).toBe('<div>foo</div>')

      teleportTarget.value = null
      await nextTick()
      expect('Invalid Teleport target: null').toHaveBeenWarned()
      expect('Invalid Teleport target on update').toHaveBeenWarned()
      expect(target.innerHTML).toBe('<div>foo</div>')

      childShow.value = false
      await nextTick()
      expect(root.innerHTML).toBe('<!--v-if-->')
      expect(target.innerHTML).toBe('')
      expect(target.childNodes.length).toBe(0)
    })

    /** 测试场景：两模式 Teleport div 有模板 ref，父 mounted 中立即读取；读取结果是目标 children[1] 的实际元素，children[0] 为 targetStart 空 Text 锚点。 */
    test('accessing template refs inside teleport', async () => {
      const target = nodeOps.createElement('div')
      const tRef = ref()
      let tRefInMounted

      render(
        h({
          /** 渲染根数组[Teleport节点（属性{to: target}；'div'节点（属性{ref: tRef}；'teleported'））、'div'节点（'root'）]。 */
          render: () => [
            h(Teleport, { to: target }, h('div', { ref: tRef }, 'teleported')),
            h('div', 'root'),
          ],
          /** 在组件mounted时读取Teleport内容ref并保存到tRefInMounted，供eager/defer两套用例比较ref是否已可用。 */
          mounted() {
            tRefInMounted = tRef.value
          },
        }),
        nodeOps.createElement('div'),
      )

      // target.children[0] 是起始空 Text 锚点，实际元素位于索引1。
      expect(tRefInMounted).toBe(target.children[1])
    })
  }

  /** 测试场景：DOM Teleport 子组件 mounted 将 class foo 改 bar，再 HMR rerender 将插槽文本 foo 改 bar；目标每步反映最新 class 和 slot，验证普通更新与热替换。 */
  test('handle update and hmr rerender', async () => {
    const target = document.createElement('div')
    const root = document.createElement('div')

    const Comp = {
      /** 建立cls=ref('foo')；注册onMounted回调写入cls.value='bar'。setup返回{cls，target}。 */
      setup() {
        const cls = ref('foo')
        onMounted(() => {
          // 触发响应式更新。
          cls.value = 'bar'
        })
        return { cls, target }
      },
      template: `
        <Teleport :to="target">
          <div :class="cls">
            <div>
              <slot></slot>
            </div>
          </div>
        </Teleport>
      `,
    }

    const appId = 'test-app-id'
    const App = {
      __hmrId: appId,
      components: { Comp },
      /** 渲染Comp节点（null；插槽{default回调}）。 */
      render() {
        return originalH(Comp, null, {
          /** 提供default插槽：'div'节点（'foo'）。 */
          default: () => originalH('div', 'foo')
        })
      },
    }
    createRecord(appId, App)

    domRender(originalH(App), root)
    expect(target.innerHTML).toBe(
      '<div class="foo"><div><div>foo</div></div></div>',
    )
    await nextTick()
    expect(target.innerHTML).toBe(
      '<div class="bar"><div><div>foo</div></div></div>',
    )

    rerender(appId, () =>
      originalH(Comp, null, {
        /** 提供default插槽：'div'节点（'bar'）。 */
        default: () => originalH('div', 'bar')
      }),
    )
    await nextTick()
    expect(target.innerHTML).toBe(
      '<div class="bar"><div><div>bar</div></div></div>',
    )
  })
})
