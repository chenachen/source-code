/**
 * 测试阅读说明：本文件验证 `runtime-core/apiInject` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
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

// 测试组：api：提供/注入。
describe('api: provide/inject', () => {
  // 测试场景：字符串键。
  it('string keys', () => {
    const Provider = {
      setup() {
        provide('foo', 1)
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
      setup() {
        const foo = inject('foo')
        return () => foo
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>1</div>`)
  })

  // 测试场景：符号键。
  it('symbol keys', () => {
    // also verifies InjectionKey type sync
    const key: InjectionKey<number> = Symbol()

    const Provider = {
      setup() {
        provide(key, 1)
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
      setup() {
        const foo = inject(key) || 1
        return () => foo + 1
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 测试场景：默认值。
  it('default values', () => {
    const Provider = {
      setup() {
        provide('foo', 'foo')
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
      setup() {
        // default value should be ignored if value is provided
        const foo = inject('foo', 'fooDefault')
        // default value should be used if value is not provided
        const bar = inject('bar', 'bar')
        return () => foo + bar
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>foobar</div>`)
  })

  // 测试场景：绑定到实例。
  it('bound to instance', () => {
    const Provider = {
      setup() {
        return () => h(Consumer)
      },
    }

    const Consumer = defineComponent({
      name: 'Consumer',
      inject: {
        foo: {
          from: 'foo',
          default() {
            return this!.$options.name
          },
        },
      },
      render() {
        return this.foo
      },
    })

    const root = nodeOps.createElement('div')
    render(h(Provider), root)
    expect(serialize(root)).toBe(`<div>Consumer</div>`)
  })

  // 测试场景：嵌套提供者。
  it('nested providers', () => {
    const ProviderOne = {
      setup() {
        provide('foo', 'foo')
        provide('bar', 'bar')
        return () => h(ProviderTwo)
      },
    }

    const ProviderTwo = {
      setup() {
        // override parent value
        provide('foo', 'fooOverride')
        provide('baz', 'baz')
        return () => h(Consumer)
      },
    }

    const Consumer = {
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

  // 测试场景：与refs的反应。
  it('reactivity with refs', async () => {
    const count = ref(1)

    const Provider = {
      setup() {
        provide('count', count)
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
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

  // 测试场景：注入 readonly ref 后仍能响应提供方的更新，并阻止消费方写入。
  it('reactivity with readonly refs', async () => {
    const count = ref(1)

    const Provider = {
      setup() {
        provide('count', readonly(count))
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
      setup() {
        const count = inject<Ref<number>>('count')!
        // should not work
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

    // source mutation should still work
    count.value++
    await nextTick()
    expect(serialize(root)).toBe(`<div>2</div>`)
  })

  // 测试场景：对象形式的 provide/inject 能保持预期的响应式更新。
  it('reactivity with objects', async () => {
    const rootState = reactive({ count: 1 })

    const Provider = {
      setup() {
        provide('state', rootState)
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
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

  // 测试场景：注入 readonly 对象后仍能响应提供方的更新，并阻止消费方写入。
  it('reactivity with readonly objects', async () => {
    const rootState = reactive({ count: 1 })

    const Provider = {
      setup() {
        provide('state', readonly(rootState))
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
      setup() {
        const state = inject<typeof rootState>('state')!
        // should not work
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

  // 测试场景：应该警告未找到。
  it('should warn unfound', () => {
    const Provider = {
      setup() {
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
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

  // 测试场景：显式提供 undefined 作为默认值时，不应误报“未找到注入值”。
  it('should not warn when default value is undefined', () => {
    const Provider = {
      setup() {
        return () => h(Middle)
      },
    }

    const Middle = {
      render: () => h(Consumer),
    }

    const Consumer = {
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
  // 测试场景：不应该自行注射。
  it('should not self-inject', () => {
    const Comp = {
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

  // 测试组：hasInjectionContext 判断当前调用位置是否允许安全使用 inject。
  describe('hasInjectionContext', () => {
    // 测试场景：在setup之外应该是假的。
    it('should be false outside of setup', () => {
      expect(hasInjectionContext()).toBe(false)
    })

    // 测试场景：应该在setup内为真。
    it('should be true within setup', () => {
      expect.assertions(1)
      const Comp = {
        setup() {
          expect(hasInjectionContext()).toBe(true)
          return () => null
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
    })

    // 测试场景：app.runWithContext() 内应该为 true。
    it('should be true within app.runWithContext()', () => {
      expect.assertions(1)
      createApp({}).runWithContext(() => {
        expect(hasInjectionContext()).toBe(true)
      })
    })
  })

  // 测试组：错误使用警告。
  describe('warnings for incorrect usage', () => {
    // 测试场景：当在 setup 外部调用inject()时应该发出警告。
    it('should warn when inject() is called outside setup', () => {
      inject('foo', 'bar')
      expect(`inject() can only be used`).toHaveBeenWarned()
    })

    // 测试场景：在 setup 外部调用 Provide() 时应发出警告。
    it('should warn when provide() is called outside setup', () => {
      provide('foo', 'bar')
      expect(`provide() can only be used`).toHaveBeenWarned()
    })

    // 测试场景：当从渲染函数调用 Provide() 时应该发出警告。
    it('should warn when provide() is called from a render function', () => {
      const Provider = {
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

    // 测试场景：当从 onMounted 调用 Provide() 时应该发出警告。
    it('should warn when provide() is called from onMounted', () => {
      const Provider = {
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
