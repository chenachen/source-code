/**
 * 挂载带局部注册表的 runtime-test 组件，检查名称转换、自引用、mixins 和 extends 的解析。
 * 动态组件用例另行核对函数或对象类型、空值注释节点以及原生元素回退。
 */
import {
  Comment,
  type Component,
  type Directive,
  type VNode,
  createApp,
  createVNode,
  h,
  nodeOps,
  resolveComponent,
  resolveDirective,
  resolveDynamicComponent,
  serializeInner,
} from '@vue/runtime-test'

// resolveAssets 按局部、全局和自身引用规则解析组件与指令。
describe('resolveAssets', () => {
  // 局部组件与指令注册兼容原名、camelize、capitalize 及两种转换组合。
  test('should work', () => {
    /** 返回空内容的局部组件定义，以函数身份比较四种名称解析。 */
    const FooBar = () => null
    const BarBaz = {
      /** 空指令钩子，用对象身份比较局部注册表的名称解析。 */
      mounted: () => null
    }

    let component1: Component | string
    let component2: Component | string
    let component3: Component | string
    let component4: Component | string
    let directive1: Directive
    let directive2: Directive
    let directive3: Directive
    let directive4: Directive

    const Root = {
      components: {
        FooBar: FooBar,
      },
      directives: {
        BarBaz: BarBaz,
      },
      /** 返回执行四种组件/指令名称转换查询的 render，把结果分别保存供身份断言。 */
      setup() {
        return () => {
          component1 = resolveComponent('FooBar')!
          directive1 = resolveDirective('BarBaz')!
          // 驼峰形式
          component2 = resolveComponent('Foo-bar')!
          directive2 = resolveDirective('Bar-baz')!
          // 首字母大写形式
          component3 = resolveComponent('fooBar')!
          directive3 = resolveDirective('barBaz')!
          // 先驼峰化，再首字母大写。
          component4 = resolveComponent('foo-bar')!
          directive4 = resolveDirective('bar-baz')!
        }
      },
    }

    const app = createApp(Root)
    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(component1!).toBe(FooBar)
    expect(component2!).toBe(FooBar)
    expect(component3!).toBe(FooBar)
    expect(component4!).toBe(FooBar)

    expect(directive1!).toBe(BarBaz)
    expect(directive2!).toBe(BarBaz)
    expect(directive3!).toBe(BarBaz)
    expect(directive4!).toBe(BarBaz)
  })

  // 显式组件 name 的自引用优先；其他名称先查注册，缺失时才按 maybeSelfReference 回退。
  test('maybeSelfReference', async () => {
    let component1: Component | string
    let component2: Component | string
    let component3: Component | string

    /** 返回空内容的注册组件，供区分名称命中与自身引用回退。 */
    const Foo = () => null

    const Root = {
      name: 'Root',
      components: {
        Foo,
        Root: Foo,
      },
      /** 返回查询 Root/Foo/Bar 的渲染函数，分别构造自身名称、注册命中和缺失回退。 */
      setup() {
        return () => {
          component1 = resolveComponent('Root', true)
          component2 = resolveComponent('Foo', true)
          component3 = resolveComponent('Bar', true)
        }
      },
    }

    const app = createApp(Root)
    const root = nodeOps.createElement('div')
    app.mount(root)

    expect(component1!).toMatchObject(Root) // 显式自身名称优先。
    expect(component2!).toBe(Foo) // 已注册名称优先于缺失回退。
    expect(component3!).toMatchObject(Root) // 查找失败后回退到自身。
  })

  // 资源解析 API 在错误调用位置或解析失败时给出恰当警告。
  describe('warning', () => {
    // render 与 setup 之外调用组件或指令解析函数，会警告缺少可用上下文。
    test('used outside render() or setup()', () => {
      resolveComponent('foo')
      expect(
        'resolveComponent can only be used in render() or setup().',
      ).toHaveBeenWarned()

      resolveDirective('foo')
      expect(
        'resolveDirective can only be used in render() or setup().',
      ).toHaveBeenWarned()
    })

    // 活动实例中找不到组件或指令注册项，会发出 Failed to resolve 警告。
    test('not exist', () => {
      const Root = {
        /** 在活动 setup 中查询未注册 foo/bar，构造缺失资源警告后返回空渲染。 */
        setup() {
          resolveComponent('foo')
          resolveDirective('bar')
          return () => null
        },
      }

      const app = createApp(Root)
      const root = nodeOps.createElement('div')
      app.mount(root)
      expect('Failed to resolve component: foo').toHaveBeenWarned()
      expect('Failed to resolve directive: bar').toHaveBeenWarned()
    })

    // 动态组件解析字符串注册名、函数与对象，空值生成注释 VNode。
    test('resolve dynamic component', () => {
      const dynamicComponents = {
        /** 返回 foo 文本的函数组件定义，供动态字符串注册名解析。 */
        foo: () => 'foo',
        /** 返回 bar 文本的函数组件定义，供直接函数动态类型解析。 */
        bar: () => 'bar',
        baz: {
          /** 返回 baz 文本的对象组件渲染函数，供插槽上下文中的动态对象解析。 */
          render: () => 'baz'
        },
      }
      let foo, bar, baz // 动态组件解析结果。
      let dynamicVNode: VNode

      const Child = {
        /** 调用父级 default 插槽，让动态组件对象解析发生在插槽上下文中。 */
        render(this: any) {
          return this.$slots.default()
        },
      }

      const Root = {
        components: { foo: dynamicComponents.foo },
        /** 返回渲染函数依次解析字符串、函数、null，并在 Child 插槽中解析对象，保存各结果供比较。 */
        setup() {
          return () => {
            foo = resolveDynamicComponent('foo') // <component is="foo"/>
            bar = resolveDynamicComponent(dynamicComponents.bar) // <component :is="bar"/>, function
            dynamicVNode = createVNode(resolveDynamicComponent(null)) // <component :is="null"/>
            return h(Child, () => {
              // 在 Child 的插槽上下文中解析对象组件。
              baz = resolveDynamicComponent(dynamicComponents.baz) // <component :is="baz"/>, object
            })
          }
        },
      }

      const app = createApp(Root)
      const root = nodeOps.createElement('div')
      app.mount(root)
      expect(foo).toBe(dynamicComponents.foo)
      expect(bar).toBe(dynamicComponents.bar)
      expect(baz).toBe(dynamicComponents.baz)
      // null 动态类型归一化为 Comment。
      expect(dynamicVNode!.type).toBe(Comment)
    })

    // 动态组件字符串查不到注册时回退为元素标签，不发出缺失组件警告。
    test('resolve dynamic component should fallback to plain element without warning', () => {
      const Root = {
        /** 把未注册字符串 div 当动态类型创建元素，default 插槽返回 hello，构造原生标签回退。 */
        setup() {
          return () => {
            return createVNode(resolveDynamicComponent('div') as string, null, {
              /** 返回 hello 文本，让原生 div 类型的 default 插槽有可序列化内容。 */
              default: () => 'hello',
            })
          }
        },
      }

      const app = createApp(Root)
      const root = nodeOps.createElement('div')
      app.mount(root)
      expect(serializeInner(root)).toBe('<div>hello</div>')
    })
  })

  // mixins 与 extends 合并的局部组件或指令表，仍兼容各种名称转换。
  test('resolving from mixins & extends', () => {
    /** 返回空内容的组件定义，供 extends 合并后资源身份比较。 */
    const FooBar = () => null
    const BarBaz = {
      /** 空指令钩子，用对象身份比较局部注册表的名称解析。 */
      mounted: () => null
    }

    let component1: Component | string
    let component2: Component | string
    let component3: Component | string
    let component4: Component | string
    let directive1: Directive
    let directive2: Directive
    let directive3: Directive
    let directive4: Directive

    const Base = {
      components: {
        FooBar: FooBar,
      },
    }
    const Mixin = {
      directives: {
        BarBaz: BarBaz,
      },
    }

    const Root = {
      extends: Base,
      mixins: [Mixin],
      /** 返回查询四种名称的 render，验证 extends 组件表与 mixin 指令表在实例中可用。 */
      setup() {
        return () => {
          component1 = resolveComponent('FooBar')!
          directive1 = resolveDirective('BarBaz')!
          // 驼峰形式
          component2 = resolveComponent('Foo-bar')!
          directive2 = resolveDirective('Bar-baz')!
          // 首字母大写形式
          component3 = resolveComponent('fooBar')!
          directive3 = resolveDirective('barBaz')!
          // 先驼峰化，再首字母大写。
          component4 = resolveComponent('foo-bar')!
          directive4 = resolveDirective('bar-baz')!
        }
      },
    }

    const app = createApp(Root)
    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(component1!).toBe(FooBar)
    expect(component2!).toBe(FooBar)
    expect(component3!).toBe(FooBar)
    expect(component4!).toBe(FooBar)

    expect(directive1!).toBe(BarBaz)
    expect(directive2!).toBe(BarBaz)
    expect(directive3!).toBe(BarBaz)
    expect(directive4!).toBe(BarBaz)
  })
})
