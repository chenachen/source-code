/**
 * 测试阅读说明：本文件验证 `runtime-core/rendererAttrsFallthrough` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
/**
 * @vitest-environment jsdom
 */
// using DOM renderer because this case is mostly DOM-specific

import {
  Fragment,
  type FunctionalComponent,
  Teleport,
  createBlock,
  createCommentVNode,
  createElementBlock,
  createElementVNode,
  defineComponent,
  h,
  mergeProps,
  nextTick,
  onUpdated,
  openBlock,
  ref,
  render,
  withModifiers,
} from '@vue/runtime-dom'
import { createApp } from 'vue'
import { PatchFlags } from '@vue/shared'

// 测试组：属性失效。
describe('attribute fallthrough', () => {
  // 测试场景：应该允许attrs失败。
  it('should allow attrs to fallthrough', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const Hello = {
      setup() {
        const count = ref(0)

        function inc() {
          count.value++
          click()
        }

        return () =>
          h(Child, {
            foo: count.value + 1,
            id: 'test',
            class: 'c' + count.value,
            style: { color: count.value ? 'red' : 'green' },
            onClick: inc,
            'data-id': count.value + 1,
          })
      },
    }

    const Child = {
      setup(props: any) {
        onUpdated(childUpdated)
        return () =>
          h(
            'div',
            {
              class: 'c2',
              style: { fontWeight: 'bold' },
            },
            props.foo,
          )
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Hello), root)

    const node = root.children[0] as HTMLElement

    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('foo')).toBe('1')
    expect(node.getAttribute('class')).toBe('c2 c0')
    expect(node.style.color).toBe('green')
    expect(node.style.fontWeight).toBe('bold')
    expect(node.dataset.id).toBe('1')
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()

    await nextTick()
    expect(childUpdated).toHaveBeenCalled()
    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('foo')).toBe('2')
    expect(node.getAttribute('class')).toBe('c2 c1')
    expect(node.style.color).toBe('red')
    expect(node.style.fontWeight).toBe('bold')
    expect(node.dataset.id).toBe('2')
  })

  // 测试场景：函数式组件仅声明可选 props 时，只透传 class、style 和事件等白名单 attrs。
  it('should only allow whitelisted fallthrough on functional component with optional props', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const count = ref(0)

    function inc() {
      count.value++
      click()
    }

    const Hello = () =>
      h(Child, {
        foo: count.value + 1,
        id: 'test',
        class: 'c' + count.value,
        style: { color: count.value ? 'red' : 'green' },
        onClick: inc,
      })

    const Child = (props: any) => {
      childUpdated()
      return h(
        'div',
        {
          class: 'c2',
          style: { fontWeight: 'bold' },
        },
        props.foo,
      )
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Hello), root)

    const node = root.children[0] as HTMLElement

    // not whitelisted
    expect(node.getAttribute('id')).toBe(null)
    expect(node.getAttribute('foo')).toBe(null)

    // whitelisted: style, class, event listeners
    expect(node.getAttribute('class')).toBe('c2 c0')
    expect(node.style.color).toBe('green')
    expect(node.style.fontWeight).toBe('bold')
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()

    await nextTick()
    expect(childUpdated).toHaveBeenCalled()
    expect(node.getAttribute('id')).toBe(null)
    expect(node.getAttribute('foo')).toBe(null)
    expect(node.getAttribute('class')).toBe('c2 c1')
    expect(node.style.color).toBe('red')
    expect(node.style.fontWeight).toBe('bold')
  })

  // 测试场景：函数式组件显式声明 props 后，未消费的 attrs 可以完整透传。
  it('should allow all attrs on functional component with declared props', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const count = ref(0)

    function inc() {
      count.value++
      click()
    }

    const Hello = () =>
      h(Child, {
        foo: count.value + 1,
        id: 'test',
        class: 'c' + count.value,
        style: { color: count.value ? 'red' : 'green' },
        onClick: inc,
      })

    const Child = (props: { foo: number }) => {
      childUpdated()
      return h(
        'div',
        {
          class: 'c2',
          style: { fontWeight: 'bold' },
        },
        props.foo,
      )
    }
    Child.props = ['foo']

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Hello), root)

    const node = root.children[0] as HTMLElement

    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('foo')).toBe(null) // declared as prop
    expect(node.getAttribute('class')).toBe('c2 c0')
    expect(node.style.color).toBe('green')
    expect(node.style.fontWeight).toBe('bold')
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()

    await nextTick()
    expect(childUpdated).toHaveBeenCalled()
    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('foo')).toBe(null)
    expect(node.getAttribute('class')).toBe('c2 c1')
    expect(node.style.color).toBe('red')
    expect(node.style.fontWeight).toBe('bold')
  })

  // 测试场景：应该忽略嵌套组件。
  it('should fallthrough for nested components', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()
    const grandChildUpdated = vi.fn()

    const Hello = {
      setup() {
        const count = ref(0)

        function inc() {
          count.value++
          click()
        }

        return () =>
          h(Child, {
            foo: 1,
            id: 'test',
            class: 'c' + count.value,
            style: { color: count.value ? 'red' : 'green' },
            onClick: inc,
          })
      },
    }

    const Child = {
      setup(props: any) {
        onUpdated(childUpdated)
        // HOC simply passing props down.
        // this will result in merging the same attrs, but should be deduped by
        // `mergeProps`.
        return () => h(GrandChild, props)
      },
    }

    const GrandChild = defineComponent({
      props: {
        id: String,
        foo: Number,
      },
      setup(props) {
        onUpdated(grandChildUpdated)
        return () =>
          h(
            'div',
            {
              id: props.id,
              class: 'c2',
              style: { fontWeight: 'bold' },
            },
            props.foo,
          )
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Hello), root)

    const node = root.children[0] as HTMLElement

    // with declared props, any parent attr that isn't a prop falls through
    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('class')).toBe('c2 c0')
    expect(node.style.color).toBe('green')
    expect(node.style.fontWeight).toBe('bold')
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()

    // ...while declared ones remain props
    expect(node.hasAttribute('foo')).toBe(false)

    await nextTick()
    expect(childUpdated).toHaveBeenCalled()
    expect(grandChildUpdated).toHaveBeenCalled()
    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('class')).toBe('c2 c1')
    expect(node.style.color).toBe('red')
    expect(node.style.fontWeight).toBe('bold')

    expect(node.hasAttribute('foo')).toBe(false)
  })

  // 测试场景：不应因 inheritAttrs 而失败： false。
  it('should not fallthrough with inheritAttrs: false', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent' })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      inheritAttrs: false,
      render() {
        return h('div', this.foo)
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    // should not contain class
    expect(root.innerHTML).toMatch(`<div>1</div>`)
  })

  // #3741
  // 测试场景：mixin 声明 inheritAttrs: false 时，透传 attrs 不应落到根节点。
  it('should not fallthrough with inheritAttrs: false from mixins', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent' })
      },
    }

    const mixin = {
      inheritAttrs: false,
    }

    const Child = defineComponent({
      mixins: [mixin],
      props: ['foo'],
      render() {
        return h('div', this.foo)
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    // should not contain class
    expect(root.innerHTML).toMatch(`<div>1</div>`)
  })

  // 测试场景：使用 inheritAttrs 显式扩展： false。
  it('explicit spreading with inheritAttrs: false', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent' })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      inheritAttrs: false,
      render() {
        return h(
          'div',
          mergeProps(
            {
              class: 'child',
            },
            this.$attrs,
          ),
          this.foo,
        )
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    // should merge parent/child classes
    expect(root.innerHTML).toMatch(`<div class="child parent">1</div>`)
  })

  // 测试场景：当非单根上的失败失败时应该发出警告。
  it('should warn when fallthrough fails on non-single-root', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      render() {
        return [h('div'), h('div')]
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes (class)`).toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).toHaveBeenWarned()
  })

  // 测试场景：当 teleport 根节点上失败时应发出警告。
  it('should warn when fallthrough fails on teleport root node', () => {
    const Parent = {
      render() {
        return h(Child, { class: 'parent' })
      },
    }
    const root = document.createElement('div')

    const Child = defineComponent({
      render() {
        return h(Teleport, { to: root }, h('div'))
      },
    })

    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes (class)`).toHaveBeenWarned()
  })

  // 测试场景：渲染期间读取 $attrs 后，同一事件监听器不能因透传而重复绑定。
  it('should dedupe same listeners when $attrs is used during render', () => {
    const click = vi.fn()
    const count = ref(0)

    function inc() {
      count.value++
      click()
    }

    const Parent = {
      render() {
        return h(Child, { onClick: inc })
      },
    }

    const Child = defineComponent({
      render() {
        return h(
          'div',
          mergeProps(
            {
              onClick: withModifiers(() => {}, ['prevent', 'stop']),
            },
            this.$attrs,
          ),
        )
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    const node = root.children[0] as HTMLElement
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalledTimes(1)
    expect(count.value).toBe(1)
  })

  // 测试场景：在渲染期间使用 $attrs 时不应发出警告。
  it('should not warn when $attrs is used during render', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      render() {
        return [h('div'), h('div', this.$attrs)]
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).not.toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).not.toHaveBeenWarned()

    expect(root.innerHTML).toBe(`<div></div><div class="parent"></div>`)
  })

  // 测试场景：在渲染期间使用 context.attrs 时不应发出警告。
  it('should not warn when context.attrs is used during render', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      setup(_props, { attrs }) {
        return () => [h('div'), h('div', attrs)]
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).not.toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).not.toHaveBeenWarned()

    expect(root.innerHTML).toBe(`<div></div><div class="parent"></div>`)
  })

  // 测试场景：函数式组件渲染期间读取 context.attrs 后，不应再警告 attrs 未透传。
  it('should not warn when context.attrs is used during render (functional)', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child: FunctionalComponent = (_, { attrs }) => [
      h('div'),
      h('div', attrs),
    ]

    Child.props = ['foo']

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).not.toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).not.toHaveBeenWarned()
    expect(root.innerHTML).toBe(`<div></div><div class="parent"></div>`)
  })

  // 测试场景：函数式组件声明可选 props 时，白名单 attrs 未手动透传也不应误报。
  it('should not warn when functional component has optional props', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child = (props: any) => [h('div'), h('div', { class: props.class })]

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).not.toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).not.toHaveBeenWarned()
    expect(root.innerHTML).toBe(`<div></div><div class="parent"></div>`)
  })

  // 测试场景：函数式组件声明 props 但未消费其余 attrs 时应给出透传警告。
  it('should warn when functional component has props and does not use attrs', () => {
    const Parent = {
      render() {
        return h(Child, { foo: 1, class: 'parent', onBar: () => {} })
      },
    }

    const Child: FunctionalComponent = () => [h('div'), h('div')]

    Child.props = ['foo']

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).toHaveBeenWarned()
    expect(root.innerHTML).toBe(`<div></div><div></div>`)
  })

  // #677
  // 测试场景：应该在优化的子根上更新合并的动态attrs。
  it('should update merged dynamic attrs on optimized child root', async () => {
    const aria = ref('true')
    const cls = ref('bar')
    const Parent = {
      render() {
        return h(Child, { 'aria-hidden': aria.value, class: cls.value })
      },
    }

    const Child = {
      props: [],
      render() {
        return (openBlock(), createBlock('div'))
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(root.innerHTML).toBe(`<div aria-hidden="true" class="bar"></div>`)

    aria.value = 'false'
    await nextTick()
    expect(root.innerHTML).toBe(`<div aria-hidden="false" class="bar"></div>`)

    cls.value = 'barr'
    await nextTick()
    expect(root.innerHTML).toBe(`<div aria-hidden="false" class="barr"></div>`)
  })

  // 测试场景：有状态组件在 emits 中声明的监听器不属于待透传 attrs，不能误报警告。
  it('should not let listener fallthrough when declared in emits (stateful)', () => {
    const Child = defineComponent({
      emits: ['click'],
      render() {
        return h(
          'button',
          {
            onClick: () => {
              this.$emit('click', 'custom')
            },
          },
          'hello',
        )
      },
    })

    const onClick = vi.fn()
    const App = {
      render() {
        return h(Child, {
          onClick,
        })
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(App), root)

    const node = root.children[0] as HTMLElement
    node.dispatchEvent(new CustomEvent('click'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith('custom')
  })

  // 测试场景：函数式组件在 emits 中声明的监听器不属于待透传 attrs，不能误报警告。
  it('should not let listener fallthrough when declared in emits (functional)', () => {
    const Child: FunctionalComponent<{}, { click: any }> = (_, { emit }) => {
      // should not be in props
      expect((_ as any).onClick).toBeUndefined()
      return h('button', {
        onClick: () => {
          emit('click', 'custom')
        },
      })
    }
    Child.emits = ['click']

    const onClick = vi.fn()
    const App = {
      render() {
        return h(Child, {
          onClick,
        })
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(App), root)

    const node = root.children[0] as HTMLElement
    node.dispatchEvent(new CustomEvent('click'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith('custom')
  })

  // 测试场景：应该支持具有单个元素+注释的片段的失败。
  it('should support fallthrough for fragments with single element + comments', () => {
    const click = vi.fn()

    const Hello = {
      setup() {
        return () => h(Child, { class: 'foo', onClick: click })
      },
    }

    const Child = {
      setup() {
        return () => (
          openBlock(),
          createBlock(
            Fragment,
            null,
            [
              createCommentVNode('hello'),
              h('button'),
              createCommentVNode('world'),
            ],
            PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
          )
        )
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Hello), root)

    expect(root.innerHTML).toBe(
      `<!--hello--><button class="foo"></button><!--world-->`,
    )
    const button = root.children[0] as HTMLElement
    button.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()
  })

  // 测试场景：应该支持嵌套开发根片段的失败。
  it('should support fallthrough for nested dev root fragments', async () => {
    const toggle = ref(false)

    const Child = {
      setup() {
        return () => (
          openBlock(),
          createElementBlock(
            Fragment,
            null,
            [
              createCommentVNode(' comment A '),
              toggle.value
                ? (openBlock(), createElementBlock('span', { key: 0 }, 'Foo'))
                : (openBlock(),
                  createElementBlock(
                    Fragment,
                    { key: 1 },
                    [
                      createCommentVNode(' comment B '),
                      createElementVNode('div', null, 'Bar'),
                    ],
                    PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
                  )),
            ],
            PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
          )
        )
      },
    }

    const Root = {
      setup() {
        return () => (openBlock(), createBlock(Child, { class: 'red' }))
      },
    }

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Root), root)

    expect(root.innerHTML).toBe(
      `<!-- comment A --><!-- comment B --><div class="red">Bar</div>`,
    )

    toggle.value = true
    await nextTick()
    expect(root.innerHTML).toBe(
      `<!-- comment A --><span class=\"red\">Foo</span>`,
    )
  })

  // #1989
  // 测试场景：存在对应声明 prop 时，v-model 更新监听器不应作为普通 attrs 透传。
  it('should not fallthrough v-model listeners with corresponding declared prop', () => {
    let textFoo = ''
    let textBar = ''
    const click = vi.fn()

    const App = defineComponent({
      setup() {
        return () =>
          h(Child, {
            modelValue: textFoo,
            'onUpdate:modelValue': (val: string) => {
              textFoo = val
            },
          })
      },
    })

    const Child = defineComponent({
      props: ['modelValue'],
      setup(_props, { emit }) {
        return () =>
          h(GrandChild, {
            modelValue: textBar,
            'onUpdate:modelValue': (val: string) => {
              textBar = val
              emit('update:modelValue', 'from Child')
            },
          })
      },
    })

    const GrandChild = defineComponent({
      props: ['modelValue'],
      setup(_props, { emit }) {
        return () =>
          h('button', {
            onClick() {
              click()
              emit('update:modelValue', 'from GrandChild')
            },
          })
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(App), root)

    const node = root.children[0] as HTMLElement

    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()
    expect(textBar).toBe('from GrandChild')
    expect(textFoo).toBe('from Child')
  })

  // covers uncaught regression #10710
  // 测试场景：应该跟踪这个。slots 中的 $attrs 访问。
  it('should track this.$attrs access in slots', async () => {
    const GrandChild = {
      template: `<slot/>`,
    }
    const Child = {
      components: { GrandChild },
      template: `<div><GrandChild>{{ $attrs.foo }}</GrandChild></div>`,
    }

    const obj = ref(1)
    const App = {
      render() {
        return h(Child, { foo: obj.value })
      },
    }

    const root = document.createElement('div')
    createApp(App).mount(root)

    expect(root.innerHTML).toBe('<div foo="1">1</div>')

    obj.value = 2
    await nextTick()
    expect(root.innerHTML).toBe('<div foo="2">2</div>')
  })
})
