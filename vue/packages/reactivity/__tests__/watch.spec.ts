import {
  EffectScope,
  type Ref,
  WatchErrorCodes,
  type WatchOptions,
  type WatchScheduler,
  computed,
  onWatcherCleanup,
  ref,
  watch,
} from '../src'

/**
 * 测试调度器的后置任务队列，等待统一微任务执行。
 */
const queue: (() => void)[] = []

/**
 * 标记已安排队列刷新微任务，避免同一轮重复安排。
 */
let isFlushPending = false
/**
 * 已完成的 Promise，供 nextTick 和队列刷新安排微任务。
 */
const resolvedPromise = /*@__PURE__*/ Promise.resolve() as Promise<any>
/**
 * 有回调时在已完成 Promise 的后续微任务执行它，否则返回该 Promise 供等待。
 */
const nextTick = (fn?: () => any) =>
  fn ? resolvedPromise.then(fn) : resolvedPromise

/**
 * 首次运行直接执行 job，之后入队并安排刷新，模拟后置 watcher 的调度。
 */
const scheduler: WatchScheduler = (job, isFirstRun) => {
  if (isFirstRun) {
    job()
  } else {
    queue.push(job)
    flushJobs()
  }
}

/**
 * 只安排一个待执行微任务；运行队列后清空任务并恢复可调度状态。
 */
const flushJobs = () => {
  if (isFlushPending) return
  isFlushPending = true
  resolvedPromise.then(() => {
    queue.forEach(job => job())
    queue.length = 0
    isFlushPending = false
  })
}

describe('watch', () => {
  /**
   * 以 source = ref(0) 建立无回调 watch，源函数把 value 写入 dummy；创建时 dummy = 0，source 自增后同步为 1，验证默认同步的 effect 形式。
   */
  test('effect', () => {
    let dummy: any
    const source = ref(0)
    watch(() => {
      dummy = source.value
    })
    expect(dummy).toBe(0)
    source.value++
    expect(dummy).toBe(1)
  })

  /**
   * 以 source = ref(0) 建立带回调 watch；未立即执行所以 dummy 为 undefined，source 自增后回调把 dummy 设为 1，验证默认只在变化后执行回调。
   */
  test('with callback', () => {
    let dummy: any
    const source = ref(0)
    watch(source, () => {
      dummy = source.value
    })
    expect(dummy).toBe(undefined)
    source.value++
    expect(dummy).toBe(1)
  })

  /**
   * 自定义 call 统一捕获同步错误并记录类型；effect 首次抛错归为 WATCH_CALLBACK，普通 watcher 更新时回调抛错、停止时清理抛错分别再记录，停止后继续改源不增加错误，验证调用适配器覆盖回调和清理。
   */
  test('call option with error handling', () => {
    const onError = vi.fn()
    /**
     * 递归处理函数数组，并把单个函数的同步异常连同调用类型交给 onError。
     */
    const call: WatchOptions['call'] = function call(fn, type, args) {
      if (Array.isArray(fn)) {
        fn.forEach(f => call(f, type, args))
        return
      }
      try {
        fn.apply(null, args)
      } catch (e) {
        onError(e, type)
      }
    }

    watch(
      () => {
        throw 'oops in effect'
      },
      null,
      { call },
    )

    const source = ref(0)
    const effect = watch(
      source,
      () => {
        onWatcherCleanup(() => {
          throw 'oops in cleanup'
        })
        throw 'oops in watch'
      },
      { call },
    )

    expect(onError.mock.calls.length).toBe(1)
    expect(onError.mock.calls[0]).toMatchObject([
      'oops in effect',
      WatchErrorCodes.WATCH_CALLBACK,
    ])

    source.value++
    expect(onError.mock.calls.length).toBe(2)
    expect(onError.mock.calls[1]).toMatchObject([
      'oops in watch',
      WatchErrorCodes.WATCH_CALLBACK,
    ])

    effect!.stop()
    source.value++
    expect(onError.mock.calls.length).toBe(3)
    expect(onError.mock.calls[2]).toMatchObject([
      'oops in cleanup',
      WatchErrorCodes.WATCH_CLEANUP,
    ])
  })

  /**
   * 自定义 call 对函数返回的 Promise 注册 catch；普通 watcher 和 once watcher 分别因源更新返回拒绝的 Promise，等待 nextTick 后 onError 次数为 1、2，验证异步错误能交给调用适配器。
   */
  test('call option with async error handling', async () => {
    const onError = vi.fn()
    /**
     * 递归处理函数数组，并对单个函数返回的 Promise 注册拒绝处理。
     */
    const call: WatchOptions['call'] = function call(fn, type, args) {
      if (Array.isArray(fn)) {
        fn.forEach(f => call(f, type, args))
        return
      }
      fn.apply(null, args).catch((error: unknown) => {
        onError(error)
      })
    }

    const source1 = ref(0)
    watch(
      source1,
      async () => {
        throw 'oops in watch'
      },
      { call },
    )

    source1.value++
    await nextTick()
    expect(onError.mock.calls.length).toBe(1)
    expect(onError.mock.calls[0]).toMatchObject(['oops in watch'])

    const source2 = ref(0)
    watch(
      source2,
      async () => {
        throw 'oops in once watch'
      },
      { call, once: true },
    )

    source2.value++
    await nextTick()
    expect(onError.mock.calls.length).toBe(2)
    expect(onError.mock.calls[1]).toMatchObject(['oops in once watch'])
  })

  /**
   * 作用域内无回调 watch 同时通过参数 onCleanup 和两次 onWatcherCleanup 注册累加 2、3、5 的清理；两次源更新得到 10、20，scope.stop 后为 30，验证多个清理在重跑与停止时执行。
   */
  test('watch with onWatcherCleanup', async () => {
    let dummy = 0
    let source: Ref<number>
    const scope = new EffectScope()

    scope.run(() => {
      source = ref(0)
      watch(onCleanup => {
        source.value

        onCleanup(() => (dummy += 2))
        onWatcherCleanup(() => (dummy += 3))
        onWatcherCleanup(() => (dummy += 5))
      })
    })
    expect(dummy).toBe(0)

    scope.run(() => {
      source.value++
    })
    expect(dummy).toBe(10)

    scope.run(() => {
      source.value++
    })
    expect(dummy).toBe(20)

    scope.stop()
    expect(dummy).toBe(30)
  })

  /**
   * 同步 watcher 把 source 复制到 copyist，使用测试调度器的后置 watcher 读取 copyist；逐次更新时同步清理先记录、后置清理在 nextTick 后记录，停止两者后记录 sync 2、post 2，验证嵌套 watcher 的清理上下文。
   */
  test('nested calls to baseWatch and onWatcherCleanup', async () => {
    let calls: string[] = []
    let source: Ref<number>
    let copyist: Ref<number>
    const scope = new EffectScope()

    scope.run(() => {
      source = ref(0)
      copyist = ref(0)
      // 未配置 scheduler 时，源变化会同步执行 watcher。
      watch(
        () => {
          const current = (copyist.value = source.value)
          onWatcherCleanup(() => calls.push(`sync ${current}`))
        },
        null,
        {},
      )
      // 配置调度器后，后续更新入队，等待微任务执行。
      watch(
        () => {
          const current = copyist.value
          onWatcherCleanup(() => calls.push(`post ${current}`))
        },
        null,
        { scheduler },
      )
    })

    await nextTick()
    expect(calls).toEqual([])

    scope.run(() => source.value++)
    expect(calls).toEqual(['sync 0'])
    await nextTick()
    expect(calls).toEqual(['sync 0', 'post 0'])
    calls.length = 0

    scope.run(() => source.value++)
    expect(calls).toEqual(['sync 1'])
    await nextTick()
    expect(calls).toEqual(['sync 1', 'post 1'])
    calls.length = 0

    scope.stop()
    expect(calls).toEqual(['sync 2', 'post 2'])
  })

  /**
   * 无回调 watch 配置 once = true，初始 source = 0 后自增；dummy 仍能从 0 更新为 1，验证 once 只影响回调形式而不停止 effect 形式。
   */
  test('once option should be ignored by simple watch', async () => {
    let dummy: any
    const source = ref(0)
    watch(
      () => {
        dummy = source.value
      },
      null,
      { once: true },
    )
    expect(dummy).toBe(0)

    source.value++
    expect(dummy).toBe(1)
  })

  // #12033
  /**
   * 同步 watcher 订阅 r 的 computed，在值大于 1 时把 r 自减；从 r = 0 直接设为 10 后最终 r 与 computed 均为 1，验证递归同步回调按最新值收敛。
   */
  test('recursive sync watcher on computed', () => {
    const r = ref(0)
    const c = computed(() => r.value)

    watch(c, v => {
      if (v > 1) {
        r.value--
      }
    })

    expect(r.value).toBe(0)
    expect(c.value).toBe(0)

    r.value = 10
    expect(r.value).toBe(1)
    expect(c.value).toBe(1)
  })

  // 历史回归：嵌套 endBatch 重新加入 effect 并改动其 next 链接，
  // 曾导致外层批次过早结束；此处检查归一化写入后末端 watcher 仍执行。
  /**
   * src = 1 通过可写 computed 限制在 [1, 5]，一个 watcher 同步该计算值、另一个 spy 订阅它；src 改为 2 后 spy 一次，再改为 10 被归一为 5 后 spy 两次，验证嵌套批次仍执行末端 watcher。
   */
  test('nested batch edge case', () => {
    // 取自 VueUse 的 useClamp 场景，读写都把数值约束到区间内。
    /**
     * 把数值约束在闭区间 [min, max]，供嵌套 watcher 的归一化路径使用。
     */
    const clamp = (n: number, min: number, max: number) =>
      Math.min(max, Math.max(min, n))
    /**
     * 返回可写 computed；读写时均把源 Ref 约束在指定区间内。
     */
    function useClamp(src: Ref<number>, min: number, max: number) {
      return computed({
        /**
         * 读取源值后归一化并写回，再返回结果，覆盖 getter 内修改源的嵌套批次。
         */
        get() {
          return (src.value = clamp(src.value, min, max))
        },
        /**
         * 把写入值归一化后转发给源 Ref。
         */
        set(val) {
          src.value = clamp(val, min, max)
        },
      })
    }

    const src = ref(1)
    const clamped = useClamp(src, 1, 5)
    watch(src, val => (clamped.value = val))

    const spy = vi.fn()
    watch(clamped, spy)

    src.value = 2
    expect(spy).toHaveBeenCalledTimes(1)
    src.value = 10
    expect(spy).toHaveBeenCalledTimes(2)
  })

  /**
   * n1、n2 初始为 0，n1 的第一个 watcher 记录 1 并增加 n2，sum watcher 记录 2，另一个 n1 watcher 记录 3；n1 自增后顺序为 [1, 2, 3]，验证批处理中新增通知的执行顺序。
   */
  test('should ensure correct execution order in batch processing', () => {
    const dummy: number[] = []
    const n1 = ref(0)
    const n2 = ref(0)
    const sum = computed(() => n1.value + n2.value)
    watch(n1, () => {
      dummy.push(1)
      n2.value++
    })
    watch(sum, () => dummy.push(2))
    watch(n1, () => dummy.push(3))

    n1.value++

    expect(dummy).toEqual([1, 2, 3])
  })

  /**
   * Ref 初值 false，watch 回调立即把收到的变化重置为 false；连续两次外部赋 true 后值均回到 false，验证同步递归重置后下一次同样的外部变化仍被处理。
   */
  test('watch with immediate reset and sync flush', () => {
    const value = ref(false)

    watch(value, () => {
      value.value = false
    })

    value.value = true
    value.value = true
    expect(value.value).toBe(false)
  })
})
