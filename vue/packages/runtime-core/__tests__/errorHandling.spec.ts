/**
 * 在 setup、render、watcher、事件和生命周期中抛错，观察祖先 errorCaptured 与应用处理器。
 * 分别检查同步异常、Promise 拒绝、传播停止以及未处理错误的开发态行为。
 */
import {
  type VNode,
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  onErrorCaptured,
  onMounted,
  ref,
  render,
  watch,
  watchEffect,
} from '@vue/runtime-test'
import { ErrorCodes, ErrorTypeStrings } from '../src/errorHandling'

// 测试组：错误处理。
describe('error handling', () => {
  /** 孙组件 mounted 抛出 foo 错误，子级捕获后继续传播、根捕获返回 false；检查两层都收到同一错误与 mounted hook 信息，验证祖先捕获链。 */
  test('propagation', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 root 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info, 'root')
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 登记 child 捕获钩子，将错误与来源交给 fn，保持向上传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info, 'child')
        })
        return () => h(GrandChild)
      },
    }

    const GrandChild = {
      /** 登记同步抛错的 mounted 钩子，构造生命周期异常；组件本身不输出元素。 */
      setup() {
        onMounted(() => {
          throw err
        })
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledWith(err, 'mounted hook', 'root')
    expect(fn).toHaveBeenCalledWith(err, 'mounted hook', 'child')
  })

  /** 孙组件 mounted 抛错，最近 Child 的 errorCaptured 返回 false；检查只有 Child 收到错误，验证停止祖先传播。 */
  test('propagation stoppage', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 root 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info, 'root')
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 登记 child 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info, 'child')
          return false
        })
        return () => h(GrandChild)
      },
    }

    const GrandChild = {
      /** 登记同步抛错的 mounted 钩子，构造生命周期异常；组件本身不输出元素。 */
      setup() {
        onMounted(() => {
          throw err
        })
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(err, 'mounted hook', 'child')
  })

  /** Child 的 async mounted 拒绝，父 errorCaptured 返回 false；检查同步阶段未调用、等待计时器后收到 mounted hook，验证 Promise 拒绝转入捕获链。 */
  test('async error handling', async () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 登记异步拒绝的 mounted 钩子，构造生命周期异常；组件本身不输出元素。 */
      setup() {
        onMounted(async () => {
          throw err
        })
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r))
    expect(fn).toHaveBeenCalledWith(err, 'mounted hook')
  })

  /** 孙组件 mounted 抛 err，Child 的捕获钩子再抛 err2；检查根收到两个错误及各自来源信息，验证捕获钩子异常继续向上处理。 */
  test('error thrown in onErrorCaptured', () => {
    const err = new Error('foo')
    const err2 = new Error('bar')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 捕获后再抛 err2，返回渲染函数挂载 GrandChild，构造错误捕获钩子自身失败的路径。 */
      setup() {
        onErrorCaptured(() => {
          throw err2
        })
        return () => h(GrandChild)
      },
    }

    const GrandChild = {
      /** 登记同步抛错的 mounted 钩子，构造生命周期异常；组件本身不输出元素。 */
      setup() {
        onMounted(() => {
          throw err
        })
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledWith(err, 'mounted hook')
    expect(fn).toHaveBeenCalledWith(err2, 'errorCaptured hook')
  })

  /** Child setup 直接抛 err，父捕获并停止传播；检查 setup function 信息，验证初始化异常的分类。 */
  test('setup function', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** setup 初始化直接抛 err，构造组件初始化失败。 */
      setup() {
        throw err
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'setup function')
  })

  /** 两个子组件分别在 created 与 beforeCreate 抛错，父捕获；检查两种 hook 信息，验证 Options 初始化阶段也使用错误边界。 */
  test('in created/beforeCreate hook', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => [h(Child1), h(Child2)]
      },
    }

    const Child1 = {
      /** 在 created 初始化钩子直接抛 err，供验证 Options 生命周期的错误分类。 */
      created() {
        throw err
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    }

    const Child2 = {
      /** 在 beforeCreate 初始化钩子直接抛 err，供验证 Options 生命周期的错误分类。 */
      beforeCreate() {
        throw err
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'created hook')
    expect(fn).toHaveBeenCalledWith(err, 'beforeCreate hook')
  })

  /** Child 返回的 render 函数抛 err，父捕获；检查 render function 信息，验证渲染异常分类。 */
  test('in render function', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 返回每次执行都抛错的渲染函数，使本例只观察 render 错误边界。 */
      setup() {
        return () => {
          throw err
        }
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'render function')
  })

  /** Child 元素的函数 ref 抛 err，父捕获；检查 ref function 信息，验证引用赋值回调进入错误边界。 */
  test('in function ref', () => {
    const err = new Error('foo')
    /** 函数 ref 被设置时直接抛 err，构造引用赋值异常。 */
    const ref = () => {
      throw err
    }
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = defineComponent(() => () => h('div', { ref }))

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'ref function')
  })

  /** Child watchEffect 首次执行抛 err，父捕获；检查 watcher callback 信息，验证 effect 回调异常分类。 */
  test('in effect', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 注册首次执行便抛 err 的 watchEffect，返回空渲染，构造 effect 回调异常。 */
      setup() {
        watchEffect(() => {
          throw err
        })
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'watcher callback')
  })

  /** Child watch 的 source getter 抛 err，父捕获；检查 watcher getter 信息，验证取值异常与回调异常分开标记。 */
  test('in watch getter', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 注册取值阶段直接抛 err 的 watch，返回空渲染，构造 watcher getter 异常。 */
      setup() {
        watch(
          () => {
            throw err
          },
          () => {},
        )
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'watcher getter')
  })

  /** Child watch 监听 count，挂载后递增并等待 nextTick 触发抛错回调；检查父收到 watcher callback，验证调度阶段的监听异常。 */
  test('in watch callback', async () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const count = ref(0)
    const Child = {
      /** 监听 count，在更新回调中抛 err，返回空渲染，构造异步 watcher 回调异常。 */
      setup() {
        watch(
          () => count.value,
          () => {
            throw err
          },
        )
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledWith(err, 'watcher callback')
  })

  /** Child watchEffect 读取 count 并登记抛错清理，递增 count 后等待刷新；检查 watcher cleanup function，验证重跑前清理异常。 */
  test('in effect cleanup', async () => {
    const err = new Error('foo')
    const count = ref(0)
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 读取 count 并注册抛错清理，返回空渲染；count 更新时触发 effect 重跑前的清理异常。 */
      setup() {
        watchEffect(onCleanup => {
          count.value
          onCleanup(() => {
            throw err
          })
        })
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledWith(err, 'watcher cleanup function')
  })

  /** Child setup emit foo，父级 onFoo 同步抛 err；检查父捕获的 component event handler 信息，验证组件事件异常归类。 */
  test('in component event handler via emit', () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () =>
          h(Child, {
            /** foo 事件回调直接抛 err，供验证 emit 的同步异常分类。 */
            onFoo: () => {
              throw err
            },
          })
      },
    }

    const Child = {
      /** setup 中同步 emit foo 后返回空渲染，使事件处理器在组件初始化期间被触发。 */
      setup(props: any, { emit }: any) {
        emit('foo')
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledWith(err, 'component event handler')
  })

  /** Child setup emit foo，async onFoo 返回拒绝；等待 nextTick 后检查捕获错误与事件来源，验证异步组件事件处理。 */
  test('in component event handler via emit (async)', async () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () =>
          h(Child, {
            /** 异步 foo 事件处理器直接拒绝 err，供验证 emit 对 Promise 错误的处理。 */
            async onFoo() {
              throw err
            },
          })
      },
    }

    const Child = {
      props: ['onFoo'],
      /** setup 中同步 emit foo 后返回空渲染，使事件处理器在组件初始化期间被触发。 */
      setup(props: any, { emit }: any) {
        emit('foo')
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    await nextTick()
    expect(fn).toHaveBeenCalledWith(err, 'component event handler')
  })

  /** onFoo 数组分别返回拒绝与成功 Promise，Child emit 后等待收集到的 Promise；检查原拒绝值与捕获来源，验证数组事件处理器各自的异步错误。 */
  test('in component event handler via emit (async + array)', async () => {
    const err = new Error('foo')
    const fn = vi.fn()

    const res: Promise<any>[] = []
    /** 返回将指定 Promise 登记到 res 并原样返回它的处理器，让用例等待所有数组事件回调的结果。 */
    const createAsyncHandler = (p: Promise<any>) => () => {
      res.push(p)
      return p
    }

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () =>
          h(Child, {
            onFoo: [
              createAsyncHandler(Promise.reject(err)),
              createAsyncHandler(Promise.resolve(1)),
            ],
          })
      },
    }

    const Child = {
      /** setup 中同步 emit foo 后返回空渲染，使事件处理器在组件初始化期间被触发。 */
      setup(props: any, { emit }: any) {
        emit('foo')
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    try {
      await Promise.all(res)
    } catch (e: any) {
      expect(e).toBe(err)
    }
    expect(fn).toHaveBeenCalledWith(err, 'component event handler')
  })

  /** Child setup 抛错，父捕获却未返回 false，也无应用处理器；检查捕获记录、未处理警告与 render 重新抛原错误，验证开发态未处理路径。 */
  it('should warn unhandled', () => {
    const groupCollapsed = vi.spyOn(console, 'groupCollapsed')
    groupCollapsed.mockImplementation(() => {})
    const log = vi.spyOn(console, 'log')
    log.mockImplementation(() => {})

    const err = new Error('foo')
    const fn = vi.fn()

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn，保持向上传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** setup 初始化直接抛 err，构造组件初始化失败。 */
      setup() {
        throw err
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    }

    let caughtError
    try {
      render(h(Comp), nodeOps.createElement('div'))
    } catch (caught) {
      caughtError = caught
    }
    expect(fn).toHaveBeenCalledWith(err, 'setup function')
    expect(
      `Unhandled error during execution of setup function`,
    ).toHaveBeenWarned()
    expect(caughtError).toBe(err)

    groupCollapsed.mockRestore()
    log.mockRestore()
  })

  /** 应用内 immediate watch 与 watchEffect 各有同步/异步抛错版本，配置 errorHandler 后挂载并等待刷新；检查四个错误各进入 watcher callback，验证统一应用处理。 */
  test('handle error in watch & watchEffect', async () => {
    const error1 = new Error('error1')
    const error2 = new Error('error2')
    const error3 = new Error('error3')
    const error4 = new Error('error4')
    const handler = vi.fn()

    const app = createApp({
      /** 注册同步/异步 immediate watch 和 watchEffect 四种抛错回调，构造应用级统一错误处理。 */
      setup() {
        const count = ref(1)
        watch(
          count,
          () => {
            throw error1
          },
          { immediate: true },
        )
        watch(
          count,
          async () => {
            throw error2
          },
          { immediate: true },
        )
        watchEffect(() => {
          throw error3
        })
        watchEffect(async () => {
          throw error4
        })
      },
      /** 提供空渲染函数，避免其他渲染行为干扰本例的异常阶段。 */
      render() {},
    })

    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))

    await nextTick()
    expect(handler).toHaveBeenCalledWith(error1, {}, 'watcher callback')
    expect(handler).toHaveBeenCalledWith(error2, {}, 'watcher callback')
    expect(handler).toHaveBeenCalledWith(error3, {}, 'watcher callback')
    expect(handler).toHaveBeenCalledWith(error4, {}, 'watcher callback')
    expect(handler).toHaveBeenCalledTimes(4)
  })

  // #9574
  /** render 每次抛错，errorHandler 读写另一个 ref；等待刷新后检查处理器仅执行一次，验证错误处理期间暂停依赖收集，避免自触发。 */
  test('should pause tracking in error handler', async () => {
    const error = new Error('error')
    const x = ref(Math.random())

    const handler = vi.fn(() => {
      x.value
      x.value = Math.random()
    })

    const app = createApp({
      /** 返回每次执行都抛错的渲染函数，使本例只观察 render 错误边界。 */
      setup() {
        return () => {
          throw error
        }
      },
    })

    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))

    await nextTick()
    expect(handler).toHaveBeenCalledWith(error, {}, 'render function')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  /** 挂载后给复用 VNode.el 安装抛错 getter，再修改 render 依赖；检查应用处理器收到 COMPONENT_UPDATE，验证带所有者的调度任务异常归属。 */
  test('errors in scheduler job with owner instance should be caught', async () => {
    let vnode: VNode
    const x = ref(0)
    const app = createApp({
      /** 首次保存 div VNode，后续复用同一对象，使 el 抛错 getter 在更新路径被读取。 */
      render() {
        return (vnode = vnode || h('div', x.value))
      },
    })

    app.config.errorHandler = vi.fn()
    app.mount(nodeOps.createElement('div'))

    const error = new Error('error')
    Object.defineProperty(vnode!, 'el', {
      /** 读取复用 VNode.el 时抛 error，把异常放在组件更新任务的宿主引用阶段。 */
      get() {
        throw error
      },
    })

    x.value++
    await nextTick()
    expect(app.config.errorHandler).toHaveBeenCalledWith(
      error,
      {},
      ErrorTypeStrings[ErrorCodes.COMPONENT_UPDATE],
    )
  })

  // #11286
  /** computed 在 count 变为2时抛错，组件 render 读取它；刷新后检查 COMPONENT_UPDATE 错误信息，验证计算值异常进入更新边界。 */
  test('handle error in computed', async () => {
    const err = new Error()
    const handler = vi.fn()

    const count = ref(1)
    const x = computed(() => {
      if (count.value === 2) throw err
      return count.value + 1
    })

    const app = createApp({
      /** 返回读取 computed x 的渲染函数，使计算异常发生在组件更新任务中。 */
      setup() {
        return () => x.value
      },
    })

    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))

    count.value = 2

    await nextTick()
    expect(handler).toHaveBeenCalledWith(
      err,
      {},
      ErrorTypeStrings[ErrorCodes.COMPONENT_UPDATE],
    )
  })

  // #11624
  /** watch 以 computed 为源，trigger 改为 true 使计算抛错；等待刷新后检查祖先收到 COMPONENT_UPDATE 信息，记录这条实际调度错误路径。 */
  test('in computed that is used as key for watch', async () => {
    const err = new Error('foo')
    const fn = vi.fn()
    const trigger = ref(false)

    const Comp = {
      /** 登记 当前祖先 捕获钩子，将错误与来源交给 fn并返回 false 停止传播；返回渲染函数构造子组件错误链。 */
      setup() {
        onErrorCaptured((err, instance, info) => {
          fn(err, info)
          return false
        })
        return () => h(Child)
      },
    }

    const Child = {
      /** 以会随 trigger 抛错的 computed 为 watch 源，构造调度时计算值失败的路径。 */
      setup() {
        const foo = computed(() => {
          if (trigger.value) throw err
          return 1
        })
        watch(foo, () => {})
        return () => null
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    trigger.value = true
    await nextTick()
    expect(fn).toHaveBeenCalledWith(
      err,
      ErrorTypeStrings[ErrorCodes.COMPONENT_UPDATE],
    )
  })

  // 原生事件处理器的错误由各宿主渲染器测试覆盖。
})
