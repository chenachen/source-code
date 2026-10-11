/**
 * 渲染真实父子组件，检查 provide 的继承与覆盖、inject 的默认值及响应式值共享。
 * readonly 写入和错误调用位置用警告断言验证，runWithContext 用例检查组件外注入上下文。
 */
import {
  type InjectionKey,
  type Ref,
  defineComponent,
  h,
  hasInjectionContext,
  inject,
  nextTick,
  onMounted,
  provide,
  reactive,
  readonly,
  ref,
} from '../src/index'
import { createApp, nodeOps, render, serialize } from '@vue/runtime-test'

// 祖先依赖注入的继承、覆盖、默认值与共享响应式状态。
describe('api: provide/inject', () => {
  // 字符串键沿祖先 provides 传到隔层消费组件。
  it('string keys', () => {
    const Provider = {
      /**
       * 调用 `provide('foo', 1)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('foo', 1)
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('foo')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `foo`。
       */
      setup() {
        const foo = inject('foo')
        return () => foo
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)
  })

  // 以 InjectionKey<number> 的 Symbol 键提供 1，挂载隔层消费组件并断言文本为 2；消费方回退值也为 1，此输出不能单独区分注入成功与回退。
  it('symbol keys', () => {
    // InjectionKey<number> 让提供和消费代码共享静态值类型；此处运行时只断言文本 2。
    const key: InjectionKey<number> = Symbol()

    const Provider = {
      /**
       * 调用 `provide(key, 1)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide(key, 1)
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject(key)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `foo + 1`。
       */
      setup() {
        const foo = inject(key) || 1
        return () => foo + 1
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 已提供的键忽略默认值，缺失键返回默认值。
  it('default values', () => {
    const Provider = {
      /**
       * 调用 `provide('foo', 'foo')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('foo', 'foo')
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('foo', 'fooDefault')`、`inject('bar', 'bar')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `foo + bar`。
       */
      setup() {
        // 祖先已提供 foo，应忽略 fooDefault。
        const foo = inject('foo', 'fooDefault')
        // 祖先未提供 bar，采用传入默认值。
        const bar = inject('bar', 'bar')
        return () => foo + bar
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>foobar</div>`)
  })

  // Options inject 的默认值工厂以消费组件的公共实例作为 this。
  it('bound to instance', () => {
    const Provider = {
      /**
       * 返回渲染闭包，执行时产出 `h(Consumer)`。
       */
      setup() {
        return () => h(Consumer)
      },
    }

    const Consumer = defineComponent({
      name: 'Consumer',
      inject: {
        foo: {
          from: 'foo',
          /**
           * 注入缺失时的默认工厂，以消费组件公共实例为 this 读取其 $options.name；供断言验证默认工厂的 this 绑定。
           */
          default() {
            return this!.$options.name
          },
        },
      },
      /**
       * 渲染结果为 `this.foo`。
       */
      render() {
        return this.foo
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>Consumer</div>`)
  })

  // 子提供者覆盖同名键，其他键继续继承，并可添加自己的键。
  it('nested providers', () => {
    const ProviderOne = {
      /**
       * 调用 `provide('foo', 'foo')`、`provide('bar', 'bar')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(ProviderTwo)`。
       */
      setup() {
        provide('foo', 'foo')
        provide('bar', 'bar')
        return () => h(ProviderTwo)
      },
    }

    const ProviderTwo = {
      /**
       * 调用 `provide('foo', 'fooOverride')`、`provide('baz', 'baz')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Consumer)`。
       */
      setup() {
        // 当前提供者只遮蔽父级 foo，其他键继续继承。
        provide('foo', 'fooOverride')
        provide('baz', 'baz')
        return () => h(Consumer)
      },
    }

    const Consumer = {
      /**
       * 调用 `inject('foo')`、`inject('bar')`、`inject('baz')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `[foo, bar, baz].join(',')`。
       */
      setup() {
        const foo = inject('foo')
        const bar = inject('bar')
        const baz = inject('baz')
        return () => [foo, bar, baz].join(',')
      },
    }

    const root = nodeOps.createElement('div')
    render(h(ProviderOne), root)
    expect(serialize(root)).toBe(`<div>fooOverride,bar,baz</div>`)
  })

  // 注入同一 ref，提供方修改 value 后消费组件更新。
  it('reactivity with refs', async () => {
    const count = ref(1)

    const Provider = {
      /**
       * 调用 `provide('count', count)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('count', count)
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('count')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        const count = inject<Ref<number>>('count')!
        return () => count.value
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)

    count.value++
    await nextTick()
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 注入 readonly ref 拒绝消费方写入，但仍响应提供方对原 ref 的修改。
  it('reactivity with readonly refs', async () => {
    const count = ref(1)

    const Provider = {
      /**
       * 调用 `provide('count', readonly(count))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('count', readonly(count))
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('count')` 完成本例的初始化登记或读取；把 `count.value` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        const count = inject<Ref<number>>('count')!
        // 对注入的 readonly 包装器写入应被拒绝。
        count.value++
        return () => count.value
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)

    expect(
      `Set operation on key "value" failed: target is readonly`,
    ).toHaveBeenWarned()

    // 提供方修改原 ref 后，readonly 消费视图仍应更新。
    count.value++
    await nextTick()
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 注入 reactive 对象保留共享引用，提供方修改属性后消费组件更新。
  it('reactivity with objects', async () => {
    const rootState = reactive({ count: 1 })

    const Provider = {
      /**
       * 调用 `provide('state', rootState)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('state', rootState)
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('state')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `state.count`。
       */
      setup() {
        const state = inject<typeof rootState>('state')!
        return () => state.count
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)

    rootState.count++
    await nextTick()
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 注入 readonly 对象拒绝消费方写入，但仍响应提供方对原 reactive 对象的修改。
  it('reactivity with readonly objects', async () => {
    const rootState = reactive({ count: 1 })

    const Provider = {
      /**
       * 调用 `provide('state', readonly(rootState))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        provide('state', readonly(rootState))
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('state')` 完成本例的初始化登记或读取；把 `state.count` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `state.count`。
       */
      setup() {
        const state = inject<typeof rootState>('state')!
        // 对注入的 readonly 包装器写入应被拒绝。
        state.count++
        return () => state.count
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)

    expect(
      `Set operation on key "count" failed: target is readonly`,
    ).toHaveBeenWarned()

    rootState.count++
    await nextTick()
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 没有默认值的缺失注入返回 undefined，并触发 injection not found 警告。
  it('should warn unfound', () => {
    const Provider = {
      /**
       * 返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('foo')` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `foo`。
       */
      setup() {
        const foo = inject('foo')
        expect(foo).toBeUndefined()
        return () => foo
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div><!----></div>`)
    expect(`injection "foo" not found.`).toHaveBeenWarned()
  })

  // 显式传入 undefined 默认值时，缺失键不触发 injection not found 警告。
  it('should not warn when default value is undefined', () => {
    const Provider = {
      /**
       * 返回渲染闭包，执行时产出 `h(Middle)`。
       */
      setup() {
        return () => h(Middle)
      },
    }

    const Middle = {
      /**
       * 渲染结果为 `h(Consumer)`。
       */
      render: () => h(Consumer),
    }

    const Consumer = {
      /**
       * 调用 `inject('foo', undefined)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `foo`。
       */
      setup() {
        const foo = inject('foo', undefined)
        return () => foo
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(`injection "foo" not found.`).not.toHaveBeenWarned()
  })

  // #2400
  // 组件 inject 从父级开始查找，不读取它自己刚 provide 的值。
  it('should not self-inject', () => {
    const Comp = {
      /**
       * 调用 `provide('foo', 'foo')`、`inject('foo', null)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `injection`。
       */
      setup() {
        provide('foo', 'foo')
        const injection = inject('foo', null)
        return () => injection
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serialize(root)).toBe(`<div><!----></div>`)
  })

  // hasInjectionContext 判断当前调用位置是否允许安全使用 inject。
  describe('hasInjectionContext', () => {
    // 没有组件或 App 注入上下文时，hasInjectionContext 返回 false。
    it('should be false outside of setup', () => {
      expect(hasInjectionContext()).toBe(false)
    })

    // 组件 setup 内存在注入上下文，hasInjectionContext 返回 true。
    it('should be true within setup', () => {
      expect.assertions(1)
      const Comp = {
        /**
         * 调用 `hasInjectionContext()` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
         */
        setup() {
          expect(hasInjectionContext()).toBe(true)
          return () => null
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
    })

    // app.runWithContext 执行期间，hasInjectionContext 返回 true。
    it('should be true within app.runWithContext()', () => {
      expect.assertions(1)
      createApp({}).runWithContext(() => {
        expect(hasInjectionContext()).toBe(true)
      })
    })
  })

  // 错误使用警告。
  describe('warnings for incorrect usage', () => {
    // 没有活动实例或 App 上下文时，调用 inject 会警告。
    it('should warn when inject() is called outside setup', () => {
      inject('foo', 'bar')
      expect(`inject() can only be used`).toHaveBeenWarned()
    })

    // 没有活动组件实例时，调用 provide 会警告。
    it('should warn when provide() is called outside setup', () => {
      provide('foo', 'bar')
      expect(`provide() can only be used`).toHaveBeenWarned()
    })

    // 普通组件 render 期间没有 setup 的 currentInstance，调用 provide 会警告。
    it('should warn when provide() is called from a render function', () => {
      const Provider = {
        /**
         * 返回渲染闭包，执行时执行 `provide('foo', 'bar')`。
         */
        setup() {
          return () => {
            provide('foo', 'bar')
          }
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Provider), root)
      expect(`provide() can only be used`).toHaveBeenWarned()
    })

    // onMounted 调用 provide 时，实例已挂载，因此开发环境会警告。
    it('should warn when provide() is called from onMounted', () => {
      const Provider = {
        /**
         * 调用 `onMounted(() => { provide('foo', 'bar'); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
         */
        setup() {
          onMounted(() => {
            provide('foo', 'bar')
          })

          return () => null
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Provider), root)
      expect(`provide() can only be used`).toHaveBeenWarned()
    })
  })
})
