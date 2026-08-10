/**
 * 测试阅读说明：本文件验证 `runtime-core/scheduler` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type SchedulerJob,
  SchedulerJobFlags,
  flushPostFlushCbs,
  flushPreFlushCbs,
  nextTick,
  queueJob,
  queuePostFlushCb,
} from '../src/scheduler'

// 测试组：scheduler 对组件任务和 watcher 的排序、去重、递归与错误处理。
describe('scheduler', () => {
  // 测试场景：nextTick 等待当前刷新微任务完成，并正确绑定回调上下文。
  it('nextTick', async () => {
    const calls: string[] = []
    const dummyThen = Promise.resolve().then()
    const job1 = () => {
      calls.push('job1')
    }
    const job2 = () => {
      calls.push('job2')
    }
    nextTick(job1)
    job2()

    expect(calls.length).toBe(1)
    await dummyThen
    // job1 will be pushed in nextTick
    expect(calls.length).toBe(2)
    expect(calls).toMatchObject(['job2', 'job1'])
  })

  // 测试组：queueJob 按 ID 插入主队列、去重任务并维护父子更新顺序。
  describe('queueJob', () => {
    // 测试场景：基本用法。
    it('basic usage', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      const job2 = () => {
        calls.push('job2')
      }
      queueJob(job1)
      queueJob(job2)
      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['job1', 'job2'])
    })

    // 测试场景：刷新时应按作业 ID 的升序插入作业。
    it("should insert jobs in ascending order of job's id when flushing", async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')

        queueJob(job2)
        queueJob(job3)
      }

      const job2 = () => {
        calls.push('job2')
        queueJob(job4)
        queueJob(job5)
      }
      job2.id = 10

      const job3 = () => {
        calls.push('job3')
      }
      job3.id = 1

      const job4 = () => {
        calls.push('job4')
      }

      const job5 = () => {
        calls.push('job5')
      }

      queueJob(job1)

      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['job1', 'job3', 'job2', 'job4', 'job5'])
    })

    // 测试场景：应该删除排队作业的重复数据。
    it('should dedupe queued jobs', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      const job2 = () => {
        calls.push('job2')
      }
      queueJob(job1)
      queueJob(job2)
      queueJob(job1)
      queueJob(job2)
      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['job1', 'job2'])
    })

    // 测试场景：主队列正在 flush 时，新 queueJob 插入剩余队列的正确位置。
    it('queueJob while flushing', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
        // job2 will be executed after job1 at the same tick
        queueJob(job2)
      }
      const job2 = () => {
        calls.push('job2')
      }
      queueJob(job1)

      await nextTick()
      expect(calls).toEqual(['job1', 'job2'])
    })
  })

  // 测试组：预冲洗作业。
  describe('pre flush jobs', () => {
    // 测试场景：组件 queueJob 执行期间加入 pre-flush 回调。
    it('queueJob inside preFlushCb', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      const cb1: SchedulerJob = () => {
        // queueJob in postFlushCb
        calls.push('cb1')
        queueJob(job1)
      }
      cb1.flags! |= SchedulerJobFlags.PRE

      queueJob(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1'])
    })

    // 测试场景：queueJob 与 pre-flush 回调都继续加入 pre-flush 回调时保持顺序。
    it('queueJob & preFlushCb inside preFlushCb', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      job1.id = 1

      const cb1: SchedulerJob = () => {
        calls.push('cb1')
        queueJob(job1)
        // cb2 should execute before the job
        queueJob(cb2)
        queueJob(cb3)
      }
      cb1.flags! |= SchedulerJobFlags.PRE

      const cb2: SchedulerJob = () => {
        calls.push('cb2')
      }
      cb2.flags! |= SchedulerJobFlags.PRE
      cb2.id = 1

      const cb3: SchedulerJob = () => {
        calls.push('cb3')
      }
      cb3.flags! |= SchedulerJobFlags.PRE
      cb3.id = 1

      queueJob(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'cb3', 'job1'])
    })

    // 测试场景：应在具有相同 id 的预作业之后插入作业。
    it('should insert jobs after pre jobs with the same id', async () => {
      const calls: string[] = []
      const job1: SchedulerJob = () => {
        calls.push('job1')
      }
      job1.id = 1
      job1.flags! |= SchedulerJobFlags.PRE
      const job2: SchedulerJob = () => {
        calls.push('job2')
        queueJob(job5)
        queueJob(job6)
      }
      job2.id = 2
      job2.flags! |= SchedulerJobFlags.PRE
      const job3: SchedulerJob = () => {
        calls.push('job3')
      }
      job3.id = 2
      job3.flags! |= SchedulerJobFlags.PRE
      const job4: SchedulerJob = () => {
        calls.push('job4')
      }
      job4.id = 3
      job4.flags! |= SchedulerJobFlags.PRE
      const job5: SchedulerJob = () => {
        calls.push('job5')
      }
      job5.id = 2
      const job6: SchedulerJob = () => {
        calls.push('job6')
      }
      job6.id = 2
      job6.flags! |= SchedulerJobFlags.PRE

      // We need several jobs to test this properly, otherwise
      // findInsertionIndex can yield the correct index by chance
      queueJob(job4)
      queueJob(job2)
      queueJob(job3)
      queueJob(job1)

      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'job3', 'job6', 'job5', 'job4'])
    })

    // 测试场景：pre-flush 回调执行期间加入普通 queueJob。
    it('preFlushCb inside queueJob', async () => {
      const calls: string[] = []
      const job1 = () => {
        // the only case where a pre-flush cb can be queued inside a job is
        // when updating the props of a child component. This is handled
        // directly inside `updateComponentPreRender` to avoid non atomic
        // cb triggers (#1763)
        queueJob(cb1)
        queueJob(cb2)
        flushPreFlushCbs()
        calls.push('job1')
      }
      const cb1: SchedulerJob = () => {
        calls.push('cb1')
        // a cb triggers its parent job, which should be skipped
        queueJob(job1)
      }
      cb1.flags! |= SchedulerJobFlags.PRE
      const cb2: SchedulerJob = () => {
        calls.push('cb2')
      }
      cb2.flags! |= SchedulerJobFlags.PRE

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'job1'])
    })

    // 测试场景：在刷新期间应首先插入没有 id 的预作业。
    it('should insert pre jobs without ids first during flushing', async () => {
      const calls: string[] = []
      const job1: SchedulerJob = () => {
        calls.push('job1')
        queueJob(job3)
        queueJob(job4)
      }
      // job1 has no id
      job1.flags! |= SchedulerJobFlags.PRE
      const job2: SchedulerJob = () => {
        calls.push('job2')
      }
      job2.id = 1
      job2.flags! |= SchedulerJobFlags.PRE
      const job3: SchedulerJob = () => {
        calls.push('job3')
      }
      // job3 has no id
      job3.flags! |= SchedulerJobFlags.PRE
      const job4: SchedulerJob = () => {
        calls.push('job4')
      }
      // job4 has no id
      job4.flags! |= SchedulerJobFlags.PRE

      queueJob(job1)
      queueJob(job2)
      await nextTick()
      expect(calls).toEqual(['job1', 'job3', 'job4', 'job2'])
    })

    // #3806
    // 测试场景：post-flush 回调中加入 pre-flush 任务时，应安排到下一轮正确阶段执行。
    it('queue preFlushCb inside postFlushCb', async () => {
      const spy = vi.fn()
      const cb: SchedulerJob = () => spy()
      cb.flags! |= SchedulerJobFlags.PRE
      queuePostFlushCb(() => {
        queueJob(cb)
      })
      await nextTick()
      expect(spy).toHaveBeenCalled()
    })
  })

  // 测试组：queuePostFlushCb 收集 DOM 提交后回调并处理嵌套入队。
  describe('queuePostFlushCb', () => {
    // 测试场景：基本用法。
    it('basic usage', async () => {
      const calls: string[] = []
      const cb1 = () => {
        calls.push('cb1')
      }
      const cb2 = () => {
        calls.push('cb2')
      }
      const cb3 = () => {
        calls.push('cb3')
      }

      queuePostFlushCb([cb1, cb2])
      queuePostFlushCb(cb3)

      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'cb3'])
    })

    // 测试场景：不应使用非常大的 cb 数组来溢出调用堆栈。
    it('should not overflow the call stack with a very large cb array', async () => {
      // a suspense boundary can buffer an unbounded number of post effects
      // while pending (e.g. a large tree re-rendering under it) and flush them
      // all at once on resolve - spreading such an array into push() throws
      // RangeError: Maximum call stack size exceeded
      let called = 0
      const cbs: SchedulerJob[] = []
      for (let i = 0; i < 1000000; i++) {
        cbs.push(() => {
          called++
        })
      }

      queuePostFlushCb(cbs)
      await nextTick()
      expect(called).toBe(1000000)
    })

    // 测试场景：将非常大的 cb 数组合并到主动刷新时不应溢出调用堆栈。
    it('should not overflow the call stack when merging a very large cb array into an active flush', async () => {
      // same as above, but the large array is queued while a post flush is
      // already in progress, exercising the merge into activePostFlushCbs
      // inside a nested flushPostFlushCbs call
      let called = 0
      const cbs: SchedulerJob[] = []
      for (let i = 0; i < 1000000; i++) {
        cbs.push(() => {
          called++
        })
      }

      queuePostFlushCb(() => {
        queuePostFlushCb(cbs)
        flushPostFlushCbs()
      })
      await nextTick()
      expect(called).toBe(1000000)
    })

    // 测试场景：应该对排队的 postFlushCb 进行重复数据删除。
    it('should dedupe queued postFlushCb', async () => {
      const calls: string[] = []
      const cb1 = () => {
        calls.push('cb1')
      }
      const cb2 = () => {
        calls.push('cb2')
      }
      const cb3 = () => {
        calls.push('cb3')
      }

      queuePostFlushCb([cb1, cb2])
      queuePostFlushCb(cb3)

      queuePostFlushCb([cb1, cb3])
      queuePostFlushCb(cb2)

      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'cb3'])
    })

    // 测试场景：post 队列正在 flush 时，新回调进入当前轮剩余任务或下一轮。
    it('queuePostFlushCb while flushing', async () => {
      const calls: string[] = []
      const cb1 = () => {
        calls.push('cb1')
        // cb2 will be executed after cb1 at the same tick
        queuePostFlushCb(cb2)
      }
      const cb2 = () => {
        calls.push('cb2')
      }
      queuePostFlushCb(cb1)

      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2'])
    })
  })

  // 测试组：主队列 queueJob 与 post-flush 回调相互入队时的阶段顺序。
  describe('queueJob w/ queuePostFlushCb', () => {
    // 测试场景：queueJob 执行期间加入 post-flush 回调。
    it('queueJob inside postFlushCb', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      const cb1 = () => {
        // queueJob in postFlushCb
        calls.push('cb1')
        queueJob(job1)
      }

      queuePostFlushCb(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1'])
    })

    // 测试场景：queueJob 与 post-flush 回调都继续加入 post 回调时保持顺序和去重。
    it('queueJob & postFlushCb inside postFlushCb', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
      }
      const cb1 = () => {
        calls.push('cb1')
        queuePostFlushCb(cb2)
        // job1 will executed before cb2
        // Job has higher priority than postFlushCb
        queueJob(job1)
      }
      const cb2 = () => {
        calls.push('cb2')
      }

      queuePostFlushCb(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1', 'cb2'])
    })

    // 测试场景：queueJob 执行期间加入 postFlushCb 时，回调顺序和去重行为正确。
    it('postFlushCb inside queueJob', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
        // postFlushCb in queueJob
        queuePostFlushCb(cb1)
      }
      const cb1 = () => {
        calls.push('cb1')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'cb1'])
    })

    // 测试场景：queueJob 内的 queueJob 和 postFlushCb。
    it('queueJob & postFlushCb inside queueJob', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')
        // cb1 will executed after job2
        // Job has higher priority than postFlushCb
        queuePostFlushCb(cb1)
        queueJob(job2)
      }
      const job2 = () => {
        calls.push('job2')
      }
      const cb1 = () => {
        calls.push('cb1')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'cb1'])
    })

    // 测试场景：嵌套 queueJob 带 postFlushCb。
    it('nested queueJob w/ postFlushCb', async () => {
      const calls: string[] = []
      const job1 = () => {
        calls.push('job1')

        queuePostFlushCb(cb1)
        queueJob(job2)
      }
      const job2 = () => {
        calls.push('job2')
        queuePostFlushCb(cb2)
      }
      const cb1 = () => {
        calls.push('cb1')
      }
      const cb2 = () => {
        calls.push('cb2')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'cb1', 'cb2'])
    })

    // 测试场景：后刷新期间添加的作业顺序正确。
    test('jobs added during post flush are ordered correctly', async () => {
      const calls: string[] = []

      const job1: SchedulerJob = () => {
        calls.push('job1')
      }
      job1.id = 1

      const job2: SchedulerJob = () => {
        calls.push('job2')
      }
      job2.id = 2

      queuePostFlushCb(() => {
        queueJob(job2)
        queueJob(job1)
      })

      await nextTick()

      expect(calls).toEqual(['job1', 'job2'])
    })
  })

  // 测试场景：根据id对作业进行排序。
  test('sort job based on id', async () => {
    const calls: string[] = []
    const job1 = () => calls.push('job1')
    // job1 has no id
    const job2 = () => calls.push('job2')
    job2.id = 2
    const job3 = () => calls.push('job3')
    job3.id = 1
    const job4: SchedulerJob = () => calls.push('job4')
    job4.id = 2
    job4.flags! |= SchedulerJobFlags.PRE
    const job5: SchedulerJob = () => calls.push('job5')
    // job5 has no id
    job5.flags! |= SchedulerJobFlags.PRE

    queueJob(job1)
    queueJob(job2)
    queueJob(job3)
    queueJob(job4)
    queueJob(job5)
    await nextTick()
    expect(calls).toEqual(['job5', 'job3', 'job4', 'job2', 'job1'])
  })

  // 测试场景：根据id排序SchedulerCbs。
  test('sort SchedulerCbs based on id', async () => {
    const calls: string[] = []
    const cb1 = () => calls.push('cb1')
    // cb1 has no id
    const cb2 = () => calls.push('cb2')
    cb2.id = 2
    const cb3 = () => calls.push('cb3')
    cb3.id = 1

    queuePostFlushCb(cb1)
    queuePostFlushCb(cb2)
    queuePostFlushCb(cb3)
    await nextTick()
    expect(calls).toEqual(['cb3', 'cb2', 'cb1'])
  })

  // #1595
  // 测试场景：避免重复的 postFlushCb 调用。
  test('avoid duplicate postFlushCb invocation', async () => {
    const calls: string[] = []
    const cb1 = () => {
      calls.push('cb1')
      queuePostFlushCb(cb2)
    }
    const cb2 = () => {
      calls.push('cb2')
    }
    queuePostFlushCb(cb1)
    queuePostFlushCb(cb2)
    await nextTick()
    expect(calls).toEqual(['cb1', 'cb2'])
  })

  // 测试场景：nextTick 应该捕获 scheduler 刷新错误。
  test('nextTick should capture scheduler flush errors', async () => {
    const err = new Error('test')
    queueJob(() => {
      throw err
    })
    try {
      await nextTick()
    } catch (e: any) {
      expect(e).toBe(err)
    }
    expect(
      `Unhandled error during execution of scheduler flush`,
    ).toHaveBeenWarned()

    // this one should no longer error
    await nextTick()
  })

  // 测试场景：错误后可以重新排队作业。
  test('jobs can be re-queued after an error', async () => {
    const err = new Error('test')
    let shouldThrow = true

    const job1: SchedulerJob = vi.fn(() => {
      if (shouldThrow) {
        shouldThrow = false
        throw err
      }
    })
    job1.id = 1

    const job2: SchedulerJob = vi.fn()
    job2.id = 2

    queueJob(job1)
    queueJob(job2)

    try {
      await nextTick()
    } catch (e: any) {
      expect(e).toBe(err)
    }
    expect(
      `Unhandled error during execution of scheduler flush`,
    ).toHaveBeenWarned()

    expect(job1).toHaveBeenCalledTimes(1)
    expect(job2).toHaveBeenCalledTimes(0)

    queueJob(job1)
    queueJob(job2)

    await nextTick()

    expect(job1).toHaveBeenCalledTimes(2)
    expect(job2).toHaveBeenCalledTimes(1)
  })

  // 测试场景：默认情况下应该阻止自触发作业。
  test('should prevent self-triggering jobs by default', async () => {
    let count = 0
    const job = () => {
      if (count < 3) {
        count++
        queueJob(job)
      }
    }
    queueJob(job)
    await nextTick()
    // only runs once - a job cannot queue itself
    expect(count).toBe(1)
  })

  // 测试场景：应该允许显式标记的作业自行触发。
  test('should allow explicitly marked jobs to trigger itself', async () => {
    // normal job
    let count = 0
    const job: SchedulerJob = () => {
      if (count < 3) {
        count++
        queueJob(job)
      }
    }
    job.flags! |= SchedulerJobFlags.ALLOW_RECURSE
    queueJob(job)
    await nextTick()
    expect(count).toBe(3)

    // post cb
    const cb: SchedulerJob = () => {
      if (count < 5) {
        count++
        queuePostFlushCb(cb)
      }
    }
    cb.flags! |= SchedulerJobFlags.ALLOW_RECURSE
    queuePostFlushCb(cb)
    await nextTick()
    expect(count).toBe(5)
  })

  // 测试场景：递归作业只能非递归地排队一次。
  test('recursive jobs can only be queued once non-recursively', async () => {
    const job: SchedulerJob = vi.fn()
    job.id = 1
    job.flags = SchedulerJobFlags.ALLOW_RECURSE

    queueJob(job)
    queueJob(job)

    await nextTick()

    expect(job).toHaveBeenCalledTimes(1)
  })

  // 测试场景：递归作业只能递归排队一次。
  test('recursive jobs can only be queued once recursively', async () => {
    let recurse = true

    const job: SchedulerJob = vi.fn(() => {
      if (recurse) {
        queueJob(job)
        queueJob(job)
        recurse = false
      }
    })
    job.id = 1
    job.flags = SchedulerJobFlags.ALLOW_RECURSE

    queueJob(job)

    await nextTick()

    expect(job).toHaveBeenCalledTimes(2)
  })

  // 测试场景：递归作业不能被其他作业重新排队。
  test(`recursive jobs can't be re-queued by other jobs`, async () => {
    let recurse = true

    const job1: SchedulerJob = () => {
      if (recurse) {
        // job2 is already queued, so this shouldn't do anything
        queueJob(job2)
        recurse = false
      }
    }
    job1.id = 1

    const job2: SchedulerJob = vi.fn(() => {
      if (recurse) {
        queueJob(job1)
        queueJob(job2)
      }
    })
    job2.id = 2
    job2.flags = SchedulerJobFlags.ALLOW_RECURSE

    queueJob(job2)

    await nextTick()

    expect(job2).toHaveBeenCalledTimes(2)
  })

  // 测试场景：调用 flushPreFlushCbs 时作业已正确去重。
  test('jobs are de-duplicated correctly when calling flushPreFlushCbs', async () => {
    let recurse = true

    const job1: SchedulerJob = vi.fn(() => {
      queueJob(job3)
      queueJob(job3)
      flushPreFlushCbs()
    })
    job1.id = 1
    job1.flags = SchedulerJobFlags.PRE

    const job2: SchedulerJob = vi.fn(() => {
      if (recurse) {
        // job2 does not allow recurse, so this shouldn't do anything
        queueJob(job2)

        // job3 is already queued, so this shouldn't do anything
        queueJob(job3)
        recurse = false
      }
    })
    job2.id = 2
    job2.flags = SchedulerJobFlags.PRE

    const job3: SchedulerJob = vi.fn(() => {
      if (recurse) {
        queueJob(job2)
        queueJob(job3)

        // The jobs are already queued, so these should have no effect
        queueJob(job2)
        queueJob(job3)
      }
    })
    job3.id = 3
    job3.flags = SchedulerJobFlags.ALLOW_RECURSE | SchedulerJobFlags.PRE

    queueJob(job1)

    await nextTick()

    expect(job1).toHaveBeenCalledTimes(1)
    expect(job2).toHaveBeenCalledTimes(1)
    expect(job3).toHaveBeenCalledTimes(2)
  })

  // #1947 flushPostFlushCbs should handle nested calls
  // e.g. app.mount inside app.mount
  // 测试场景：flushPostFlushCbs 立即刷新、排序并去重待执行的 post 回调。
  test('flushPostFlushCbs', async () => {
    let count = 0

    const queueAndFlush = (hook: Function) => {
      queuePostFlushCb(hook)
      flushPostFlushCbs()
    }

    queueAndFlush(() => {
      queueAndFlush(() => {
        count++
      })
    })

    await nextTick()
    expect(count).toBe(1)
  })

  // #910
  // 测试场景：已停止的 ReactiveEffect 即使仍在队列中，也不应再次执行。
  test('should not run stopped reactive effects', async () => {
    const spy = vi.fn()

    // simulate parent component that toggles child
    const job1 = () => {
      // @ts-expect-error
      job2.flags! |= SchedulerJobFlags.DISPOSED
    }
    // simulate child that's triggered by the same reactive change that
    // triggers its toggle
    const job2 = () => spy()
    expect(spy).toHaveBeenCalledTimes(0)

    queueJob(job1)
    queueJob(job2)
    await nextTick()

    // should not be called
    expect(spy).toHaveBeenCalledTimes(0)
  })

  // 测试场景：flushPreFlushCbs 预作业内。
  it('flushPreFlushCbs inside a pre job', async () => {
    const spy = vi.fn()
    const job: SchedulerJob = () => {
      spy()
      flushPreFlushCbs()
    }
    job.flags! |= SchedulerJobFlags.PRE
    queueJob(job)
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // 测试场景：post-flush 阶段调用 flushPreFlushCbs 时不会破坏调度阶段边界。
  test('flushPreFlushCbs inside a post job', async () => {
    const calls: string[] = []
    const callsAfterFlush: string[] = []

    const job1: SchedulerJob = () => {
      calls.push('job1')
    }
    job1.id = 1
    job1.flags! |= SchedulerJobFlags.PRE

    const job2: SchedulerJob = () => {
      calls.push('job2')
    }
    job2.id = 2
    job2.flags! |= SchedulerJobFlags.PRE

    queuePostFlushCb(() => {
      queueJob(job2)
      queueJob(job1)

      // e.g. nested app.mount() call
      flushPreFlushCbs()
      callsAfterFlush.push(...calls)
    })

    await nextTick()

    expect(callsAfterFlush).toEqual(['job1', 'job2'])
    expect(calls).toEqual(['job1', 'job2'])
  })

  // 测试场景：nextTick 应返回承诺。
  it('nextTick should return promise', async () => {
    const fn = vi.fn(() => {
      return 1
    })

    const p = nextTick(fn)

    expect(p).toBeInstanceOf(Promise)
    expect(await p).toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // #10003
  // 测试场景：post-flush 回调内部再次刷新回调时，嵌套队列顺序与去重正确。
  test('nested flushPostFlushCbs', async () => {
    const calls: string[] = []
    const cb1 = () => calls.push('cb1')
    // cb1 has no id
    const cb2 = () => calls.push('cb2')
    cb2.id = -1
    const queueAndFlush = (hook: Function) => {
      queuePostFlushCb(hook)
      flushPostFlushCbs()
    }

    queueAndFlush(() => {
      queuePostFlushCb([cb1, cb2])
      flushPostFlushCbs()
    })

    await nextTick()
    expect(calls).toEqual(['cb2', 'cb1'])
  })
})
