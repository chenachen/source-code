/**
 * @vitest-environment jsdom
 */
// 使用 DOM 宿主，直接检查 attributes、style 与事件。

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

// 组件 attrs 的自动透传与手动消费。
describe('attribute fallthrough', () => {
  /** 有状态 Child 未声明 props，父传foo/id/class/style/data-id/click；检查初始合并属性，点击递增后再检查新属性与子更新，验证完整透传。 */
  it('should allow attrs to fallthrough', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const Hello = {
      /** 创建 count:0，返回传入动态 foo/class/style/data-id 与 click 的 Child render，构造有状态 attrs 透传。 */
      setup() {
        const count = ref(0)

        /** 递增 count 并记录 click，让 DOM 点击同时触发父更新。 */
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
      /** 登记子 updated spy，返回带自身 c2/bold 样式的 div 与 props.foo，构造父子 attrs 合并。 */
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

  /** 函数式 Child 无运行时props声明，父传foo/id与class/style/click；检查foo/id缺失、白名单合并，点击后样式变化，验证函数式默认筛选。 */
  it('should only allow whitelisted fallthrough on functional component with optional props', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const count = ref(0)

    /** 递增 count 并记录 click，供函数式白名单透传测试。 */
    function inc() {
      count.value++
      click()
    }

    /** 读取 count 构造 Child 输入，提供 foo/id/class/style/监听器，观察未声明 props 的函数组件筛选。 */
    const Hello = () =>
      h(Child, {
        foo: count.value + 1,
        id: 'test',
        class: 'c' + count.value,
        style: { color: count.value ? 'red' : 'green' },
        onClick: inc,
      })

    /** 记录渲染并以 props.foo 输出 div，自身 c2/bold 与白名单 attrs 合并。 */
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

    // 不在无 props 声明函数组件的自动透传白名单内。
    expect(node.getAttribute('id')).toBe(null)
    expect(node.getAttribute('foo')).toBe(null)

    // 白名单包含 style、class 和事件监听器。
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

  /** 函数式 Child 显式声明foo，父传id/class/style/click；检查foo仅作内容、id透传及点击后的新class/style，验证声明props后的完整attrs。 */
  it('should allow all attrs on functional component with declared props', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()

    const count = ref(0)

    /** 递增 count 并记录 click，供显式 props 函数组件的更新。 */
    function inc() {
      count.value++
      click()
    }

    /** 读取 count 构造 Child 输入，供已声明 foo 与其他 attrs 分离。 */
    const Hello = () =>
      h(Child, {
        foo: count.value + 1,
        id: 'test',
        class: 'c' + count.value,
        style: { color: count.value ? 'red' : 'green' },
        onClick: inc,
      })

    /** 读取声明 foo 渲染 div，并记录子 render，供完整 attrs 透传。 */
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
    expect(node.getAttribute('foo')).toBe(null) // foo 已声明为 prop，不透传为 attribute。
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

  /** Child将props原样传GrandChild，父传class/style/click；检查最终合并属性和click一次触发、两层updated，验证嵌套透传及监听器去重。 */
  it('should fallthrough for nested components', async () => {
    const click = vi.fn()
    const childUpdated = vi.fn()
    const grandChildUpdated = vi.fn()

    const Hello = {
      /** 创建 count 和点击递增，返回固定 foo/id 及动态 class/style 的 Child，构造嵌套透传。 */
      setup() {
        const count = ref(0)

        /** 递增 count 并记录 click，让多层透传监听器可检测重复调用。 */
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
      /** 登记 updated spy 后把 props 原样传给 GrandChild，构造自动 attrs 与手动 props 的同引用合并。 */
      setup(props: any) {
        onUpdated(childUpdated)
        // 高阶组件直接把 props 传到下一层。
        // 相同 attrs 会再合并，但 mergeProps 应去重监听器。

        return () => h(GrandChild, props)
      },
    }

    const GrandChild = defineComponent({
      props: {
        id: String,
        foo: Number,
      },
      /** 登记 GrandChild updated spy，以声明 id/foo 输出带自身 class/style 的 div。 */
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

    // 已声明 props 后，其余父 attrs 自动透传。
    expect(node.getAttribute('id')).toBe('test')
    expect(node.getAttribute('class')).toBe('c2 c0')
    expect(node.style.color).toBe('green')
    expect(node.style.fontWeight).toBe('bold')
    node.dispatchEvent(new CustomEvent('click'))
    expect(click).toHaveBeenCalled()

    // 声明项仍保留为 props。
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

  /** Child声明foo并关闭inheritAttrs，父传foo1/class:parent；检查仅div/1，验证自动class透传关闭。 */
  it('should not fallthrough with inheritAttrs: false', () => {
    const Parent = {
      /** 传入 foo:1 与 class:parent，构造 inheritAttrs:false 输入。 */
      render() {
        return h(Child, { foo: 1, class: 'parent' })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      inheritAttrs: false,
      /** 仅输出声明 foo，不手动使用 attrs，验证关闭自动透传。 */
      render() {
        return h('div', this.foo)
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    // 根元素没有父 class。
    expect(root.innerHTML).toMatch(`<div>1</div>`)
  })

  // #3741
  /** mixin中关闭inheritAttrs，父传foo1/class:parent；检查无class的div/1，验证合并后的选项生效。 */
  it('should not fallthrough with inheritAttrs: false from mixins', () => {
    const Parent = {
      /** 传入 foo/class，构造由 mixin 关闭透传的输入。 */
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
      /** 仅渲染 foo，供 mixin 的 inheritAttrs:false 断言。 */
      render() {
        return h('div', this.foo)
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    // 根元素没有父 class。
    expect(root.innerHTML).toMatch(`<div>1</div>`)
  })

  /** Child关闭inheritAttrs并手动mergeProps自身child class与$attrs，父传parent class；检查child parent/1，验证手动消费仍可合并。 */
  it('explicit spreading with inheritAttrs: false', () => {
    const Parent = {
      /** 传入 foo/class，供关闭自动透传后手动消费 attrs。 */
      render() {
        return h(Child, { foo: 1, class: 'parent' })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      inheritAttrs: false,
      /** 合并 child class 与 this.$attrs，输出 foo，构造显式 attrs 展开。 */
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

    // 手动 mergeProps 合并父子 class。
    expect(root.innerHTML).toMatch(`<div class="child parent">1</div>`)
  })

  /** Child返回两个div未用attrs，父传class/onBar；检查额外attrs及事件监听器警告，验证无单根的诊断。 */
  it('should warn when fallthrough fails on non-single-root', () => {
    const Parent = {
      /** 传入声明 foo、额外 class 与 onBar，构造多根无法自动透传。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，构造未声明 emits 的额外事件 attrs。 */
          onBar: () => {}
        })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      /** 返回两个 div，故意没有可自动选择的单根。 */
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

  /** Child根为Teleport，父传class:parent；检查额外class警告，验证传送根无法自动选择透传元素。 */
  it('should warn when fallthrough fails on teleport root node', () => {
    const Parent = {
      /** 向 Child 传 class，构造 Teleport 根的无元素透传目标。 */
      render() {
        return h(Child, { class: 'parent' })
      },
    }
    const root = document.createElement('div')

    const Child = defineComponent({
      /** 返回到 root 的 Teleport，供无单元素根的 attrs 警告。 */
      render() {
        return h(Teleport, { to: root }, h('div'))
      },
    })

    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes (class)`).toHaveBeenWarned()
  })

  /** Child用mergeProps把本地prevent/stop监听器和$attrs给div；点击一次检查父click一次、count1，验证重复监听器去重。 */
  it('should dedupe same listeners when $attrs is used during render', () => {
    const click = vi.fn()
    const count = ref(0)

    /** 递增 count 并记录 click，供重复监听器调用次数检查。 */
    function inc() {
      count.value++
      click()
    }

    const Parent = {
      /** 把 inc 监听器传给 Child，构造父级 DOM 事件输入。 */
      render() {
        return h(Child, { onClick: inc })
      },
    }

    const Child = defineComponent({
      /** 把 prevent/stop 本地监听器与 this.$attrs 合并给 div，构造同监听器去重。 */
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

  /** 双根Child手动把$attrs给第二div，父传class/onBar；检查无两类警告及第二div class，验证渲染期间标记attrs已消费。 */
  it('should not warn when $attrs is used during render', () => {
    const Parent = {
      /** 传入 foo/class/onBar，供多根手动消费 $attrs。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，供读取 $attrs 后的消费警告测试。 */
          onBar: () => {}
        })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      /** 返回双根并把 this.$attrs 给第二 div，构造已消费标记。 */
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

  /** setup捕获context.attrs并在render交给第二div；检查无两类警告和指定根class，验证setup attrs的消费跟踪。 */
  it('should not warn when context.attrs is used during render', () => {
    const Parent = {
      /** 传入 foo/class/onBar，供 setup context.attrs 消费。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，供 setup context.attrs 的消费警告测试。 */
          onBar: () => {}
        })
      },
    }

    const Child = defineComponent({
      props: ['foo'],
      /** 返回双根，把 setup attrs 对象给第二 div，构造 context.attrs 的渲染访问。 */
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

  /** 函数式Child声明foo并用context.attrs选择第二div；检查无两类警告及class，验证函数式手动透传。 */
  it('should not warn when context.attrs is used during render (functional)', () => {
    const Parent = {
      /** 传入 foo/class/onBar，供函数式 context.attrs 消费。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，供函数式 context.attrs 的消费警告测试。 */
          onBar: () => {}
        })
      },
    }

    /** 返回双根并把 context.attrs 放到第二 div，手动选择透传目标。 */
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

  /** 无props声明的函数组件从props取class放第二div；检查无两类警告及class，验证可选props的函数式多根处理。 */
  it('should not warn when functional component has optional props', () => {
    const Parent = {
      /** 传入 foo/class/onBar，供未声明 props 的函数组件多根场景。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，构造没有 props 声明的函数式组件事件输入。 */
          onBar: () => {}
        })
      },
    }

    /** 从全量 props 取 class 放到第二 div，构造没有运行时 props 声明的手动消费。 */
    const Child = (props: any) => [h('div'), h('div', { class: props.class })]

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(h(Parent), root)

    expect(`Extraneous non-props attributes`).not.toHaveBeenWarned()
    expect(`Extraneous non-emits event listeners`).not.toHaveBeenWarned()
    expect(root.innerHTML).toBe(`<div></div><div class="parent"></div>`)
  })

  /** 函数式Child声明foo却不读attrs，父传class/onBar；检查两类警告及空双根，验证未消费attrs诊断。 */
  it('should warn when functional component has props and does not use attrs', () => {
    const Parent = {
      /** 传入 foo/class/onBar，供声明 props 却未用 attrs 的警告。 */
      render() {
        return h(Child, {
          foo: 1,
          class: 'parent',
          /** 空 onBar 监听器，构造声明 props 却未消费 attrs 的警告输入。 */
          onBar: () => {}
        })
      },
    }

    /** 返回两个空 div，故意不读取 attrs，外部声明 foo 后应诊断额外 attrs。 */
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
  /** Child根是空div block，父aria-hidden true→false、class bar→barr；检查各次属性，验证透传合并后的动态标记。 */
  it('should update merged dynamic attrs on optimized child root', async () => {
    const aria = ref('true')
    const cls = ref('bar')
    const Parent = {
      /** 传动态 aria-hidden 与 class，构造优化单根 attrs 更新。 */
      render() {
        return h(Child, { 'aria-hidden': aria.value, class: cls.value })
      },
    }

    const Child = {
      props: [],
      /** 返回无自身动态 props 的 div block，观察透传合并是否补全动态标记。 */
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

  /** 有状态Child声明emits:click，button点击改为emit click/custom；检查父监听只一次且载荷custom，验证声明事件不当作原生透传。 */
  it('should not let listener fallthrough when declared in emits (stateful)', () => {
    const Child = defineComponent({
      emits: ['click'],
      /** button 的 DOM 点击改为 emit click/custom，构造声明 emits 后的组件事件。 */
      render() {
        return h(
          'button',
          {
            /** DOM 点击时调用 this.$emit click/custom，供观察声明 emits 后不重复原生透传。 */
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
      /** 把 onClick 传给声明 click emits 的 Child，观察只接收 custom 载荷。 */
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

  /** 函数式Child声明emits:click，先检查props没有onClick，再点击button；父监听应一次收到custom，验证事件监听器过滤与emit。 */
  it('should not let listener fallthrough when declared in emits (functional)', () => {
    /** 先检查 props 中没有 onClick，再返回会 emit click/custom 的 button，构造函数式 emits 过滤。 */
    const Child: FunctionalComponent<{}, { click: any }> = (_, { emit }) => {
      // 声明的事件监听器不进入函数组件 props。
      expect((_ as any).onClick).toBeUndefined()
      return h('button', {
        /** DOM 点击时通过 setup emit 发送 click/custom，供函数式事件过滤测试。 */
        onClick: () => {
          emit('click', 'custom')
        },
      })
    }
    Child.emits = ['click']

    const onClick = vi.fn()
    const App = {
      /** 将组件 onClick 传给函数式 Child，供事件调用一次的断言。 */
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

  /** Child返回注释/button/注释的DEV_ROOT_FRAGMENT，父传class:foo/click；检查button属性与点击调用，验证唯一有效根透传。 */
  it('should support fallthrough for fragments with single element + comments', () => {
    const click = vi.fn()

    const Hello = {
      /** 返回传 class:foo/onClick 的 Child render，构造带注释的开发单根。 */
      setup() {
        return () => h(Child, { class: 'foo', onClick: click })
      },
    }

    const Child = {
      /** 返回注释/button/注释的 DEV_ROOT_FRAGMENT，构造可定位的唯一元素根。 */
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

  /** Child在span/Foo与嵌套开发Fragment的div/Bar间切换，父传class:red；检查两种有效根都带class，验证嵌套根定位更新。 */
  it('should support fallthrough for nested dev root fragments', async () => {
    const toggle = ref(false)

    const Child = {
      /** 按 toggle 在 span/Foo 与嵌套开发 Fragment 的 div/Bar 之间切换，保留注释节点。 */
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
      /** 以 class:red 创建 Child block，构造父 attrs 向有效开发根下传。 */
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
  /** App/Child/GrandChild各连接modelValue，点击最内button后检查textBar来自GrandChild、textFoo来自Child，验证模型监听器按声明prop过滤。 */
  it('should not fallthrough v-model listeners with corresponding declared prop', () => {
    let textFoo = ''
    let textBar = ''
    const click = vi.fn()

    const App = defineComponent({
      /** 向 Child 传 textFoo 模型及父写回处理器，构造外层模型协议。 */
      setup() {
        return () =>
          h(Child, {
            modelValue: textFoo,
            /** 接收 Child 模型事件载荷并保存 textFoo，供外层模型回流检查。 */
            'onUpdate:modelValue': (val: string) => {
              textFoo = val
            },
          })
      },
    })

    const Child = defineComponent({
      props: ['modelValue'],
      /** 向 GrandChild 传 textBar 模型，内部监听器写回后 emit from Child，构造两层独立协议。 */
      setup(_props, { emit }) {
        return () =>
          h(GrandChild, {
            modelValue: textBar,
            /** 保存 GrandChild 模型载荷到 textBar，再 emit from Child 给外层，构造两条独立模型协议。 */
            'onUpdate:modelValue': (val: string) => {
              textBar = val
              emit('update:modelValue', 'from Child')
            },
          })
      },
    })

    const GrandChild = defineComponent({
      props: ['modelValue'],
      /** 返回点击时 emit from GrandChild 的 button，使祖先模型监听器过滤可被观察。 */
      setup(_props, { emit }) {
        return () =>
          h('button', {
            /** 记录点击后 emit update:modelValue/from GrandChild，启动子级模型事件链。 */
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

  /** 模板Child的GrandChild插槽读取$attrs.foo，父foo1到2；检查宿主attribute与插槽文本一起变化，验证插槽attrs访问可跟踪。 */
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
      /** 把 obj.value 作为 foo attr 传给模板组件，构造插槽中读取 $attrs 的依赖更新。 */
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
