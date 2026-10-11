import {
  type VNode,
  defineComponent,
  h,
  nextTick,
  ref,
  watch,
  withDirectives,
} from '@vue/runtime-core'
import { Transition, render, vShow } from '@vue/runtime-dom'

/** 把exp作为显示绑定附加vShow到node，返回携带指令绑定的同一VNode。 */
const withVShow = (node: VNode, exp: any) =>
  withDirectives(node, [[vShow, exp]])

/** 每个 v-show 用例重新创建的 DOM 挂载容器。 */
let root: any

beforeEach(() => {
  root = document.createElement('div')
})

// 测试组：给div附vShow并反复改显示绑定或style；读取display、内部原始display记录及Transition调用，区分指令隐藏和声明样式。
describe('runtime-dom: v-show directive', () => {
  /** 测试场景：组件数据 value=true 并给 div 绑定 v-show；首次渲染 style.display 为空串，保留默认显示。 */
  test('should check show value is truthy', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: true}，供本例渲染和事件更新读取。 */
      data() {
        return { value: true }
      },
      /** 渲染根数组[withVShow(h('div'), this.value)]。 */
      render() {
        return [withVShow(h('div'), this.value)]
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('')
  })

  /** 测试场景：组件数据 value=false 并给 div 绑定 v-show；首次渲染 style.display=none，验证隐藏值。 */
  test('should check show value is falsy', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: false}，供本例渲染和事件更新读取。 */
      data() {
        return { value: false }
      },
      /** 渲染根数组[withVShow(h('div'), this.value)]。 */
      render() {
        return [withVShow(h('div'), this.value)]
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')
  })

  /** 测试场景：同一 div 依次绑定 false、{}、0、[]、null、字符串0、undefined、1，每次等待更新；按布尔真值在 none 与空串之间切换，确认类型本身不决定显示。 */
  it('should update show value changed', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: true}，供本例渲染和事件更新读取。 */
      data() {
        return { value: true }
      },
      /** 渲染根数组[withVShow(h('div'), this.value)]。 */
      render() {
        return [withVShow(h('div'), this.value)]
      },
    })
    render(h(component), root)

    const $div = root.children[0]
    const data = root._vnode.component.data

    expect($div.style.display).toEqual('')

    data.value = false
    await nextTick()
    expect($div.style.display).toEqual('none')

    data.value = {}
    await nextTick()
    expect($div.style.display).toEqual('')

    data.value = 0
    await nextTick()
    expect($div.style.display).toEqual('none')

    data.value = []
    await nextTick()
    expect($div.style.display).toEqual('')

    data.value = null
    await nextTick()
    expect($div.style.display).toEqual('none')

    data.value = '0'
    await nextTick()
    expect($div.style.display).toEqual('')

    data.value = undefined
    await nextTick()
    expect($div.style.display).toEqual('none')

    data.value = 1
    await nextTick()
    expect($div.style.display).toEqual('')
  })

  /** 测试场景：div 原始 style.display=block，v-show 从 true→false→true；隐藏写 none，恢复显示写回 block。 */
  test('should respect display value in style attribute', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: true}，供本例渲染和事件更新读取。 */
      data() {
        return { value: true }
      },
      /** 渲染根数组[withVShow(h('div', { style: { display: 'block' } }), this.value)]。 */
      render() {
        return [
          withVShow(h('div', { style: { display: 'block' } }), this.value),
        ]
      },
    })
    render(h(component), root)

    const $div = root.children[0]
    const data = root._vnode.component.data

    expect($div.style.display).toEqual('block')

    data.value = false
    await nextTick()
    expect($div.style.display).toEqual('none')

    data.value = true
    await nextTick()
    expect($div.style.display).toEqual('block')
  })

  // #2583
  /** 测试场景：v-show 初始 false，字符串样式仅改 width 后仍隐藏；再设 true 恢复空 display，确认 cssText 更新保留隐藏标记。 */
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated', async () => {
    const style = ref('width: 100px')
    const display = ref(false)
    const component = defineComponent({
      /** 渲染withVShow(h('div', { style: style.value }), display.value)。 */
      render() {
        return withVShow(h('div', { style: style.value }), display.value)
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')

    style.value = 'width: 50px'
    await nextTick()
    expect($div.style.display).toEqual('none')

    display.value = true
    await nextTick()
    expect($div.style.display).toEqual('')
  })

  /** 测试场景：v-show 初始 false，对象样式原 display=block，仅更新 width 后仍为 none；再设 true 恢复 block，确认隐藏时保存的原始显示值。 */
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated (object value)', async () => {
    const style = ref({
      display: 'block',
      width: '100px',
    })
    const display = ref(false)
    const component = defineComponent({
      /** 渲染withVShow(h('div', { style: style.value }), display.value)。 */
      render() {
        return withVShow(h('div', { style: style.value }), display.value)
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')

    style.value.width = '50px'
    await nextTick()
    expect($div.style.display).toEqual('none')

    display.value = true
    await nextTick()
    expect($div.style.display).toEqual('block')
  })

  // #2583, #2757
  /** 测试场景：Transition 包裹 v-show div，并由 watch 同步文本状态；隐藏时更新字符串 width 仍为 none，再显示恢复空串，验证样式更新与过渡显示协议协同。 */
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated (with Transition)', async () => {
    const style = ref('width: 100px')
    const display = ref(false)
    const component = defineComponent({
      /** 建立innerValue=false，用watch(display)把显示状态同步到文本ref；返回Transition包裹的v-show div，分别读取style、文本与显示绑定。 */
      setup() {
        const innerValue = ref(false)
        watch(display, val => {
          innerValue.value = val
        })
        return () => {
          return h(Transition, () =>
            withVShow(
              h('div', { style: style.value }, innerValue.value),
              display.value,
            ),
          )
        }
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')

    style.value = 'width: 50px'
    await nextTick()
    expect($div.style.display).toEqual('none')

    display.value = true
    await nextTick()
    expect($div.style.display).toEqual('')
  })

  // #10151
  /** 测试场景：初始 style.display=none 且 v-show=false；设 true 仍尊重 none，改样式为 block/inline-block 后可显示，隐藏再显示恢复 inline-block；移除显式 display 后恢复空串并采用浏览器默认 block。 */
  test('should respect the display value when v-show value is true', async () => {
    const isVisible = ref(false)
    const useDisplayStyle = ref(true)
    const compStyle = ref({
      display: 'none',
    })
    const withoutDisplayStyle = {
      margin: '10px',
    }

    const Component = {
      /** setup返回渲染函数：withVShow( h('div', { style: useDisplayStyle.value ? compStyle.value : withoutDisplayStyle, }), isVisible.value, )。 */
      setup() {
        return () => {
          return withVShow(
            h('div', {
              style: useDisplayStyle.value
                ? compStyle.value
                : withoutDisplayStyle,
            }),
            isVisible.value,
          )
        }
      },
    }
    render(h(Component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')

    isVisible.value = true
    await nextTick()
    expect($div.style.display).toEqual('none')

    compStyle.value.display = 'block'
    await nextTick()
    expect($div.style.display).toEqual('block')

    compStyle.value.display = 'inline-block'
    await nextTick()
    expect($div.style.display).toEqual('inline-block')

    isVisible.value = false
    await nextTick()
    expect($div.style.display).toEqual('none')

    isVisible.value = true
    await nextTick()
    expect($div.style.display).toEqual('inline-block')

    useDisplayStyle.value = false
    await nextTick()
    expect($div.style.display).toEqual('')
    expect(getComputedStyle($div).display).toEqual('block')

    isVisible.value = false
    await nextTick()
    expect($div.style.display).toEqual('none')

    isVisible.value = true
    await nextTick()
    expect($div.style.display).toEqual('')
  })

  // #10294
  /** 测试场景：初始隐藏且样式只含 margin，隐藏期间修改 margin 再显示；display 从 none 恢复空串，确认样式更新不会把隐藏值记为原始 display。 */
  test('should record display by vShowOldKey only when display exists in style', async () => {
    const isVisible = ref(false)
    const style = ref({
      margin: '10px',
    })

    const Component = {
      /** setup返回渲染函数：withVShow( h('div', { style: style.value, }), isVisible.value, )。 */
      setup() {
        return () => {
          return withVShow(
            h('div', {
              style: style.value,
            }),
            isVisible.value,
          )
        }
      },
    }
    render(h(Component), root)
    const $div = root.children[0]

    expect($div.style.display).toEqual('none')

    style.value.margin = '20px'
    await nextTick()
    expect($div.style.display).toEqual('none')

    isVisible.value = true
    await nextTick()
    expect($div.style.display).toEqual('')
  })
})
