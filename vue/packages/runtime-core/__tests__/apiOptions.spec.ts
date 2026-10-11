/**
 * 挂载 Options API 组件，验证状态更新、watch 回调、依赖注入、生命周期顺序和选项合并结果。
 */
/**
 * @vitest-environment jsdom
 */
import type { Mock } from 'vitest'
import {
  type TestElement,
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  renderToString,
  serializeInner,
  triggerEvent,
} from '@vue/runtime-test'
import { render as domRender } from 'vue'

// Options API 的初始化、更新与选项合并。
describe('api: options', () => {
  // data 返回的 foo 通过 this 参与渲染，点击递增后从 1 更新为 2。
  test('data', async () => {
    const Comp = defineComponent({
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
      /**
       * 渲染结果为 `h('div', { onClick: () => { this.foo++; }, }, this.foo)`。
       */
      render() {
        return h(
          'div',
          {
            /**
             * 修改或记录 `this.foo`。
             */
            onClick: () => {
              this.foo++
            },
          },
          this.foo,
        )
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>1</div>`)

    triggerEvent(root.children[0] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>2</div>`)
  })

  // 普通 computed getter 通过 this 读取 foo，箭头 getter 通过 vm 读取 bar；点击改变 foo 后渲染结果由 5 变为 7。
  test('computed', async () => {
    const Comp = defineComponent({
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
      computed: {
        /**
         * 返回 `this.foo + 1`。
         */
        bar(): number {
          return this.foo + 1
        },
        /**
         * 返回 `vm.bar + 1`。
         */
        baz: (vm: any): number => vm.bar + 1,
      },
      /**
       * 渲染结果为 `h('div', { onClick: () => { this.foo++; }, }, this.bar + this.baz)`。
       */
      render() {
        return h(
          'div',
          {
            /**
             * 修改或记录 `this.foo`。
             */
            onClick: () => {
              this.foo++
            },
          },
          this.bar + this.baz,
        )
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>5</div>`)

    triggerEvent(root.children[0] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>7</div>`)
  })

  // methods 作为事件回调仍绑定组件 this；data 中重新绑定 incBy 的参数后，两次事件分别递增 1 和 2。
  test('methods', async () => {
    const Comp = defineComponent({
      /**
       * 建立每实例初始 data：`{ foo: 1, }`；并记录 `this.incBy` 供外层检查。
       */
      data() {
        // #3300：data 初始化期间可重新赋值 ctx 中已绑定的方法。
        this.incBy = this.incBy.bind(this, 2)
        return {
          foo: 1,
        }
      },
      methods: {
        /**
         * 作为 click 回调递增 this.foo，脱离直接方法调用时仍应绑定组件公共 this。
         */
        inc() {
          this.foo++
        },
        /**
         * 把 this.foo 增加 n；data 中预绑定 n=2 后，foo 事件即使不传参数仍应增加 2。
         */
        incBy(n = 0) {
          this.foo += n
        },
      },
      /**
       * 渲染结果为 `h('div', { onClick: this.inc, onFoo: this.incBy, }, this.foo)`。
       */
      render() {
        return h(
          'div',
          {
            onClick: this.inc,
            onFoo: this.incBy,
          },
          this.foo,
        )
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>1</div>`)

    triggerEvent(root.children[0] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>2</div>`)

    triggerEvent(root.children[0] as TestElement, 'foo')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>4</div>`)
  })

  // 组件 methods.foo 与 globalProperties.foo 同名时，渲染调用组件方法并得到 foo。
  test("component's own methods have higher priority than global properties", async () => {
    const app = createApp({
      methods: {
        /**
         * 返回 `'foo'`。
         */
        foo() {
          return 'foo'
        },
      },
      /**
       * 渲染结果为 `this.foo()`。
       */
      render() {
        return this.foo()
      },
    })
    /**
     * 提供返回 bar 的全局同名函数，与组件 methods.foo 返回 foo 竞争；渲染结果用来判断查找优先级。
     */
    app.config.globalProperties.foo = () => 'bar'

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe(`foo`)
  })

  // watch 覆盖方法名、函数、handler 对象、deep 与点路径；逐次改值检查新旧值和回调 this。
  test('watch', async () => {
    /**
     * 返回实际回调 this，供 spy.mock.results 检查 watcher 是否绑定组件公共实例。
     */
    function returnThis(this: any) {
      return this
    }
    const spyA = vi.fn(returnThis)
    const spyB = vi.fn(returnThis)
    const spyC = vi.fn(returnThis)
    const spyD = vi.fn(returnThis)
    const spyE = vi.fn(returnThis)

    let ctx: any
    const Comp = {
      /**
       * 建立每实例初始 data：`{ foo: 1, bar: 2, baz: { qux: 3, }, qux: 4, dot: { path: 5, }, }`。
       */
      data() {
        return {
          foo: 1,
          bar: 2,
          baz: {
            qux: 3,
          },
          qux: 4,
          dot: {
            path: 5,
          },
        }
      },
      watch: {
        // 处理器使用 methods 中的方法名。
        foo: 'onFooChange',
        // 直接使用函数作为处理器。
        bar: spyB,
        baz: {
          handler: spyC,
          deep: true,
        },
        qux: {
          handler: 'onQuxChange',
        },
        'dot.path': spyE,
      },
      methods: {
        onFooChange: spyA,
        onQuxChange: spyD,
      },
      /**
       * 同时记录 `ctx` 供 render 后的断言检查。
       */
      render() {
        ctx = this
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    /**
     * 检查指定次 spy 回调的前两个参数内容和返回的 this；callIndex 选择记录，args 只比较新旧值，不约束 cleanup 参数。
     */
    function assertCall(spy: Mock, callIndex: number, args: any[]) {
      expect(spy.mock.calls[callIndex].slice(0, 2)).toMatchObject(args)
      expect(spy.mock.results[callIndex].value).toBe(ctx)
    }

    ctx.foo++
    await nextTick()
    expect(spyA).toHaveBeenCalledTimes(1)
    assertCall(spyA, 0, [2, 1])

    ctx.bar++
    await nextTick()
    expect(spyB).toHaveBeenCalledTimes(1)
    assertCall(spyB, 0, [3, 2])

    ctx.baz.qux++
    await nextTick()
    expect(spyC).toHaveBeenCalledTimes(1)
    // 深度修改未替换源对象，新旧参数都表示当前同一对象内容；此断言比较内容。
    assertCall(spyC, 0, [{ qux: 4 }, { qux: 4 }])

    ctx.qux++
    await nextTick()
    expect(spyD).toHaveBeenCalledTimes(1)
    assertCall(spyD, 0, [5, 4])

    ctx.dot.path++
    await nextTick()
    expect(spyE).toHaveBeenCalledTimes(1)
    assertCall(spyE, 0, [6, 5])
  })

  // watch 的处理器数组支持方法名、函数与 deep 对象写法，逐次改值检查回调参数和 this。
  test('watch array', async () => {
    /**
     * 数组形式 watch 的回调探针，返回调用时 this，检查处理器展开后仍绑定同一组件。
     */
    function returnThis(this: any) {
      return this
    }
    const spyA = vi.fn(returnThis)
    const spyB = vi.fn(returnThis)
    const spyC = vi.fn(returnThis)

    let ctx: any
    const Comp = {
      /**
       * 建立每实例初始 data：`{ foo: 1, bar: 2, baz: { qux: 3, }, }`。
       */
      data() {
        return {
          foo: 1,
          bar: 2,
          baz: {
            qux: 3,
          },
        }
      },
      watch: {
        // 处理器使用 methods 中的方法名。
        foo: ['onFooChange'],
        // 直接使用函数作为处理器。
        bar: [spyB],
        baz: [
          {
            handler: spyC,
            deep: true,
          },
        ],
      },
      methods: {
        onFooChange: spyA,
      },
      /**
       * 同时记录 `ctx` 供 render 后的断言检查。
       */
      render() {
        ctx = this
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    /**
     * 为数组 watch 处理器检查新旧值与回调 this；读取 mock 指定次调用和返回记录，不额外触发 watcher。
     */
    function assertCall(spy: Mock, callIndex: number, args: any[]) {
      expect(spy.mock.calls[callIndex].slice(0, 2)).toMatchObject(args)
      expect(spy.mock.results[callIndex].value).toBe(ctx)
    }

    ctx.foo++
    await nextTick()
    expect(spyA).toHaveBeenCalledTimes(1)
    assertCall(spyA, 0, [2, 1])

    ctx.bar++
    await nextTick()
    expect(spyB).toHaveBeenCalledTimes(1)
    assertCall(spyB, 0, [3, 2])

    ctx.baz.qux++
    await nextTick()
    expect(spyC).toHaveBeenCalledTimes(1)
    // 深度修改未替换源对象，新旧参数都表示当前同一对象内容；此断言比较内容。
    assertCall(spyC, 0, [{ qux: 4 }, { qux: 4 }])
  })

  // #3966
  // 两个 mixin 与组件共同监听 obj；改值后，三个处理器都把各自字段更新为 bar。
  test('watch merging from mixins', async () => {
    const mixinA = {
      /**
       * 建立每实例初始 data：`{ fromMixinA: '', }`。
       */
      data() {
        return {
          fromMixinA: '',
        }
      },
      watch: {
        obj: {
          /**
           * 修改或记录 `this.fromMixinA`。
           */
          handler(this: any, to: any) {
            this.fromMixinA = to
          },
        },
      },
    }

    const mixinB = {
      /**
       * 建立每实例初始 data：`{ fromMixinB: '', }`。
       */
      data() {
        return {
          fromMixinB: '',
        }
      },
      watch: {
        obj: 'setMixinB',
      },
      methods: {
        /**
         * 修改或记录 `this.fromMixinB`。
         */
        setMixinB(this: any, to: any) {
          this.fromMixinB = to
        },
      },
    }

    let vm: any
    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      mixins: [mixinA, mixinB],
      /**
       * 建立每实例初始 data：`({ obj: 'foo', fromComp: '', })`。
       */
      data: () => ({
        obj: 'foo',
        fromComp: '',
      }),
      watch: {
        /**
         * 修改或记录 `this.fromComp`。
         */
        obj(this: any, to: any) {
          this.fromComp = to
        },
      },
      /**
       * 在 mounted 阶段写入 `vm` 供后续观察或触发更新。
       */
      mounted() {
        vm = this
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    vm.obj = 'bar'
    await nextTick()
    expect(vm.fromComp).toBe('bar')
    expect(vm.fromMixinA).toBe('bar')
    expect(vm.fromMixinB).toBe('bar')
  })

  // provide 提供字符串和 Symbol 键；inject 覆盖数组、别名、from 及普通值或工厂默认值。
  test('provide/inject', () => {
    const symbolKey = Symbol()
    const Root = defineComponent({
      /**
       * 建立每实例初始 data：`{ a: 1, }`。
       */
      data() {
        return {
          a: 1,
        }
      },
      /**
       * 返回 `a`、`[symbolKey]` 作为此组件的祖先提供值，让后代 inject 读取。
       */
      provide() {
        return {
          a: this.a,
          [symbolKey]: 2,
        }
      },
      /**
       * 渲染结果为 `[ h(ChildA), h(ChildB), h(ChildC), h(ChildD), h(ChildE), h(ChildF), h(ChildG), h(ChildH), h(ChildI), h(ChildJ), ]`。
       */
      render() {
        return [
          h(ChildA),
          h(ChildB),
          h(ChildC),
          h(ChildD),
          h(ChildE),
          h(ChildF),
          h(ChildG),
          h(ChildH),
          h(ChildI),
          h(ChildJ),
        ]
      },
    })

    /**
     * 按给定 inject 声明创建消费组件，render 读取 injectedKey；让数组、别名、默认值与 Symbol 来源共用同一输出探针。
     */
    const defineChild = (injectOptions: any, injectedKey = 'b') =>
      ({
        inject: injectOptions,
        /**
         * 渲染结果为 `this[injectedKey]`。
         */
        render() {
          return this[injectedKey]
        },
      }) as any

    const ChildA = defineChild(['a'], 'a')
    const ChildB = defineChild({ b: 'a' })
    const ChildC = defineChild({
      b: {
        from: 'a',
      },
    })
    const ChildD = defineChild(
      {
        a: {
          /**
           * prop 默认值工厂 返回 `0`。
           */
          default: () => 0,
        },
      },
      'a',
    )
    const ChildE = defineChild({
      b: {
        from: 'c',
        default: 2,
      },
    })
    const ChildF = defineChild({
      b: {
        from: 'c',
        /**
         * prop 默认值工厂 返回 `3`。
         */
        default: () => 3,
      },
    })
    const ChildG = defineChild({
      b: {
        default: 4,
      },
    })
    const ChildH = defineChild({
      b: {
        /**
         * prop 默认值工厂 返回 `5`。
         */
        default: () => 5,
      },
    })
    const ChildI = defineChild({
      b: symbolKey,
    })
    const ChildJ = defineChild({
      b: {
        from: symbolKey,
      },
    })
    expect(renderToString(h(Root))).toBe(`1111234522`)
  })

  // 通过 provide/inject 传递 ref 和 computed，子组件 this 自动解包，源 ref 改变后渲染从 1 更新为 3。
  test('provide/inject refs', async () => {
    const n = ref(0)
    const np = computed(() => n.value + 1)
    const Parent = defineComponent({
      /**
       * 返回 `n`、`np` 作为此组件的祖先提供值，让后代 inject 读取。
       */
      provide() {
        return {
          n,
          np,
        }
      },
      /**
       * 渲染结果为 `h(Child)`。
       */
      render: () => h(Child),
    })
    const Child = defineComponent({
      inject: ['n', 'np'],
      /**
       * 渲染结果为 `this.n + this.np`。
       */
      render(this: any) {
        return this.n + this.np
      },
    })
    const app = createApp(Parent)
    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe(`1`)

    n.value++
    await nextTick()
    expect(serializeInner(root)).toBe(`3`)
  })

  // extends 中的 provide 通过 this 读取合并后的 data，子组件 inject 得到值 1。
  test('provide accessing data in extends', () => {
    const Base = defineComponent({
      /**
       * 建立每实例初始 data：`{ a: 1, }`。
       */
      data() {
        return {
          a: 1,
        }
      },
      /**
       * 返回 `a` 作为此组件的祖先提供值，让后代 inject 读取。
       */
      provide() {
        return {
          a: this.a,
        }
      },
    })

    const Child = {
      inject: ['a'],
      /**
       * 渲染结果为 `(this as any).a`。
       */
      render() {
        return (this as any).a
      },
    }

    const Root = defineComponent({
      extends: Base,
      /**
       * 渲染结果为 `h(Child)`。
       */
      render() {
        return h(Child)
      },
    })
    expect(renderToString(h(Root))).toBe(`1`)
  })

  // 以 root、mid、child 三层组件记录挂载、更新与卸载钩子，逐阶段断言父子调用顺序。
  test('lifecycle', async () => {
    const count = ref(0)
    const root = nodeOps.createElement('div')
    const calls: string[] = []

    const Root = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('root beforeCreate')`。
       */
      beforeCreate() {
        calls.push('root beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('root created')`。
       */
      created() {
        calls.push('root created')
      },
      /**
       * 在 beforeMount 阶段执行 `calls.push('root onBeforeMount')`。
       */
      beforeMount() {
        calls.push('root onBeforeMount')
      },
      /**
       * 在 mounted 阶段执行 `calls.push('root onMounted')`。
       */
      mounted() {
        calls.push('root onMounted')
      },
      /**
       * 在 beforeUpdate 阶段执行 `calls.push('root onBeforeUpdate')`。
       */
      beforeUpdate() {
        calls.push('root onBeforeUpdate')
      },
      /**
       * 在 updated 阶段执行 `calls.push('root onUpdated')`。
       */
      updated() {
        calls.push('root onUpdated')
      },
      /**
       * 在 beforeUnmount 阶段执行 `calls.push('root onBeforeUnmount')`。
       */
      beforeUnmount() {
        calls.push('root onBeforeUnmount')
      },
      /**
       * 在 unmounted 阶段执行 `calls.push('root onUnmounted')`。
       */
      unmounted() {
        calls.push('root onUnmounted')
      },
      /**
       * 渲染结果为 `h(Mid, { count: count.value })`。
       */
      render() {
        return h(Mid, { count: count.value })
      },
    }

    const Mid = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('mid beforeCreate')`。
       */
      beforeCreate() {
        calls.push('mid beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('mid created')`。
       */
      created() {
        calls.push('mid created')
      },
      /**
       * 在 beforeMount 阶段执行 `calls.push('mid onBeforeMount')`。
       */
      beforeMount() {
        calls.push('mid onBeforeMount')
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mid onMounted')`。
       */
      mounted() {
        calls.push('mid onMounted')
      },
      /**
       * 在 beforeUpdate 阶段执行 `calls.push('mid onBeforeUpdate')`。
       */
      beforeUpdate() {
        calls.push('mid onBeforeUpdate')
      },
      /**
       * 在 updated 阶段执行 `calls.push('mid onUpdated')`。
       */
      updated() {
        calls.push('mid onUpdated')
      },
      /**
       * 在 beforeUnmount 阶段执行 `calls.push('mid onBeforeUnmount')`。
       */
      beforeUnmount() {
        calls.push('mid onBeforeUnmount')
      },
      /**
       * 在 unmounted 阶段执行 `calls.push('mid onUnmounted')`。
       */
      unmounted() {
        calls.push('mid onUnmounted')
      },
      /**
       * 渲染结果为 `h(Child, { count: this.$props.count })`。
       */
      render(this: any) {
        return h(Child, { count: this.$props.count })
      },
    }

    const Child = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('child beforeCreate')`。
       */
      beforeCreate() {
        calls.push('child beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('child created')`。
       */
      created() {
        calls.push('child created')
      },
      /**
       * 在 beforeMount 阶段执行 `calls.push('child onBeforeMount')`。
       */
      beforeMount() {
        calls.push('child onBeforeMount')
      },
      /**
       * 在 mounted 阶段执行 `calls.push('child onMounted')`。
       */
      mounted() {
        calls.push('child onMounted')
      },
      /**
       * 在 beforeUpdate 阶段执行 `calls.push('child onBeforeUpdate')`。
       */
      beforeUpdate() {
        calls.push('child onBeforeUpdate')
      },
      /**
       * 在 updated 阶段执行 `calls.push('child onUpdated')`。
       */
      updated() {
        calls.push('child onUpdated')
      },
      /**
       * 在 beforeUnmount 阶段执行 `calls.push('child onBeforeUnmount')`。
       */
      beforeUnmount() {
        calls.push('child onBeforeUnmount')
      },
      /**
       * 在 unmounted 阶段执行 `calls.push('child onUnmounted')`。
       */
      unmounted() {
        calls.push('child onUnmounted')
      },
      /**
       * 渲染结果为 `h('div', this.$props.count)`。
       */
      render(this: any) {
        return h('div', this.$props.count)
      },
    }

    // 首次挂载，核对记录的调用顺序。
    render(h(Root), root)
    expect(calls).toEqual([
      'root beforeCreate',
      'root created',
      'root onBeforeMount',
      'mid beforeCreate',
      'mid created',
      'mid onBeforeMount',
      'child beforeCreate',
      'child created',
      'child onBeforeMount',
      'child onMounted',
      'mid onMounted',
      'root onMounted',
    ])

    calls.length = 0

    // 修改渲染依赖并等待一次刷新，核对更新顺序。
    count.value++
    await nextTick()
    expect(calls).toEqual([
      'root onBeforeUpdate',
      'mid onBeforeUpdate',
      'child onBeforeUpdate',
      'child onUpdated',
      'mid onUpdated',
      'root onUpdated',
    ])

    calls.length = 0

    // 卸载根树，核对卸载钩子顺序。
    render(null, root)
    expect(calls).toEqual([
      'root onBeforeUnmount',
      'mid onBeforeUnmount',
      'child onBeforeUnmount',
      'child onUnmounted',
      'mid onUnmounted',
      'root onUnmounted',
    ])
  })

  // 多个 mixin 合并 data 与 props，组件自身的 c 覆盖同名字段；created、mounted 按 mixin 列表再到组件执行。
  test('mixins', () => {
    const calls: string[] = []
    const mixinA = defineComponent({
      /**
       * 建立每实例初始 data：`{ a: 1, }`。
       */
      data() {
        return {
          a: 1,
        }
      },
      /**
       * 在 created 阶段执行 `calls.push('mixinA created')`、`expect(this.a).toBe(1)`、`expect(this.a)`。
       */
      created(this: any) {
        calls.push('mixinA created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.c).toBe(4)
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mixinA mounted')`。
       */
      mounted() {
        calls.push('mixinA mounted')
      },
    })
    const mixinB = defineComponent({
      props: {
        bP: {
          type: String,
        },
      },
      /**
       * 建立每实例初始 data：`{ b: 2, }`。
       */
      data() {
        return {
          b: 2,
        }
      },
      /**
       * 在 created 阶段执行 `calls.push('mixinB created')`、`expect(this.a).toBe(1)`、`expect(this.a)`。
       */
      created(this: any) {
        calls.push('mixinB created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.bP).toBeUndefined()
        expect(this.c).toBe(4)
        expect(this.cP1).toBeUndefined()
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mixinB mounted')`。
       */
      mounted() {
        calls.push('mixinB mounted')
      },
    })
    const mixinC = defineComponent({
      props: ['cP1', 'cP2'],
      /**
       * 建立每实例初始 data：`{ c: 3, }`。
       */
      data() {
        return {
          c: 3,
        }
      },
      /**
       * 在 created 阶段执行 `calls.push('mixinC created')`、`expect(this.c).toBe(4)`、`expect(this.c)`。
       */
      created() {
        calls.push('mixinC created')
        // 组件 data 的同名 c 覆盖 mixin 的 c。
        expect(this.c).toBe(4)
        expect(this.cP1).toBeUndefined()
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mixinC mounted')`。
       */
      mounted() {
        calls.push('mixinC mounted')
      },
    })
    const Comp = defineComponent({
      props: {
        aaa: String,
      },
      mixins: [mixinA, mixinB, mixinC],
      /**
       * 建立每实例初始 data：`{ c: 4, z: 4, }`。
       */
      data() {
        return {
          c: 4,
          z: 4,
        }
      },
      /**
       * 在 created 阶段执行 `calls.push('comp created')`、`expect(this.a).toBe(1)`、`expect(this.a)`。
       */
      created() {
        calls.push('comp created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.bP).toBeUndefined()
        expect(this.c).toBe(4)
        expect(this.cP2).toBeUndefined()
        expect(this.z).toBe(4)
      },
      /**
       * 在 mounted 阶段执行 `calls.push('comp mounted')`。
       */
      mounted() {
        calls.push('comp mounted')
      },
      /**
       * 渲染结果为 `` `${this.a}${this.b}${this.c}` ``。
       */
      render() {
        return `${this.a}${this.b}${this.c}`
      },
    })
    expect(renderToString(h(Comp))).toBe(`124`)
    expect(calls).toEqual([
      'mixinA created',
      'mixinB created',
      'mixinC created',
      'comp created',
      'mixinA mounted',
      'mixinB mounted',
      'mixinC mounted',
      'comp mounted',
    ])
  })

  // 组件未定义 render，采用 mixin 的 render 并输出 from mixin。
  test('render from mixin', () => {
    const Comp = {
      mixins: [
        {
          /**
           * 渲染结果为 `'from mixin'`。
           */
          render: () => 'from mixin',
        },
      ],
    }
    expect(renderToString(h(Comp))).toBe('from mixin')
  })

  // 组件 extends 的对象包含 mixin；beforeCreate 与 created 都按 mixin、extends 对象、组件的顺序执行。
  test('chained mixins in extends', () => {
    const calls: string[] = []
    const mixinA = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('mixinA beforeCreate')`。
       */
      beforeCreate() {
        calls.push('mixinA beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('mixinA created')`。
       */
      created() {
        calls.push('mixinA created')
      },
    }

    const extendA = {
      mixins: [mixinA],
      /**
       * 在 beforeCreate 阶段执行 `calls.push('extendA beforeCreate')`。
       */
      beforeCreate() {
        calls.push('extendA beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('extendA created')`。
       */
      created() {
        calls.push('extendA created')
      },
    }

    const Comp = {
      extends: extendA,
      /**
       * 渲染结果为 `'123'`。
       */
      render: () => '123',
      /**
       * 在 beforeCreate 阶段执行 `calls.push('self beforeCreate')`。
       */
      beforeCreate() {
        calls.push('self beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('self created')`。
       */
      created() {
        calls.push('self created')
      },
    }

    expect(renderToString(h(Comp))).toBe(`123`)
    expect(calls).toEqual([
      'mixinA beforeCreate',
      'extendA beforeCreate',
      'self beforeCreate',
      'mixinA created',
      'extendA created',
      'self created',
    ])
  })

  // 连续调用 defineComponent，并把两个结果放入外层 mixins；仅保留该选项的类型/调用写法，没有挂载或运行时 matcher，不据此判断实际合并结果。
  test('unlikely mixin usage', () => {
    const MixinA = {
      /**
       * 空 data 工厂占位；该选项形状用于本例的类型/混入写法。
       */
      data() {},
    }
    const MixinB = {
      /**
       * 空 data 工厂占位；该选项形状用于本例的类型/混入写法。
       */
      data() {},
    }
    defineComponent({
      // 先给每个 mixin 做 defineComponent 类型推导，再作为外层 mixins 输入。
      mixins: [defineComponent(MixinA), defineComponent(MixinB)],
      /**
       * 空 data 工厂占位；该选项形状用于本例的类型/混入写法。
       */
      data() {},
    })
  })

  // mixin 自身带 extends；beforeCreate 与 created 都先执行其基类，再执行 mixin 和组件。
  test('chained extends in mixins', () => {
    const calls: string[] = []

    const extendA = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('extendA beforeCreate')`。
       */
      beforeCreate() {
        calls.push('extendA beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('extendA created')`。
       */
      created() {
        calls.push('extendA created')
      },
    }

    const mixinA = {
      extends: extendA,
      /**
       * 在 beforeCreate 阶段执行 `calls.push('mixinA beforeCreate')`。
       */
      beforeCreate() {
        calls.push('mixinA beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('mixinA created')`。
       */
      created() {
        calls.push('mixinA created')
      },
    }

    const Comp = {
      mixins: [mixinA],
      /**
       * 渲染结果为 `'123'`。
       */
      render: () => '123',
      /**
       * 在 beforeCreate 阶段执行 `calls.push('self beforeCreate')`。
       */
      beforeCreate() {
        calls.push('self beforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('self created')`。
       */
      created() {
        calls.push('self created')
      },
    }

    expect(renderToString(h(Comp))).toBe(`123`)
    expect(calls).toEqual([
      'extendA beforeCreate',
      'mixinA beforeCreate',
      'self beforeCreate',
      'extendA created',
      'mixinA created',
      'self created',
    ])
  })

  // 组件继承 Base 的 data，自己的 b 覆盖基类值；mounted 先执行 Base，再执行组件。
  test('extends', () => {
    const calls: string[] = []
    const Base = defineComponent({
      /**
       * 建立每实例初始 data：`{ a: 1, b: 1, }`。
       */
      data() {
        return {
          a: 1,
          b: 1,
        }
      },
      methods: {
        /**
         * 基类的空方法占位，用于 extends 选项形状；本用例不调用此方法。
         */
        sayA() {},
      },
      /**
       * 在 mounted 阶段执行 `expect(this.a).toBe(1)`、`expect(this.a)`、`expect(this.b).toBe(2)`。
       */
      mounted(this: any) {
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        calls.push('base')
      },
    })
    const Comp = defineComponent({
      extends: Base,
      /**
       * 建立每实例初始 data：`{ b: 2, }`。
       */
      data() {
        return {
          b: 2,
        }
      },
      /**
       * 在 mounted 阶段执行 `calls.push('comp')`。
       */
      mounted() {
        calls.push('comp')
      },
      /**
       * 渲染结果为 `` `${this.a}${this.b}` ``。
       */
      render() {
        return `${this.a}${this.b}`
      },
    })

    expect(renderToString(h(Comp))).toBe(`12`)
    expect(calls).toEqual(['base', 'comp'])
  })

  // extends、mixin 与组件的 data 合并，mixin 的 x 覆盖基类值；mounted 按 base、mixin、comp 顺序执行。
  test('extends with mixins', () => {
    const calls: string[] = []
    const Base = defineComponent({
      /**
       * 建立每实例初始 data：`{ a: 1, x: 'base', }`。
       */
      data() {
        return {
          a: 1,
          x: 'base',
        }
      },
      methods: {
        /**
         * extends 与 mixin 夹具中的基类方法占位；本用例的断言观察数据覆盖和 mounted 顺序。
         */
        sayA() {},
      },
      /**
       * 在 mounted 阶段执行 `expect(this.a).toBe(1)`、`expect(this.a)`、`expect(this.b).toBeTruthy()`。
       */
      mounted(this: any) {
        expect(this.a).toBe(1)
        expect(this.b).toBeTruthy()
        expect(this.c).toBe(2)
        calls.push('base')
      },
    })
    const Mixin = defineComponent({
      /**
       * 建立每实例初始 data：`{ b: true, x: 'mixin', }`。
       */
      data() {
        return {
          b: true,
          x: 'mixin',
        }
      },
      /**
       * 在 mounted 阶段执行 `expect(this.a).toBe(1)`、`expect(this.a)`、`expect(this.b).toBeTruthy()`。
       */
      mounted(this: any) {
        expect(this.a).toBe(1)
        expect(this.b).toBeTruthy()
        expect(this.c).toBe(2)
        calls.push('mixin')
      },
    })
    const Comp = defineComponent({
      extends: Base,
      mixins: [Mixin],
      /**
       * 建立每实例初始 data：`{ c: 2, }`。
       */
      data() {
        return {
          c: 2,
        }
      },
      /**
       * 在 mounted 阶段执行 `calls.push('comp')`。
       */
      mounted() {
        calls.push('comp')
      },
      /**
       * 渲染结果为 `` `${this.a}${this.b}${this.c}${this.x}` ``。
       */
      render() {
        return `${this.a}${this.b}${this.c}${this.x}`
      },
    })

    expect(renderToString(h(Comp))).toBe(`1true2mixin`)
    expect(calls).toEqual(['base', 'mixin', 'comp'])
  })

  // extends 链先于 mixins 链合并；分别记录 beforeCreate 与 created，确认每组都按 A、B、C、D、组件执行。
  test('beforeCreate/created in extends and mixins', () => {
    const calls: string[] = []
    const BaseA = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('beforeCreateA')`。
       */
      beforeCreate() {
        calls.push('beforeCreateA')
      },
      /**
       * 在 created 阶段执行 `calls.push('createdA')`。
       */
      created() {
        calls.push('createdA')
      },
    }
    const BaseB = {
      extends: BaseA,
      /**
       * 在 beforeCreate 阶段执行 `calls.push('beforeCreateB')`。
       */
      beforeCreate() {
        calls.push('beforeCreateB')
      },
      /**
       * 在 created 阶段执行 `calls.push('createdB')`。
       */
      created() {
        calls.push('createdB')
      },
    }

    const MixinA = {
      /**
       * 在 beforeCreate 阶段执行 `calls.push('beforeCreateC')`。
       */
      beforeCreate() {
        calls.push('beforeCreateC')
      },
      /**
       * 在 created 阶段执行 `calls.push('createdC')`。
       */
      created() {
        calls.push('createdC')
      },
    }
    const MixinB = {
      mixins: [MixinA],
      /**
       * 在 beforeCreate 阶段执行 `calls.push('beforeCreateD')`。
       */
      beforeCreate() {
        calls.push('beforeCreateD')
      },
      /**
       * 在 created 阶段执行 `calls.push('createdD')`。
       */
      created() {
        calls.push('createdD')
      },
    }

    const Comp = {
      extends: BaseB,
      mixins: [MixinB],
      /**
       * 在 beforeCreate 阶段执行 `calls.push('selfBeforeCreate')`。
       */
      beforeCreate() {
        calls.push('selfBeforeCreate')
      },
      /**
       * 在 created 阶段执行 `calls.push('selfCreated')`。
       */
      created() {
        calls.push('selfCreated')
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    }

    renderToString(h(Comp))
    expect(calls).toEqual([
      'beforeCreateA',
      'beforeCreateB',
      'beforeCreateC',
      'beforeCreateD',
      'selfBeforeCreate',
      'createdA',
      'createdB',
      'createdC',
      'createdD',
      'selfCreated',
    ])
  })

  // 嵌套 mixins 与 extends 的自定义选项被合并到当前 $options，渲染可读出两个 base 值。
  test('flatten merged options', async () => {
    const MixinBase = {
      msg1: 'base',
    }
    const ExtendsBase = {
      msg2: 'base',
    }
    const Mixin = {
      mixins: [MixinBase],
    }
    const Extends = {
      extends: ExtendsBase,
    }
    const Comp = defineComponent({
      extends: defineComponent(Extends),
      mixins: [defineComponent(Mixin)],
      /**
       * 渲染结果为 `` `${this.$options.msg1},${this.$options.msg2}` ``。
       */
      render() {
        return `${this.$options.msg1},${this.$options.msg2}`
      },
    })

    expect(renderToString(h(Comp))).toBe('base,base')
  })

  // 组件没有自己的模板，继承 extends.template，经主 Vue 入口编译后渲染 Foo。
  test('extends template', () => {
    const Comp = {
      extends: {
        template: `<h1>Foo</h1>`,
      },
    }

    const root = document.createElement('div') as any
    domRender(h(Comp), root)
    expect(root.innerHTML).toBe(`<h1>Foo</h1>`)
  })

  // 组件自身 msg1、msg2 覆盖 mixin 和 extends 的同名自定义选项，$options 读取结果均为 local。
  test('options defined in component have higher priority', async () => {
    const Mixin = {
      msg1: 'base',
    }
    const Extends = {
      msg2: 'base',
    }
    const Comp = defineComponent({
      msg1: 'local',
      msg2: 'local',
      extends: defineComponent(Extends),
      mixins: [defineComponent(Mixin)],
      /**
       * 渲染结果为 `` `${this.$options.msg1},${this.$options.msg2}` ``。
       */
      render() {
        return `${this.$options.msg1},${this.$options.msg2}`
      },
    })

    expect(renderToString(h(Comp))).toBe('local,local')
  })

  // Options API 通过 this 读取 setup 的 count ref；递增后 computed 重算，data 初始化的 plusOne 保留原值。
  test('accessing setup() state from options', async () => {
    const Comp = defineComponent({
      /**
       * 返回 `count` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          count: ref(0),
        }
      },
      /**
       * 建立每实例初始 data：`{ plusOne: (this as any).count + 1, }`。
       */
      data() {
        return {
          plusOne: (this as any).count + 1,
        }
      },
      computed: {
        /**
         * 返回 `this.count + 2`。
         */
        plusTwo(): number {
          return this.count + 2
        },
      },
      methods: {
        /**
         * 递增 setup 返回并自动解包到 this 的 count，让渲染和 computed 更新，data 初始快照保持原值。
         */
        inc() {
          this.count++
        },
      },
      /**
       * 渲染结果为 `` h('div', { onClick: this.inc, }, `${this.count},${this.plusOne},${this.plusTwo}`) ``。
       */
      render() {
        return h(
          'div',
          {
            onClick: this.inc,
          },
          `${this.count},${this.plusOne},${this.plusTwo}`,
        )
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>0,1,2</div>`)

    triggerEvent(root.children[0] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1,1,3</div>`)
  })

  // #1016
  // mixin2 的 watch 监听后续 mixin3 声明的数据；数据初始化完成后注册监听，改值时获得正确的新旧值。
  test('watcher initialization should be deferred in mixins', async () => {
    const mixin1 = {
      /**
       * 建立每实例初始 data：`{ mixin1Data: 'mixin1', }`。
       */
      data() {
        return {
          mixin1Data: 'mixin1',
        }
      },
      methods: {},
    }

    const watchSpy = vi.fn()
    const mixin2 = {
      watch: {
        mixin3Data: watchSpy,
      },
    }

    const mixin3 = {
      /**
       * 建立每实例初始 data：`{ mixin3Data: 'mixin3', }`。
       */
      data() {
        return {
          mixin3Data: 'mixin3',
        }
      },
      methods: {},
    }

    let vm: any
    const Comp = {
      mixins: [mixin1, mixin2, mixin3],
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段写入 `vm` 供后续观察或触发更新。
       */
      created() {
        vm = this
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    // 修改来自后续 mixin 的字段，检查 watcher 已读取到正确初始值。
    vm.mixin3Data = 'hello'
    await nextTick()
    expect(watchSpy.mock.calls[0].slice(0, 2)).toEqual(['hello', 'mixin3'])
  })

  // inject 采用最近提供同名键的祖先值，分别覆盖根级、直接 provide 和 mixin provide。
  test('injection from closest ancestor', () => {
    const Root = defineComponent({
      provide: {
        a: 'root',
      },
      /**
       * 渲染结果为 `[h(Mid), ' ', h(MidWithProvide), ' ', h(MidWithMixinProvide)]`。
       */
      render() {
        return [h(Mid), ' ', h(MidWithProvide), ' ', h(MidWithMixinProvide)]
      },
    })

    const Mid = {
      /**
       * 渲染结果为 `h(Child)`。
       */
      render() {
        return h(Child)
      },
    } as any

    const MidWithProvide = {
      provide: {
        a: 'midWithProvide',
      },
      /**
       * 渲染结果为 `h(Child)`。
       */
      render() {
        return h(Child)
      },
    } as any

    const mixin = {
      provide: {
        a: 'midWithMixinProvide',
      },
    }

    const MidWithMixinProvide = {
      mixins: [mixin],
      /**
       * 渲染结果为 `h(Child)`。
       */
      render() {
        return h(Child)
      },
    } as any

    const Child = {
      inject: ['a'],
      /**
       * 渲染结果为 `this.a`。
       */
      render() {
        return this.a
      },
    } as any

    expect(renderToString(h(Root))).toBe(
      'root midWithProvide midWithMixinProvide',
    )
  })

  // $options 暴露合并后的选项形态。
  describe('options merge strategies', () => {
    // $options.data 是合并函数；调用后保留 mixin 的 bar，组件 foo 覆盖同名值，并加入 baz。
    test('this.$options.data', () => {
      const mixin = {
        /**
         * 建立每实例初始 data：`{ foo: 1, bar: 2 }`。
         */
        data() {
          return { foo: 1, bar: 2 }
        },
      }
      createApp({
        mixins: [mixin],
        /**
         * 建立每实例初始 data：`{ foo: 3, baz: 4, }`。
         */
        data() {
          return {
            foo: 3,
            baz: 4,
          }
        },
        /**
         * 在 created 阶段执行 `expect(this.$options.data).toBeInstanceOf(Function)`、`expect(this.$options.data)`、`expect(this.$options.data()).toEqual({ foo: 3, bar: 2, baz: 4, })`。
         */
        created() {
          expect(this.$options.data).toBeInstanceOf(Function)
          expect(this.$options.data()).toEqual({
            foo: 3,
            bar: 2,
            baz: 4,
          })
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // $options.inject 将数组声明归一化并与对象声明合并，实例字段按 from 映射读取 app.provide 的值。
    test('this.$options.inject', () => {
      const mixin = {
        inject: ['a'],
      }
      const app = createApp({
        mixins: [mixin],
        inject: { b: 'b', c: { from: 'd' } },
        /**
         * 在 created 阶段执行 `expect(this.$options.inject.a).toEqual('a')`、`expect(this.$options.inject.a)`、`expect(this.$options.inject.b).toEqual('b')`。
         */
        created() {
          expect(this.$options.inject.a).toEqual('a')
          expect(this.$options.inject.b).toEqual('b')
          expect(this.$options.inject.c).toEqual({ from: 'd' })
          expect(this.a).toBe(1)
          expect(this.b).toBe(2)
          expect(this.c).toBe(3)
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      })

      app.provide('a', 1)
      app.provide('b', 2)
      app.provide('d', 3)
      app.mount(nodeOps.createElement('div'))
    })

    // $options.provide 是合并函数；调用后同时返回 mixin 的 a 和组件的 b。
    test('this.$options.provide', () => {
      const mixin = {
        provide: {
          a: 1,
        },
      }
      createApp({
        mixins: [mixin],
        /**
         * 返回 `b` 作为此组件的祖先提供值，让后代 inject 读取。
         */
        provide() {
          return {
            b: 2,
          }
        },
        /**
         * 在 created 阶段执行 `expect(this.$options.provide).toBeInstanceOf(Function)`、`expect(this.$options.provide)`、`expect(this.$options.provide()).toEqual({ a: 1, b: 2 })`。
         */
        created() {
          expect(this.$options.provide).toBeInstanceOf(Function)
          expect(this.$options.provide()).toEqual({ a: 1, b: 2 })
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // mixin 与组件的同名生命周期选项合并为数组，mounted、beforeUnmount、unmounted 各包含两个函数。
    test('this.$options[lifecycle-name]', () => {
      const mixin = {
        /**
         * 在 mounted 阶段保留生命周期占位。
         */
        mounted() {},
        /**
         * 在 beforeUnmount 阶段保留生命周期占位。
         */
        beforeUnmount() {},
        /**
         * 在 unmounted 阶段保留生命周期占位。
         */
        unmounted() {},
      }
      createApp({
        mixins: [mixin],
        /**
         * 在 mounted 阶段保留生命周期占位。
         */
        mounted() {},
        /**
         * 在 beforeUnmount 阶段保留生命周期占位。
         */
        beforeUnmount() {},
        /**
         * 在 unmounted 阶段保留生命周期占位。
         */
        unmounted() {},
        /**
         * 在 created 阶段执行 `expect(this.$options.mounted).toBeInstanceOf(Array)`、`expect(this.$options.mounted)`、`expect(this.$options.mounted.length).toBe(2)`。
         */
        created() {
          expect(this.$options.mounted).toBeInstanceOf(Array)
          expect(this.$options.mounted.length).toBe(2)
          expect(this.$options.beforeUnmount).toBeInstanceOf(Array)
          expect(this.$options.beforeUnmount.length).toBe(2)
          expect(this.$options.unmounted).toBeInstanceOf(Array)
          expect(this.$options.unmounted.length).toBe(2)
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // components 与 directives 的注册表合并，$options 保留 mixin 和组件各自的注册键。
    test('this.$options[asset-name]', () => {
      const mixin = {
        components: {
          a: {},
        },
        directives: {
          d1: {},
        },
      }
      createApp({
        mixins: [mixin],
        components: {
          b: {},
        },
        directives: {
          d2: {},
        },
        /**
         * 在 created 阶段执行 `expect('a' in this.$options.components).toBe(true)`、`expect('a' in this.$options.components)`、`expect('b' in this.$options.components).toBe(true)`。
         */
        created() {
          expect('a' in this.$options.components).toBe(true)
          expect('b' in this.$options.components).toBe(true)
          expect('d1' in this.$options.directives).toBe(true)
          expect('d2' in this.$options.directives).toBe(true)
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // $options.methods 保留 mixin 的 fn1 与组件的 fn2，二者仍为函数。
    test('this.$options.methods', () => {
      const mixin = {
        methods: {
          /**
           * 空 fn1 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          fn1() {},
        },
      }
      createApp({
        mixins: [mixin],
        methods: {
          /**
           * 空 fn2 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          fn2() {},
        },
        /**
         * 在 created 阶段执行 `expect(this.$options.methods.fn1).toBeInstanceOf(Function)`、`expect(this.$options.methods.fn1)`、`expect(this.$options.methods.fn2).toBeInstanceOf(Function)`。
         */
        created() {
          expect(this.$options.methods.fn1).toBeInstanceOf(Function)
          expect(this.$options.methods.fn2).toBeInstanceOf(Function)
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // $options.computed 保留 mixin 的 c1 与组件的 c2 getter，二者仍为函数。
    test('this.$options.computed', () => {
      const mixin = {
        computed: {
          /**
           * 空 c1 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          c1() {},
        },
      }
      createApp({
        mixins: [mixin],
        computed: {
          /**
           * 空 c2 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          c2() {},
        },
        /**
         * 在 created 阶段执行 `expect(this.$options.computed.c1).toBeInstanceOf(Function)`、`expect(this.$options.computed.c1)`、`expect(this.$options.computed.c2).toBeInstanceOf(Function)`。
         */
        created() {
          expect(this.$options.computed.c1).toBeInstanceOf(Function)
          expect(this.$options.computed.c2).toBeInstanceOf(Function)
        },
        /**
         * 渲染结果为 `null`。
         */
        render: () => null,
      }).mount(nodeOps.createElement('div'))
    })

    // #2791
    // mixin 的 beforeCreate 向 $options.computed 添加 getter，随后初始化生效并响应 count 更新。
    test('modify $options in the beforeCreate hook', async () => {
      const count = ref(0)
      const mixin = {
        /**
         * 建立每实例初始 data：`{ foo: 1 }`。
         */
        data() {
          return { foo: 1 }
        },
        /**
         * 在 beforeCreate 阶段写入 `this.$options.computed`、`this.$options.computed.value` 供后续观察或触发更新。
         */
        beforeCreate(this: any) {
          if (!this.$options.computed) {
            this.$options.computed = {}
          }
          /**
           * beforeCreate 临时添加的 computed getter，读取 count.value；验证选项解构/初始化发生在该钩子之后。
           */
          this.$options.computed.value = () => count.value
        },
      }
      const root = nodeOps.createElement('div')
      createApp({
        mixins: [mixin],
        /**
         * 渲染结果为 `this.value`。
         */
        render(this: any) {
          return this.value
        },
      }).mount(root)

      expect(serializeInner(root)).toBe('0')

      count.value++
      await nextTick()
      expect(serializeInner(root)).toBe('1')
    })
  })

  // 非法选项与重复属性声明的开发期警告。
  describe('warnings', () => {
    // watch 用方法名指定不存在的处理器，普通写法与 handler 对象写法都发出警告。
    test('Expected a function as watch handler', () => {
      const Comp = {
        watch: {
          foo: 'notExistingMethod',
          foo2: {
            handler: 'notExistingMethod2',
          },
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      expect(
        'Invalid watch handler specified by key "notExistingMethod"',
      ).toHaveBeenWarned()
      expect(
        'Invalid watch handler specified by key "notExistingMethod2"',
      ).toHaveBeenWarned()
    })

    // watch.foo 传入布尔值 true，挂载时发出非法 watch 选项警告。
    test('Invalid watch option', () => {
      const Comp = {
        watch: { foo: true },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      // @ts-expect-error
      render(h(Comp), root)

      expect('Invalid watch option: "foo"').toHaveBeenWarned()
    })

    // computed.foo 只有 setter，挂载时发出缺少 getter 的警告。
    test('computed with setter and no getter', () => {
      const Comp = {
        computed: {
          foo: {
            /**
             * 空 set 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
             */
            set() {},
          },
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect('Computed property "foo" has no getter.').toHaveBeenWarned()
    })

    // 向只有 getter 的 computed.foo 赋值，发出计算属性只读警告。
    test('assigning to computed with no setter', () => {
      let instance: any
      const Comp = {
        computed: {
          foo: {
            /**
             * 空 get 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
             */
            get() {},
          },
        },
        /**
         * 在 mounted 阶段写入 `instance` 供后续观察或触发更新。
         */
        mounted() {
          instance = this
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      instance.foo = 1
      expect(
        'Write operation failed: computed property "foo" is readonly',
      ).toHaveBeenWarned()
    })

    // inject 与 props 同时声明 a，挂载时发出重复属性警告。
    test('inject property is already declared in props', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`{ a: 1, }`。
         */
        data() {
          return {
            a: 1,
          }
        },
        /**
         * 返回 `a` 作为此组件的祖先提供值，让后代 inject 读取。
         */
        provide() {
          return {
            a: this.a,
          }
        },
        /**
         * 渲染结果为 `[h(ChildA)]`。
         */
        render() {
          return [h(ChildA)]
        },
      } as any
      const ChildA = {
        props: { a: Number },
        inject: ['a'],
        /**
         * 渲染结果为 `this.a`。
         */
        render() {
          return this.a
        },
      } as any

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Inject property "a" is already defined in Props.`,
      ).toHaveBeenWarned()
    })

    // methods.foo 被配置为数字，挂载时发出方法类型不是函数的警告。
    test('methods property is not a function', () => {
      const Comp = {
        methods: {
          foo: 1,
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Method "foo" has type "number" in the component definition. ` +
          `Did you reference the function correctly?`,
      ).toHaveBeenWarned()
    })

    // methods 与 props 同时声明 foo，挂载时发出重复属性警告。
    test('methods property is already declared in props', () => {
      const Comp = {
        props: {
          foo: Number,
        },
        methods: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Methods property "foo" is already defined in Props.`,
      ).toHaveBeenWarned()
    })

    // methods 与 inject 同时声明 a，挂载时发出重复属性警告。
    test('methods property is already declared in inject', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`{ a: 1, }`。
         */
        data() {
          return {
            a: 1,
          }
        },
        /**
         * 返回 `a` 作为此组件的祖先提供值，让后代 inject 读取。
         */
        provide() {
          return {
            a: this.a,
          }
        },
        /**
         * 渲染结果为 `[h(ChildA)]`。
         */
        render() {
          return [h(ChildA)]
        },
      } as any
      const ChildA = {
        methods: {
          /**
           * 返回 `null`。
           */
          a: () => null,
        },
        inject: ['a'],
        /**
         * 渲染结果为 `this.a`。
         */
        render() {
          return this.a
        },
      } as any

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Methods property "a" is already defined in Inject.`,
      ).toHaveBeenWarned()
    })

    // data 返回值与 props 存在同名 foo，挂载时发出重复属性警告。
    test('data property is already declared in props', () => {
      const Comp = {
        props: { foo: Number },
        /**
         * 建立每实例初始 data：`({ foo: 1, })`。
         */
        data: () => ({
          foo: 1,
        }),
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Data property "foo" is already defined in Props.`,
      ).toHaveBeenWarned()
    })

    // data 返回值与 inject 存在同名 a，挂载时发出重复属性警告。
    test('data property is already declared in inject', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`{ a: 1, }`。
         */
        data() {
          return {
            a: 1,
          }
        },
        /**
         * 返回 `a` 作为此组件的祖先提供值，让后代 inject 读取。
         */
        provide() {
          return {
            a: this.a,
          }
        },
        /**
         * 渲染结果为 `[h(ChildA)]`。
         */
        render() {
          return [h(ChildA)]
        },
      } as any
      const ChildA = {
        /**
         * 建立每实例初始 data：`{ a: 1, }`。
         */
        data() {
          return {
            a: 1,
          }
        },
        inject: ['a'],
        /**
         * 渲染结果为 `this.a`。
         */
        render() {
          return this.a
        },
      } as any

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Data property "a" is already defined in Inject.`,
      ).toHaveBeenWarned()
    })

    // data 返回值与 methods 存在同名 foo，挂载时发出重复属性警告。
    test('data property is already declared in methods', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`({ foo: 1, })`。
         */
        data: () => ({
          foo: 1,
        }),
        methods: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Data property "foo" is already defined in Methods.`,
      ).toHaveBeenWarned()
    })

    // computed 与 props 同时声明 foo，挂载时发出重复属性警告。
    test('computed property is already declared in props', () => {
      const Comp = {
        props: { foo: Number },
        computed: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Computed property "foo" is already defined in Props.`,
      ).toHaveBeenWarned()
    })

    // computed 与 inject 同时声明 a，挂载时发出重复属性警告。
    test('computed property is already declared in inject', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`{ a: 1, }`。
         */
        data() {
          return {
            a: 1,
          }
        },
        /**
         * 返回 `a` 作为此组件的祖先提供值，让后代 inject 读取。
         */
        provide() {
          return {
            a: this.a,
          }
        },
        /**
         * 渲染结果为 `[h(ChildA)]`。
         */
        render() {
          return [h(ChildA)]
        },
      } as any
      const ChildA = {
        computed: {
          a: {
            /**
             * 空 get 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
             */
            get() {},
            /**
             * 空 set 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
             */
            set() {},
          },
        },
        inject: ['a'],
        /**
         * 渲染结果为 `this.a`。
         */
        render() {
          return this.a
        },
      } as any

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Computed property "a" is already defined in Inject.`,
      ).toHaveBeenWarned()
    })

    // computed 与 methods 同时声明 foo，挂载时发出重复属性警告。
    test('computed property is already declared in methods', () => {
      const Comp = {
        computed: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        methods: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Computed property "foo" is already defined in Methods.`,
      ).toHaveBeenWarned()
    })

    // computed 与 data 同时声明 foo，挂载时发出重复属性警告。
    test('computed property is already declared in data', () => {
      const Comp = {
        /**
         * 建立每实例初始 data：`({ foo: 1, })`。
         */
        data: () => ({
          foo: 1,
        }),
        computed: {
          /**
           * 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          foo() {},
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(
        `Computed property "foo" is already defined in Data.`,
      ).toHaveBeenWarned()
    })
  })
})
