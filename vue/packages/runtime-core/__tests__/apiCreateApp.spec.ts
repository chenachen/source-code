/**
 * 通过 runtime-test 宿主节点挂载 App，检查插件、注册表、注入上下文和配置的实际作用。
 * 卸载、重复挂载及错误配置用例分别核对宿主输出、调用次数或开发警告。
 */
import {
  type Plugin,
  createApp,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  nextTick,
  nodeOps,
  onMounted,
  provide,
  ref,
  resolveComponent,
  resolveDirective,
  serializeInner,
  watch,
  withDirectives,
} from '@vue/runtime-test'

// createApp 的挂载、上下文、插件、配置、资源注册与卸载行为。
describe('api: createApp', () => {
  // 挂载根 props 并检查宿主输出；同容器另挂 App 和同 App 再次 mount 分别触发警告。
  test('mount', () => {
    const Comp = defineComponent({
      props: {
        count: {
          default: 0,
        },
      },
      /**
       * 返回渲染闭包，执行时产出 `props.count`。
       */
      setup(props) {
        return () => props.count
      },
    })

    const root1 = nodeOps.createElement('div')
    createApp(Comp).mount(root1)
    expect(serializeInner(root1)).toBe(`0`)
    //#5571：另一 App 再次挂到同一容器时给出警告。
    createApp(Comp).mount(root1)
    expect(
      `There is already an app instance mounted on the host container`,
    ).toHaveBeenWarned()

    // 挂载时传入根 props，覆盖 count 默认值。
    const root2 = nodeOps.createElement('div')
    const app2 = createApp(Comp, { count: 1 })
    app2.mount(root2)
    expect(serializeInner(root2)).toBe(`1`)

    // 同一 App 再次挂载时警告，新容器仍为空。
    const root3 = nodeOps.createElement('div')
    app2.mount(root3)
    expect(serializeInner(root3)).toBe(``)
    expect(`already been mounted`).toHaveBeenWarned()
  })

  // 未挂载时 unmount 会警告；挂载后 unmount 清空根组件的宿主输出。
  test('unmount', () => {
    const Comp = defineComponent({
      props: {
        count: {
          default: 0,
        },
      },
      /**
       * 返回渲染闭包，执行时产出 `props.count`。
       */
      setup(props) {
        return () => props.count
      },
    })

    const root = nodeOps.createElement('div')
    const app = createApp(Comp)

    // 尚未挂载，卸载调用应给出警告。
    app.unmount()
    expect(`that is not mounted`).toHaveBeenWarned()

    app.mount(root)

    app.unmount()
    expect(serializeInner(root)).toBe(``)
  })

  // app.provide 作为注入根，根组件 provide 覆盖同名值，并检查缺失键和重复提供警告。
  test('provide', () => {
    const Root = {
      /**
       * 调用 `provide('foo', 3)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Child)`。
       */
      setup() {
        // 根组件 provide 遮蔽 app.provide 的同名值。
        provide('foo', 3)
        return () => h(Child)
      },
    }

    const Child = {
      /**
       * 调用 `inject('foo')`、`inject('bar')`、`inject('__proto__')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `` `${foo},${bar}` ``。
       */
      setup() {
        const foo = inject('foo')
        const bar = inject('bar')
        try {
          inject('__proto__')
        } catch (e: any) {}
        return () => `${foo},${bar}`
      },
    }

    const app = createApp(Root)
    app.provide('foo', 1)
    app.provide('bar', 2)

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe(`3,2`)
    expect('[Vue warn]: injection "__proto__" not found.').toHaveBeenWarned()

    const app2 = createApp(Root)
    app2.provide('bar', 1)
    app2.provide('bar', 2)
    expect(`App already provides property with key "bar".`).toHaveBeenWarned()
  })

  // runWithContext 优先使用当前 App 的 provides，嵌套调用后恢复外层与组件外上下文。
  test('runWithContext', () => {
    const app = createApp({
      /**
       * 调用 `provide('foo', 'should not be seen')`、`createApp({ setup() { provide('foo', 'foo from child'); }, })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        provide('foo', 'should not be seen')

        // 在外层 setup 内创建另一应用，检查 runWithContext 优先选当前 App。
        const childApp = createApp({
          /**
           * 调用 `provide('foo', 'foo from child')` 完成本例的初始化登记或读取。
           */
          setup() {
            provide('foo', 'foo from child')
          },
        })

        childApp.provide('foo', 2)
        expect(childApp.runWithContext(() => inject('foo'))).toBe(2)

        return () => h('div')
      },
    })
    app.provide('foo', 1)

    expect(app.runWithContext(() => inject('foo'))).toBe(1)
    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(
      app.runWithContext(() => {
        app.runWithContext(() => {})
        return inject('foo')
      }),
    ).toBe(1)

    // runWithContext 返回后恢复组件外状态，inject 再次调用应警告。
    inject('foo')
    expect('inject() can only be used inside setup').toHaveBeenWarned()
  })

  // 全局组件可注册、查询和覆盖；组件局部注册优先于同名全局注册。
  test('component', () => {
    const Root = {
      // 局部同名资源应覆盖应用全局注册。
      components: {
        /**
         * 返回 `'barbaz-local!'`。
         */
        BarBaz: () => 'barbaz-local!',
      },
      /**
       * 返回渲染闭包，执行时产出 `h('div', [h(FooBar), h(BarBaz)])`。
       */
      setup() {
        // setup 执行期间按当前实例解析资源。
        const FooBar = resolveComponent('foo-bar')
        return () => {
          // render 执行期间按渲染实例解析资源。
          const BarBaz = resolveComponent('bar-baz')
          return h('div', [h(FooBar), h(BarBaz)])
        }
      },
    }

    const app = createApp(Root)

    /**
     * 返回 `'foobar!'`。
     */
    const FooBar = () => 'foobar!'
    app.component('FooBar', FooBar)
    expect(app.component('FooBar')).toBe(FooBar)

    app.component('BarBaz', () => 'barbaz!')

    app.component('BarBaz', () => 'barbaz!')
    expect(
      'Component "BarBaz" has already been registered in target app.',
    ).toHaveBeenWarnedTimes(1)

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe(`<div>foobar!barbaz-local!</div>`)
  })

  // 全局指令可注册、查询和覆盖；局部同名指令优先，并检查内置指令名警告。
  test('directive', () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const spy3 = vi.fn()

    const Root = {
      // 局部同名资源应覆盖应用全局注册。
      directives: {
        BarBaz: { mounted: spy3 },
      },
      /**
       * 返回渲染闭包，执行时产出 `withDirectives(h('div'), [[FooBar], [BarBaz]])`。
       */
      setup() {
        // setup 执行期间按当前实例解析资源。
        const FooBar = resolveDirective('foo-bar')
        return () => {
          // render 执行期间按渲染实例解析资源。
          const BarBaz = resolveDirective('bar-baz')
          return withDirectives(h('div'), [[FooBar], [BarBaz]])
        }
      },
    }

    const app = createApp(Root)

    const FooBar = { mounted: spy1 }
    app.directive('FooBar', FooBar)
    expect(app.directive('FooBar')).toBe(FooBar)

    app.directive('BarBaz', {
      mounted: spy2,
    })

    app.directive('BarBaz', {
      mounted: spy2,
    })
    expect(
      'Directive "BarBaz" has already been registered in target app.',
    ).toHaveBeenWarnedTimes(1)

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(spy1).toHaveBeenCalled()
    expect(spy2).not.toHaveBeenCalled()
    expect(spy3).toHaveBeenCalled()

    app.directive('bind', FooBar)
    expect(
      `Do not use built-in directive ids as custom directive id: bind`,
    ).toHaveBeenWarned()
  })

  // 全局 mixin 合并数据与钩子，钩子先于组件自身执行，重复安装同一 mixin 会警告。
  test('mixin', () => {
    const calls: string[] = []
    const mixinA = {
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
        expect(this.c).toBe(3)
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mixinA mounted')`。
       */
      mounted() {
        calls.push('mixinA mounted')
      },
    }
    const mixinB = {
      name: 'mixinB',
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
        expect(this.c).toBe(3)
      },
      /**
       * 在 mounted 阶段执行 `calls.push('mixinB mounted')`。
       */
      mounted() {
        calls.push('mixinB mounted')
      },
    }
    const Comp = {
      /**
       * 建立每实例初始 data：`{ c: 3, }`。
       */
      data() {
        return {
          c: 3,
        }
      },
      /**
       * 在 created 阶段执行 `calls.push('comp created')`、`expect(this.a).toBe(1)`、`expect(this.a)`。
       */
      created(this: any) {
        calls.push('comp created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.c).toBe(3)
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
      render(this: any) {
        return `${this.a}${this.b}${this.c}`
      },
    }

    const app = createApp(Comp)
    app.mixin(mixinA)
    app.mixin(mixinB)

    app.mixin(mixinA)
    app.mixin(mixinB)
    expect(
      'Mixin has already been applied to target app',
    ).toHaveBeenWarnedTimes(2)
    expect(
      'Mixin has already been applied to target app: mixinB',
    ).toHaveBeenWarnedTimes(1)

    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(serializeInner(root)).toBe(`123`)
    expect(calls).toEqual([
      'mixinA created',
      'mixinB created',
      'comp created',
      'mixinA mounted',
      'mixinB mounted',
      'comp mounted',
    ])
  })

  // 函数插件和 install 对象按身份去重；无效插件会警告。
  test('use', () => {
    /**
     * 返回 `app.provide('foo', 1)`。
     */
    const PluginA: Plugin = app => app.provide('foo', 1)
    const PluginB: Plugin = {
      /**
       * 返回 `app.provide('bar', arg1 + arg2)`。
       */
      install: (app, arg1, arg2) => app.provide('bar', arg1 + arg2),
    }
    /**
     * 带静态 install 的类插件夹具；app.use 按对象插件协议调用类的静态方法，不实例化此类。
     */
    class PluginC {
      someProperty = {}
      /**
       * 通过闭包中的 app 提供 baz=2；本用例检查类也可被 app.use 接受，输出只使用 foo/bar。
       */
      static install() {
        app.provide('baz', 2)
      }
    }
    const PluginD: any = undefined

    const Root = {
      /**
       * 调用 `inject('foo')`、`inject('bar')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `` `${foo},${bar}` ``。
       */
      setup() {
        const foo = inject('foo')
        const bar = inject('bar')
        return () => `${foo},${bar}`
      },
    }

    const app = createApp(Root)
    app.use(PluginA)
    app.use(PluginB, 1, 1)
    app.use(PluginC)

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe(`1,2`)

    app.use(PluginA)
    expect(
      `Plugin has already been applied to target app`,
    ).toHaveBeenWarnedTimes(1)

    app.use(PluginD)
    expect(
      `A plugin must either be a function or an object with an "install" ` +
        `function.`,
    ).toHaveBeenWarnedTimes(1)
  })

  // 同一个清理函数登记三次，app.unmount 按三条登记分别调用它。
  test('onUnmount', () => {
    const cleanup = vi.fn().mockName('plugin cleanup')
    /**
     * 执行 `app.provide('foo', 1)`、`app.onUnmount(cleanup)`。
     */
    const PluginA: Plugin = app => {
      app.provide('foo', 1)
      app.onUnmount(cleanup)
    }
    const PluginB: Plugin = {
      /**
       * 执行 `app.provide('bar', arg1 + arg2)`、`app.onUnmount(cleanup)`。
       */
      install: (app, arg1, arg2) => {
        app.provide('bar', arg1 + arg2)
        app.onUnmount(cleanup)
      },
    }

    const app = createApp({
      /**
       * 渲染结果为 `` `Test` ``。
       */
      render: () => `Test`,
    })
    app.use(PluginA)
    app.use(PluginB)

    const root = nodeOps.createElement('div')
    app.mount(root)

    //清理函数也允许在挂载后登记。
    app.onUnmount(cleanup)

    app.unmount()

    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  // 组件 render 抛错后，errorHandler 收到原错误、公共实例和 render function 阶段说明。
  test('config.errorHandler', () => {
    const error = new Error()
    const count = ref(0)

    const handler = vi.fn((err, instance, info) => {
      expect(err).toBe(error)
      expect(instance.count).toBe(count.value)
      expect(info).toBe(`render function`)
    })

    const Root = {
      /**
       * 返回 `count` 作为后续渲染可读的绑定。
       */
      setup() {
        const count = ref(0)
        return {
          count,
        }
      },
      /**
       * 渲染时抛出 `error`，让错误处理断言观察该阶段。
       */
      render() {
        throw error
      },
    }

    const app = createApp(Root)
    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))
    expect(handler).toHaveBeenCalled()
  })

  // 组件缺少 render 时，warnHandler 收到警告、公共实例和组件追踪。
  test('config.warnHandler', () => {
    let ctx: any
    const handler = vi.fn((msg, instance, trace) => {
      expect(msg).toMatch(`Component is missing template or render function`)
      expect(instance).toBe(ctx.proxy)
      expect(trace).toMatch(`Hello`)
    })

    const Root = {
      name: 'Hello',
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `ctx` 写入本例的状态或观察变量。
       */
      setup() {
        ctx = getCurrentInstance()
      },
    }

    const app = createApp(Root)
    app.config.warnHandler = handler
    app.mount(nodeOps.createElement('div'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // 应用配置参与组件保留名检查，指令名另按 Vue 内置指令检查。
  describe('config.isNativeTag', () => {
    const isNativeTag = vi.fn(tag => tag === 'div')

    // 组件 name 命中 isNativeTag 时，挂载会警告该名称是原生标签保留名。
    test('Component.name', () => {
      const Root = {
        name: 'div',
        /**
         * 渲染结果为 `null`。
         */
        render() {
          return null
        },
      }

      const app = createApp(Root)

      Object.defineProperty(app.config, 'isNativeTag', {
        value: isNativeTag,
        writable: false,
      })

      app.mount(nodeOps.createElement('div'))
      expect(
        `Do not use built-in or reserved HTML elements as component id: div`,
      ).toHaveBeenWarned()
    })

    // 局部 components 使用 isNativeTag 识别的原生标签名时会警告。
    test('Component.components', () => {
      const Root = {
        components: {
          /**
           * 返回 `'div'`。
           */
          div: () => 'div',
        },
        /**
         * 渲染结果为 `null`。
         */
        render() {
          return null
        },
      }

      const app = createApp(Root)
      Object.defineProperty(app.config, 'isNativeTag', {
        value: isNativeTag,
        writable: false,
      })

      app.mount(nodeOps.createElement('div'))
      expect(
        `Do not use built-in or reserved HTML elements as component id: div`,
      ).toHaveBeenWarned()
    })

    // 局部 directives 使用 Vue 内置指令名 bind 时会警告。
    test('Component.directives', () => {
      const Root = {
        directives: {
          /**
           * 空 bind 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
           */
          bind: () => {},
        },
        /**
         * 渲染结果为 `null`。
         */
        render() {
          return null
        },
      }

      const app = createApp(Root)
      app.mount(nodeOps.createElement('div'))
      expect(
        `Do not use built-in directive ids as custom directive id: bind`,
      ).toHaveBeenWarned()
    })

    // app.component 注册的名称命中 isNativeTag 时会警告。
    test('register using app.component', () => {
      const app = createApp({
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      })

      Object.defineProperty(app.config, 'isNativeTag', {
        value: isNativeTag,
        writable: false,
      })

      app.component('div', () => 'div')
      app.mount(nodeOps.createElement('div'))
      expect(
        `Do not use built-in or reserved HTML elements as component id: div`,
      ).toHaveBeenWarned()
    })
  })

  // 自定义合并策略按全局 mixin、extends、局部 mixin、组件自身的顺序合并字段。
  test('config.optionMergeStrategies', () => {
    let merged: string
    const App = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      mixins: [{ foo: 'mixin' }],
      extends: { foo: 'extends' },
      foo: 'local',
      /**
       * 在 beforeCreate 阶段写入 `merged` 供后续观察或触发更新。
       */
      beforeCreate() {
        merged = this.$options.foo
      },
    })

    const app = createApp(App)
    app.mixin({
      foo: 'global',
    })
    /**
     * 把前后来源的 foo 串成逗号文本，保留合并顺序，供最终 global,extends,mixin,local 输出断言。
     */
    app.config.optionMergeStrategies.foo = (a, b) => (a ? `${a},` : ``) + b

    app.mount(nodeOps.createElement('div'))
    expect(merged!).toBe('global,extends,mixin,local')
  })

  // 应用的 globalProperties 字段可通过组件公共实例读取并渲染。
  test('config.globalProperties', () => {
    const app = createApp({
      /**
       * 渲染结果为 `this.foo`。
       */
      render() {
        return this.foo
      },
    })
    app.config.globalProperties.foo = 'hello'
    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe('hello')
  })

  // 生产环境开启 throwUnhandledErrorInProduction 后，未处理 setup 错误继续抛出。
  test('config.throwUnhandledErrorInProduction', () => {
    __DEV__ = false
    try {
      const err = new Error()
      const app = createApp({
        /**
         * 在 setup 中故意抛出 `err`，供本例检查初始化错误传播。
         */
        setup() {
          throw err
        },
      })
      app.config.throwUnhandledErrorInProduction = true
      const root = nodeOps.createElement('div')
      expect(() => app.mount(root)).toThrow(err)
    } finally {
      __DEV__ = true
    }
  })

  // 普通 setup 返回保留名 _ 会警告，模板 ref 仍可正常挂载。
  test('return property "_" should not overwrite "ctx._", __isScriptSetup: false', () => {
    const Comp = defineComponent({
      /**
       * 返回 ref 值的保留名 _，故意触发普通 setup 返回键的警告；render 仍创建 input 模板 ref，检查内部 ctx._ 没有被覆盖。
       */
      setup() {
        return {
          _: ref(0), // return property "_" should not overwrite "ctx._"
        }
      },
      /**
       * 渲染结果为 `h('input', { ref: 'input', })`。
       */
      render() {
        return h('input', {
          ref: 'input',
        })
      },
    })

    const root1 = nodeOps.createElement('div')
    createApp(Comp).mount(root1)

    expect(
      `setup() return property "_" should not start with "$" or "_" which are reserved prefixes for Vue internals.`,
    ).toHaveBeenWarned()
  })

  // 模拟 script setup 返回 _ 后，读取 $refs 不触发内部上下文损坏错误。
  test('return property "_" should not overwrite "ctx._", __isScriptSetup: true', () => {
    const Comp = defineComponent({
      /**
       * 返回 _ 与模拟的 __isScriptSetup 标记；结合 input 模板 ref，检查 script setup 绑定不会覆盖内部 ctx._。
       */
      setup() {
        return {
          _: ref(0), // setup 返回的 _ 不应覆盖 ctx._ 的内部实例链接。
          __isScriptSetup: true, // mock __isScriptSetup = true
        }
      },
      /**
       * 渲染结果为 `h('input', { ref: 'input', })`。
       */
      render() {
        return h('input', {
          ref: 'input',
        })
      },
    })

    const root1 = nodeOps.createElement('div')
    const app = createApp(Comp).mount(root1)

    // 读取 $refs，触发公开代理查找。
    app.$refs.input

    expect(
      `TypeError: Cannot read property '__isScriptSetup' of undefined`,
    ).not.toHaveBeenWarned()
  })

  // #10005
  // mounted 中修改状态并嵌套挂载另一个 App，post watcher 仍在第二次 render 后执行。
  test('flush order edge case on nested createApp', async () => {
    const order: string[] = []
    const App = defineComponent({
      /**
       * 调用 `watch(message, () => { order.push('post watcher'); }, { flush: 'post' })`、`onMounted(() => { message.value = 'm2'; createApp(() => '').mount(nodeOps.createElement('div')); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', [message.value])`。
       */
      setup(props) {
        const message = ref('m1')
        watch(
          message,
          () => {
            order.push('post watcher')
          },
          { flush: 'post' },
        )
        onMounted(() => {
          message.value = 'm2'
          createApp(() => '').mount(nodeOps.createElement('div'))
        })
        return () => {
          order.push('render')
          return h('div', [message.value])
        }
      },
    })

    createApp(App).mount(nodeOps.createElement('div'))
    await nextTick()
    expect(order).toMatchObject(['render', 'render', 'post watcher'])
  })

  // #14215
  // 先卸载旧应用的子组件，再卸载新应用；旧子组件已停止的 watcher 不被触发。
  test("unmount new app should not trigger other app's watcher", async () => {
    const compWatcherTriggerFn = vi.fn()
    const data = ref(true)
    const foo = ref('')

    /**
     * 创建并挂载独立应用，返回仅卸载该应用的 destroy；用于复现另一应用的同步 render/unmount 与旧组件 watcher 排队的交互。
     */
    const createNewApp = () => {
      const app = createApp({
        /** 渲染结果为 `h('new app')`。 */ render: () => h('new app')
      })
      const wrapper = nodeOps.createElement('div')
      app.mount(wrapper)
      return /** 卸载刚创建的新应用，触发 renderer 的同步收尾；外层计数断言观察旧组件 watcher 不被错误执行。 */ function destroy() {
        app.unmount()
      }
    }

    const Comp = defineComponent({
      /**
       * 调用 `watch(() => foo.value, compWatcherTriggerFn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', 'comp')`。
       */
      setup() {
        watch(() => foo.value, compWatcherTriggerFn)
        return () => h('div', 'comp')
      },
    })

    const App = defineComponent({
      /**
       * 返回渲染闭包，执行时产出 `(data.value ? h(Comp) : null)`。
       */
      setup() {
        return () => (data.value ? h(Comp) : null)
      },
    })

    createApp(App).mount(nodeOps.createElement('div'))
    await nextTick()

    data.value = false
    const destroy = createNewApp()
    foo.value = 'bar'
    destroy()
    await nextTick()

    expect(compWatcherTriggerFn).toBeCalledTimes(0)
  })

  // config.compilerOptions 需要完整版模板编译器，其用例位于 packages/vue。
  // runtime-test 的此组用例不执行运行时模板编译。
})
