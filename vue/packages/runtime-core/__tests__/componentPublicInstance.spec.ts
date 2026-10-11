/**
 * 从 mounted 获取公共实例，检查属性读写、存在性判断和 Object.defineProperty 对访问缓存的影响。
 */
import {
  createApp,
  defineComponent,
  getCurrentInstance,
  h,
  nodeOps,
  render,
  shallowReadonly,
} from '@vue/runtime-test'
import type {
  ComponentInternalInstance,
  ComponentOptions,
} from '../src/component'

// 公共实例 Proxy 的状态入口、内置属性和属性描述符。
describe('component: proxy', () => {
  // 通过公共实例读取并修改 foo，写入结果同步到 instance.data。
  test('data', () => {
    let instance: ComponentInternalInstance
    let instanceProxy: any
    const Comp = {
      /**
       * 建立每实例初始 data：`{ foo: 1, }`。
       */
      data() {
        return {
          foo: 1,
        }
      },
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance`、`instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()!
        instanceProxy = this
      },
      /**
       * 渲染结果为 `null`。
       */
      render() {
        return null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(instanceProxy.foo).toBe(1)
    instanceProxy.foo = 2
    expect(instance!.data.foo).toBe(2)
  })

  // setup 返回普通数值 foo；公共实例可读写它，写入结果同步到 instance.setupState。
  test('setupState', () => {
    let instance: ComponentInternalInstance
    let instanceProxy: any
    const Comp = {
      /**
       * 返回 `foo` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          foo: 1,
        }
      },
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance`、`instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()!
        instanceProxy = this
      },
      /**
       * 渲染结果为 `null`。
       */
      render() {
        return null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(instanceProxy.foo).toBe(1)
    instanceProxy.foo = 2
    expect(instance!.setupState.foo).toBe(2)
  })

  // 传入 count 但未声明 props，公共实例的 has 检查不暴露 count。
  test('should not expose non-declared props', () => {
    let instanceProxy: any
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }
    render(h(Comp, { count: 1 }), nodeOps.createElement('div'))
    expect('count' in instanceProxy).toBe(false)
  })

  // 检查 $data、$props、$attrs 等内置公共属性的来源，拒绝改写 $data，并绑定 $nextTick 回调的 this。
  test('public properties', async () => {
    let instance: ComponentInternalInstance
    let instanceProxy: any
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance`、`instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()!
        instanceProxy = this
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(instanceProxy.$data).toBe(instance!.data)
    expect(instanceProxy.$props).toBe(shallowReadonly(instance!.props))
    expect(instanceProxy.$attrs).toBe(shallowReadonly(instance!.attrs))
    expect(instanceProxy.$slots).toBe(shallowReadonly(instance!.slots))
    expect(instanceProxy.$refs).toBe(shallowReadonly(instance!.refs))
    expect(instanceProxy.$parent).toBe(
      instance!.parent && instance!.parent.proxy,
    )
    expect(instanceProxy.$root).toBe(instance!.root.proxy)
    expect(instanceProxy.$emit).toBe(instance!.emit)
    expect(instanceProxy.$el).toBe(instance!.vnode.el)
    expect(instanceProxy.$options).toBe(instance!.type as ComponentOptions)
    expect(() => (instanceProxy.$data = {})).toThrow(TypeError)
    expect(`Attempting to mutate public property "$data"`).toHaveBeenWarned()

    const nextTickThis = await instanceProxy.$nextTick(function (this: any) {
      return this
    })
    expect(nextTickThis).toBe(instanceProxy)
  })

  // 向公共实例新增 foo 和 $store，均写入 instance.ctx 并可再次读取。
  test('user attached properties', async () => {
    let instance: ComponentInternalInstance
    let instanceProxy: any
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance`、`instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()!
        instanceProxy = this
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    instanceProxy.foo = 1
    expect(instanceProxy.foo).toBe(1)
    expect(instance!.ctx.foo).toBe(1)

    // 自定义 $store 没有对应实例内置字段，允许写入 ctx。
    const obj = (instanceProxy.$store = {})
    expect(instanceProxy.$store).toBe(obj)
    expect(instance!.ctx.$store).toBe(obj)
  })

  // 公共实例读取 globalProperties.foo；向实例同名字段赋值只写入 ctx，保留全局值。
  test('globalProperties', () => {
    let instance: ComponentInternalInstance
    let instanceProxy: any
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        return () => null
      },
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance`、`instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()!
        instanceProxy = this
      },
    }

    const app = createApp(Comp)
    app.config.globalProperties.foo = 1
    app.mount(nodeOps.createElement('div'))

    expect(instanceProxy.foo).toBe(1)

    // 实例赋值写入 ctx 的同名字段，遮蔽全局属性。
    instanceProxy.foo = 2
    // expect(instanceProxy.foo).toBe(2)
    expect(instance!.ctx.foo).toBe(2)
    // 应用 globalProperties.foo 应保持 1。
    expect(app.config.globalProperties.foo).toBe(1)
  })

  // 用 in 检查各属性来源，computed getter 故意抛错以确认 has 不求值；不存在属性的读取也不应制造存在性。
  test('has check', () => {
    let instanceProxy: any
    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      props: {
        msg: String,
      },
      /**
       * 建立每实例初始 data：`{ foo: 0, $foo: 0, }`。
       */
      data() {
        return {
          foo: 0,
          $foo: 0,
        }
      },
      computed: {
        /**
         * 若被求值就抛错的 computed getter；本例只执行 in 检查，成功通过说明检查键存在没有读取 computed 的值。
         */
        cmp: () => {
          throw new Error('value of cmp should not be accessed')
        },
        /**
         * 带 $ 前缀的抛错 computed getter；本例只检查键存在，应不触发 getter 求值或错误。
         */
        $cmp: () => {
          throw new Error('value of $cmp should not be read')
        },
      },
      /**
       * 返回 `bar` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          bar: 1,
        }
      },
      __cssModules: {
        $style: {},
        cssStyles: {},
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }

    const app = createApp(Comp, { msg: 'hello' })
    app.config.globalProperties.global = 1
    app.config.globalProperties.$global = 1

    app.mount(nodeOps.createElement('div'))

    // 已声明 props 的存在性。
    expect('msg' in instanceProxy).toBe(true)
    // 普通 data 字段存在，保留前缀 data 字段不通过 this 暴露。
    expect('foo' in instanceProxy).toBe(true)
    expect('$foo' in instanceProxy).toBe(false)
    // 普通 setup binding 的存在性。
    expect('bar' in instanceProxy).toBe(true)
    // computed 已在 ctx 中定义，但 has 不应执行其 getter。
    expect('cmp' in instanceProxy).toBe(true)
    expect('$cmp' in instanceProxy).toBe(true)
    // 内置公共属性的存在性。
    expect('$el' in instanceProxy).toBe(true)
    // CSS Modules 注册的样式映射也可按键访问。
    expect('$style' in instanceProxy).toBe(true)
    expect('cssStyles' in instanceProxy).toBe(true)
    // 应用全局属性参与存在性查找。
    expect('global' in instanceProxy).toBe(true)
    expect('$global' in instanceProxy).toBe(true)

    // 没有声明的键应返回 false。
    expect('$foobar' in instanceProxy).toBe(false)
    expect('baz' in instanceProxy).toBe(false)

    // #4962：读取缺失键留下 OTHER 缓存，但这个缓存不能让 in 变为 true。
    // 随后再次检查普通键与 $ 键，仍应不存在。
    instanceProxy.baz
    instanceProxy.$baz
    expect('baz' in instanceProxy).toBe(false)
    expect('$baz' in instanceProxy).toBe(false)

    // 新增键写入 ctx 后，in 应变为 true。
    instanceProxy.baz = 1
    expect('baz' in instanceProxy).toBe(true)
    instanceProxy.$baz = 1
    expect('$baz' in instanceProxy).toBe(true)

    // 开发 ctx 的可枚举字段供控制台检查。
    // 断言中只列出当前目标实际定义的键。
    expect(Object.keys(instanceProxy)).toMatchObject([
      'msg',
      'bar',
      'foo',
      'cmp',
      '$cmp',
      'baz',
      '$baz',
    ])
  })

  // 用 Object.defineProperty 反复将 setup 字段改为值或 getter，公共实例始终读取新描述符。
  test('allow updating proxy with Object.defineProperty', () => {
    let instanceProxy: any
    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 返回 `isDisplayed` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          isDisplayed: true,
        }
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }

    const app = createApp(Comp)

    app.mount(nodeOps.createElement('div'))

    Object.defineProperty(instanceProxy, 'isDisplayed', { value: false })

    expect(instanceProxy.isDisplayed).toBe(false)

    Object.defineProperty(instanceProxy, 'isDisplayed', { value: true })

    expect(instanceProxy.isDisplayed).toBe(true)

    Object.defineProperty(instanceProxy, 'isDisplayed', {
      /**
       * 读取探针 返回 `false`。
       */
      get() {
        return false
      },
    })

    expect(instanceProxy.isDisplayed).toBe(false)

    Object.defineProperty(instanceProxy, 'isDisplayed', {
      /**
       * 读取探针 返回 `true`。
       */
      get() {
        return true
      },
    })

    expect(instanceProxy.isDisplayed).toBe(true)
  })

  // 先缓存 setup 方法入口，再改为 getter 并安装 spy；检查 getter 调用次数，确认描述符变化不会被旧缓存遮住。
  test('allow test runner spying on proxy methods with Object.defineProperty', () => {
    // #5417
    let instanceProxy: any
    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 返回 `toggle` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          /**
           * 返回 `'a'`。
           */
          toggle() {
            return 'a'
          },
        }
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }

    const app = createApp(Comp)

    app.mount(nodeOps.createElement('div'))

    // 先读取 toggle，令来源缓存记住 setup binding。
    const v1 = instanceProxy.toggle()
    expect(v1).toEqual('a')

    // 把 toggle 重定义为 ctx getter，使旧来源缓存必须失效。
    let getCalledTimes = 0
    Object.defineProperty(instanceProxy, 'toggle', {
      /**
       * 递增 getCalledTimes 并返回一个结果为 b 的函数；vi.spyOn 的读取、调用和恢复过程据此检查 getter 的执行次数。
       */
      get() {
        getCalledTimes++
        return () => 'b'
      },
    })

    // 定义描述符本身不应调用 getter。
    expect(getCalledTimes).toEqual(0)

    // 重定义后再次访问，必须走新 getter。
    const v2 = instanceProxy.toggle()
    expect(v2).toEqual('b')
    expect(getCalledTimes).toEqual(1)

    // 缓存可以记来源，不能缓存 getter 的返回函数；每次读取仍应调用 getter。
    instanceProxy.toggle()
    expect(getCalledTimes).toEqual(2)

    // 安装 spy 会读取一次 getter，并把该属性替换为 spy 包装器。
    // spy 也通过 Object.defineProperty 更新描述符。
    const spy = vi.spyOn(instanceProxy, 'toggle')
    expect(getCalledTimes).toEqual(3)

    const v3 = instanceProxy.toggle()
    expect(v3).toEqual('b')
    expect(spy).toHaveBeenCalled()
    expect(getCalledTimes).toEqual(3)
  })

  // 先读取 setup 字段，再用值描述符改为 b 和 null，公共实例读取应随之变化。
  test('defineProperty on proxy property with value descriptor', () => {
    // #5417
    let instanceProxy: any
    const Comp = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 返回 `toggle` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          toggle: 'a',
        }
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }

    const app = createApp(Comp)

    app.mount(nodeOps.createElement('div'))

    const v1 = instanceProxy.toggle
    expect(v1).toEqual('a')

    Object.defineProperty(instanceProxy, 'toggle', {
      value: 'b',
    })
    const v2 = instanceProxy.toggle
    expect(v2).toEqual('b')

    // value:null 也是有效值描述符，不应被当作没有 value。
    Object.defineProperty(instanceProxy, 'toggle', {
      value: null,
    })
    const v3 = instanceProxy.toggle
    expect(v3).toBeNull()
  })

  // 分别重定义 data、computed、setup 和 prop 字段的 getter，检查公共实例采用新描述符。
  test('defineProperty on public instance proxy should work with SETUP,DATA,CONTEXT,PROPS', () => {
    // #5417
    let instanceProxy: any
    const Comp = {
      props: ['fromProp'],
      /**
       * 建立每实例初始 data：`{ name: 'data.name' }`。
       */
      data() {
        return { name: 'data.name' }
      },
      computed: {
        /**
         * 返回 `'Hi ' + (this as any).name`。
         */
        greet() {
          return 'Hi ' + (this as any).name
        },
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 返回 `fromSetup` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          fromSetup: true,
        }
      },
      /**
       * 在 mounted 阶段写入 `instanceProxy` 供后续观察或触发更新。
       */
      mounted() {
        instanceProxy = this
      },
    }

    const app = createApp(Comp, {
      fromProp: true,
    })

    app.mount(nodeOps.createElement('div'))
    expect(instanceProxy.greet).toEqual('Hi data.name')

    // 把原 data 名称重定义为 ctx getter。
    Object.defineProperty(instanceProxy, 'name', {
      /**
       * 读取探针 返回 `'getter.name'`。
       */
      get() {
        return 'getter.name'
      },
    })

    // 重定义 ctx 描述符未改变原 data，computed 继续复用缓存值。
    expect(instanceProxy.greet).toEqual('Hi data.name')

    // 写入原 data 字段，使 computed 标脏后重新读取公共代理。
    instanceProxy.name = ''

    // computed 重算时应通过失效后的来源缓存读取新的 ctx getter。
    expect(instanceProxy.greet).toEqual('Hi getter.name')

    // 覆盖 computed 的 ctx 描述符。
    Object.defineProperty(instanceProxy, 'greet', {
      /**
       * 读取探针 返回 `'Hi greet.getter.computed'`。
       */
      get() {
        return 'Hi greet.getter.computed'
      },
    })
    expect(instanceProxy.greet).toEqual('Hi greet.getter.computed')

    // 用 getter 覆盖 setupState 名称，检查新来源。
    expect(instanceProxy.fromSetup).toBe(true)
    Object.defineProperty(instanceProxy, 'fromSetup', {
      /**
       * 读取探针 返回 `false`。
       */
      get() {
        return false
      },
    })
    expect(instanceProxy.fromSetup).toBe(false)

    // 用 getter 覆盖 prop 名称的公开描述符，检查新来源。
    expect(instanceProxy.fromProp).toBe(true)
    Object.defineProperty(instanceProxy, 'fromProp', {
      /**
       * 读取探针 返回 `false`。
       */
      get() {
        return false
      },
    })
    expect(instanceProxy.fromProp).toBe(false)
  })

  // #864
  // 声明 test 但不传值，渲染读取它时不触发“实例未定义该属性”的警告。
  test('should not warn declared but absent props', () => {
    const Comp = {
      props: ['test'],
      /**
       * 渲染结果为 `this.test`。
       */
      render(this: any) {
        return this.test
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(
      `was accessed during render but is not defined`,
    ).not.toHaveBeenWarned()
  })

  // 渲染时读取 Symbol.unscopables 不抛错，并能生成包含该 Symbol 的未定义属性警告。
  test('should allow symbol to access on render', () => {
    const Comp = {
      /**
       * 渲染结果为 `'1'` 或 `'2'`。
       */
      render() {
        if ((this as any)[Symbol.unscopables]) {
          return '1'
        }
        return '2'
      },
    }

    const app = createApp(Comp)
    app.mount(nodeOps.createElement('div'))

    expect(
      `Property ${JSON.stringify(
        Symbol.unscopables,
      )} was accessed during render ` + `but is not defined on instance.`,
    ).toHaveBeenWarned()
  })

  // 带 __isScriptSetup 标记的 foo 不暴露给公共实例，尝试通过 this 改写时发出绑定不可修改的警告。
  test('should prevent mutating script setup bindings', () => {
    const Comp = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 返回 `__isScriptSetup`、`foo` 作为后续渲染可读的绑定。
       */
      setup() {
        return {
          __isScriptSetup: true,
          foo: 1,
        }
      },
      /**
       * 在 mounted 阶段执行 `expect('foo' in this).toBe(false)`、`expect('foo' in this)`；写入 `this.foo` 供后续观察或触发更新。
       */
      mounted() {
        expect('foo' in this).toBe(false)
        try {
          this.foo = 123
        } catch (e) {}
      },
    })
    render(h(Comp), nodeOps.createElement('div'))
    expect(`Cannot mutate <script setup> binding "foo"`).toHaveBeenWarned()
  })
})
