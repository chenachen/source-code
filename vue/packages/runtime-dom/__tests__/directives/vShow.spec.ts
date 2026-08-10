/**
 * 测试阅读说明：本文件验证 `runtime-dom/directives/vShow` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
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

/** 给 VNode 附加 v-show 指令，避免各用例重复构造指令参数数组。 */
const withVShow = (node: VNode, exp: any) =>
  withDirectives(node, [[vShow, exp]])

/** 每个 v-show 用例重新创建的 DOM 挂载容器。 */
let root: any

beforeEach(() => {
  root = document.createElement('div')
})

// 测试组：runtime-dom 的 v-show 显隐和过渡协作行为。
describe('runtime-dom: v-show directive', () => {
  // 测试场景：应该检查显示值是否真实。
  test('should check show value is truthy', async () => {
    const component = defineComponent({
      data() {
        return { value: true }
      },
      render() {
        return [withVShow(h('div'), this.value)]
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('')
  })

  // 测试场景：应该检查显示值是否为假。
  test('should check show value is falsy', async () => {
    const component = defineComponent({
      data() {
        return { value: false }
      },
      render() {
        return [withVShow(h('div'), this.value)]
      },
    })
    render(h(component), root)

    const $div = root.children[0]

    expect($div.style.display).toEqual('none')
  })

  // 测试场景：应该更新显示值已更改。
  it('should update show value changed', async () => {
    const component = defineComponent({
      data() {
        return { value: true }
      },
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

  // 测试场景：应该尊重样式属性中的显示值。
  test('should respect display value in style attribute', async () => {
    const component = defineComponent({
      data() {
        return { value: true }
      },
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
  // 测试场景：更新时由v-show设置的`display`的值不应该被样式属性覆盖。
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated', async () => {
    const style = ref('width: 100px')
    const display = ref(false)
    const component = defineComponent({
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

  // 测试场景：v-show 设置的 `display` 的值在更新时不应被 style 属性覆盖（对象值）。
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated (object value)', async () => {
    const style = ref({
      display: 'block',
      width: '100px',
    })
    const display = ref(false)
    const component = defineComponent({
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
  // 测试场景：更新时由v-show设置的`display`的值不应该被样式属性覆盖（使用Transition）。
  test('the value of `display` set by v-show should not be overwritten by the style attribute when updated (with Transition)', async () => {
    const style = ref('width: 100px')
    const display = ref(false)
    const component = defineComponent({
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
  // 测试场景：当 v-show 值为 true 时应尊重显示值。
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
  // 测试场景：仅当样式中存在显示时才应通过 vShowOldKey 记录显示。
  test('should record display by vShowOldKey only when display exists in style', async () => {
    const isVisible = ref(false)
    const style = ref({
      margin: '10px',
    })

    const Component = {
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
