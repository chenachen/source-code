import {
  type VNode,
  defineComponent,
  h,
  nextTick,
  ref,
  render,
  vModelCheckbox,
  vModelDynamic,
  withDirectives,
} from '@vue/runtime-dom'

/** 按type创建原生Event并dispatch到el，触发input/change等已注册监听器；无返回值。 */
const triggerEvent = (type: string, el: Element) => {
  const event = new Event(type)
  el.dispatchEvent(event)
}

/** 给node附加vModelDynamic指令，arg是模型值、mods是修饰符；返回携带指令绑定的同一VNode。 */
const withVModel = (node: VNode, arg: any, mods?: any) =>
  withDirectives(node, [[vModelDynamic, arg, '', mods]])

/** 模拟编译产物中的 onUpdate:modelValue 赋值函数。 */
const setValue = function (this: any, value: any) {
  this.value = value
}

/** 每个 v-model 用例独享的 DOM 挂载容器。 */
let root: any

beforeEach(() => {
  root = document.createElement('div') as any
})

// 测试组：withVModel把vModelDynamic附到原生控件VNode；派发input/change/composition事件并改模型数据，逐例检查值、选中状态、修饰符与监听顺序。
describe('vModel', () => {
  /** 测试场景：文本input初始model=null呈空串，输入foo后model先更新、用户onInput已读到foo；程序设bar/undefined后DOM分别bar/空串，验证双向同步与监听顺序。 */
  it('should work with text input', async () => {
    const manualListener = vi.fn()
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { 'onUpdate:modelValue': setValue.bind(this), onInput: () => { manualListener(data.value) }, }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              'onUpdate:modelValue': setValue.bind(this),
              /** 读取更新后的data.value传给manualListener，检查v-model赋值先于用户input监听器。 */
              onInput: () => {
                manualListener(data.value)
              },
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')!
    const data = root._vnode.component.data
    expect(input.value).toEqual('')

    input.value = 'foo'
    triggerEvent('input', input)
    await nextTick()
    expect(data.value).toEqual('foo')
    // #1931
    expect(manualListener).toHaveBeenCalledWith('foo')

    data.value = 'bar'
    await nextTick()
    expect(input.value).toEqual('bar')

    data.value = undefined
    await nextTick()
    expect(input.value).toEqual('')
  })

  /** 测试场景：type=number且model=null的input先为空；输入1触发input后model为数字1，确认type自动数值转换。 */
  it('should work with number input', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'number', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'number',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')!
    const data = root._vnode.component.data
    expect(input.value).toEqual('')
    expect(input.type).toEqual('number')

    input.value = 1
    triggerEvent('input', input)
    await nextTick()
    expect(typeof data.value).toEqual('number')
    expect(data.value).toEqual(1)
  })

  // #7003
  /** 测试场景：两个number input初始1.002，分别输入1.00；model均转数字1，第二次更新未把第一个DOM的等价文本1.00重写，验证避免无效值覆盖。 */
  it('should work with number input and be able to update rendering correctly', async () => {
    /** 将第一个number input派发的数值写this.value1，与第二个输入框保持独立状态。 */
    const setValue1 = function (this: any, value: any) {
      this.value1 = value
    }
    /** 将第二个number input派发的数值写this.value2，触发同组件更新以检查另一个输入框等价值保护。 */
    const setValue2 = function (this: any, value: any) {
      this.value2 = value
    }
    const component = defineComponent({
      /** 初始化组件状态为{value1: 1.002，value2: 1.002}，供本例渲染和事件更新读取。 */
      data() {
        return { value1: 1.002, value2: 1.002 }
      },
      /** 渲染根数组[withVModel( h('input', { id: 'input_num1', type: 'number', 'onUpdate:modelValue': setValue1.bind(this), }), this.value1, )、withVModel( h('input', { id: 'input_num2', type: 'number', 'onUpdate:modelValue': setValue2.bind(this), }), this.value2, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              id: 'input_num1',
              type: 'number',
              'onUpdate:modelValue': setValue1.bind(this),
            }),
            this.value1,
          ),
          withVModel(
            h('input', {
              id: 'input_num2',
              type: 'number',
              'onUpdate:modelValue': setValue2.bind(this),
            }),
            this.value2,
          ),
        ]
      },
    })
    render(h(component), root)
    const data = root._vnode.component.data

    const inputNum1 = root.querySelector('#input_num1')!
    expect(inputNum1.value).toBe('1.002')

    const inputNum2 = root.querySelector('#input_num2')!
    expect(inputNum2.value).toBe('1.002')

    inputNum1.value = '1.00'
    triggerEvent('input', inputNum1)
    await nextTick()
    expect(data.value1).toBe(1)

    inputNum2.value = '1.00'
    triggerEvent('input', inputNum2)
    await nextTick()
    expect(data.value2).toBe(1)

    expect(inputNum1.value).toBe('1.00')
  })

  /** 测试场景：model更新监听器是[赋值函数,spy]；input输入foo后数据写foo且spy收到foo，验证数组处理器逐个调用。 */
  it('should work with multiple listeners', async () => {
    const spy = vi.fn()
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { 'onUpdate:modelValue': [setValue.bind(this), spy], }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              'onUpdate:modelValue': [setValue.bind(this), spy],
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')!
    const data = root._vnode.component.data

    input.value = 'foo'
    triggerEvent('input', input)
    await nextTick()
    expect(data.value).toEqual('foo')
    expect(spy).toHaveBeenCalledWith('foo')
  })

  /** 测试场景：响应式toggle让更新监听器从spy1换spy2；先输入foo、切换后输入bar，旧spy不收bar而新spy收到，验证beforeUpdate刷新assigner。 */
  it('should work with updated listeners', async () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const toggle = ref(true)

    const component = defineComponent({
      /** 渲染根数组[withVModel( h('input', { 'onUpdate:modelValue': toggle.value ? spy1 : spy2, }), 'foo', )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              'onUpdate:modelValue': toggle.value ? spy1 : spy2,
            }),
            'foo',
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')!

    input.value = 'foo'
    triggerEvent('input', input)
    await nextTick()
    expect(spy1).toHaveBeenCalledWith('foo')

    // 替换 model 更新处理器。
    toggle.value = false
    await nextTick()

    input.value = 'bar'
    triggerEvent('input', input)
    await nextTick()
    expect(spy1).not.toHaveBeenCalledWith('bar')
    expect(spy2).toHaveBeenCalledWith('bar')
  })

  /** 测试场景：textarea绑定初始null；输入foo写回model，程序设bar同步到DOM，确认多行输入走文本指令。 */
  it('should work with textarea', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('textarea', { 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('textarea', {
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('textarea')
    const data = root._vnode.component.data

    input.value = 'foo'
    triggerEvent('input', input)
    await nextTick()
    expect(data.value).toEqual('foo')

    data.value = 'bar'
    await nextTick()
    expect(input.value).toEqual('bar')
  })

  /** 测试场景：分别绑定number、trim、trim+number、trim+lazy、lazy；输入+01.2/两端空格文本并按对应input/change触发，model得到数字/去空格字符串，number的change还正规化DOM为1.2。 */
  it('should support modifiers', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{number: null，trim: null，lazy: null，trimNumber: null，trimLazy: null}，供本例渲染和事件更新读取。 */
      data() {
        return {
          number: null,
          trim: null,
          lazy: null,
          trimNumber: null,
          trimLazy: null,
        }
      },
      /** 分别创建number、trim、trim+lazy、trim+number、lazy五个input，各更新监听器写对应数据字段；通过withVModel配置修饰符，供输入/change断言比较转换和触发时机。 */
      render() {
        return [
          withVModel(
            h('input', {
              class: 'number',
              /** 执行this.number=val。无返回值。 */
              'onUpdate:modelValue': (val: any) => {
                this.number = val
              },
            }),
            this.number,
            {
              number: true,
            },
          ),
          withVModel(
            h('input', {
              class: 'trim',
              /** 执行this.trim=val。无返回值。 */
              'onUpdate:modelValue': (val: any) => {
                this.trim = val
              },
            }),
            this.trim,
            {
              trim: true,
            },
          ),
          withVModel(
            h('input', {
              class: 'trim-lazy',
              /** 执行this.trimLazy=val。无返回值。 */
              'onUpdate:modelValue': (val: any) => {
                this.trimLazy = val
              },
            }),
            this.trim,
            {
              trim: true,
              lazy: true,
            },
          ),
          withVModel(
            h('input', {
              class: 'trim-number',
              /** 执行this.trimNumber=val。无返回值。 */
              'onUpdate:modelValue': (val: any) => {
                this.trimNumber = val
              },
            }),
            this.trimNumber,
            {
              trim: true,
              number: true,
            },
          ),
          withVModel(
            h('input', {
              class: 'lazy',
              /** 执行this.lazy=val。无返回值。 */
              'onUpdate:modelValue': (val: any) => {
                this.lazy = val
              },
            }),
            this.lazy,
            {
              lazy: true,
            },
          ),
        ]
      },
    })
    render(h(component), root)

    const number = root.querySelector('.number')
    const trim = root.querySelector('.trim')
    const trimNumber = root.querySelector('.trim-number')
    const trimLazy = root.querySelector('.trim-lazy')
    const lazy = root.querySelector('.lazy')
    const data = root._vnode.component.data

    number.value = '+01.2'
    triggerEvent('input', number)
    await nextTick()
    expect(data.number).toEqual(1.2)
    triggerEvent('change', number)
    await nextTick()
    expect(number.value).toEqual('1.2')

    trim.value = '    hello, world    '
    triggerEvent('input', trim)
    await nextTick()
    expect(data.trim).toEqual('hello, world')

    trimNumber.value = '    1    '
    triggerEvent('input', trimNumber)
    await nextTick()
    expect(data.trimNumber).toEqual(1)

    trimNumber.value = '    +01.2    '
    triggerEvent('input', trimNumber)
    await nextTick()
    expect(data.trimNumber).toEqual(1.2)

    trimLazy.value = '   ddd    '
    triggerEvent('change', trimLazy)
    await nextTick()
    expect(data.trimLazy).toEqual('ddd')

    lazy.value = 'foo'
    triggerEvent('change', lazy)
    await nextTick()
    expect(data.lazy).toEqual('foo')
  })

  /** 测试场景：文本input挂在双层ShadowRoot内并focus；输入两端空格文本后model已trim但DOM仍保留原空格，且各层activeElement准确，验证焦点解析与等价trim值保护。 */
  it('should preserve unresolved trimmed text while focused in nested shadow roots', async () => {
    const model = ref('')
    const component = defineComponent({
      /** 渲染withVModel( h('input', { 'onUpdate:modelValue': (value: string) => { model.value = value }, }), model.value, { trim: true, }, )。 */
      render() {
        return withVModel(
          h('input', {
            /** 执行model.value=value。无返回值。 */
            'onUpdate:modelValue': (value: string) => {
              model.value = value
            },
          }),
          model.value,
          {
            trim: true,
          },
        )
      },
    })

    document.body.appendChild(root)
    const outerShadowRoot = root.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('div')
    outerShadowRoot.appendChild(innerHost)
    const innerShadowRoot = innerHost.attachShadow({ mode: 'open' })

    try {
      render(h(component), innerShadowRoot)

      const input = innerShadowRoot.querySelector('input') as HTMLInputElement
      input.focus()

      expect(document.activeElement).toBe(root)
      expect(outerShadowRoot.activeElement).toBe(innerHost)
      expect(innerShadowRoot.activeElement).toBe(input)

      input.value = '    hello, world    '
      triggerEvent('input', input)
      await nextTick()

      expect(model.value).toEqual('hello, world')
      expect(input.value).toEqual('    hello, world    ')
    } finally {
      render(null, innerShadowRoot)
      root.remove()
    }
  })

  /** 测试场景：两个range设置min1/max100，number用input、lazy用change；20/30及超边界200/-1分别写回数字/字符串且受浏览器范围约束，程序写60/-1/200也同步成60/1/100。 */
  it('should work with range', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: 25}，供本例渲染和事件更新读取。 */
      data() {
        return { value: 25 }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'range', min: 1, max: 100, class: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), this.value, { number: true, }, )、withVModel( h('input', { type: 'range', min: 1, max: 100, class: 'bar', 'onUpdate:modelValue': setValue.bind(this), }), this.value, { lazy: true, }, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'range',
              min: 1,
              max: 100,
              class: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
            {
              number: true,
            },
          ),
          withVModel(
            h('input', {
              type: 'range',
              min: 1,
              max: 100,
              class: 'bar',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
            {
              lazy: true,
            },
          ),
        ]
      },
    })
    render(h(component), root)

    const foo = root.querySelector('.foo')
    const bar = root.querySelector('.bar')
    const data = root._vnode.component.data

    foo.value = 20
    triggerEvent('input', foo)
    await nextTick()
    expect(data.value).toEqual(20)

    foo.value = 200
    triggerEvent('input', foo)
    await nextTick()
    expect(data.value).toEqual(100)

    foo.value = -1
    triggerEvent('input', foo)
    await nextTick()
    expect(data.value).toEqual(1)

    bar.value = 30
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toEqual('30')

    bar.value = 200
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toEqual('100')

    bar.value = -1
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toEqual('1')

    data.value = 60
    await nextTick()
    expect(foo.value).toEqual('60')
    expect(bar.value).toEqual('60')

    data.value = -1
    await nextTick()
    expect(foo.value).toEqual('1')
    expect(bar.value).toEqual('1')

    data.value = 200
    await nextTick()
    expect(foo.value).toEqual('100')
    expect(bar.value).toEqual('100')
  })

  /** 测试场景：checkbox初始null；用户勾选change写true，程序设false/true同步checked，用户取消再写false，验证布尔model。 */
  it('should work with checkbox', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')
    const data = root._vnode.component.data

    input.checked = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual(true)

    data.value = false
    await nextTick()
    expect(input.checked).toEqual(false)

    data.value = true
    await nextTick()
    expect(input.checked).toEqual(true)

    input.checked = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual(false)
  })

  /** 测试场景：checkbox设置true-value=yes、false-value=no，初始yes已勾选；用户取消/勾选和程序写yes/no分别同步字符串model与checked。 */
  it('should work with checkbox and true-value/false-value', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: 'yes'}，供本例渲染和事件更新读取。 */
      data() {
        return { value: 'yes' }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', 'true-value': 'yes', 'false-value': 'no', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              'true-value': 'yes',
              'false-value': 'no',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')
    const data = root._vnode.component.data

    // 初始 checked 按声明的 true-value/false-value 匹配。
    expect(input.checked).toEqual(true)

    input.checked = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual('no')

    data.value = 'yes'
    await nextTick()
    expect(input.checked).toEqual(true)

    data.value = 'no'
    await nextTick()
    expect(input.checked).toEqual(false)

    input.checked = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual('yes')
  })

  /** 测试场景：checkbox的true/false值是对象；用户切换写对应对象，程序写结构相等的新对象也更新checked，验证looseEqual匹配。 */
  it('should work with checkbox and true-value/false-value with object values', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', 'true-value': { yes: 'yes' }, 'false-value': { no: 'no' }, 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              'true-value': { yes: 'yes' },
              'false-value': { no: 'no' },
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')
    const data = root._vnode.component.data

    input.checked = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual({ yes: 'yes' })

    data.value = { no: 'no' }
    await nextTick()
    expect(input.checked).toEqual(false)

    data.value = { yes: 'yes' }
    await nextTick()
    expect(input.checked).toEqual(true)

    input.checked = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual({ no: 'no' })
  })

  /** 测试场景：两个checkbox共享数组model、value分别foo/bar；勾选/取消逐项增删，程序替换为单项或空数组同步两checked，验证成员同步。 */
  it(`should support array as a checkbox model`, async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', class: 'foo', value: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )、withVModel( h('input', { type: 'checkbox', class: 'bar', value: 'bar', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              class: 'foo',
              value: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
          withVModel(
            h('input', {
              type: 'checkbox',
              class: 'bar',
              value: 'bar',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const foo = root.querySelector('.foo')
    const bar = root.querySelector('.bar')
    const data = root._vnode.component.data

    foo.checked = true
    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toMatchObject(['foo'])

    bar.checked = true
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toMatchObject(['foo', 'bar'])

    bar.checked = false
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toMatchObject(['foo'])

    foo.checked = false
    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toMatchObject([])

    data.value = ['foo']
    await nextTick()
    expect(bar.checked).toEqual(false)
    expect(foo.checked).toEqual(true)

    data.value = ['bar']
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(true)

    data.value = []
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(false)
  })

  /** 测试场景：两个checkbox共享Set model；用户切换写包含相应成员的新Set，程序替换单项/空Set同步checked，验证Set成员路径。 */
  it(`should support Set as a checkbox model`, async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: new Set()}，供本例渲染和事件更新读取。 */
      data() {
        return { value: new Set() }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', class: 'foo', value: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )、withVModel( h('input', { type: 'checkbox', class: 'bar', value: 'bar', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              class: 'foo',
              value: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
          withVModel(
            h('input', {
              type: 'checkbox',
              class: 'bar',
              value: 'bar',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const foo = root.querySelector('.foo')
    const bar = root.querySelector('.bar')
    const data = root._vnode.component.data

    foo.checked = true
    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toMatchObject(new Set(['foo']))

    bar.checked = true
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toMatchObject(new Set(['foo', 'bar']))

    bar.checked = false
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toMatchObject(new Set(['foo']))

    foo.checked = false
    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toMatchObject(new Set())

    data.value = new Set(['foo'])
    await nextTick()
    expect(bar.checked).toEqual(false)
    expect(foo.checked).toEqual(true)

    data.value = new Set(['bar'])
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(true)

    data.value = new Set()
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(false)
  })

  /** 测试场景：初始checked=true并监视DOM setter；重复change和重复false数据不额外写DOM，用户手动取消计一次setter，程序再设true计一次，验证等值跳过。 */
  it('should not update DOM unnecessarily', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: true}，供本例渲染和事件更新读取。 */
      data() {
        return { value: true }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')
    const data = root._vnode.component.data

    const setCheckedSpy = vi.spyOn(input, 'checked', 'set')

    // 不修改 checked，直接触发 change，观察等值跳过。
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual(true)
    expect(setCheckedSpy).not.toHaveBeenCalled()

    // 先修改 checked 再触发 change。
    input.checked = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual(false)
    expect(setCheckedSpy).toHaveBeenCalledTimes(1)

    setCheckedSpy.mockClear()

    data.value = false
    await nextTick()
    expect(input.checked).toEqual(false)
    expect(setCheckedSpy).not.toHaveBeenCalled()

    data.value = true
    await nextTick()
    expect(input.checked).toEqual(true)
    expect(setCheckedSpy).toHaveBeenCalledTimes(1)
  })

  /** 测试场景：两个checkbox初始数组仅foo，监视各checked setter；相同change/等成员新数组不写DOM，增加bar及移除foo只改必要元素，验证数组成员比较。 */
  it('should handle array values correctly without unnecessary updates', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: ['foo']}，供本例渲染和事件更新读取。 */
      data() {
        return { value: ['foo'] }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'checkbox', value: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )、withVModel( h('input', { type: 'checkbox', value: 'bar', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'checkbox',
              value: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
          withVModel(
            h('input', {
              type: 'checkbox',
              value: 'bar',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const [foo, bar] = root.querySelectorAll('input')
    const data = root._vnode.component.data

    const setCheckedSpyFoo = vi.spyOn(foo, 'checked', 'set')
    const setCheckedSpyBar = vi.spyOn(bar, 'checked', 'set')

    expect(foo.checked).toEqual(true)
    expect(bar.checked).toEqual(false)

    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toEqual(['foo'])
    expect(setCheckedSpyFoo).not.toHaveBeenCalled()

    bar.checked = true
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toEqual(['foo', 'bar'])
    expect(setCheckedSpyBar).toHaveBeenCalledTimes(1)

    setCheckedSpyFoo.mockClear()
    setCheckedSpyBar.mockClear()

    data.value = ['foo', 'bar']
    await nextTick()
    expect(setCheckedSpyFoo).not.toHaveBeenCalled()
    expect(setCheckedSpyBar).not.toHaveBeenCalled()

    data.value = ['bar']
    await nextTick()
    expect(setCheckedSpyFoo).toHaveBeenCalledTimes(1)
    expect(setCheckedSpyBar).not.toHaveBeenCalled()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(true)
  })

  /** 测试场景：两个radio值foo/bar，共享初始null model；change写对应值，程序写null/单值同步两checked，确认单选互斥匹配。 */
  it('should work with radio', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h('input', { type: 'radio', class: 'foo', value: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )、withVModel( h('input', { type: 'radio', class: 'bar', value: 'bar', 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              type: 'radio',
              class: 'foo',
              value: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
          withVModel(
            h('input', {
              type: 'radio',
              class: 'bar',
              value: 'bar',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const foo = root.querySelector('.foo')
    const bar = root.querySelector('.bar')
    const data = root._vnode.component.data

    foo.checked = true
    triggerEvent('change', foo)
    await nextTick()
    expect(data.value).toEqual('foo')

    bar.checked = true
    triggerEvent('change', bar)
    await nextTick()
    expect(data.value).toEqual('bar')

    data.value = null
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(false)

    data.value = 'foo'
    await nextTick()
    expect(foo.checked).toEqual(true)
    expect(bar.checked).toEqual(false)

    data.value = 'bar'
    await nextTick()
    expect(foo.checked).toEqual(false)
    expect(bar.checked).toEqual(true)
  })

  /** 测试场景：单select含foo/bar；用户选择写回字符串，程序改model后select.value和两个option.selected同步，验证单选定位。 */
  it('should work with single select', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: 'foo' }), h('option', { value: 'bar' })], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: 'foo' }), h('option', { value: 'bar' })],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const foo = root.querySelector('option[value=foo]')
    const bar = root.querySelector('option[value=bar]')
    const data = root._vnode.component.data

    foo.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual('foo')

    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toEqual('bar')

    foo.selected = false
    bar.selected = false
    data.value = 'foo'
    await nextTick()
    expect(input.value).toEqual('foo')
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(false)

    foo.selected = true
    bar.selected = false
    data.value = 'bar'
    await nextTick()
    expect(input.value).toEqual('bar')
    expect(foo.selected).toEqual(false)
    expect(bar.selected).toEqual(true)
  })

  /** 测试场景：multiple select共享数组model；用户单选/双选返回相应数组，程序写foo或foo,bar同步selected，验证多选数组双向同步。 */
  it('multiple select (model is Array)', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: 'foo' }), h('option', { value: 'bar' })], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: 'foo' }), h('option', { value: 'bar' })],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const foo = root.querySelector('option[value=foo]')
    const bar = root.querySelector('option[value=bar]')
    const data = root._vnode.component.data

    foo.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(['foo'])

    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(['bar'])

    foo.selected = true
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(['foo', 'bar'])

    foo.selected = false
    bar.selected = false
    data.value = ['foo']
    await nextTick()
    expect(input.value).toEqual('foo')
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(false)

    foo.selected = false
    bar.selected = false
    data.value = ['foo', 'bar']
    await nextTick()
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)
  })

  /** 测试场景：select使用number修饰符，option原value为字符串1；选择后model类型number且值1，验证读取选项后的数值转换。 */
  it('v-model.number should work with select tag', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: null}，供本例渲染和事件更新读取。 */
      data() {
        return { value: null }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: '1' }), h('option', { value: '2' })], ), this.value, { number: true, }, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: '1' }), h('option', { value: '2' })],
            ),
            this.value,
            {
              number: true,
            },
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const one = root.querySelector('option[value="1"]')
    const data = root._vnode.component.data

    one.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(typeof data.value).toEqual('number')
    expect(data.value).toEqual(1)
  })

  /** 测试场景：multiple select使用number，option值字符串1/2；用户选择写数字数组，程序写[1]/[1,2]匹配字符串选项，验证number多选双向同步。 */
  it('v-model.number should work with multiple select', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: '1' }), h('option', { value: '2' })], ), this.value, { number: true, }, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: '1' }), h('option', { value: '2' })],
            ),
            this.value,
            {
              number: true,
            },
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const one = root.querySelector('option[value="1"]')
    const two = root.querySelector('option[value="2"]')
    const data = root._vnode.component.data

    one.selected = true
    two.selected = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([1])

    one.selected = false
    two.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([2])

    one.selected = true
    two.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([1, 2])

    one.selected = false
    two.selected = false
    data.value = [1]
    await nextTick()
    expect(one.selected).toEqual(true)
    expect(two.selected).toEqual(false)

    one.selected = false
    two.selected = false
    data.value = [1, 2]
    await nextTick()
    expect(one.selected).toEqual(true)
    expect(two.selected).toEqual(true)
  })

  /** 测试场景：multiple select数组model、option原值为对象；用户选项写原对象数组，程序写结构相等新对象仍全部选中，验证数组looseEqual。 */
  it('multiple select (model is Array, option value is object)', async () => {
    const fooValue = { foo: 1 }
    const barValue = { bar: 1 }

    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [ h('option', { value: fooValue }), h('option', { value: barValue }), ], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [
                h('option', { value: fooValue }),
                h('option', { value: barValue }),
              ],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    await nextTick()

    const input = root.querySelector('select')
    const [foo, bar] = root.querySelectorAll('option')
    const data = root._vnode.component.data

    foo.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([fooValue])

    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([barValue])

    foo.selected = true
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([fooValue, barValue])

    // 取消选中，重置 DOM 状态。
    foo.selected = false
    bar.selected = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([])

    data.value = [fooValue, barValue]
    await nextTick()
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)

    // 取消选中，重置 DOM 状态。
    foo.selected = false
    bar.selected = false
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject([])

    data.value = [{ foo: 1 }, { bar: 1 }]
    await nextTick()
    // 数组用 looseEqual，结构相等的新对象也匹配原选项。
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)
  })

  /** 测试场景：multiple select初始Set model；用户选择后仍返回Set，程序写foo或foo,bar的Set同步selected，验证保留集合类型。 */
  it('multiple select (model is Set)', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: new Set()}，供本例渲染和事件更新读取。 */
      data() {
        return { value: new Set() }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: 'foo' }), h('option', { value: 'bar' })], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: 'foo' }), h('option', { value: 'bar' })],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const foo = root.querySelector('option[value=foo]')
    const bar = root.querySelector('option[value=bar]')
    const data = root._vnode.component.data

    foo.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toBeInstanceOf(Set)
    expect(data.value).toMatchObject(new Set(['foo']))

    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toBeInstanceOf(Set)
    expect(data.value).toMatchObject(new Set(['bar']))

    foo.selected = true
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toBeInstanceOf(Set)
    expect(data.value).toMatchObject(new Set(['foo', 'bar']))

    foo.selected = false
    bar.selected = false
    data.value = new Set(['foo'])
    await nextTick()
    expect(input.value).toEqual('foo')
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(false)

    foo.selected = false
    bar.selected = false
    data.value = new Set(['foo', 'bar'])
    await nextTick()
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)
  })

  /** 测试场景：同一multiple select先将model由Array换Set后change，再换回Array后change；分别返回Set(foo,bar)和数组bar，验证事件使用当前model类型。 */
  it('multiple select uses current Array/Set model type', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: 'foo' }), h('option', { value: 'bar' })], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: 'foo' }), h('option', { value: 'bar' })],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('select')
    const foo = root.querySelector('option[value=foo]')
    const bar = root.querySelector('option[value=bar]')
    const data = root._vnode.component.data

    data.value = new Set(['foo'])
    await nextTick()
    foo.selected = true
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toBeInstanceOf(Set)
    expect(data.value).toMatchObject(new Set(['foo', 'bar']))

    data.value = ['foo']
    await nextTick()
    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(Array.isArray(data.value)).toBe(true)
    expect(data.value).toMatchObject(['bar'])
  })

  /** 测试场景：multiple select Set model、option值对象；原引用Set可选中，换为结构相等但不同引用对象Set后都不选，验证Set.has引用匹配。 */
  it('multiple select (model is Set, option value is object)', async () => {
    const fooValue = { foo: 1 }
    const barValue = { bar: 1 }

    const component = defineComponent({
      /** 初始化组件状态为{value: new Set()}，供本例渲染和事件更新读取。 */
      data() {
        return { value: new Set() }
      },
      /** 渲染根数组[withVModel( h( 'select', { value: null, multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [ h('option', { value: fooValue }), h('option', { value: barValue }), ], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                value: null,
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [
                h('option', { value: fooValue }),
                h('option', { value: barValue }),
              ],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    await nextTick()

    const input = root.querySelector('select')
    const [foo, bar] = root.querySelectorAll('option')
    const data = root._vnode.component.data

    foo.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(new Set([fooValue]))

    foo.selected = false
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(new Set([barValue]))

    foo.selected = true
    bar.selected = true
    triggerEvent('change', input)
    await nextTick()
    expect(data.value).toMatchObject(new Set([fooValue, barValue]))

    foo.selected = false
    bar.selected = false
    data.value = new Set([fooValue, barValue])
    await nextTick()
    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)

    foo.selected = false
    bar.selected = false
    data.value = new Set([{ foo: 1 }, { bar: 1 }])
    await nextTick()
    // Set 使用 has，不作 looseEqual；结构相等但引用不同的对象不选中。
    expect(foo.selected).toEqual(false)
    expect(bar.selected).toEqual(false)
  })

  /** 测试场景：文本input进入compositionstart后修改文本并触发input，model保持空串；compositionend派发最终input后model为完整中文，验证组合输入屏蔽。 */
  it('should work with composition session', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: ''}，供本例渲染和事件更新读取。 */
      data() {
        return { value: '' }
      },
      /** 渲染根数组[withVModel( h('input', { 'onUpdate:modelValue': setValue.bind(this), }), this.value, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              'onUpdate:modelValue': setValue.bind(this),
            }),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    const input = root.querySelector('input')!
    const data = root._vnode.component.data
    expect(input.value).toEqual('')

    //developer.mozilla.org/en-US/docs/Web/API/Element/compositionstart_event
    // 用户开始用拼音输入法输入汉字时可能触发compositionstart事件。
    input.value = '使用拼音'
    triggerEvent('compositionstart', input)
    await nextTick()
    expect(data.value).toEqual('')

    // 组合会话期间 input 不写回 model。
    input.value = '使用拼音输入'
    triggerEvent('input', input)
    await nextTick()
    expect(data.value).toEqual('')

    // compositionend 清除组合标记并补发 input，同步最终文本。
    triggerEvent('compositionend', input)
    await nextTick()
    expect(data.value).toEqual('使用拼音输入')
  })

  /** 测试场景：multiple select model=[1,2]，option值字符串1/2；挂载后均selected，验证数组原始值按字符串化数字匹配。 */
  it('multiple select (model is number, option value is string)', async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: [1, 2]}，供本例渲染和事件更新读取。 */
      data() {
        return {
          value: [1, 2],
        }
      },
      /** 渲染根数组[withVModel( h( 'select', { multiple: true, 'onUpdate:modelValue': setValue.bind(this), }, [h('option', { value: '1' }), h('option', { value: '2' })], ), this.value, )]。 */
      render() {
        return [
          withVModel(
            h(
              'select',
              {
                multiple: true,
                'onUpdate:modelValue': setValue.bind(this),
              },
              [h('option', { value: '1' }), h('option', { value: '2' })],
            ),
            this.value,
          ),
        ]
      },
    })
    render(h(component), root)

    await nextTick()
    const [foo, bar] = root.querySelectorAll('option')

    expect(foo.selected).toEqual(true)
    expect(bar.selected).toEqual(true)
  })

  // #10503
  /** 测试场景：number input初始model0，输入01后change model为数字1；DOM更新为1，验证前导0文本不能被等数值短路保留。 */
  test('equal value with a leading 0 should trigger update.', async () => {
    /** 将number input派发值写this.num，驱动前导0文本的DOM正规化。 */
    const setNum = function (this: any, value: any) {
      this.num = value
    }
    const component = defineComponent({
      /** 初始化组件状态为{num: 0}，供本例渲染和事件更新读取。 */
      data() {
        return { num: 0 }
      },
      /** 渲染根数组[withVModel( h('input', { id: 'input_num1', type: 'number', 'onUpdate:modelValue': setNum.bind(this), }), this.num, )]。 */
      render() {
        return [
          withVModel(
            h('input', {
              id: 'input_num1',
              type: 'number',
              'onUpdate:modelValue': setNum.bind(this),
            }),
            this.num,
          ),
        ]
      },
    })

    render(h(component), root)
    const data = root._vnode.component.data

    const inputNum1 = root.querySelector('#input_num1')!
    expect(inputNum1.value).toBe('0')

    inputNum1.value = '01'
    triggerEvent('input', inputNum1)
    await nextTick()
    expect(data.num).toBe(1)

    expect(inputNum1.value).toBe('1')
  })

  /** 测试场景：checkbox直接使用vModelCheckbox，初始空数组；push foo/按索引改bar，再换空Set并add/delete foo，每次checked正确切换，验证deep遍历追踪原地集合修改。 */
  it(`should support mutating an array or set value for a checkbox`, async () => {
    const component = defineComponent({
      /** 初始化组件状态为{value: []}，供本例渲染和事件更新读取。 */
      data() {
        return { value: [] }
      },
      /** 渲染根数组[withDirectives( h('input', { type: 'checkbox', class: 'foo', value: 'foo', 'onUpdate:modelValue': setValue.bind(this), }), [[vModelCheckbox, this.value]], )]。 */
      render() {
        return [
          withDirectives(
            h('input', {
              type: 'checkbox',
              class: 'foo',
              value: 'foo',
              'onUpdate:modelValue': setValue.bind(this),
            }),
            [[vModelCheckbox, this.value]],
          ),
        ]
      },
    })
    render(h(component), root)

    const foo = root.querySelector('.foo')
    const data = root._vnode.component.data

    expect(foo.checked).toEqual(false)

    data.value.push('foo')
    await nextTick()
    expect(foo.checked).toEqual(true)

    data.value[0] = 'bar'
    await nextTick()
    expect(foo.checked).toEqual(false)

    data.value = new Set()
    await nextTick()
    expect(foo.checked).toEqual(false)

    data.value.add('foo')
    await nextTick()
    expect(foo.checked).toEqual(true)

    data.value.delete('foo')
    await nextTick()
    expect(foo.checked).toEqual(false)
  })
})
