/**
 * 测试阅读说明：本文件验证 `runtime-core/apiCreateApp` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
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

// 测试组：createApp 的挂载、上下文、插件、配置、资源注册与卸载行为。
describe('api: createApp', () => {
  // 测试场景：app.mount 创建根组件实例、设置容器关联并防止重复挂载。
  test('mount', () => {
    const Comp = defineComponent({
      props: {
        count: {
          default: 0,
        },
      },
      setup(props) {
        return () => props.count
      },
    })

    const root1 = nodeOps.createElement('div')
    createApp(Comp).mount(root1)
    expect(serializeInner(root1)).toBe(`0`)
    //#5571 mount multiple apps to the same host element
    createApp(Comp).mount(root1)
    expect(
      `There is already an app instance mounted on the host container`,
    ).toHaveBeenWarned()

    // mount with props
    const root2 = nodeOps.createElement('div')
    const app2 = createApp(Comp, { count: 1 })
    app2.mount(root2)
    expect(serializeInner(root2)).toBe(`1`)

    // remount warning
    const root3 = nodeOps.createElement('div')
    app2.mount(root3)
    expect(serializeInner(root3)).toBe(``)
    expect(`already been mounted`).toHaveBeenWarned()
  })

  // 测试场景：app.unmount 清理根组件、容器引用和应用级副作用。
  test('unmount', () => {
    const Comp = defineComponent({
      props: {
        count: {
          default: 0,
        },
      },
      setup(props) {
        return () => props.count
      },
    })

    const root = nodeOps.createElement('div')
    const app = createApp(Comp)

    // warning
    app.unmount()
    expect(`that is not mounted`).toHaveBeenWarned()

    app.mount(root)

    app.unmount()
    expect(serializeInner(root)).toBe(``)
  })

  // 测试场景：app.provide 让整棵应用组件树注入应用级依赖。
  test('provide', () => {
    const Root = {
      setup() {
        // test override
        provide('foo', 3)
        return () => h(Child)
      },
    }

    const Child = {
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

  // 测试场景：runWithContext 临时激活应用上下文，使组件外部也能使用 inject。
  test('runWithContext', () => {
    const app = createApp({
      setup() {
        provide('foo', 'should not be seen')

        // nested createApp
        const childApp = createApp({
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

    // ensure the context is restored
    inject('foo')
    expect('inject() can only be used inside setup').toHaveBeenWarned()
  })

  // 测试场景：app.component 注册、查询和覆盖全局组件。
  test('component', () => {
    const Root = {
      // local override
      components: {
        BarBaz: () => 'barbaz-local!',
      },
      setup() {
        // resolve in setup
        const FooBar = resolveComponent('foo-bar')
        return () => {
          // resolve in render
          const BarBaz = resolveComponent('bar-baz')
          return h('div', [h(FooBar), h(BarBaz)])
        }
      },
    }

    const app = createApp(Root)

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

  // 测试场景：app.directive 注册、查询和覆盖全局指令。
  test('directive', () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const spy3 = vi.fn()

    const Root = {
      // local override
      directives: {
        BarBaz: { mounted: spy3 },
      },
      setup() {
        // resolve in setup
        const FooBar = resolveDirective('foo-bar')
        return () => {
          // resolve in render
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

  // 测试场景：app.mixin 把全局 mixin 合并到应用中的组件选项。
  test('mixin', () => {
    const calls: string[] = []
    const mixinA = {
      data() {
        return {
          a: 1,
        }
      },
      created(this: any) {
        calls.push('mixinA created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.c).toBe(3)
      },
      mounted() {
        calls.push('mixinA mounted')
      },
    }
    const mixinB = {
      name: 'mixinB',
      data() {
        return {
          b: 2,
        }
      },
      created(this: any) {
        calls.push('mixinB created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.c).toBe(3)
      },
      mounted() {
        calls.push('mixinB mounted')
      },
    }
    const Comp = {
      data() {
        return {
          c: 3,
        }
      },
      created(this: any) {
        calls.push('comp created')
        expect(this.a).toBe(1)
        expect(this.b).toBe(2)
        expect(this.c).toBe(3)
      },
      mounted() {
        calls.push('comp mounted')
      },
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

  // 测试场景：app.use 安装函数或对象插件，并按插件身份去重。
  test('use', () => {
    const PluginA: Plugin = app => app.provide('foo', 1)
    const PluginB: Plugin = {
      install: (app, arg1, arg2) => app.provide('bar', arg1 + arg2),
    }
    class PluginC {
      someProperty = {}
      static install() {
        app.provide('baz', 2)
      }
    }
    const PluginD: any = undefined

    const Root = {
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

  // 测试场景：app.onUnmount 登记的清理函数在应用卸载时执行一次。
  test('onUnmount', () => {
    const cleanup = vi.fn().mockName('plugin cleanup')
    const PluginA: Plugin = app => {
      app.provide('foo', 1)
      app.onUnmount(cleanup)
    }
    const PluginB: Plugin = {
      install: (app, arg1, arg2) => {
        app.provide('bar', arg1 + arg2)
        app.onUnmount(cleanup)
      },
    }

    const app = createApp({
      render: () => `Test`,
    })
    app.use(PluginA)
    app.use(PluginB)

    const root = nodeOps.createElement('div')
    app.mount(root)

    //also can be added after mount
    app.onUnmount(cleanup)

    app.unmount()

    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  // 测试场景：app.config.errorHandler 接收组件树中未被捕获的运行时错误。
  test('config.errorHandler', () => {
    const error = new Error()
    const count = ref(0)

    const handler = vi.fn((err, instance, info) => {
      expect(err).toBe(error)
      expect(instance.count).toBe(count.value)
      expect(info).toBe(`render function`)
    })

    const Root = {
      setup() {
        const count = ref(0)
        return {
          count,
        }
      },
      render() {
        throw error
      },
    }

    const app = createApp(Root)
    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))
    expect(handler).toHaveBeenCalled()
  })

  // 测试场景：app.config.warnHandler 接收开发期警告及组件追踪信息。
  test('config.warnHandler', () => {
    let ctx: any
    const handler = vi.fn((msg, instance, trace) => {
      expect(msg).toMatch(`Component is missing template or render function`)
      expect(instance).toBe(ctx.proxy)
      expect(trace).toMatch(`Hello`)
    })

    const Root = {
      name: 'Hello',
      setup() {
        ctx = getCurrentInstance()
      },
    }

    const app = createApp(Root)
    app.config.warnHandler = handler
    app.mount(nodeOps.createElement('div'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // 测试组：app.config.isNativeTag 的配置、调用方式和只读约束。
  describe('config.isNativeTag', () => {
    const isNativeTag = vi.fn(tag => tag === 'div')

    // 测试场景：app.component 使用组件自身 name 作为省略显式名称时的注册 key。
    test('Component.name', () => {
      const Root = {
        name: 'div',
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

    // 测试场景：app.component 注册的组件可以包含并解析自己的局部 components。
    test('Component.components', () => {
      const Root = {
        components: {
          div: () => 'div',
        },
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

    // 测试场景：app.component 注册的组件可以包含并解析自己的局部 directives。
    test('Component.directives', () => {
      const Root = {
        directives: {
          bind: () => {},
        },
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

    // 测试场景：使用app.component注册。
    test('register using app.component', () => {
      const app = createApp({
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

  // 测试场景：config.optionMergeStrategies 自定义 Options API 字段的合并方式。
  test('config.optionMergeStrategies', () => {
    let merged: string
    const App = defineComponent({
      render() {},
      mixins: [{ foo: 'mixin' }],
      extends: { foo: 'extends' },
      foo: 'local',
      beforeCreate() {
        merged = this.$options.foo
      },
    })

    const app = createApp(App)
    app.mixin({
      foo: 'global',
    })
    app.config.optionMergeStrategies.foo = (a, b) => (a ? `${a},` : ``) + b

    app.mount(nodeOps.createElement('div'))
    expect(merged!).toBe('global,extends,mixin,local')
  })

  // 测试场景：app.config.globalProperties 为应用内组件公共实例提供全局属性。
  test('config.globalProperties', () => {
    const app = createApp({
      render() {
        return this.foo
      },
    })
    app.config.globalProperties.foo = 'hello'
    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(serializeInner(root)).toBe('hello')
  })

  // 测试场景：config.throwUnhandledErrorInProduction 控制生产环境未处理错误是否继续抛出。
  test('config.throwUnhandledErrorInProduction', () => {
    __DEV__ = false
    try {
      const err = new Error()
      const app = createApp({
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

  // 测试场景：返回属性“_”不应覆盖“ctx._”，__isScriptSetup：false。
  test('return property "_" should not overwrite "ctx._", __isScriptSetup: false', () => {
    const Comp = defineComponent({
      setup() {
        return {
          _: ref(0), // return property "_" should not overwrite "ctx._"
        }
      },
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

  // 测试场景：返回属性“_”不应覆盖“ctx._”，__isScriptSetup：true。
  test('return property "_" should not overwrite "ctx._", __isScriptSetup: true', () => {
    const Comp = defineComponent({
      setup() {
        return {
          _: ref(0), // return property "_" should not overwrite "ctx._"
          __isScriptSetup: true, // mock __isScriptSetup = true
        }
      },
      render() {
        return h('input', {
          ref: 'input',
        })
      },
    })

    const root1 = nodeOps.createElement('div')
    const app = createApp(Comp).mount(root1)

    // trigger
    app.$refs.input

    expect(
      `TypeError: Cannot read property '__isScriptSetup' of undefined`,
    ).not.toHaveBeenWarned()
  })

  // #10005
  // 测试场景：嵌套 createApp 上的齐平顺序边缘情况。
  test('flush order edge case on nested createApp', async () => {
    const order: string[] = []
    const App = defineComponent({
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
  // 测试场景：卸载新应用程序不应触发其他应用程序的watcher。
  test("unmount new app should not trigger other app's watcher", async () => {
    const compWatcherTriggerFn = vi.fn()
    const data = ref(true)
    const foo = ref('')

    const createNewApp = () => {
      const app = createApp({ render: () => h('new app') })
      const wrapper = nodeOps.createElement('div')
      app.mount(wrapper)
      return function destroy() {
        app.unmount()
      }
    }

    const Comp = defineComponent({
      setup() {
        watch(() => foo.value, compWatcherTriggerFn)
        return () => h('div', 'comp')
      },
    })

    const App = defineComponent({
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

  // config.compilerOptions is tested in packages/vue since it is only
  // supported in the full build.
})
