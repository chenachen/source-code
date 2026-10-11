/**
 * 通过连续 render、模板更新和开发期警告，验证 props/attrs 分流、类型转换、默认值与声明合并。
 */
/**
 * @vitest-environment jsdom
 */

import {
  type ComponentInternalInstance,
  type FunctionalComponent,
  type SetupContext,
  createApp,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  nextTick,
  nodeOps,
  provide,
  ref,
  render,
  serializeInner,
  toRefs,
  watch,
} from '@vue/runtime-test'
import { render as domRender } from 'vue'

// 有状态与函数式组件的 props/attrs 分流，以及 prop 声明的转换和校验。
describe('component props', () => {
  // 通过公共实例读取声明的 props；连续 render 检查连字符键归一化、更新与移除，未声明输入进入 attrs。
  test('stateful', () => {
    let props: any
    let attrs: any
    let proxy: any

    const Comp = defineComponent({
      props: ['fooBar', 'barBaz'],
      /**
       * 同时记录 `props`、`attrs`、`proxy` 供 render 后的断言检查。
       */
      render() {
        props = this.$props
        attrs = this.$attrs
        proxy = this
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Comp, { fooBar: 1, bar: 2 }), root)
    expect(proxy.fooBar).toBe(1)
    expect(props).toEqual({ fooBar: 1 })
    expect(attrs).toEqual({ bar: 2 })

    // 父输入连字符键匹配 camelCase 声明。
    render(h(Comp, { 'foo-bar': 2, bar: 3, baz: 4 }), root)
    expect(proxy.fooBar).toBe(2)
    expect(props).toEqual({ fooBar: 2 })
    expect(attrs).toEqual({ bar: 3, baz: 4 })

    // #955：更新连字符输入时，不应误把 camelCase 内部 prop 当作已移除。
    render(h(Comp, { 'foo-bar': 3, bar: 3, baz: 4, barBaz: 5 }), root)
    expect(proxy.fooBar).toBe(3)
    expect(proxy.barBaz).toBe(5)
    expect(props).toEqual({ fooBar: 3, barBaz: 5 })
    expect(attrs).toEqual({ bar: 3, baz: 4 })

    render(h(Comp, { qux: 5 }), root)
    expect(proxy.fooBar).toBeUndefined()
    // #1412：旧 camelCase 输入移除后，公共实例值恢复为 undefined。
    expect(proxy.barBaz).toBeUndefined()
    expect(props).toEqual({})
    expect(attrs).toEqual({ qux: 5 })
  })

  // setup 捕获的 props 与 attrs 随连续 render 更新，已移除的输入也被清理。
  test('stateful with setup', () => {
    let props: any
    let attrs: any

    const Comp = defineComponent({
      props: ['foo'],
      /**
       * 返回空渲染闭包，不创建宿主内容。
       */
      setup(_props, { attrs: _attrs }) {
        return () => {
          props = _props
          attrs = _attrs
        }
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Comp, { foo: 1, bar: 2 }), root)
    expect(props).toEqual({ foo: 1 })
    expect(attrs).toEqual({ bar: 2 })

    render(h(Comp, { foo: 2, bar: 3, baz: 4 }), root)
    expect(props).toEqual({ foo: 2 })
    expect(attrs).toEqual({ bar: 3, baz: 4 })

    render(h(Comp, { qux: 5 }), root)
    expect(props).toEqual({})
    expect(attrs).toEqual({ qux: 5 })
  })

  // 函数式组件声明 Comp.props 后，只接收声明的 foo，其他输入进入 attrs。
  test('functional with declaration', () => {
    let props: any
    let attrs: any

    /**
     * 修改或记录 `props`、`attrs`。
     */
    const Comp: FunctionalComponent = (_props, { attrs: _attrs }) => {
      props = _props
      attrs = _attrs
    }
    Comp.props = ['foo']

    const root = nodeOps.createElement('div')
    render(h(Comp, { foo: 1, bar: 2 }), root)
    expect(props).toEqual({ foo: 1 })
    expect(attrs).toEqual({ bar: 2 })

    render(h(Comp, { foo: 2, bar: 3, baz: 4 }), root)
    expect(props).toEqual({ foo: 2 })
    expect(attrs).toEqual({ bar: 3, baz: 4 })

    render(h(Comp, { qux: 5 }), root)
    expect(props).toEqual({})
    expect(attrs).toEqual({ qux: 5 })
  })

  // 未声明 props 的函数式组件接收全部 attrs；两次 render 都验证 props 与 attrs 是同一对象。
  test('functional without declaration', () => {
    let props: any
    let attrs: any
    /**
     * 修改或记录 `props`、`attrs`。
     */
    const Comp: FunctionalComponent = (_props, { attrs: _attrs }) => {
      props = _props
      attrs = _attrs
    }
    const root = nodeOps.createElement('div')

    render(h(Comp, { foo: 1 }), root)
    expect(props).toEqual({ foo: 1 })
    expect(attrs).toEqual({ foo: 1 })
    expect(props).toBe(attrs)

    render(h(Comp, { bar: 2 }), root)
    expect(props).toEqual({ bar: 2 })
    expect(attrs).toEqual({ bar: 2 })
    expect(props).toBe(attrs)
  })

  // Boolean prop 缺失时为 false，空字符串和同名字符串为 true；其他字符串保留原值并触发类型警告。
  test('boolean casting', () => {
    let proxy: any
    const Comp = {
      props: {
        foo: Boolean,
        bar: Boolean,
        baz: Boolean,
        qux: Boolean,
      },
      /**
       * 同时记录 `proxy` 供 render 后的断言检查。
       */
      render() {
        proxy = this
      },
    }
    render(
      h(Comp, {
        // 未传 foo，应解析为 false。
        bar: '', // 空字符串按 Boolean attribute 解析为 true。
        baz: 'baz', // 与 prop 名相同的字符串解析为 true。
        qux: 'ok', // other values should be left in-tact (but raise warning)
      }),
      nodeOps.createElement('div'),
    )

    expect(proxy.foo).toBe(false)
    expect(proxy.bar).toBe(true)
    expect(proxy.baz).toBe(true)
    expect(proxy.qux).toBe('ok')
    expect('type check failed for prop "qux"').toHaveBeenWarned()
  })

  // 传值覆盖默认值；对象默认工厂只调用一次并复用结果，Function 类型的默认函数直接作为值保留。
  test('default value', () => {
    let proxy: any
    const defaultFn = vi.fn(() => ({ a: 1 }))
    const defaultBaz = vi.fn(() => ({ b: 1 }))

    const Comp = {
      props: {
        foo: {
          default: 1,
        },
        bar: {
          default: defaultFn,
        },
        baz: {
          type: Function,
          default: defaultBaz,
        },
      },
      /**
       * 同时记录 `proxy` 供 render 后的断言检查。
       */
      render() {
        proxy = this
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp, { foo: 2 }), root)
    expect(proxy.foo).toBe(2)
    const prevBar = proxy.bar
    expect(proxy.bar).toEqual({ a: 1 })
    expect(proxy.baz).toEqual(defaultBaz)
    expect(defaultFn).toHaveBeenCalledTimes(1)
    expect(defaultBaz).toHaveBeenCalledTimes(0)

    // #999：只更新 foo，不应再次执行未改变的 bar 默认值工厂。
    // 缓存的 bar 默认对象应保持同一引用。
    render(h(Comp, { foo: 3 }), root)
    expect(proxy.foo).toBe(3)
    expect(proxy.bar).toEqual({ a: 1 })
    expect(proxy.bar).toBe(prevBar)
    expect(defaultFn).toHaveBeenCalledTimes(1)

    render(h(Comp, { bar: { b: 2 } }), root)
    expect(proxy.foo).toBe(1)
    expect(proxy.bar).toEqual({ b: 2 })
    expect(defaultFn).toHaveBeenCalledTimes(1)

    render(h(Comp, { foo: 3, bar: { b: 3 } }), root)
    expect(proxy.foo).toBe(3)
    expect(proxy.bar).toEqual({ b: 3 })
    expect(defaultFn).toHaveBeenCalledTimes(1)

    render(h(Comp, { bar: { b: 4 } }), root)
    expect(proxy.foo).toBe(1)
    expect(proxy.bar).toEqual({ b: 4 })
    expect(defaultFn).toHaveBeenCalledTimes(1)
  })

  // 默认值工厂调用 inject，读取父组件 provide 的 test 并渲染 injected。
  test('using inject in default value factory', () => {
    const Child = defineComponent({
      props: {
        test: {
          /**
           * prop 默认值工厂 返回 `inject('test', 'default')`。
           */
          default: () => inject('test', 'default'),
        },
      },
      /**
       * 返回渲染闭包，执行时产出 `h('div', props.test)`。
       */
      setup(props) {
        return () => {
          return h('div', props.test)
        }
      },
    })

    const Comp = {
      /**
       * 调用 `provide('test', 'injected')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Child)`。
       */
      setup() {
        provide('test', 'injected')
        return () => h(Child)
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>injected</div>`)
  })

  // 用主 Vue 入口编译模板，分别更新声明的 foo 和未声明的 id，检查文本与根元素属性。
  test('optimized props updates', async () => {
    const Child = defineComponent({
      props: ['foo'],
      template: `<div>{{ foo }}</div>`,
    })

    const foo = ref(1)
    const id = ref('a')

    const Comp = defineComponent({
      /**
       * 返回 `foo`、`id` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          foo,
          id,
        }
      },
      components: { Child },
      template: `<Child :foo="foo" :id="id"/>`,
    })

    // 使用主 Vue 入口 domRender，让模板经过运行时编译。
    // 编译产物提供 patchFlag/dynamicProps，覆盖优化更新分支。
    const root = document.createElement('div')
    domRender(h(Comp), root)
    expect(root.innerHTML).toBe('<div id="a">1</div>')

    foo.value++
    await nextTick()
    expect(root.innerHTML).toBe('<div id="a">2</div>')

    id.value = 'b'
    await nextTick()
    expect(root.innerHTML).toBe('<div id="b">2</div>')
  })

  // 自定义 validator 的参数与只读约束。
  describe('validator', () => {
    // validator 接收当前 prop 值，以及包含 foo、bar 的完整 props 对象。
    test('validator should be called with two arguments', async () => {
      const mockFn = vi.fn((...args: any[]) => true)
      const Comp = defineComponent({
        props: {
          foo: {
            type: Number,
            /**
             * prop/事件校验器 返回 `mockFn(value, props)`。
             */
            validator: (value, props) => mockFn(value, props),
          },
          bar: {
            type: Number,
          },
        },
        template: `<div />`,
      })

      // 使用主 Vue 入口 domRender，让模板经过运行时编译。
      // 编译产物提供 patchFlag/dynamicProps，覆盖优化更新分支。
      const root = document.createElement('div')
      domRender(h(Comp, { foo: 1, bar: 2 }), root)
      expect(mockFn).toHaveBeenCalledWith(1, { foo: 1, bar: 2 })
    })

    // foo 的 validator 尝试改写 bar 时发出只读警告，bar 的 validator 仍收到原值 2。
    test('validator should not be able to mutate other props', async () => {
      const mockFn = vi.fn((...args: any[]) => true)
      const Comp = defineComponent({
        props: {
          foo: {
            type: Number,
            /**
             * 修改或记录 `props.bar`；prop/事件校验器 返回 `!!(props.bar = 1)`。
             */
            validator: (value, props) => !!(props.bar = 1),
          },
          bar: {
            type: Number,
            /**
             * prop/事件校验器 返回 `mockFn(value)`。
             */
            validator: value => mockFn(value),
          },
        },
        template: `<div />`,
      })

      // 使用主 Vue 入口 domRender，让模板经过运行时编译。
      // 编译产物提供 patchFlag/dynamicProps，覆盖优化更新分支。
      const root = document.createElement('div')
      domRender(h(Comp, { foo: 1, bar: 2 }), root)
      expect(
        `Set operation on key "bar" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()
      expect(mockFn).toHaveBeenCalledWith(2)
    })
  })

  //#12011
  // 初次挂载分别传入两种含数字的连字符键，均不触发 hasB4BProp 的必填缺失警告。
  test('replace camelize with hyphenate to handle props key', () => {
    const Comp = {
      props: {
        hasB4BProp: { type: Boolean, required: true },
      },
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
    }
    render(
      h('div', {}, [
        h(Comp, {
          'has-b-4-b-prop': true,
        }),
        h(Comp, {
          'has-b4-b-prop': true,
        }),
      ]),
      nodeOps.createElement('div'),
    )
    expect(`Missing required prop: "hasB4BProp"`).not.toHaveBeenWarned()
  })

  // 修改 setup 的 props 发出只读警告；通过公共实例改写 prop 则警告并抛出 TypeError。
  test('warn props mutation', () => {
    let instance: ComponentInternalInstance
    let setupProps: any
    const Comp = {
      props: ['foo'],
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance`、`setupProps` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup(props: any) {
        instance = getCurrentInstance()!
        setupProps = props
        return () => null
      },
    }
    render(h(Comp, { foo: 1 }), nodeOps.createElement('div'))
    expect(setupProps.foo).toBe(1)
    expect(instance!.props.foo).toBe(1)
    setupProps.foo = 2
    expect(`Set operation on key "foo" failed`).toHaveBeenWarned()
    expect(() => {
      ;(instance!.proxy as any).foo = 2
    }).toThrow(TypeError)
    expect(`Attempting to mutate prop "foo"`).toHaveBeenWarned()
    // 新增非 prop 的同名 Object 原型方法不应被当成只读 prop。
    expect(() => {
      /** 空自定义方法赋值探针，验证非 prop 键可写入公共实例，不触发只读 prop 的 TypeError。 */
      ;(instance!.proxy as any).hasOwnProperty = () => {}
    }).not.toThrow(TypeError)
  })

  // 未传入 required 的 Boolean、String、Number props 时，分别发出必填缺失警告。
  test('warn absent required props', () => {
    const Comp = {
      props: {
        bool: { type: Boolean, required: true },
        str: { type: String, required: true },
        num: { type: Number, required: true },
      },
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(`Missing required prop: "bool"`).toHaveBeenWarned()
    expect(`Missing required prop: "str"`).toHaveBeenWarned()
    expect(`Missing required prop: "num"`).toHaveBeenWarned()
  })

  // 逐项检查运行时值与声明类型不匹配的警告，并覆盖 skipCheck 和空类型数组。
  test('warn on type mismatch', () => {
    /**
     * 自定义 prop 构造器夹具；传入普通对象以检查 instanceof 类型不匹配的警告。
     */
    class MyClass {}
    const Comp = {
      props: {
        bool: { type: Boolean },
        str: { type: String },
        symStr: { type: String },
        sym: { type: Symbol },
        num: { type: Number },
        arr: { type: Array },
        obj: { type: Object },
        cls: { type: MyClass },
        fn: { type: Function },
        skipCheck: { type: [Boolean, Function], skipCheck: true },
        empty: { type: [] },
      },
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
    }
    render(
      h(Comp, {
        bool: 'true',
        str: 100,
        symStr: Symbol(),
        sym: 'symbol',
        num: '100',
        arr: {},
        obj: 'false',
        cls: {},
        fn: true,
        skipCheck: 'foo',
        empty: [1, 2, 3],
      }),
      nodeOps.createElement('div'),
    )
    expect(
      `Invalid prop: type check failed for prop "bool". Expected Boolean, got String`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "str". Expected String with value "100", got Number with value 100.`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "symStr". Expected String, got Symbol`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "sym". Expected Symbol, got String with value "symbol".`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "num". Expected Number with value 100, got String with value "100".`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "arr". Expected Array, got Object`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "obj". Expected Object, got String with value "false"`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "fn". Expected Function, got Boolean with value true.`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "cls". Expected MyClass, got Object`,
    ).toHaveBeenWarned()
    expect(
      `Invalid prop: type check failed for prop "skipCheck". Expected Boolean | Function, got String with value "foo".`,
    ).not.toHaveBeenWarned()
    expect(
      `Prop type [] for prop "empty" won't match anything. Did you mean to use type Array instead?`,
    ).toHaveBeenWarned()
  })

  // #3495
  // 声明 required 的 fooBar，传入 foo-bar 后不应再报必填缺失。
  test('should not warn required props using kebab-case', async () => {
    const Comp = {
      props: {
        fooBar: { type: String, required: true },
      },
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
    }
    render(
      h(Comp, {
        'foo-bar': 'hello',
      }),
      nodeOps.createElement('div'),
    )
    expect(`Missing required prop: "fooBar"`).not.toHaveBeenWarned()
  })

  // 组件、两个局部 mixin 和 extends 的 prop 声明共同进入 setup props 与公共实例 $props。
  test('merging props from mixins and extends', () => {
    let setupProps: any
    let renderProxy: any

    const E = {
      props: ['base'],
    }
    const M1 = {
      props: ['m1'],
    }
    const M2 = {
      props: { m2: null },
    }
    const Comp = {
      props: ['self'],
      mixins: [M1, M2],
      extends: E,
      /**
       * 把 `setupProps` 写入本例的状态或观察变量。
       */
      setup(props: any) {
        setupProps = props
      },
      /**
       * 渲染结果为 `h('div', [this.self, this.base, this.m1, this.m2])`；同时记录 `renderProxy` 供 render 后的断言检查。
       */
      render(this: any) {
        renderProxy = this
        return h('div', [this.self, this.base, this.m1, this.m2])
      },
    }

    const root = nodeOps.createElement('div')
    const props = {
      self: 'from self, ',
      base: 'from base, ',
      m1: 'from mixin 1, ',
      m2: 'from mixin 2',
    }
    render(h(Comp, props), root)

    expect(serializeInner(root)).toMatch(
      `from self, from base, from mixin 1, from mixin 2`,
    )
    expect(setupProps).toMatchObject(props)
    expect(renderProxy.$props).toMatchObject(props)
  })

  // 两个全局 mixin 的 prop 声明与组件自身声明合并，并在 setup 和公共实例中可读。
  test('merging props from global mixins', () => {
    let setupProps: any
    let renderProxy: any

    const M1 = {
      props: ['m1'],
    }
    const M2 = {
      props: { m2: null },
    }
    const Comp = {
      props: ['self'],
      /**
       * 把 `setupProps` 写入本例的状态或观察变量。
       */
      setup(props: any) {
        setupProps = props
      },
      /**
       * 渲染结果为 `h('div', [this.self, this.m1, this.m2])`；同时记录 `renderProxy` 供 render 后的断言检查。
       */
      render(this: any) {
        renderProxy = this
        return h('div', [this.self, this.m1, this.m2])
      },
    }

    const props = {
      self: 'from self, ',
      m1: 'from mixin 1, ',
      m2: 'from mixin 2',
    }
    const app = createApp(Comp, props)
    app.mixin(M1)
    app.mixin(M2)

    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(serializeInner(root)).toMatch(
      `from self, from mixin 1, from mixin 2`,
    )
    expect(setupProps).toMatchObject(props)
    expect(renderProxy.$props).toMatchObject(props)
  })

  // 同一全局 mixin 的 prop 默认值分别应用到基础组件和通过 extends 继承它的组件。
  test('merging props from global mixins and extends', () => {
    let renderProxy: any
    let extendedRenderProxy: any

    const defaultProp = ' from global'
    const props = {
      globalProp: {
        type: String,
        default: defaultProp,
      },
    }
    const globalMixin = {
      props,
    }
    const Comp = {
      /**
       * 渲染结果为 `h('div', ['Comp', this.globalProp])`；同时记录 `renderProxy` 供 render 后的断言检查。
       */
      render(this: any) {
        renderProxy = this
        return h('div', ['Comp', this.globalProp])
      },
    }
    const ExtendedComp = {
      extends: Comp,
      /**
       * 渲染结果为 `h('div', ['ExtendedComp', this.globalProp])`；同时记录 `extendedRenderProxy` 供 render 后的断言检查。
       */
      render(this: any) {
        extendedRenderProxy = this
        return h('div', ['ExtendedComp', this.globalProp])
      },
    }

    const app = createApp(
      {
        /**
         * 渲染结果为 `[h(ExtendedComp), h(Comp)]`。
         */
        render: () => [h(ExtendedComp), h(Comp)],
      },
      {},
    )
    app.mixin(globalMixin)

    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(serializeInner(root)).toMatch(
      `<div>ExtendedComp from global</div><div>Comp from global</div>`,
    )
    expect(renderProxy.$props).toMatchObject({ globalProp: defaultProp })
    expect(extendedRenderProxy.$props).toMatchObject({
      globalProp: defaultProp,
    })
  })

  // CompA 同时作为组件和 mixin 使用；独立渲染采用全局默认值，CompB 中局部 mixin 的默认值胜出。
  test('merging props for a component that is also used as a mixin', () => {
    const CompA = {
      /**
       * 渲染结果为 `this.foo`。
       */
      render(this: any) {
        return this.foo
      },
    }

    const mixin = {
      props: {
        foo: {
          default: 'from mixin',
        },
      },
    }

    const CompB = {
      mixins: [mixin, CompA],
      /**
       * 渲染结果为 `this.foo`。
       */
      render(this: any) {
        return this.foo
      },
    }

    const app = createApp({
      /**
       * 渲染结果为 `[h(CompA), ', ', h(CompB)]`。
       */
      render() {
        return [h(CompA), ', ', h(CompB)]
      },
    })

    app.mixin({
      props: {
        foo: {
          default: 'from global mixin',
        },
      },
    })

    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(serializeInner(root)).toMatch(`from global mixin, from mixin`)
  })

  // 声明 BigInt 类型的 prop，传入计算所得 BigInt 并检查渲染出的精确数字字符串。
  test('props type support BigInt', () => {
    const Comp = {
      props: {
        foo: BigInt,
      },
      /**
       * 渲染结果为 `h('div', [this.foo])`。
       */
      render(this: any) {
        return h('div', [this.foo])
      },
    }

    const root = nodeOps.createElement('div')
    render(
      h(Comp, {
        foo: BigInt(BigInt(100000111)) + BigInt(2000000000) * BigInt(30000000),
      }),
      root,
    )

    expect(serializeInner(root)).toMatch('<div>60000000100000111</div>')
  })

  // #3474
  // foo 始终传入 undefined，只更新 bar；watch(props.foo) 不触发，说明默认工厂结果保持同一引用。
  test('should cache the value returned from the default factory to avoid unnecessary watcher trigger', async () => {
    let count = 0
    const Comp = {
      props: {
        foo: {
          type: Object,
          /**
           * prop 默认值工厂 返回 `({ val: 1 })`。
           */
          default: () => ({ val: 1 }),
        },
        bar: Number,
      },
      /**
       * 调用 `watch(() => props.foo, () => { count++; })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('h1', [props.foo.val, props.bar])`。
       */
      setup(props: any) {
        watch(
          () => props.foo,
          () => {
            count++
          },
        )
        return () => h('h1', [props.foo.val, props.bar])
      },
    }

    const foo = ref()
    const bar = ref(0)
    const app = createApp({
      /**
       * 渲染结果为 `h(Comp, { foo: foo.value, bar: bar.value })`。
       */
      render: () => h(Comp, { foo: foo.value, bar: bar.value }),
    })

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toMatch(`<h1>10</h1>`)
    expect(count).toBe(0)

    bar.value++
    await nextTick()
    expect(serializeInner(root)).toMatch(`<h1>11</h1>`)
    expect(count).toBe(0)
  })

  // #3288
  // foo 未传入时仍存在于 Object.keys(props)，toRefs 为它创建的 ref 能监听后续传值。
  test('declared prop key should be present even if not passed', async () => {
    let initialKeys: string[] = []
    const changeSpy = vi.fn()
    const passFoo = ref(false)

    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      props: {
        foo: String,
      },
      /**
       * 调用 `watch(foo, changeSpy)` 完成本例的初始化登记或读取；把 `initialKeys` 写入本例的状态或观察变量。
       */
      setup(props: any) {
        initialKeys = Object.keys(props)
        const { foo } = toRefs(props)
        watch(foo, changeSpy)
      },
    }

    /**
     * 返回 `(passFoo.value ? h(Comp, { foo: 'ok' }) : h(Comp))`。
     */
    const Parent = () => (passFoo.value ? h(Comp, { foo: 'ok' }) : h(Comp))
    const root = nodeOps.createElement('div')
    createApp(Parent).mount(root)

    expect(initialKeys).toMatchObject(['foo'])
    passFoo.value = true
    await nextTick()
    expect(changeSpy).toHaveBeenCalledTimes(1)
  })

  // #3371
  // 父组件渲染时读取子组件的 Boolean prop；传入空字符串的子组件完成挂载与更新队列后仍输出 foo。
  test(`avoid double-setting props when casting`, async () => {
    const Parent = {
      /**
       * 调用 `provide('register', registerChildProps)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `slots.default!()`。
       */
      setup(props: any, { slots }: SetupContext) {
        const childProps = ref()
        /**
         * 把子组件 props 对象写入父级 childProps ref，让父 render 随后主动读取 Boolean prop，复现重复赋值可能产生的更新循环。
         */
        const registerChildProps = (props: any) => {
          childProps.value = props
        }
        provide('register', registerChildProps)

        return () => {
          // 父 render 主动读取子 props，建立可能被重复赋值触发的依赖。
          childProps.value && childProps.value.foo
          return slots.default!()
        }
      },
    }

    const Child = {
      props: {
        foo: {
          type: Boolean,
          required: false,
        },
      },
      /**
       * 调用 `inject('register')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `'foo'`。
       */
      setup(props: { foo: boolean }) {
        const register = inject('register') as any
        // register 将子 props 写入父级 childProps ref。
        // 父 render 随后读取这个对象，最终输出必须仍能稳定刷新。
        register(props)

        return () => 'foo'
      },
    }

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `h(Parent, () => h(Child as any, { foo: '' }, () => null))`。
       */
      setup() {
        return () => h(Parent, () => h(Child as any, { foo: '' }, () => null))
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    await nextTick()
    expect(serializeInner(root)).toBe(`foo`)
  })

  // required prop 的类型数组包含 Function 与 null，分别传入函数和 null 均不抛错。
  test('support null in required + multiple-type declarations', () => {
    const Comp = {
      props: {
        foo: { type: [Function, null], required: true },
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    }
    const root = nodeOps.createElement('div')
    expect(() => {
      render(
        h(Comp, {
          /** 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。 */ foo: () => {}
        }),
        root
      )
    }).not.toThrow()

    expect(() => {
      render(h(Comp, { foo: null }), root)
    }).not.toThrow()
  })

  // #5016
  // 值为 undefined 的 foo 仍保留在 attrs 的键集合中，后续更新为字符串也能正确渲染。
  test('handling attr with undefined value', () => {
    const Comp = {
      /**
       * 渲染结果为 `JSON.stringify(this.$attrs) + Object.keys(this.$attrs)`。
       */
      render(this: any) {
        return JSON.stringify(this.$attrs) + Object.keys(this.$attrs)
      },
    }
    const root = nodeOps.createElement('div')

    let attrs: any = { foo: undefined }

    render(h(Comp, attrs), root)
    expect(serializeInner(root)).toBe(
      JSON.stringify(attrs) + Object.keys(attrs),
    )

    render(h(Comp, (attrs = { foo: 'bar' })), root)
    expect(serializeInner(root)).toBe(
      JSON.stringify(attrs) + Object.keys(attrs),
    )
  })

  // #691ef
  // 挂载后原始 props.msg 仍只有 type 一个键，归一化过程没有往声明对象写入内部字段。
  test('should not mutate original props long-form definition object', () => {
    const props = {
      msg: {
        type: String,
      },
    }
    const Comp = defineComponent({
      props,
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    })

    const root = nodeOps.createElement('div')

    render(h(Comp, { msg: 'test' }), root)

    expect(Object.keys(props.msg).length).toBe(1)
  })

  // 将 key、ref 和 $foo 声明为 prop，分别检查保留名称警告。
  test('should warn against reserved prop names', () => {
    const Comp = defineComponent({
      props: {
        key: String,
        ref: String,
        $foo: String,
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    })

    const root = nodeOps.createElement('div')

    render(h(Comp, { msg: 'test' }), root)

    expect(`Invalid prop name: "key"`).toHaveBeenWarned()
    expect(`Invalid prop name: "ref"`).toHaveBeenWarned()
    expect(`Invalid prop name: "$foo"`).toHaveBeenWarned()
  })

  // #5517
  // Child 声明 event 后，模板的 onEvent 监听器在初次挂载与 foo 更新后都不进入 setup props。
  test('events should not be props when component updating', async () => {
    let props: any
    /**
     * 编译模板的事件处理器占位，Child 声明 event 后该监听器应由 emits 消费；本用例不实际发送事件。
     */
    function eventHandler() {}
    const foo = ref(1)

    const Child = defineComponent({
      /**
       * 把 `props` 写入本例的状态或观察变量。
       */
      setup(_props) {
        props = _props
      },
      emits: ['event'],
      props: ['foo'],
      template: `<div>{{ foo }}</div>`,
    })

    const Comp = defineComponent({
      /**
       * 返回 `foo`、`eventHandler` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          foo,
          eventHandler,
        }
      },
      components: { Child },
      template: `<Child @event="eventHandler" :foo="foo" />`,
    })

    const root = document.createElement('div')
    domRender(h(Comp), root)
    expect(props).not.toHaveProperty('onEvent')

    foo.value++
    await nextTick()
    expect(props).not.toHaveProperty('onEvent')
  })
})
