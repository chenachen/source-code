import type { MockedFunction } from 'vitest'
import {
  type HMRRuntime,
  type Ref,
  Teleport,
  type VueElement,
  createApp,
  defineAsyncComponent,
  defineComponent,
  defineCustomElement,
  h,
  inject,
  nextTick,
  onMounted,
  provide,
  ref,
  render,
  renderSlot,
  useHost,
  useShadowRoot,
} from '../src'

/** 开发环境全局 HMR 运行时，用于验证 Vue 自定义元素的热更新行为。 */
declare var __VUE_HMR_RUNTIME__: HMRRuntime

// 测试组：向浏览器注册不同名字的VueElement类，通过innerHTML、新建实例及连接/移除驱动生命周期；检查shadow DOM、props/attributes、CustomEvent、插槽、注入和样式。
describe('defineCustomElement', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  beforeEach(() => {
    container.innerHTML = ''
  })

  // 测试组：挂载/卸载。
  describe('mounting/unmount', () => {
    const E = defineCustomElement({
      props: {
        msg: {
          type: String,
          default: 'hello',
        },
      },
      /** 渲染'div'节点（this.msg）。 */
      render() {
        return h('div', this.msg)
      },
    })
    customElements.define('my-element', E)

    /** 测试场景：通过HTML插入已注册my-element，msg默认hello；宿主是E实例、内部组件已创建，ShadowRoot渲染hello div，验证连接挂载。 */
    test('should work', () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      expect(e).toBeInstanceOf(E)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
    })

    /** 测试场景：new E传msg=inline时_instance仍null；append连接后才创建组件并渲染inline div，验证构造与连接的分工。 */
    test('should work w/ manual instantiation', () => {
      const e = new E({ msg: 'inline' })
      // 构造时不创建组件实例。
      expect(e._instance).toBe(null)
      // 连接到文档后才创建组件实例。
      container.appendChild(e)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>inline</div>`)
    })

    /** 测试场景：已连接元素从容器移除并等待nextTick；_instance变null、ShadowRoot清空，验证延后确认断连后的真实卸载。 */
    test('should unmount on remove', async () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      container.removeChild(e)
      await nextTick()
      expect(e._instance).toBe(null)
      expect(e.shadowRoot!.innerHTML).toBe('')
    })

    // #10610
    /** 测试场景：带value=12的输入自定义元素移到另一父div；移动后移除value attribute，内部input变空，确认移动未断开MutationObserver。 */
    test('When elements move, avoid prematurely disconnecting MutationObserver', async () => {
      const CustomInput = defineCustomElement({
        props: ['value'],
        emits: ['update'],
        /** setup返回渲染函数：'input'节点（属性{type: 'number'，value: props.value，onInput回调}）。 */
        setup(props, { emit }) {
          return () =>
            h('input', {
              type: 'number',
              value: props.value,
              /** 执行emit('update', Number.isNaN(num)决定null或num)。无返回值。 */
              onInput: (e: InputEvent) => {
                const num = (e.target! as HTMLInputElement).valueAsNumber
                emit('update', Number.isNaN(num) ? null : num)
              },
            })
        },
      })
      customElements.define('my-el-input', CustomInput)
      const num = ref('12')
      const containerComp = defineComponent({
        /** setup返回渲染函数：'div'节点（根数组['my-el-input'节点（属性{value: num.value，onUpdate回调}）、'div'节点（属性{id: 'move'}）]）。 */
        setup() {
          return () => {
            return h('div', [
              h('my-el-input', {
                value: num.value,
                /** 执行num.value=$event.detail[0]。无返回值。 */
                onUpdate: ($event: CustomEvent) => {
                  num.value = $event.detail[0]
                },
              }),
              h('div', { id: 'move' }),
            ])
          }
        },
      })
      const app = createApp(containerComp)
      const container = document.createElement('div')
      document.body.appendChild(container)
      app.mount(container)
      const myInputEl = container.querySelector('my-el-input')!
      const inputEl = myInputEl.shadowRoot!.querySelector('input')!
      await nextTick()
      expect(inputEl.value).toBe('12')
      const moveEl = container.querySelector('#move')!
      moveEl.append(myInputEl)
      await nextTick()
      myInputEl.removeAttribute('value')
      await nextTick()
      expect(inputEl.value).toBe('')
    })

    /** 测试场景：同一元素从嵌套div同步移到容器；下一tick内部_instance保持同对象且hello DOM保留，验证断连后重新连接不会卸载。 */
    test('should not unmount on move', async () => {
      container.innerHTML = `<div><my-element></my-element></div>`
      const e = container.childNodes[0].childNodes[0] as VueElement
      const i = e._instance
      // 元素从一父节点同步搬到另一父节点，先触发断连，
      // 随后同轮触发连接回调。
      container.appendChild(e)
      await nextTick()
      // 再次连接后保留同一组件实例。
      expect(e._instance).toBe(i)
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')
    })

    /** 测试场景：移除元素并等tick后_instance=null、ShadowRoot空，再重新插入；重建组件并显示hello，验证真正卸载后的再连接。 */
    test('remove then insert again', async () => {
      container.innerHTML = `<my-element></my-element>`
      const e = container.childNodes[0] as VueElement
      container.removeChild(e)
      await nextTick()
      expect(e._instance).toBe(null)
      expect(e.shadowRoot!.innerHTML).toBe('')
      container.appendChild(e)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')
    })
  })

  // 测试组：自定义元素 attributes/properties 与组件 props 的双向衔接。
  describe('props', () => {
    const E = defineCustomElement({
      props: {
        foo: [String, null],
        bar: Object,
        bazQux: null,
        value: null,
      },
      /** 渲染根数组['div'节点（null；this.foo || ''）、'div'节点（null；this.bazQux || (this.bar && this.bar.x)）]。 */
      render() {
        return [
          h('div', null, this.foo || ''),
          h('div', null, this.bazQux || (this.bar && this.bar.x)),
        ]
      },
    })
    customElements.define('my-el-props', E)

    /** 测试场景：Vue render向声明value的自定义元素传{x:1}；宿主property仍为对象，验证对象走property通道。 */
    test('renders custom element w/ correct object prop value', () => {
      render(h('my-el-props', { value: { x: 1 } }), container)
      const el = container.children[0]
      expect((el as any).value).toEqual({ x: 1 })
    })

    /** 测试场景：HTML attributes foo=hello/baz-qux=bye初始化双div；分别setAttribute后对应文本更新，确认连字符映射和observer同步。 */
    test('props via attribute', async () => {
      // bazQux 声明映射到 baz-qux attribute。
      container.innerHTML = `<my-el-props foo="hello" baz-qux="bye"></my-el-props>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div><div>bye</div>')

      // 修改宿主 attribute。
      e.setAttribute('foo', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>changed</div><div>bye</div>')

      e.setAttribute('baz-qux', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        '<div>changed</div><div>changed</div>',
      )
    })

    /** 测试场景：连接前设foo字符串/bar对象，字符串反射foo attribute而对象不反射；后续字符串/null/undefined及bazQux更新同步DOM与attribute移除/连字符反射。 */
    test('props via properties', async () => {
      const e = new E()
      e.foo = 'one'
      e.bar = { x: 'two' }
      container.appendChild(e)
      expect(e.shadowRoot!.innerHTML).toBe('<div>one</div><div>two</div>')

      // 检查 property 到 attribute 的反射。
      // 字符串原始值反射为 attribute。
      expect(e.getAttribute('foo')).toBe('one')
      // 对象值保留在 property，不写为 attribute。
      expect(e.hasAttribute('bar')).toBe(false)

      e.foo = 'three'
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>three</div><div>two</div>')
      expect(e.getAttribute('foo')).toBe('three')

      e.foo = null
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div></div><div>two</div>')
      expect(e.hasAttribute('foo')).toBe(false)

      e.foo = undefined
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div></div><div>two</div>')
      expect(e.hasAttribute('foo')).toBe(false)
      expect(e.foo).toBe(undefined)

      e.bazQux = 'four'
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div></div><div>four</div>')
      expect(e.getAttribute('baz-qux')).toBe('four')
    })

    /** 测试场景：声明foo/bar初始由property写入，再交替更新foo attribute与bar对象property；两次DOM均同时显示新值，foo property跟attribute同步而bar无attribute。 */
    test('props via attributes and properties changed together', async () => {
      const e = new E()
      e.foo = 'foo1'
      e.bar = { x: 'bar1' }
      container.appendChild(e)
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>foo1</div><div>bar1</div>')

      // 修改宿主 attribute。 then property
      e.setAttribute('foo', 'foo2')
      e.bar = { x: 'bar2' }
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>foo2</div><div>bar2</div>')
      expect(e.getAttribute('foo')).toBe('foo2')
      expect(e.foo).toBe('foo2')
      expect(e.hasAttribute('bar')).toBe(false)

      // 先更新对象 property，再更新 attribute。
      e.bar = { x: 'bar3' }
      e.setAttribute('foo', 'foo3')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>foo3</div><div>bar3</div>')
      expect(e.getAttribute('foo')).toBe('foo3')
      expect(e.hasAttribute('bar')).toBe(false)
    })

    /** 测试场景：声明Boolean fooBar，Vue render传foo-bar=true；宿主输出foo-bar空attribute，验证连字符键映射与布尔反射。 */
    test('props via hyphen property', async () => {
      const Comp = defineCustomElement({
        props: {
          fooBar: Boolean,
        },
        /** 渲染'Comp'。 */
        render() {
          return 'Comp'
        },
      })
      customElements.define('my-el-comp', Comp)
      render(h('my-el-comp', { 'foo-bar': true }), container)
      const el = container.children[0]
      expect((el as any).outerHTML).toBe('<my-el-comp foo-bar=""></my-el-comp>')
    })

    /** 测试场景：fooBar:Number/bar:Boolean/baz:String；初始foo-bar=1转数字、缺bar为false，空bar转true、2e1转20而String baz仍2e1，确认声明转换。 */
    test('attribute -> prop type casting', async () => {
      const E = defineCustomElement({
        props: {
          fooBar: Number, // 检查驼峰命名 prop 的数值转换
          bar: Boolean,
          baz: String,
        },
        /** 渲染[ this.fooBar, typeof this.fooBar, this.bar, typeof this.bar, this.baz, typeof this.baz, ].join(' ')。 */
        render() {
          return [
            this.fooBar,
            typeof this.fooBar,
            this.bar,
            typeof this.bar,
            this.baz,
            typeof this.baz,
          ].join(' ')
        },
      })
      customElements.define('my-el-props-cast', E)
      container.innerHTML = `<my-el-props-cast foo-bar="1" baz="12345"></my-el-props-cast>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(
        `1 number false boolean 12345 string`,
      )

      e.setAttribute('bar', '')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`1 number true boolean 12345 string`)

      e.setAttribute('foo-bar', '2e1')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `20 number true boolean 12345 string`,
      )

      e.setAttribute('baz', '2e1')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`20 number true boolean 2e1 string`)
    })

    // #4772
    /** 测试场景：document.createElement后setAttribute foo=123再连接，foo声明Number；渲染报告number，验证程序创建元素的挂载转换。 */
    test('attr casting w/ programmatic creation', () => {
      const E = defineCustomElement({
        props: {
          foo: Number,
        },
        /** 渲染`foo type: ${typeof this.foo}`。 */
        render() {
          return `foo type: ${typeof this.foo}`
        },
      })
      customElements.define('my-element-programmatic', E)
      const el = document.createElement('my-element-programmatic') as any
      el.setAttribute('foo', '123')
      container.appendChild(el)
      expect(el.shadowRoot.innerHTML).toBe(`foo type: number`)
    })

    /** 测试场景：未注册元素先设foo、dataset.age和未声明notProp，再连接后注册升级；setup收到hello和数字5，DOM正确且notProp不反射attribute，验证预升级收集。 */
    test('handling properties set before upgrading', () => {
      const E = defineCustomElement({
        props: {
          foo: String,
          dataAge: Number,
        },
        /** setup不返回渲染或公开状态。 在此fixture入口检查props.foo、props.dataAge，失败直接由expect抛出。 */
        setup(props) {
          expect(props.foo).toBe('hello')
          expect(props.dataAge).toBe(5)
        },
        /** 渲染'div'节点（`foo: ${this.foo}`）。 */
        render() {
          return h('div', `foo: ${this.foo}`)
        },
      })
      const el = document.createElement('my-el-upgrade') as any
      el.foo = 'hello'
      el.dataset.age = 5
      el.notProp = 1
      container.appendChild(el)
      customElements.define('my-el-upgrade', E)
      expect(el.shadowRoot.firstChild.innerHTML).toBe(`foo: hello`)
      // 未声明为 prop 的 property 不反射为 attribute。
      expect(el.hasAttribute('not-prop')).toBe(false)
    })

    /** 测试场景：已注册但未连接元素先设foo=hello与post对象；连接时setup保留字符串及对象同引用，DOM输出对象JSON，验证预连接property保存。 */
    test('handle properties set before connecting', () => {
      const obj = { a: 1 }
      const E = defineCustomElement({
        props: {
          foo: String,
          post: Object,
        },
        /** setup不返回渲染或公开状态。 在此fixture入口检查props.foo、props.post，失败直接由expect抛出。 */
        setup(props) {
          expect(props.foo).toBe('hello')
          expect(props.post).toBe(obj)
        },
        /** 渲染JSON.stringify(this.post)。 */
        render() {
          return JSON.stringify(this.post)
        },
      })
      customElements.define('my-el-preconnect', E)
      const el = document.createElement('my-el-preconnect') as any
      el.foo = 'hello'
      el.post = obj

      container.appendChild(el)
      expect(el.shadowRoot.innerHTML).toBe(JSON.stringify(obj))
    })

    // https://github.com/vuejs/core/issues/6163
    /** 测试场景：未声明props的自定义元素插入后显示foo div，验证无props定义的挂载路径。 */
    test('handle components with no props', async () => {
      const E = defineCustomElement({
        /** 渲染'div'节点（'foo'）。 */
        render() {
          return h('div', 'foo')
        },
      })
      customElements.define('my-element-noprops', E)
      const el = document.createElement('my-element-noprops')
      container.appendChild(el)
      await nextTick()
      expect(el.shadowRoot!.innerHTML).toMatchInlineSnapshot('"<div>foo</div>"')
    })

    // #5793
    /** 测试场景：声明连字符max-age:Number，连接后写maxAge=50；property与渲染均保持number50，确认数值property不因attribute反射变字符串。 */
    test('set number value in dom property', () => {
      const E = defineCustomElement({
        props: {
          'max-age': Number,
        },
        /** 渲染`max age: ${this.maxAge}/type: ${typeof this.maxAge}`。 */
        render() {
          // @ts-expect-error
          return `max age: ${this.maxAge}/type: ${typeof this.maxAge}`
        },
      })
      customElements.define('my-element-number-property', E)
      const el = document.createElement('my-element-number-property') as any
      container.appendChild(el)
      el.maxAge = 50
      expect(el.maxAge).toBe(50)
      expect(el.shadowRoot.innerHTML).toBe('max age: 50/type: number')
    })

    // #9006
    /** 测试场景：value:String默认hi，HTML未传值；宿主e.value为hi，验证解析组件默认值后同步宿主property。 */
    test('should reflect default value', () => {
      const E = defineCustomElement({
        props: {
          value: {
            type: String,
            default: 'hi',
          },
        },
        /** 渲染this.value。 */
        render() {
          return this.value
        },
      })
      customElements.define('my-el-default-val', E)
      container.innerHTML = `<my-el-default-val></my-el-default-val>`
      const e = container.childNodes[0] as any
      expect(e.value).toBe('hi')
    })

    // #12214
    /** 测试场景：Boolean foo默认true；未传和设undefined都true，设false/null分别保留false/null，设空串转true，验证默认值与布尔转换顺序。 */
    test('Boolean prop with default true', async () => {
      const E = defineCustomElement({
        props: {
          foo: {
            type: Boolean,
            default: true,
          },
        },
        /** 渲染String(this.foo)。 */
        render() {
          return String(this.foo)
        },
      })
      customElements.define('my-el-default-true', E)
      container.innerHTML = `<my-el-default-true></my-el-default-true>`
      const e = container.childNodes[0] as HTMLElement & {
          /** Boolean宿主property的测试扩展类型，可赋undefined/false/null/空串以核对转换。 */
          foo: any
        },
        shadowRoot = e.shadowRoot as ShadowRoot
      expect(shadowRoot.innerHTML).toBe('true')
      e.foo = undefined
      await nextTick()
      expect(shadowRoot.innerHTML).toBe('true')
      e.foo = false
      await nextTick()
      expect(shadowRoot.innerHTML).toBe('false')
      e.foo = null
      await nextTick()
      expect(shadowRoot.innerHTML).toBe('null')
      e.foo = ''
      await nextTick()
      expect(shadowRoot.innerHTML).toBe('true')
    })

    /** 测试场景：defineCustomElement直接接收setup函数并在extraOptions声明text；HTML text=hello后渲染hello，验证函数语法合并选项。 */
    test('support direct setup function syntax with extra options', () => {
      const E = defineCustomElement(
        props => {
          return () => props.text
        },
        {
          props: {
            text: String,
          },
        },
      )
      customElements.define('my-el-setup-with-props', E)
      container.innerHTML = `<my-el-setup-with-props text="hello"></my-el-setup-with-props>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe('hello')
    })

    /** 测试场景：num声明Number/String并传数字1、bool声明Boolean并传true；property和DOM类型分别number/boolean，确认Vue render传值保持类型。 */
    test('prop types validation', async () => {
      const E = defineCustomElement({
        props: {
          num: {
            type: [Number, String],
          },
          bool: {
            type: Boolean,
          },
        },
        /** 渲染'div'节点（根数组['span'节点（根数组[`${this.num} is ${typeof this.num}`]）、'span'节点（根数组[`${this.bool} is ${typeof this.bool}`]）]）。 */
        render() {
          return h('div', [
            h('span', [`${this.num} is ${typeof this.num}`]),
            h('span', [`${this.bool} is ${typeof this.bool}`]),
          ])
        },
      })

      customElements.define('my-el-with-type-props', E)
      render(h('my-el-with-type-props', { num: 1, bool: true }), container)
      const e = container.childNodes[0] as VueElement
      // @ts-expect-error
      expect(e.num).toBe(1)
      // @ts-expect-error
      expect(e.bool).toBe(true)
      expect(e.shadowRoot!.innerHTML).toBe(
        '<div><span>1 is number</span><span>true is boolean</span></div>',
      )
    })

    /** 测试场景：两个props各watch另一个并写data，首次都默认；一次render同时改两props后watch各一次且读取完整新值，等值再render不触发，仅改prop1只触发其watch。 */
    test('should patch all props together', async () => {
      let prop1Calls = 0
      let prop2Calls = 0
      const E = defineCustomElement({
        props: {
          prop1: {
            type: String,
            default: 'default1',
          },
          prop2: {
            type: String,
            default: 'default2',
          },
        },
        /** 初始化组件状态为{data1: 'defaultData1'，data2: 'defaultData2'}，供本例渲染和事件更新读取。 */
        data() {
          return {
            data1: 'defaultData1',
            data2: 'defaultData2',
          }
        },
        watch: {
          /** prop1 watcher累加调用计数，并读取当前prop2写入data2；验证同时patch时另一prop已经更新。 */
          prop1(_) {
            prop1Calls++
            this.data2 = this.prop2
          },
          /** prop2 watcher累加调用计数，并读取当前prop1写入data1；验证同时patch时另一prop已经更新。 */
          prop2(_) {
            prop2Calls++
            this.data1 = this.prop1
          },
        },
        /** 渲染'div'节点（根数组['h1'节点（this.prop1）、'h1'节点（this.prop2）、'h2'节点（this.data1）、'h2'节点（this.data2）]）。 */
        render() {
          return h('div', [
            h('h1', this.prop1),
            h('h1', this.prop2),
            h('h2', this.data1),
            h('h2', this.data2),
          ])
        },
      })
      customElements.define('my-watch-element', E)

      render(h('my-watch-element'), container)
      const e = container.childNodes[0] as VueElement
      expect(e).toBeInstanceOf(E)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>default1</h1><h1>default2</h1><h2>defaultData1</h2><h2>defaultData2</h2></div>`,
      )
      expect(prop1Calls).toBe(0)
      expect(prop2Calls).toBe(0)

      // 一次 render 同时修补两个 props。
      render(
        h('my-watch-element', { prop1: 'newValue1', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue1</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(1)
      expect(prop2Calls).toBe(1)

      // 再次 render 相同 props，不重复触发 watcher。
      render(
        h('my-watch-element', { prop1: 'newValue1', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue1</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(1)
      expect(prop2Calls).toBe(1)

      // 只改变 prop1，prop2 watcher 不触发。
      render(
        h('my-watch-element', { prop1: 'newValue3', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue3</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(2)
      expect(prop2Calls).toBe(1)
    })

    /** 测试场景：异步定义解析后复用双props交叉watch场景；同时更新时两watch均读到新props，等值不重复、单项改只触发对应watch，确认异步定义也批量patch。 */
    test('should patch all props together (async)', async () => {
      let prop1Calls = 0
      let prop2Calls = 0
      const E = defineCustomElement(
        defineAsyncComponent(() =>
          Promise.resolve(
            defineComponent({
              props: {
                prop1: {
                  type: String,
                  default: 'default1',
                },
                prop2: {
                  type: String,
                  default: 'default2',
                },
              },
              /** 初始化组件状态为{data1: 'defaultData1'，data2: 'defaultData2'}，供本例渲染和事件更新读取。 */
              data() {
                return {
                  data1: 'defaultData1',
                  data2: 'defaultData2',
                }
              },
              watch: {
                /** prop1 watcher累加调用计数，并读取当前prop2写入data2；验证同时patch时另一prop已经更新。 */
                prop1(_) {
                  prop1Calls++
                  this.data2 = this.prop2
                },
                /** prop2 watcher累加调用计数，并读取当前prop1写入data1；验证同时patch时另一prop已经更新。 */
                prop2(_) {
                  prop2Calls++
                  this.data1 = this.prop1
                },
              },
              /** 渲染'div'节点（根数组['h1'节点（this.prop1）、'h1'节点（this.prop2）、'h2'节点（this.data1）、'h2'节点（this.data2）]）。 */
              render() {
                return h('div', [
                  h('h1', this.prop1),
                  h('h1', this.prop2),
                  h('h2', this.data1),
                  h('h2', this.data2),
                ])
              },
            }),
          ),
        ),
      )
      customElements.define('my-async-watch-element', E)

      render(h('my-async-watch-element'), container)

      await new Promise(r => setTimeout(r))
      const e = container.childNodes[0] as VueElement
      expect(e).toBeInstanceOf(E)
      expect(e._instance).toBeTruthy()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>default1</h1><h1>default2</h1><h2>defaultData1</h2><h2>defaultData2</h2></div>`,
      )
      expect(prop1Calls).toBe(0)
      expect(prop2Calls).toBe(0)

      // 一次 render 同时修补两个 props。
      render(
        h('my-async-watch-element', { prop1: 'newValue1', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue1</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(1)
      expect(prop2Calls).toBe(1)

      // 再次 render 相同 props，不重复触发 watcher。
      render(
        h('my-async-watch-element', { prop1: 'newValue1', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue1</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(1)
      expect(prop2Calls).toBe(1)

      // 只改变 prop1，prop2 watcher 不触发。
      render(
        h('my-async-watch-element', { prop1: 'newValue3', prop2: 'newValue2' }),
        container,
      )
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><h1>newValue3</h1><h1>newValue2</h1><h2>newValue1</h2><h2>newValue2</h2></div>`,
      )
      expect(prop1Calls).toBe(2)
      expect(prop2Calls).toBe(1)
    })
  })

  // 测试组：未声明 attributes 作为 attrs 传入组件并响应后续变化。
  describe('attrs', () => {
    const E = defineCustomElement({
      /** 渲染根数组['div'节点（null；this.$attrs.foo）]。 */
      render() {
        return [h('div', null, this.$attrs.foo as string)]
      },
    })
    customElements.define('my-el-attrs', E)

    /** 测试场景：未声明foo的元素从HTML attribute收到hello，经$attrs渲染；setAttribute改changed后DOM更新，验证未声明attribute进入attrs。 */
    test('attrs via attribute', async () => {
      container.innerHTML = `<my-el-attrs foo="hello"></my-el-attrs>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe('<div>hello</div>')

      e.setAttribute('foo', 'changed')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe('<div>changed</div>')
    })

    /** 测试场景：未声明foo的元素仅写property=123再连接；$attrs.foo未收到该property，内部div为空，确认非attribute写入不自动成为attrs。 */
    test('non-declared properties should not show up in $attrs', () => {
      const e = new E()
      // @ts-expect-error
      e.foo = '123'
      container.appendChild(e)
      expect(e.shadowRoot!.innerHTML).toBe('<div></div>')
    })

    // #12408
    /** 测试场景：Vue render未声明tabindex=1/data-test=true；宿主attributes分别1/true，验证原生及data属性走attribute。 */
    test('should set number tabindex as attribute', () => {
      render(h('my-el-attrs', { tabindex: 1, 'data-test': true }), container)
      const el = container.children[0] as HTMLElement
      expect(el.getAttribute('tabindex')).toBe('1')
      expect(el.getAttribute('data-test')).toBe('true')
    })

    /** 测试场景：Vue render未声明translate=no；attribute保持no、原生translate布尔property为false，验证不能直接赋字符串给原生property。 */
    test('should keep undeclared native attrs as attrs', () => {
      const root = document.createElement('div')
      document.body.appendChild(root)

      render(h('my-el-attrs', { translate: 'no' }), root)
      const el = root.children[0] as HTMLElement
      expect(el.getAttribute('translate')).toBe('no')
      expect(el.translate).toBe(false)

      render(null, root)
      root.remove()
    })

    // https://github.com/vuejs/core/issues/12964
    // jsdom 缺少 delegatesFocus 支持，当前用例跳过执行。
    // https://github.com/jsdom/jsdom/issues/3418
    // eslint-disable-next-line vitest/no-disabled-tests
    /** 测试场景：跳过用例：配置shadowRootOptions.delegatesFocus=true，预期ShadowRoot同值；因jsdom缺支持未执行，不能据此认定运行行为已验证。 */
    test.skip('shadowRoot should be initialized with delegatesFocus', () => {
      const E = defineCustomElement(
        {
          /** 渲染根数组['input'节点（属性{tabindex: 1}）]。 */
          render() {
            return [h('input', { tabindex: 1 })]
          },
        },
        { shadowRootOptions: { delegatesFocus: true } },
      )
      customElements.define('my-el-with-delegate-focus', E)

      const e = new E()
      container.appendChild(e)
      expect(e.shadowRoot!.delegatesFocus).toBe(true)
    })
  })

  // 测试组：组件 emits 转换成宿主可监听的 CustomEvent。
  describe('emits', () => {
    const CompDef = defineComponent({
      /** 执行emit('created')。setup返回渲染函数：'div'节点（属性{onClick回调，onMousedown回调，onWheel回调}）。 */
      setup(_, { emit }) {
        emit('created')
        return () =>
          h('div', {
            /** 执行emit('my-click', 1)。无返回值。 */
            onClick: () => {
              emit('my-click', 1)
            },
            /** 执行emit('myEvent', 1)。无返回值。 */
            onMousedown: () => {
              emit('myEvent', 1) // 核对同时派发连字符事件名。
            },
            /** 执行emit('my-wheel', {bubbles: true}, 1)。无返回值。 */
            onWheel: () => {
              emit('my-wheel', { bubbles: true }, 1)
            },
          })
      },
    })
    const E = defineCustomElement(CompDef)
    customElements.define('my-el-emits', E)

    /** 测试场景：连接前监听created，setup同步emit created；append连接后监听器收到事件，验证首次setup的emit派发宿主。 */
    test('emit on connect', () => {
      const e = new E()
      const spy = vi.fn()
      e.addEventListener('created', spy)
      container.appendChild(e)
      expect(spy).toHaveBeenCalled()
    })

    /** 测试场景：ShadowRoot内div点击触发emit my-click(1)；宿主监听器一次且CustomEvent.detail=[1]，验证参数数组桥接。 */
    test('emit on interaction', () => {
      container.innerHTML = `<my-el-emits></my-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1],
      })
    })

    // #5373
    /** 测试场景：ShadowRoot内mousedown触发emit myEvent；宿主监听myEvent和my-event均一次，验证同时派发原名及连字符事件名。 */
    test('case transform for camelCase event', () => {
      container.innerHTML = `<my-el-emits></my-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy1 = vi.fn()
      e.addEventListener('myEvent', spy1)
      const spy2 = vi.fn()
      // emit 使用 myEvent，同时监听 my-event；
      // Vue 模板使用自定义元素时会采用这种连字符监听名。
      e.addEventListener('my-event', spy2)
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('mousedown'))
      expect(spy1).toHaveBeenCalledTimes(1)
      expect(spy2).toHaveBeenCalledTimes(1)
    })

    /** 测试场景：异步wrapper解析CompDef后点击内部div；宿主收到my-click且detail=[1]，确认异步实际实例安装emit桥接。 */
    test('emit from within async component wrapper', async () => {
      const p = new Promise<typeof CompDef>(res => res(CompDef as any))
      const E = defineCustomElement(defineAsyncComponent(() => p))
      customElements.define('my-async-el-emits', E)
      container.innerHTML = `<my-async-el-emits></my-async-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      // 等待异步定义与连续更新完成后再访问内部 DOM。
      await customElements.whenDefined('my-async-el-emits')
      await nextTick()
      await nextTick()
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1],
      })
    })

    // #7293
    /** 测试场景：异步wrapper宿主带id attribute，解析后点击内部div；仍收到my-click和detail=[1]，验证绑定属性不破坏异步emit桥接。 */
    test('emit in an async component wrapper with properties bound', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(
          () => new Promise<typeof CompDef>(res => res(CompDef as any)),
        ),
      )
      customElements.define('my-async-el-props-emits', E)
      container.innerHTML = `<my-async-el-props-emits id="my_async_el_props_emits"></my-async-el-props-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-click', spy)
      await customElements.whenDefined('my-async-el-props-emits')
      await nextTick()
      await nextTick()
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('click'))
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toMatchObject({
        detail: [1],
      })
    })

    /** 测试场景：内部wheel触发emit my-wheel({bubbles:true},1)；宿主事件一次且bubbles=true，detail仍为完整两项参数数组，验证首参事件选项合并。 */
    test('emit with options', async () => {
      container.innerHTML = `<my-el-emits></my-el-emits>`
      const e = container.childNodes[0] as VueElement
      const spy = vi.fn()
      e.addEventListener('my-wheel', spy)
      e.shadowRoot!.childNodes[0].dispatchEvent(new CustomEvent('wheel'))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatchObject({
        bubbles: true,
        detail: [{ bubbles: true }, 1],
      })
    })
  })

  // 测试组：自定义元素通过原生 slot 分发 children，并把 renderSlot 的 props 写成 slot 元素 attributes。
  describe('slots', () => {
    const E = defineCustomElement({
      /** 渲染根数组['div'节点（null；根数组[renderSlot(this.$slots, 'default', undefined, () => [ h('div', 'fallback'), ])]）、'div'节点（null；renderSlot(this.$slots, 'named')）]。 */
      render() {
        return [
          h('div', null, [
            renderSlot(this.$slots, 'default', undefined, () => [
              h('div', 'fallback'),
            ]),
          ]),
          h('div', null, renderSlot(this.$slots, 'named')),
        ]
      },
    })
    customElements.define('my-el-slots', E)

    /** 测试场景：宿主有默认span内容，组件renderSlot输出默认/命名slot；ShadowRoot含原生slot及默认fallback div，验证原生投影结构而非复制宿主span。 */
    test('render slots correctly', () => {
      container.innerHTML = `<my-el-slots><span>hi</span></my-el-slots>`
      const e = container.childNodes[0] as VueElement
      // 原生 slot 投影不改变 ShadowRoot.innerHTML；
      // 这里检查原生 slot 与 fallback 结构。
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot><div>fallback</div></slot></div><div><slot name="named"></slot></div>`,
      )
    })

    /** 测试场景：renderSlot默认slot附响应式class，foo改bar；ShadowRoot原生slot.class同步更新，验证slot props成为原生元素attributes。 */
    test('render slot props', async () => {
      const foo = ref('foo')
      const E = defineCustomElement({
        /** 渲染根数组['div'节点（null；renderSlot(this.$slots, 'default', { class: foo.value })）]。 */
        render() {
          return [
            h(
              'div',
              null,
              renderSlot(this.$slots, 'default', { class: foo.value }),
            ),
          ]
        },
      })
      customElements.define('my-el-slot-props', E)
      container.innerHTML = `<my-el-slot-props><span>hi</span></my-el-slot-props>`
      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot class="foo"></slot></div>`,
      )

      foo.value = 'bar'
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot class="bar"></slot></div>`,
      )
    })
  })

  // 测试组：提供/注入。
  describe('provide/inject', () => {
    const Consumer = defineCustomElement({
      /** 执行inject('foo')。setup返回渲染函数：'div'节点（foo.value）。 */
      setup() {
        const foo = inject<Ref>('foo')!
        return () => h('div', foo.value)
      },
    })
    customElements.define('my-consumer', Consumer)

    /** 测试场景：Provider ShadowRoot内创建Consumer并provide响应式foo；Consumer显示injected后随foo更新changed，验证嵌套自定义元素provide父链。 */
    test('over nested usage', async () => {
      const foo = ref('injected!')
      const Provider = defineCustomElement({
        provide: {
          foo,
        },
        /** 渲染'my-consumer'节点。 */
        render() {
          return h('my-consumer')
        },
      })
      customElements.define('my-provider', Provider)
      container.innerHTML = `<my-provider><my-provider>`
      const provider = container.childNodes[0] as VueElement
      const consumer = provider.shadowRoot!.childNodes[0] as VueElement

      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>injected!</div>`)

      foo.value = 'changed!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>changed!</div>`)
    })

    /** 测试场景：Consumer作为Provider的轻DOM默认slot内容；inject foo初始injected并更新changed，验证slot投影后的自定义元素父链。 */
    test('over slot composition', async () => {
      const foo = ref('injected!')
      const Provider = defineCustomElement({
        provide: {
          foo,
        },
        /** 渲染renderSlot(this.$slots, 'default')。 */
        render() {
          return renderSlot(this.$slots, 'default')
        },
      })
      customElements.define('my-provider-2', Provider)

      container.innerHTML = `<my-provider-2><my-consumer></my-consumer><my-provider-2>`
      const provider = container.childNodes[0]
      const consumer = provider.childNodes[0] as VueElement
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>injected!</div>`)

      foo.value = 'changed!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>changed!</div>`)
    })

    /** 测试场景：两层Provider各提供fooA/fooB，Consumer显示两个值并响应共同更新；验证继承祖先provides链，此例无config断言。 */
    test('inherited from ancestors', async () => {
      const fooA = ref('FooA!')
      const fooB = ref('FooB!')
      const ProviderA = defineCustomElement({
        provide: {
          fooA,
        },
        /** 渲染'provider-b'节点。 */
        render() {
          return h('provider-b')
        },
      })
      const ProviderB = defineCustomElement({
        provide: {
          fooB,
        },
        /** 渲染'my-multi-consumer'节点。 */
        render() {
          return h('my-multi-consumer')
        },
      })

      const Consumer = defineCustomElement({
        /** 执行inject('fooA')；inject('fooB')。setup返回渲染函数：'div'节点（`${fooA.value} ${fooB.value}`）。 */
        setup() {
          const fooA = inject<Ref>('fooA')!
          const fooB = inject<Ref>('fooB')!
          return () => h('div', `${fooA.value} ${fooB.value}`)
        },
      })

      customElements.define('provider-a', ProviderA)
      customElements.define('provider-b', ProviderB)
      customElements.define('my-multi-consumer', Consumer)
      container.innerHTML = `<provider-a><provider-a>`
      const providerA = container.childNodes[0] as VueElement
      const providerB = providerA.shadowRoot!.childNodes[0] as VueElement
      const consumer = providerB.shadowRoot!.childNodes[0] as VueElement

      expect(consumer.shadowRoot!.innerHTML).toBe(`<div>FooA! FooB!</div>`)

      fooA.value = 'changedA!'
      fooB.value = 'changedB!'
      await nextTick()
      expect(consumer.shadowRoot!.innerHTML).toBe(
        `<div>changedA! changedB!</div>`,
      )
    })

    /** 测试场景：GrandParent渲染Parent并经slot投影Consumer，二者都provide foo；Consumer读Parent而非GrandParent，验证assignedSlot/ShadowRoot宿主父级解析。 */
    test('should resolve correct parent when element is slotted in shadow DOM', async () => {
      const GrandParent = defineCustomElement({
        provide: {
          foo: ref('GrandParent'),
        },
        /** 渲染'my-parent-in-shadow'节点（'slot'节点）。 */
        render() {
          return h('my-parent-in-shadow', h('slot'))
        },
      })
      const Parent = defineCustomElement({
        provide: {
          foo: ref('Parent'),
        },
        /** 渲染'slot'节点。 */
        render() {
          return h('slot')
        },
      })
      customElements.define('my-grand-parent', GrandParent)
      customElements.define('my-parent-in-shadow', Parent)
      container.innerHTML = `<my-grand-parent><my-consumer></my-consumer></my-grand-parent>`
      const grandParent = container.childNodes[0] as VueElement,
        consumer = grandParent.firstElementChild as VueElement
      expect(consumer.shadowRoot!.textContent).toBe('Parent')
    })

    // #13212
    /** 测试场景：Outer configureApp提供shared/outer，Inner configureApp覆盖outer并提供inner，Inner.setup再provide inner-child；三层inject分别匹配各上下文并出现一次缺失/覆盖警告，确认继承及局部遮蔽。 */
    test('inherited from app context within nested elements', async () => {
      const outerValues: (string | undefined)[] = []
      const innerValues: (string | undefined)[] = []
      const innerChildValues: (string | undefined)[] = []

      const Outer = defineCustomElement(
        {
          /** 执行outerValues.push(inject<string>('shared'), inject<string>('outer'), inject<string>('inner'))；inject('shared')；inject('outer')；inject('inner')。setup不返回渲染或公开状态。 */
          setup() {
            outerValues.push(
              inject<string>('shared'),
              inject<string>('outer'),
              inject<string>('inner'),
            )
          },
          /** 渲染'div'节点（根数组[renderSlot(this.$slots, 'default')]）。 */
          render() {
            return h('div', [renderSlot(this.$slots, 'default')])
          },
        },
        {
          /** 在自定义元素新建app时配置注入：'shared', 'shared'；'outer', 'outer'。 */
          configureApp(app) {
            app.provide('shared', 'shared')
            app.provide('outer', 'outer')
          },
        },
      )

      const Inner = defineCustomElement(
        {
          /** 执行provide('inner', 'inner-child')；innerValues.push(inject<string>('shared'), inject<string>('outer'), inject<string>('inner'))；inject('shared')；inject('outer')；inject('inner')。setup不返回渲染或公开状态。 */
          setup() {
            // 本组件的 provide 不作为本组件 inject 的来源，注入从父上下文开始。
            provide('inner', 'inner-child')

            innerValues.push(
              inject<string>('shared'),
              inject<string>('outer'),
              inject<string>('inner'),
            )
          },
          /** 渲染'div'节点（根数组[renderSlot(this.$slots, 'default')]）。 */
          render() {
            return h('div', [renderSlot(this.$slots, 'default')])
          },
        },
        {
          /** 在自定义元素新建app时配置注入：'outer', 'override-outer'；'inner', 'inner'。 */
          configureApp(app) {
            app.provide('outer', 'override-outer')
            app.provide('inner', 'inner')
          },
        },
      )

      const InnerChild = defineCustomElement({
        /** 执行innerChildValues.push(inject<string>('shared'), inject<string>('outer'), inject<string>('inner'))；inject('shared')；inject('outer')；inject('inner')。setup不返回渲染或公开状态。 */
        setup() {
          innerChildValues.push(
            inject<string>('shared'),
            inject<string>('outer'),
            inject<string>('inner'),
          )
        },
        /** 渲染'div'节点。 */
        render() {
          return h('div')
        },
      })

      customElements.define('provide-from-app-outer', Outer)
      customElements.define('provide-from-app-inner', Inner)
      customElements.define('provide-from-app-inner-child', InnerChild)

      container.innerHTML =
        '<provide-from-app-outer>' +
        '<provide-from-app-inner>' +
        '<provide-from-app-inner-child></provide-from-app-inner-child>' +
        '</provide-from-app-inner>' +
        '</provide-from-app-outer>'

      const outer = container.childNodes[0] as VueElement
      expect(outer.shadowRoot!.innerHTML).toBe('<div><slot></slot></div>')

      expect('[Vue warn]: injection "inner" not found.').toHaveBeenWarnedTimes(
        1,
      )
      expect(
        '[Vue warn]: App already provides property with key "outer" inherited from its parent element. ' +
          'It will be overwritten with the new value.',
      ).toHaveBeenWarnedTimes(1)

      expect(outerValues).toEqual(['shared', 'outer', undefined])
      expect(innerValues).toEqual(['shared', 'override-outer', 'inner'])
      expect(innerChildValues).toEqual([
        'shared',
        'override-outer',
        'inner-child',
      ])
    })
  })

  // 测试组：自定义元素的组件样式注入、继承与更新。
  describe('styles', () => {
    /** 按ShadowRoot中style节点的DOM顺序读取textContent，与完整CSS数组比较；同时检查注入顺序、去重和HMR旧样式移除。 */
    function assertStyles(el: VueElement, css: string[]) {
      const styles = el.shadowRoot?.querySelectorAll('style')!
      expect(styles.length).toBe(css.length) // 同一个 Bar 类型只注入一份样式，即使挂载两份实例。
      for (let i = 0; i < css.length; i++) {
        expect(styles[i].textContent).toBe(css[i])
      }
    }

    /** 测试场景：根定义styles=red，插入ShadowRoot后检查style文本；HMR改blue/yellow后assertStyles检查两条新样式且旧style移除。 */
    test('should attach styles to shadow dom', async () => {
      const def = defineComponent({
        __hmrId: 'foo',
        styles: [`div { color: red; }`],
        /** 渲染'div'节点（'hello'）。 */
        render() {
          return h('div', 'hello')
        },
      })
      const Foo = defineCustomElement(def)
      customElements.define('my-el-with-styles', Foo)
      container.innerHTML = `<my-el-with-styles></my-el-with-styles>`
      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelector('style')!
      expect(style.textContent).toBe(`div { color: red; }`)

      // HMR 重载定义后刷新组件与 style。
      __VUE_HMR_RUNTIME__.reload('foo', {
        ...def,
        styles: [`div { color: blue; }`, `div { color: yellow; }`],
      } as any)

      await nextTick()
      assertStyles(el, [`div { color: blue; }`, `div { color: yellow; }`])
    })

    /** 测试场景：根渲染同一Bar子组件两次且经过无样式Baz；初始子green/blue样式只注入一组、位于根red前，HMR两次替换子styles后顺序和去重仍正确。 */
    test("child components should inject styles to root element's shadow root", async () => {
      /** 返回Bar节点。 */
      const Baz = () => h(Bar)
      const Bar = defineComponent({
        __hmrId: 'bar',
        styles: [`div { color: green; }`, `div { color: blue; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      const Foo = defineCustomElement({
        styles: [`div { color: red; }`],
        /** 渲染根数组[Baz节点、Baz节点]。 */
        render() {
          return [h(Baz), h(Baz)]
        },
      })
      customElements.define('my-el-with-child-styles', Foo)
      container.innerHTML = `<my-el-with-child-styles></my-el-with-child-styles>`
      const el = container.childNodes[0] as VueElement

      // style 按子组件到父组件的顺序注入。
      assertStyles(el, [
        `div { color: green; }`,
        `div { color: blue; }`,
        `div { color: red; }`,
      ])

      // HMR 重载定义后刷新组件与 style。
      __VUE_HMR_RUNTIME__.reload(Bar.__hmrId!, {
        ...Bar,
        styles: [`div { color: red; }`, `div { color: yellow; }`],
      } as any)

      await nextTick()
      assertStyles(el, [
        `div { color: red; }`,
        `div { color: yellow; }`,
        `div { color: red; }`,
      ])

      __VUE_HMR_RUNTIME__.reload(Bar.__hmrId!, {
        ...Bar,
        styles: [`div { color: blue; }`],
      } as any)
      await nextTick()
      assertStyles(el, [`div { color: blue; }`, `div { color: red; }`])
    })

    /** 测试场景：根带red样式、Child带green；根HMR改blue/yellow后仍保持Child green在根两条样式前，验证根重建的样式排序。 */
    test('root custom element HMR should preserve child-first style order', async () => {
      const Child = defineComponent({
        styles: [`div { color: green; }`],
        /** 渲染'child'。 */
        render() {
          return 'child'
        },
      })
      const def = defineComponent({
        __hmrId: 'root-child-style-order',
        styles: [`div { color: red; }`],
        /** 渲染Child节点。 */
        render() {
          return h(Child)
        },
      })
      const Foo = defineCustomElement(def)
      customElements.define('my-el-root-hmr-style-order', Foo)
      container.innerHTML = `<my-el-root-hmr-style-order></my-el-root-hmr-style-order>`
      const el = container.childNodes[0] as VueElement

      assertStyles(el, [`div { color: green; }`, `div { color: red; }`])

      __VUE_HMR_RUNTIME__.reload(def.__hmrId!, {
        ...def,
        styles: [`div { color: blue; }`, `div { color: yellow; }`],
      } as any)

      await nextTick()
      assertStyles(el, [
        `div { color: green; }`,
        `div { color: blue; }`,
        `div { color: yellow; }`,
      ])
    })

    /** 测试场景：同一Bar经直接Baz及WrapperBar两条路径渲染；样式按Bar green→Wrapper blue→根red排列，重复Bar不重复注入，验证子优先去重。 */
    test('inject child component styles before parent styles', async () => {
      /** 返回Bar节点。 */
      const Baz = () => h(Bar)
      const Bar = defineComponent({
        styles: [`div { color: green; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      const WrapperBar = defineComponent({
        styles: [`div { color: blue; }`],
        /** 渲染Baz节点。 */
        render() {
          return h(Baz)
        },
      })
      /** 返回WrapperBar节点。 */
      const WBaz = () => h(WrapperBar)
      const Foo = defineCustomElement({
        styles: [`div { color: red; }`],
        /** 渲染根数组[Baz节点、WBaz节点]。 */
        render() {
          return [h(Baz), h(WBaz)]
        },
      })
      customElements.define('my-el-with-wrapper-child-styles', Foo)
      container.innerHTML = `<my-el-with-wrapper-child-styles></my-el-with-wrapper-child-styles>`
      const el = container.childNodes[0] as VueElement

      // style 按子组件到父组件的顺序注入。
      assertStyles(el, [
        `div { color: green; }`,
        `div { color: blue; }`,
        `div { color: red; }`,
      ])
    })

    /** 测试场景：Bar green、Wrapper blue、根red，HMR删除Wrapper styles后只留green/red；再把Bar改yellow，保持yellow/red，验证丢失父style锚点后的插入位置。 */
    test('inject nested child component styles after HMR removes parent styles', async () => {
      const Bar = defineComponent({
        __hmrId: 'nested-child-style-hmr-bar',
        styles: [`div { color: green; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      const WrapperBar = defineComponent({
        __hmrId: 'nested-child-style-hmr-wrapper',
        styles: [`div { color: blue; }`],
        /** 渲染Bar节点。 */
        render() {
          return h(Bar)
        },
      })
      const Foo = defineCustomElement({
        styles: [`div { color: red; }`],
        /** 渲染WrapperBar节点。 */
        render() {
          return h(WrapperBar)
        },
      })
      customElements.define('my-el-with-hmr-nested-child-styles', Foo)
      container.innerHTML = `<my-el-with-hmr-nested-child-styles></my-el-with-hmr-nested-child-styles>`
      const el = container.childNodes[0] as VueElement

      assertStyles(el, [
        `div { color: green; }`,
        `div { color: blue; }`,
        `div { color: red; }`,
      ])

      __VUE_HMR_RUNTIME__.reload(WrapperBar.__hmrId!, {
        ...WrapperBar,
        styles: undefined,
      } as any)
      await nextTick()
      assertStyles(el, [`div { color: green; }`, `div { color: red; }`])

      __VUE_HMR_RUNTIME__.reload(Bar.__hmrId!, {
        ...Bar,
        styles: [`div { color: yellow; }`],
      } as any)
      await nextTick()
      assertStyles(el, [`div { color: yellow; }`, `div { color: red; }`])
    })

    /** 测试场景：根无styles，子Bar green和Wrapper blue；挂载后仅两条style按子优先排列，验证没有根style锚点时的注入。 */
    test('inject child component styles when parent has no styles', async () => {
      /** 返回Bar节点。 */
      const Baz = () => h(Bar)
      const Bar = defineComponent({
        styles: [`div { color: green; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      const WrapperBar = defineComponent({
        styles: [`div { color: blue; }`],
        /** 渲染Baz节点。 */
        render() {
          return h(Baz)
        },
      })
      /** 返回WrapperBar节点。 */
      const WBaz = () => h(WrapperBar)
      // 根自定义元素未提供 styles。
      const Foo = defineCustomElement({
        /** 渲染根数组[Baz节点、WBaz节点]。 */
        render() {
          return [h(Baz), h(WBaz)]
        },
      })
      customElements.define('my-el-with-inject-child-styles', Foo)
      container.innerHTML = `<my-el-with-inject-child-styles></my-el-with-inject-child-styles>`
      const el = container.childNodes[0] as VueElement

      assertStyles(el, [`div { color: green; }`, `div { color: blue; }`])
    })

    /** 测试场景：多层Baz/Bar/Wrapper/WBaz含不同styles且共享Bar；assertStyles顺序green/yellow/blue/black/red，验证深层子优先及组件去重。 */
    test('inject nested child component styles', async () => {
      const Baz = defineComponent({
        styles: [`div { color: yellow; }`],
        /** 渲染Bar节点。 */
        render() {
          return h(Bar)
        },
      })
      const Bar = defineComponent({
        styles: [`div { color: green; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      const WrapperBar = defineComponent({
        styles: [`div { color: blue; }`],
        /** 渲染Baz节点。 */
        render() {
          return h(Baz)
        },
      })
      const WBaz = defineComponent({
        styles: [`div { color: black; }`],
        /** 渲染WrapperBar节点。 */
        render() {
          return h(WrapperBar)
        },
      })
      const Foo = defineCustomElement({
        styles: [`div { color: red; }`],
        /** 渲染根数组[Baz节点、WBaz节点]。 */
        render() {
          return [h(Baz), h(WBaz)]
        },
      })
      customElements.define('my-el-with-inject-nested-child-styles', Foo)
      container.innerHTML = `<my-el-with-inject-nested-child-styles></my-el-with-inject-nested-child-styles>`
      const el = container.childNodes[0] as VueElement
      assertStyles(el, [
        `div { color: green; }`,
        `div { color: yellow; }`,
        `div { color: blue; }`,
        `div { color: black; }`,
        `div { color: red; }`,
      ])
    })

    /** 测试场景：shadowRoot=false的根包带styles子组件；el.shadowRoot?.querySelector结果undefined，仅检查没有影子样式节点。 */
    test("child components should not inject styles to root element's shadow root w/ shadowRoot false", async () => {
      const Bar = defineComponent({
        styles: [`div { color: green; }`],
        /** 渲染'bar'。 */
        render() {
          return 'bar'
        },
      })
      /** 返回Bar节点。 */
      const Baz = () => h(Bar)
      const Foo = defineCustomElement(
        {
          /** 渲染根数组[Baz节点]。 */
          render() {
            return [h(Baz)]
          },
        },
        { shadowRoot: false },
      )

      customElements.define('my-foo-with-shadowroot-false', Foo)
      container.innerHTML = `<my-foo-with-shadowroot-false></my-foo-with-shadowroot-false>`
      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelector('style')
      expect(style).toBeUndefined()
    })

    /** 测试场景：根样式注入配置nonce=xxx；ShadowRoot style带nonce=xxx，验证style节点属性。 */
    test('with nonce', () => {
      const Foo = defineCustomElement(
        {
          styles: [`div { color: red; }`],
          /** 渲染'div'节点（'hello'）。 */
          render() {
            return h('div', 'hello')
          },
        },
        { nonce: 'xxx' },
      )
      customElements.define('my-el-with-nonce', Foo)
      container.innerHTML = `<my-el-with-nonce></my-el-with-nonce>`
      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelector('style')!
      expect(style.getAttribute('nonce')).toBe('xxx')
    })
  })

  // 测试组：异步自定义元素定义解析前后的 props、slots、连接与错误处理。
  describe('async', () => {
    /** 测试场景：同一异步定义创建两个元素，loader只调用一次，各自styles+msg正确；e1 attribute再property更新同步到内部DOM和宿主attribute，验证共享加载与实例独立props。 */
    test('should work', async () => {
      const loaderSpy = vi.fn()
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          loaderSpy()
          return Promise.resolve({
            props: ['msg'],
            styles: [`div { color: red }`],
            /** 渲染'div'节点（null；this.msg）。 */
            render(this: any) {
              return h('div', null, this.msg)
            },
          })
        }),
      )
      customElements.define('my-el-async', E)
      container.innerHTML =
        `<my-el-async msg="hello"></my-el-async>` +
        `<my-el-async msg="world"></my-el-async>`

      await new Promise(r => setTimeout(r))

      // 多个元素共享同一定义，loader 只调用一次。
      expect(loaderSpy).toHaveBeenCalledTimes(1)

      const e1 = container.childNodes[0] as VueElement
      const e2 = container.childNodes[1] as VueElement

      // 解析定义后分别向各宿主 ShadowRoot 注入样式。
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style>div { color: red }</style><div>hello</div>`,
      )
      expect(e2.shadowRoot!.innerHTML).toBe(
        `<style>div { color: red }</style><div>world</div>`,
      )

      // 通过 attribute 更新 msg。
      e1.setAttribute('msg', 'attr')
      await nextTick()
      expect((e1 as any).msg).toBe('attr')
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style>div { color: red }</style><div>attr</div>`,
      )

      // 通过 property 更新 msg。
      expect(`msg` in e1).toBe(true)
      ;(e1 as any).msg = 'prop'
      expect(e1.getAttribute('msg')).toBe('prop')
      expect(e1.shadowRoot!.innerHTML).toBe(
        `<style>div { color: red }</style><div>prop</div>`,
      )
    })

    /** 测试场景：异步定义声明msg，e1连接前写hello、e2连接后解析前写world；解析后均保留且后续property立即更新DOM，验证尚无accessor时的属性收集。 */
    test('set DOM property before resolve', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            props: ['msg'],
            /** setup不返回渲染或公开状态。 在此fixture入口检查typeof props.msg，失败直接由expect抛出。 */
            setup(props) {
              expect(typeof props.msg).toBe('string')
            },
            /** 渲染'div'节点（this.msg）。 */
            render(this: any) {
              return h('div', this.msg)
            },
          })
        }),
      )
      customElements.define('my-el-async-2', E)

      const e1 = new E()

      // 连接前写入 property。
      e1.msg = 'hello'

      const e2 = new E()

      container.appendChild(e1)
      container.appendChild(e2)

      // 已连接但定义未解析时写入 property。
      e2.msg = 'world'

      await new Promise(r => setTimeout(r))

      expect(e1.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
      expect(e2.shadowRoot!.innerHTML).toBe(`<div>world</div>`)

      e1.msg = 'world'
      expect(e1.shadowRoot!.innerHTML).toBe(`<div>world</div>`)

      e2.msg = 'hello'
      expect(e2.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
    })

    /** 测试场景：异步定义未解析时Vue render传value对象；解析前后property同引用且无value attribute，完成后显示x=1，验证延迟props定义不丢对象。 */
    test('render object prop before resolve', async () => {
      const AsyncComp = defineComponent({
        props: { value: Object },
        /** 渲染'div'节点（this.value.x）。 */
        render(this: any) {
          return h('div', this.value.x)
        },
      })
      let resolve!: (comp: typeof AsyncComp) => void
      const p = new Promise<typeof AsyncComp>(res => {
        resolve = res
      })
      const E = defineCustomElement(defineAsyncComponent(() => p))
      customElements.define('my-el-async-object-prop', E)

      const root = document.createElement('div')
      document.body.appendChild(root)
      const value = { x: 1 }

      render(h('my-el-async-object-prop', { value }), root)

      const el = root.children[0] as VueElement & {
        /** 异步组件解析前已写入元素property的对象输入{x:1}；用例在解析前后检查同一引用且不生成value attribute。 */
        value: typeof value
      }
      expect(el.value).toBe(value)
      expect(el.getAttribute('value')).toBe(null)

      resolve(AsyncComp)

      await new Promise(r => setTimeout(r))

      expect(el.value).toBe(value)
      expect(el.getAttribute('value')).toBe(null)
      expect(el.shadowRoot!.innerHTML).toBe(`<div>1</div>`)

      render(null, root)
      root.remove()
    })

    /** 测试场景：异步定义尚未知Number声明时HTML n=2e1；解析后setup收到20且DOM报告number，验证补做数值attribute转换。 */
    test('Number prop casting before resolve', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            props: { n: Number },
            /** setup不返回渲染或公开状态。 在此fixture入口检查props.n，失败直接由expect抛出。 */
            setup(props) {
              expect(props.n).toBe(20)
            },
            /** 渲染'div'节点（this.n + ',' + typeof this.n）。 */
            render(this: any) {
              return h('div', this.n + ',' + typeof this.n)
            },
          })
        }),
      )
      customElements.define('my-el-async-3', E)
      container.innerHTML = `<my-el-async-3 n="2e1"></my-el-async-3>`

      await new Promise(r => setTimeout(r))

      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(`<div>20,number</div>`)
    })

    /** 测试场景：异步定义宿主预置默认span，解析后ShadowRoot输出原生default/named slot及fallback；验证异步根的slot结构。 */
    test('with slots', async () => {
      const E = defineCustomElement(
        defineAsyncComponent(() => {
          return Promise.resolve({
            /** 渲染根数组['div'节点（null；根数组[renderSlot(this.$slots, 'default', undefined, () => [ h('div', 'fallback'), ])]）、'div'节点（null；renderSlot(this.$slots, 'named')）]。 */
            render(this: any) {
              return [
                h('div', null, [
                  renderSlot(this.$slots, 'default', undefined, () => [
                    h('div', 'fallback'),
                  ]),
                ]),
                h('div', null, renderSlot(this.$slots, 'named')),
              ]
            },
          })
        }),
      )
      customElements.define('my-el-async-slots', E)
      container.innerHTML = `<my-el-async-slots><span>hi</span></my-el-async-slots>`

      await new Promise(r => setTimeout(r))

      const e = container.childNodes[0] as VueElement
      expect(e.shadowRoot!.innerHTML).toBe(
        `<div><slot><div>fallback</div></slot></div><div><slot name="named"></slot></div>`,
      )
    })
  })

  // 测试组：shadowRoot: false 时直接在自定义元素 light DOM 中渲染和更新。
  describe('shadowRoot: false', () => {
    const E = defineCustomElement({
      shadowRoot: false,
      props: {
        msg: {
          type: String,
          default: 'hello',
        },
      },
      /** 渲染'div'节点（this.msg）。 */
      render() {
        return h('div', this.msg)
      },
    })
    customElements.define('my-el-shadowroot-false', E)

    /** 测试场景：shadowRoot=false的同步定义插入后等requestAnimationFrame；_instance已创建、内容在宿主innerHTML且shadowRoot=null，验证轻DOM挂载。 */
    test('should work', async () => {
      /** 返回下一次requestAnimationFrame完成的Promise，供轻DOM挂载场景等待浏览器帧回调。 */
      function raf() {
        return new Promise(resolve => {
          requestAnimationFrame(resolve)
        })
      }

      container.innerHTML = `<my-el-shadowroot-false></my-el-shadowroot-false>`
      const e = container.childNodes[0] as VueElement
      await raf()
      expect(e).toBeInstanceOf(E)
      expect(e._instance).toBeTruthy()
      expect(e.innerHTML).toBe(`<div>hello</div>`)
      expect(e.shadowRoot).toBe(null)
    })

    const toggle = ref(true)
    const ES = defineCustomElement(
      {
        /** 渲染根数组[renderSlot(this.$slots, 'default')、toggle.value决定renderSlot(this.$slots, 'named')或null、renderSlot(this.$slots, 'omitted', {}, () => [ h('div', 'fallback'), ])]。 */
        render() {
          return [
            renderSlot(this.$slots, 'default'),
            toggle.value ? renderSlot(this.$slots, 'named') : null,
            renderSlot(this.$slots, 'omitted', {}, () => [
              h('div', 'fallback'),
            ]),
          ]
        },
      },
      { shadowRoot: false },
    )
    customElements.define('my-el-shadowroot-false-slots', ES)

    /** 测试场景：shadowRoot=false组件包含default/named/empty slot；宿主默认span和Text被投放、空slot输出fallback，关闭named分支后只删命名内容并留注释。 */
    test('should render slots', async () => {
      container.innerHTML =
        `<my-el-shadowroot-false-slots>` +
        `<span>default</span>text` +
        `<div slot="named">named</div>` +
        `</my-el-shadowroot-false-slots>`
      const e = container.childNodes[0] as VueElement
      // 原生 slot 投影不改变 ShadowRoot.innerHTML；
      // 这里检查原生 slot 与 fallback 结构。
      expect(e.innerHTML).toBe(
        `<span>default</span>text` +
          `<div slot="named">named</div>` +
          `<div>fallback</div>`,
      )

      toggle.value = false
      await nextTick()
      expect(e.innerHTML).toBe(
        `<span>default</span>text` + `<!---->` + `<div>fallback</div>`,
      )
    })

    /** 测试场景：轻DOM父子自定义元素嵌套投放span插槽；刷新后实际child含default span，记录顺序parent rendering/mounted再child rendering/mounted，验证父先处理slots。 */
    test('render nested customElement w/ shadowRoot false', async () => {
      const calls: string[] = []

      const Child = defineCustomElement(
        {
          /** 执行calls.push('child rendering')；注册onMounted回调写入calls.push('child mounted')。setup不返回渲染或公开状态。 */
          setup() {
            calls.push('child rendering')
            onMounted(() => {
              calls.push('child mounted')
            })
          },
          /** 渲染renderSlot(this.$slots, 'default')。 */
          render() {
            return renderSlot(this.$slots, 'default')
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-child', Child)

      const Parent = defineCustomElement(
        {
          /** 执行calls.push('parent rendering')；注册onMounted回调写入calls.push('parent mounted')。setup不返回渲染或公开状态。 */
          setup() {
            calls.push('parent rendering')
            onMounted(() => {
              calls.push('parent mounted')
            })
          },
          /** 渲染renderSlot(this.$slots, 'default')。 */
          render() {
            return renderSlot(this.$slots, 'default')
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-parent', Parent)

      const App = {
        /** 渲染'my-parent'节点（null；插槽{default回调}）。 */
        render() {
          return h('my-parent', null, {
            /** 提供default插槽：根数组['my-child'节点（null；插槽{default回调}）]。 */
            default: () => [
              h('my-child', null, {
                /** 提供default插槽：根数组['span'节点（null；'default'）]。 */
                default: () => [h('span', null, 'default')],
              }),
            ],
          })
        },
      }
      const app = createApp(App)
      app.mount(container)
      await nextTick()
      const e = container.childNodes[0] as VueElement
      expect(e.innerHTML).toBe(
        `<my-child data-v-app=""><span>default</span></my-child>`,
      )
      expect(calls).toEqual([
        'parent rendering',
        'parent mounted',
        'child rendering',
        'child mounted',
      ])
      app.unmount()
    })

    /** 测试场景：轻DOM父子嵌套且Child根为Teleport；刷新后target显示投放的default span，验证替换slot节点跨远端容器。 */
    test('render nested Teleport w/ shadowRoot false', async () => {
      const target = document.createElement('div')
      const Child = defineCustomElement(
        {
          /** 渲染Teleport节点（属性{to: target}；插槽{default回调}）。 */
          render() {
            return h(
              Teleport,
              { to: target },
              {
                /** 提供default插槽：根数组[renderSlot(this.$slots, 'default')]。 */
                default: () => [renderSlot(this.$slots, 'default')],
              },
            )
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-el-teleport-child', Child)
      const Parent = defineCustomElement(
        {
          /** 渲染renderSlot(this.$slots, 'default')。 */
          render() {
            return renderSlot(this.$slots, 'default')
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-el-teleport-parent', Parent)

      const App = {
        /** 渲染'my-el-teleport-parent'节点（null；插槽{default回调}）。 */
        render() {
          return h('my-el-teleport-parent', null, {
            /** 提供default插槽：根数组['my-el-teleport-child'节点（null；插槽{default回调}）]。 */
            default: () => [
              h('my-el-teleport-child', null, {
                /** 提供default插槽：根数组['span'节点（null；'default'）]。 */
                default: () => [h('span', null, 'default')],
              }),
            ],
          })
        },
      }
      const app = createApp(App)
      app.mount(container)
      await nextTick()
      expect(target.innerHTML).toBe(`<span>default</span>`)
      app.unmount()
    })

    /** 测试场景：轻DOMChild有两个Teleport分别使用header/body slot；各target收到对应原轻DOM元素，验证独立远端投放。 */
    test('render two Teleports w/ shadowRoot false', async () => {
      const target1 = document.createElement('div')
      const target2 = document.createElement('span')
      const Child = defineCustomElement(
        {
          /** 渲染根数组[Teleport节点（属性{to: target1}；根数组[renderSlot(this.$slots, 'header')]）、Teleport节点（属性{to: target2}；根数组[renderSlot(this.$slots, 'body')]）]。 */
          render() {
            return [
              h(Teleport, { to: target1 }, [renderSlot(this.$slots, 'header')]),
              h(Teleport, { to: target2 }, [renderSlot(this.$slots, 'body')]),
            ]
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-el-two-teleport-child', Child)

      const App = {
        /** 渲染'my-el-two-teleport-child'节点（null；插槽{default回调}）。 */
        render() {
          return h('my-el-two-teleport-child', null, {
            /** 提供default插槽：根数组['div'节点（属性{slot: 'header'}；'header'）、'span'节点（属性{slot: 'body'}；'body'）]。 */
            default: () => [
              h('div', { slot: 'header' }, 'header'),
              h('span', { slot: 'body' }, 'body'),
            ],
          })
        },
      }
      const app = createApp(App)
      app.mount(container)
      await nextTick()
      expect(target1.outerHTML).toBe(
        `<div><div slot="header">header</div></div>`,
      )
      expect(target2.outerHTML).toBe(
        `<span><span slot="body">body</span></span>`,
      )
      app.unmount()
    })

    /** 测试场景：两个轻DOMTeleport中header禁用、body启用；header target为空、body target含body，确认本地投放不误进入禁用目标。 */
    test('render two Teleports w/ shadowRoot false (with disabled)', async () => {
      const target1 = document.createElement('div')
      const target2 = document.createElement('span')
      const Child = defineCustomElement(
        {
          /** 渲染根数组[Teleport节点（属性{to: target1，disabled: true}；根数组[renderSlot(this.$slots, 'header')]）、Teleport节点（属性{to: target2}；根数组[renderSlot(this.$slots, 'body')]）]。 */
          render() {
            return [
              // 第一个 Teleport 禁用，内容留在轻 DOM 宿主。
              h(Teleport, { to: target1, disabled: true }, [
                renderSlot(this.$slots, 'header'),
              ]),
              h(Teleport, { to: target2 }, [renderSlot(this.$slots, 'body')]),
            ]
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-el-two-teleport-child-0', Child)

      const App = {
        /** 渲染'my-el-two-teleport-child-0'节点（null；插槽{default回调}）。 */
        render() {
          return h('my-el-two-teleport-child-0', null, {
            /** 提供default插槽：根数组['div'节点（属性{slot: 'header'}；'header'）、'span'节点（属性{slot: 'body'}；'body'）]。 */
            default: () => [
              h('div', { slot: 'header' }, 'header'),
              h('span', { slot: 'body' }, 'body'),
            ],
          })
        },
      }
      const app = createApp(App)
      app.mount(container)
      await nextTick()
      expect(target1.outerHTML).toBe(`<div></div>`)
      expect(target2.outerHTML).toBe(
        `<span><span slot="body">body</span></span>`,
      )
      app.unmount()
    })

    /** 测试场景：轻DOMChild Teleport指向包裹自身的#t1祖先；slot header移到祖先末尾，宿主内只留双锚点，验证目标为祖先时的slot区间遍历。 */
    test('teleport target is ancestor of custom element host', async () => {
      const Child = defineCustomElement(
        {
          /** 渲染根数组[Teleport节点（属性{to: '#t1'}；根数组[renderSlot(this.$slots, 'header')]）]。 */
          render() {
            return [
              h(Teleport, { to: '#t1' }, [renderSlot(this.$slots, 'header')]),
            ]
          },
        },
        { shadowRoot: false },
      )
      customElements.define('my-el-teleport-child-target', Child)

      const App = {
        /** 渲染'div'节点（属性{id: 't1'}；根数组['my-el-teleport-child-target'节点（null；插槽{default回调}）]）。 */
        render() {
          return h('div', { id: 't1' }, [
            h('my-el-teleport-child-target', null, {
              /** 提供default插槽：根数组['div'节点（属性{slot: 'header'}；'header'）]。 */
              default: () => [h('div', { slot: 'header' }, 'header')],
            }),
          ])
        },
      }
      const app = createApp(App)
      app.mount(container)

      const target1 = document.getElementById('t1')!
      expect(target1.outerHTML).toBe(
        `<div id="t1">` +
          `<my-el-teleport-child-target data-v-app="">` +
          `<!--teleport start--><!--teleport end-->` +
          `</my-el-teleport-child-target>` +
          `<div slot="header">header</div>` +
          `</div>`,
      )

      app.unmount()
    })

    /** 测试场景：轻DOM父自定义元素以isShown条件包裹slot，内含子元素；true→false→true后插槽child隐藏并恢复，宿主布尔attribute与内容均正确。 */
    test('toggle nested custom element with shadowRoot: false', async () => {
      customElements.define(
        'my-el-child-shadow-false',
        defineCustomElement(
          {
            /** 渲染'div'节点（null；根数组[renderSlot(ctx.$slots, 'default')]）。 */
            render(ctx: any) {
              return h('div', null, [renderSlot(ctx.$slots, 'default')])
            },
          },
          { shadowRoot: false },
        ),
      )
      const ChildWrapper = {
        /** 渲染'my-el-child-shadow-false'节点（null；'child'）。 */
        render() {
          return h('my-el-child-shadow-false', null, 'child')
        },
      }

      customElements.define(
        'my-el-parent-shadow-false',
        defineCustomElement(
          {
            props: {
              isShown: { type: Boolean, required: true },
            },
            /** 渲染$props.isShown决定'div'节点（属性{key: 0}；根数组[renderSlot(ctx.$slots, 'default')]）或null。 */
            render(ctx: any, _: any, $props: any) {
              return $props.isShown
                ? h('div', { key: 0 }, [renderSlot(ctx.$slots, 'default')])
                : null
            },
          },
          { shadowRoot: false },
        ),
      )
      const ParentWrapper = {
        props: {
          isShown: { type: Boolean, required: true },
        },
        /** 渲染'my-el-parent-shadow-false'节点（属性{isShown: $props.isShown}；根数组[renderSlot(ctx.$slots, 'default')]）。 */
        render(ctx: any, _: any, $props: any) {
          return h('my-el-parent-shadow-false', { isShown: $props.isShown }, [
            renderSlot(ctx.$slots, 'default'),
          ])
        },
      }

      const isShown = ref(true)
      const App = {
        /** 渲染ParentWrapper节点（{isShown: isShown.value}；插槽{default回调}）。 */
        render() {
          return h(ParentWrapper, { isShown: isShown.value } as any, {
            /** 提供default插槽：根数组[ChildWrapper节点]。 */
            default: () => [h(ChildWrapper)],
          })
        },
      }
      const container = document.createElement('div')
      document.body.appendChild(container)
      const app = createApp(App)
      app.mount(container)
      expect(container.innerHTML).toBe(
        `<my-el-parent-shadow-false is-shown="" data-v-app="">` +
          `<div>` +
          `<my-el-child-shadow-false data-v-app="">` +
          `<div>child</div>` +
          `</my-el-child-shadow-false>` +
          `</div>` +
          `</my-el-parent-shadow-false>`,
      )

      isShown.value = false
      await nextTick()
      expect(container.innerHTML).toBe(
        `<my-el-parent-shadow-false data-v-app=""><!----></my-el-parent-shadow-false>`,
      )

      isShown.value = true
      await nextTick()
      expect(container.innerHTML).toBe(
        `<my-el-parent-shadow-false data-v-app="" is-shown="">` +
          `<div>` +
          `<my-el-child-shadow-false data-v-app="">` +
          `<div>child</div>` +
          `</my-el-child-shadow-false>` +
          `</div>` +
          `</my-el-parent-shadow-false>`,
      )
    })
  })

  // 测试组：useHost 与 useShadowRoot 等自定义元素上下文辅助 API。
  describe('helpers', () => {
    /** 测试场景：setup调用useHost并设置id=host；插入后实际自定义元素宿主id为host，验证当前宿主访问。 */
    test('useHost', () => {
      const Foo = defineCustomElement({
        /** 执行useHost()。setup返回渲染函数：'div'节点（'hello'）。 */
        setup() {
          const host = useHost()!
          host.setAttribute('id', 'host')
          return () => h('div', 'hello')
        },
      })
      customElements.define('my-el-use-host', Foo)
      container.innerHTML = `<my-el-use-host>`
      const el = container.childNodes[0] as VueElement
      expect(el.id).toBe('host')
    })

    /** 测试场景：setup用useShadowRoot手动append style；插入后ShadowRoot内查询到原样CSS文本，验证当前影子根访问。 */
    test('useShadowRoot for style injection', () => {
      const Foo = defineCustomElement({
        /** 执行useShadowRoot()；style.innerHTML=`div { color: red; }`。setup返回渲染函数：'div'节点（'hello'）。 */
        setup() {
          const root = useShadowRoot()!
          const style = document.createElement('style')
          style.innerHTML = `div { color: red; }`
          root.appendChild(style)
          return () => h('div', 'hello')
        },
      })
      customElements.define('my-el-use-shadow-root', Foo)
      container.innerHTML = `<my-el-use-shadow-root>`
      const el = container.childNodes[0] as VueElement
      const style = el.shadowRoot?.querySelector('style')!
      expect(style.textContent).toBe(`div { color: red; }`)
    })
  })

  // 测试组：setup expose 和 Options API expose 映射为自定义元素实例方法。
  describe('expose', () => {
    /** 测试场景：Options API expose仅foo方法，foo递增data.value；宿主e.foo可调用，内部div由0更新1，验证方法暴露。 */
    test('expose w/ options api', async () => {
      const E = defineCustomElement({
        /** 初始化组件状态为{value: 0}，供本例渲染和事件更新读取。 */
        data() {
          return {
            value: 0,
          }
        },
        methods: {
          /** 递增组件内部value状态；宿主通过expose公开的foo调用此方法，下一轮div文本由0变1。 */
          foo() {
            ;(this as any).value++
          },
        },
        expose: ['foo'],
        /** 渲染'div'节点（null；_ctx.value）。 */
        render(_ctx: any) {
          return h('div', null, _ctx.value)
        },
      })
      customElements.define('my-el-expose-options-api', E)

      container.innerHTML = `<my-el-expose-options-api></my-el-expose-options-api>`
      const e = container.childNodes[0] as VueElement & {
        /** Options API expose=[foo]公开到元素宿主的可调用方法；用例调用后组件内部value递增。 */
        foo: () => void
      }
      expect(e.shadowRoot!.innerHTML).toBe(`<div>0</div>`)
      e.foo()
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>1</div>`)
    })
    /** 测试场景：setup expose ref value和spy setValue；宿主getter读hello、函数与spy同对象，调用后立即读world并刷新DOM，验证ref自动解包及函数身份。 */
    test('expose attributes and callback', async () => {
      /** 自定义元素通过 expose 暴露给宿主调用的测试方法签名。 */
      type SetValue = (value: string) => void
      let fn: MockedFunction<SetValue>

      const E = defineCustomElement({
        /** 建立value=hello及可写value的spy函数setValue，通过expose公开二者；返回读取value的div渲染函数，供宿主调用公开方法后检查DOM更新。 */
        setup(_, { expose }) {
          const value = ref('hello')

          const setValue = (fn = vi.fn((_value: string) => {
            value.value = _value
          }))

          expose({
            setValue,
            value,
          })

          return () => h('div', null, [value.value])
        },
      })
      customElements.define('my-el-expose', E)

      container.innerHTML = `<my-el-expose></my-el-expose>`
      const e = container.childNodes[0] as VueElement & {
        /** setup经expose公开的value ref在宿主getter上自动解包为字符串；setValue修改后读取到world。 */
        value: string
        /** setup暴露的spy写入函数，接收新字符串并修改组件value ref。 */
        setValue: MockedFunction<SetValue>
      }
      expect(e.shadowRoot!.innerHTML).toBe(`<div>hello</div>`)
      expect(e.value).toBe('hello')
      expect(e.setValue).toBe(fn!)
      e.setValue('world')
      expect(e.value).toBe('world')
      await nextTick()
      expect(e.shadowRoot!.innerHTML).toBe(`<div>world</div>`)
    })

    /** 测试场景：声明value prop又expose同名value；连接时报告exposed property already exists警告，验证避免覆盖既有property。 */
    test('warning when exposing an existing property', () => {
      const E = defineCustomElement({
        props: {
          value: String,
        },
        /** 执行expose({value: 'hello'})。setup返回渲染函数：'div'节点（null；根数组[props.value]）。 */
        setup(props, { expose }) {
          expose({
            value: 'hello',
          })

          return () => h('div', null, [props.value])
        },
      })
      customElements.define('my-el-expose-two', E)

      container.innerHTML = `<my-el-expose-two value="world"></my-el-expose-two>`

      expect(
        `[Vue warn]: Exposed property "value" already exists on custom element.`,
      ).toHaveBeenWarned()
    })
  })

  /** 测试场景：异步父provide foo，轻DOM包装div内有同步Consumer；父解析后slot结构正确且Consumer注入foo，验证子定义等待父ready。 */
  test('async & nested custom elements', async () => {
    let fooVal: string | undefined = ''
    const E = defineCustomElement(
      defineAsyncComponent(() => {
        return Promise.resolve({
          /** 执行provide('foo', 'foo')。setup不返回渲染或公开状态。 */
          setup(props) {
            provide('foo', 'foo')
          },
          /** 渲染'div'节点（null；根数组[renderSlot(this.$slots, 'default')]）。 */
          render(this: any) {
            return h('div', null, [renderSlot(this.$slots, 'default')])
          },
        })
      }),
    )

    const EChild = defineCustomElement({
      /** 执行fooVal=inject('foo')；inject('foo')。setup不返回渲染或公开状态。 */
      setup(props) {
        fooVal = inject('foo')
      },
      /** 渲染'div'节点（null；'child'）。 */
      render(this: any) {
        return h('div', null, 'child')
      },
    })
    customElements.define('my-el-async-nested-ce', E)
    customElements.define('slotted-child', EChild)
    container.innerHTML = `<my-el-async-nested-ce><div><slotted-child></slotted-child></div></my-el-async-nested-ce>`

    await new Promise(r => setTimeout(r))
    const e = container.childNodes[0] as VueElement
    expect(e.shadowRoot!.innerHTML).toBe(`<div><slot></slot></div>`)
    expect(fooVal).toBe('foo')
  })

  /** 测试场景：异步祖先provide foo、中层provide bar、最深子注入二者；父解析后两值可用，验证多层等待与provide继承。 */
  test('async & multiple levels of nested custom elements', async () => {
    let fooVal: string | undefined = ''
    let barVal: string | undefined = ''
    const E = defineCustomElement(
      defineAsyncComponent(() => {
        return Promise.resolve({
          /** 执行provide('foo', 'foo')。setup不返回渲染或公开状态。 */
          setup(props) {
            provide('foo', 'foo')
          },
          /** 渲染'div'节点（null；根数组[renderSlot(this.$slots, 'default')]）。 */
          render(this: any) {
            return h('div', null, [renderSlot(this.$slots, 'default')])
          },
        })
      }),
    )

    const EChild = defineCustomElement({
      /** 执行provide('bar', 'bar')。setup不返回渲染或公开状态。 */
      setup(props) {
        provide('bar', 'bar')
      },
      /** 渲染'div'节点（null；根数组[renderSlot(this.$slots, 'default')]）。 */
      render(this: any) {
        return h('div', null, [renderSlot(this.$slots, 'default')])
      },
    })

    const EChild2 = defineCustomElement({
      /** 执行fooVal=inject('foo')；inject('foo')；barVal=inject('bar')；inject('bar')。setup不返回渲染或公开状态。 */
      setup(props) {
        fooVal = inject('foo')
        barVal = inject('bar')
      },
      /** 渲染'div'节点（null；'child'）。 */
      render(this: any) {
        return h('div', null, 'child')
      },
    })
    customElements.define('my-el-async-nested-m-ce', E)
    customElements.define('slotted-child-m', EChild)
    customElements.define('slotted-child2-m', EChild2)
    container.innerHTML =
      `<my-el-async-nested-m-ce>` +
      `<div><slotted-child-m>` +
      `<slotted-child2-m></slotted-child2-m>` +
      `</slotted-child-m></div>` +
      `</my-el-async-nested-m-ce>`

    await new Promise(r => setTimeout(r))
    const e = container.childNodes[0] as VueElement
    expect(e.shadowRoot!.innerHTML).toBe(`<div><slot></slot></div>`)
    expect(fooVal).toBe('foo')
    expect(barVal).toBe('bar')
  })

  /** 测试场景：三层定义都异步，先resolve Inner与Outer、最后Middle；mounted顺序outer/middle/inner且最深显示foo/bar，验证解析次序不改变祖先先挂载。 */
  test('nested async custom elements should mount ancestor-first', async () => {
    const mounted: string[] = []
    const OuterComp = defineComponent({
      /** 执行provide('foo', 'foo')。setup不返回渲染或公开状态。 */
      setup() {
        provide('foo', 'foo')
      },
      /** 组件挂载时向mounted数组加入'outer'，核对嵌套自定义元素挂载先后。 */
      mounted() {
        mounted.push('outer')
      },
      /** 渲染'slot'节点。 */
      render() {
        return h('slot')
      },
    })
    const MiddleComp = defineComponent({
      /** 执行provide('bar', 'bar')。setup不返回渲染或公开状态。 */
      setup() {
        provide('bar', 'bar')
      },
      /** 组件挂载时向mounted数组加入'middle'，核对嵌套自定义元素挂载先后。 */
      mounted() {
        mounted.push('middle')
      },
      /** 渲染'slot'节点。 */
      render() {
        return h('slot')
      },
    })
    const InnerComp = defineComponent({
      /** 执行inject('foo')；inject('bar')。setup返回渲染函数：'div'节点（`${foo}/${bar}`）。 */
      setup() {
        const foo = inject('foo')
        const bar = inject('bar')
        return () => h('div', `${foo}/${bar}`)
      },
      /** 组件挂载时向mounted数组加入'inner'，核对嵌套自定义元素挂载先后。 */
      mounted() {
        mounted.push('inner')
      },
    })
    let resolveOuter!: (comp: typeof OuterComp) => void
    let resolveMiddle!: (comp: typeof MiddleComp) => void
    let resolveInner!: (comp: typeof InnerComp) => void
    const outerReady = new Promise<typeof OuterComp>(resolve => {
      resolveOuter = resolve
    })
    const middleReady = new Promise<typeof MiddleComp>(resolve => {
      resolveMiddle = resolve
    })
    const innerReady = new Promise<typeof InnerComp>(resolve => {
      resolveInner = resolve
    })

    const Outer = defineCustomElement(defineAsyncComponent(() => outerReady))
    const Middle = defineCustomElement(defineAsyncComponent(() => middleReady))
    const Inner = defineCustomElement(defineAsyncComponent(() => innerReady))

    customElements.define('async-chain-outer', Outer)
    customElements.define('async-chain-middle', Middle)
    customElements.define('async-chain-inner', Inner)
    container.innerHTML =
      `<async-chain-outer>` +
      `<async-chain-middle>` +
      `<async-chain-inner></async-chain-inner>` +
      `</async-chain-middle>` +
      `</async-chain-outer>`

    resolveInner(InnerComp)
    resolveOuter(OuterComp)
    await new Promise(resolve => setTimeout(resolve))
    resolveMiddle(MiddleComp)
    await new Promise(resolve => setTimeout(resolve))

    const inner = container.querySelector('async-chain-inner') as VueElement
    expect(mounted).toEqual(['outer', 'middle', 'inner'])
    expect(inner.shadowRoot!.innerHTML).toBe('<div>foo/bar</div>')
  })

  /** 测试场景：Child等待异步Parent时先移除Child，Parent解析后Child仍不mounted且ShadowRoot空；重新插入才mounted一次显示child，验证ready恢复检查连接状态。 */
  test('should not resolve nested custom element after disconnect', async () => {
    const mounted = vi.fn()
    const ParentComp = defineComponent({
      /** 渲染'slot'节点。 */
      render() {
        return h('slot')
      },
    })
    let resolveParent!: (comp: typeof ParentComp) => void
    const parentReady = new Promise<typeof ParentComp>(resolve => {
      resolveParent = resolve
    })
    const Parent = defineCustomElement(defineAsyncComponent(() => parentReady))
    const Child = defineCustomElement({
      mounted,
      /** 渲染'div'节点（'child'）。 */
      render() {
        return h('div', 'child')
      },
    })

    customElements.define('async-disconnect-parent', Parent)
    customElements.define('async-disconnect-child', Child)
    container.innerHTML =
      `<async-disconnect-parent>` +
      `<async-disconnect-child></async-disconnect-child>` +
      `</async-disconnect-parent>`

    const parent = container.firstChild as VueElement
    const child = parent.firstChild as VueElement
    child.remove()
    resolveParent(ParentComp)
    await new Promise(resolve => setTimeout(resolve))

    expect(mounted).not.toHaveBeenCalled()
    expect(child.shadowRoot!.innerHTML).toBe('')

    parent.appendChild(child)
    expect(mounted).toHaveBeenCalledOnce()
    expect(child.shadowRoot!.innerHTML).toBe('<div>child</div>')
  })

  // 测试组：configureApp 在自定义元素应用创建时安装插件和全局配置。
  describe('configureApp', () => {
    /** 测试场景：直接setup函数inject msg，configureApp预先provide app-injected；内部div显示该值，验证挂载前应用配置。 */
    test('should work', () => {
      const E = defineCustomElement(
        () => {
          const msg = inject('msg')
          return () => h('div', msg!)
        },
        {
          /** 在自定义元素新建app时配置注入：'msg', 'app-injected'。 */
          configureApp(app) {
            app.provide('msg', 'app-injected')
          },
        },
      )
      customElements.define('my-element-with-app', E)

      container.innerHTML = `<my-element-with-app></my-element-with-app>`
      const e = container.childNodes[0] as VueElement

      expect(e.shadowRoot?.innerHTML).toBe('<div>app-injected</div>')
    })

    // #12448
    /** 测试场景：异步组件render inject msg，configureApp提供app-injected；等待解析后显示该值，确认异步定义保留configureApp。 */
    test('work with async component', async () => {
      const AsyncComp = defineAsyncComponent(() => {
        return Promise.resolve({
          /** 渲染'div'节点（属性{}；msg）。 */
          render() {
            const msg: string | undefined = inject('msg')
            return h('div', {}, msg)
          },
        } as any)
      })
      const E = defineCustomElement(AsyncComp, {
        /** 在自定义元素新建app时配置注入：'msg', 'app-injected'。 */
        configureApp(app) {
          app.provide('msg', 'app-injected')
        },
      })
      customElements.define('my-async-element-with-app', E)

      container.innerHTML = `<my-async-element-with-app></my-async-element-with-app>`
      const e = container.childNodes[0] as VueElement
      await new Promise(r => setTimeout(r))
      expect(e.shadowRoot?.innerHTML).toBe('<div>app-injected</div>')
    })

    /** 测试场景：configureApp提供msg并设置globalProperties.$foo，根HMR reload同定义；更新前后DOM都显示注入值和全局属性，验证重建应用重新应用配置。 */
    test('with hmr reload', async () => {
      const __hmrId = '__hmrWithApp'
      const def = defineComponent({
        __hmrId,
        /** 执行inject('msg')。setup返回{msg}。 */
        setup() {
          const msg = inject('msg')
          return { msg }
        },
        /** 渲染'div'节点（根数组['span'节点（this.msg）、'span'节点（this.$foo）]）。 */
        render(this: any) {
          return h('div', [h('span', this.msg), h('span', this.$foo)])
        },
      })
      const E = defineCustomElement(def, {
        /** 在自定义元素新建app时配置注入：'msg', 'app-injected'；并将globalProperties.$foo设为foo。 */
        configureApp(app) {
          app.provide('msg', 'app-injected')
          app.config.globalProperties.$foo = 'foo'
        },
      })
      customElements.define('my-element-with-app-hmr', E)

      container.innerHTML = `<my-element-with-app-hmr></my-element-with-app-hmr>`
      const el = container.childNodes[0] as VueElement
      expect(el.shadowRoot?.innerHTML).toBe(
        `<div><span>app-injected</span><span>foo</span></div>`,
      )

      // HMR 重载定义后刷新组件与 style。
      __VUE_HMR_RUNTIME__.reload(__hmrId, def as any)

      await nextTick()
      expect(el.shadowRoot?.innerHTML).toBe(
        `<div><span>app-injected</span><span>foo</span></div>`,
      )
    })
  })

  // #9885
  /** 测试场景：宿主onVnodeMounted立即写声明value property；ShadowRoot恰为单个hello文本，此例检查渲染结果不重复，没有mount计数spy。 */
  test('avoid double mount when prop is set immediately after mount', () => {
    customElements.define(
      'my-input-dupe',
      defineCustomElement({
        props: {
          value: String,
        },
        /** 渲染'hello'。 */
        render() {
          return 'hello'
        },
      }),
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    createApp({
      /** 渲染'div'节点（根数组['my-input-dupe'节点（属性{onVnodeMounted(vnode) { vnode.el!.value = 'fesfes' }}）]）。 */
      render() {
        return h('div', [
          h('my-input-dupe', {
            /** 执行vnode.el!.value='fesfes'。无返回值。 */
            onVnodeMounted(vnode) {
              vnode.el!.value = 'fesfes'
            },
          }),
        ])
      },
    }).mount(container)
    expect(container.children[0].children[0].shadowRoot?.innerHTML).toBe(
      'hello',
    )
  })

  // #11081
  /** 测试场景：Vue父render用camelCase fooValue向异步自定义元素传字符串；解析后setup收到fooValue并DOM同值，验证早期props收集，此例无Number转换断言。 */
  test('Props can be casted when mounting custom elements in component rendering functions', async () => {
    const E = defineCustomElement(
      defineAsyncComponent(() =>
        Promise.resolve({
          props: ['fooValue'],
          /** setup返回渲染函数：'div'节点（props.fooValue）。 在此fixture入口检查props.fooValue，失败直接由expect抛出。 */
          setup(props) {
            expect(props.fooValue).toBe('fooValue')
            return () => h('div', props.fooValue)
          },
        }),
      ),
    )
    customElements.define('my-el-async-4', E)
    const R = defineComponent({
      /** 建立fooValue=ref('fooValue')。setup返回渲染函数：'div'节点（null；根数组['my-el-async-4'节点（属性{fooValue: fooValue.value}）]）。 */
      setup() {
        const fooValue = ref('fooValue')
        return () => {
          return h('div', null, [
            h('my-el-async-4', {
              fooValue: fooValue.value,
            }),
          ])
        }
      },
    })

    const app = createApp(R)
    app.mount(container)
    await new Promise(r => setTimeout(r))
    const e = container.querySelector('my-el-async-4') as VueElement
    expect(e.shadowRoot!.innerHTML).toBe(`<div>fooValue</div>`)
    app.unmount()
  })

  // #11276
  /** 测试场景：Boolean boo初始空attribute得到true；removeAttribute后内部显示false,boolean，验证删除props键后重新执行布尔缺省。 */
  test('delete prop on attr removal', async () => {
    const E = defineCustomElement({
      props: {
        boo: {
          type: Boolean,
        },
      },
      /** 渲染this.boo + ',' + typeof this.boo。 */
      render() {
        return this.boo + ',' + typeof this.boo
      },
    })
    customElements.define('el-attr-removal', E)
    container.innerHTML = '<el-attr-removal boo>'
    const e = container.childNodes[0] as VueElement
    expect(e.shadowRoot!.innerHTML).toBe(`true,boolean`)
    e.removeAttribute('boo')
    await nextTick()
    expect(e.shadowRoot!.innerHTML).toBe(`false,boolean`)
  })

  /** 测试场景：声明tagName与原生property冲突，attribute初始化foo；渲染/property均foo并警告覆盖，验证冲突诊断与声明值生效。 */
  test('prop name conflicts with native property', () => {
    const E = defineCustomElement({
      props: {
        tagName: {
          type: String,
        },
      },
      /** 渲染this.tagName。 */
      render() {
        return this.tagName
      },
    })
    customElements.define('el-attr-tag-name', E)
    container.innerHTML = '<el-attr-tag-name tag-name="foo">'
    const e = container.childNodes[0] as VueElement
    expect(e.shadowRoot!.innerHTML).toBe(`foo`)
    expect(e.tagName).toBe('foo')
    expect(
      `[Vue warn]: Custom element prop "tagName" conflicts with an existing property on the element and will overwrite it.`,
    ).toHaveBeenWarned()
  })

  /** 测试场景：声明id与反射原生property冲突，attribute初始foo再改bar；内部DOM和e.id均bar并有覆盖警告，验证使用原生attribute方法避免反射递归。 */
  test('prop name conflicts with reflected native property', async () => {
    const E = defineCustomElement({
      props: {
        id: String,
      },
      /** 渲染this.id。 */
      render() {
        return this.id
      },
    })
    customElements.define('el-attr-id', E)
    container.innerHTML = '<el-attr-id id="foo">'
    const e = container.childNodes[0] as VueElement

    e.setAttribute('id', 'bar')
    await nextTick()
    expect(e.shadowRoot!.innerHTML).toBe(`bar`)
    expect(e.id).toBe('bar')
    expect(
      `[Vue warn]: Custom element prop "id" conflicts with an existing property on the element and will overwrite it.`,
    ).toHaveBeenWarned()
  })

  /** 测试场景：声明hasAttribute:Object覆盖原生方法，Vue render以连字符键传对象；DOM显示foo、property同对象且警告覆盖，验证内部原生方法借用不被同名prop破坏。 */
  test('native method conflict when rendered by Vue', () => {
    const value = { text: 'foo' }
    const E = defineCustomElement({
      props: {
        hasAttribute: Object,
      },
      /** 渲染this.hasAttribute!.text。 */
      render() {
        return this.hasAttribute!.text
      },
    })
    customElements.define('el-vue-has-attribute', E)

    render(
      h('el-vue-has-attribute', {
        'has-attribute': value,
      }),
      container,
    )

    const e = container.firstChild as VueElement
    expect(e.shadowRoot!.innerHTML).toBe('foo')
    expect((e as any).hasAttribute).toBe(value)
    expect(
      `[Vue warn]: Custom element prop "hasAttribute" conflicts with an existing property on the element and will overwrite it.`,
    ).toHaveBeenWarned()
  })

  /** 测试场景：fooBar:Boolean由Vue render传foo-bar空串，toggle=false后传null；宿主attribute删除且outerHTML准确，验证连字符布尔反射移除。 */
  test('hyphenated attr removal', async () => {
    const E = defineCustomElement({
      props: {
        fooBar: {
          type: Boolean,
        },
      },
      /** 渲染this.fooBar。 */
      render() {
        return this.fooBar
      },
    })
    customElements.define('el-hyphenated-attr-removal', E)
    const toggle = ref(true)
    const Comp = {
      /** 渲染'el-hyphenated-attr-removal'节点（属性{'foo-bar': toggle.value ? '' : null}）。 */
      render() {
        return h('el-hyphenated-attr-removal', {
          'foo-bar': toggle.value ? '' : null,
        })
      },
    }
    render(h(Comp), container)
    const el = container.children[0]
    expect(el.hasAttribute('foo-bar')).toBe(true)
    expect((el as any).outerHTML).toBe(
      `<el-hyphenated-attr-removal foo-bar=""></el-hyphenated-attr-removal>`,
    )

    toggle.value = false
    await nextTick()
    expect(el.hasAttribute('foo-bar')).toBe(false)
    expect((el as any).outerHTML).toBe(
      `<el-hyphenated-attr-removal></el-hyphenated-attr-removal>`,
    )
  })

  /** 测试场景：向defineCustomElement传原始Foo选项并配置shadowRoot=false；调用后Foo仍只含name字段，验证不修改首参对象。 */
  test('no unexpected mutation of the 1st argument', () => {
    const Foo = {
      name: 'Foo',
    }

    defineCustomElement(Foo, { shadowRoot: false })

    expect(Foo).toEqual({
      name: 'Foo',
    })
  })
})
