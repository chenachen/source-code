/**
 * 直接把记录调用顺序的函数加入主队列或 post 队列，通过 nextTick 等待刷新。
 * PRE、ALLOW_RECURSE、DISPOSED 与 ID 均由夹具显式设置，不依赖真实组件或 ReactiveEffect。
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

// scheduler 对组件任务和 watcher 的排序、去重、递归与错误处理。
describe('scheduler', () => {
  // 没有待刷新任务时，nextTick(fn) 仍在同步代码之后的微任务中执行 fn。
  it('nextTick', async () => {
    const calls: string[] = []
    const dummyThen = Promise.resolve().then()
    /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job1 = () => {
      calls.push('job1')
    }
    /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job2 = () => {
      calls.push('job2')
    }
    nextTick(job1)
    job2()

    expect(calls.length).toBe(1)
    await dummyThen
    // job1 在 nextTick 的微任务中记录。
    expect(calls.length).toBe(2)
    expect(calls).toMatchObject(['job2', 'job1'])
  })

  // queueJob 按 ID 插入主队列、去重任务并维护父子更新顺序。
  describe('queueJob', () => {
    // 两个普通 job 入队后不立即执行，nextTick 等待它们按入队顺序执行。
    it('basic usage', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job2 = () => {
        calls.push('job2')
      }
      queueJob(job1)
      queueJob(job2)
      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['job1', 'job2'])
    })

    // 刷新中的 job 添加不同 ID 任务，新任务只在尚未执行区间内按 ID 排序。
    it("should insert jobs in ascending order of job's id when flushing", async () => {
      const calls: string[] = []
      /** 记录 job1 后加入 job2/id10 与 job3/id1，构造刷新中的有序插入。 */
      const job1 = () => {
        calls.push('job1')

        queueJob(job2)
        queueJob(job3)
      }

      /** 记录 job2 后加入无 ID 的 job4/job5，检查它们位于有 ID 任务之后。 */
      const job2 = () => {
        calls.push('job2')
        queueJob(job4)
        queueJob(job5)
      }
      job2.id = 10

      /** 将 job3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job3 = () => {
        calls.push('job3')
      }
      job3.id = 1

      /** 将 job4 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job4 = () => {
        calls.push('job4')
      }

      /** 将 job5 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job5 = () => {
        calls.push('job5')
      }

      queueJob(job1)

      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['job1', 'job3', 'job2', 'job4', 'job5'])
    })

    // 同一函数多次 queueJob，只在本轮执行一次。
    it('should dedupe queued jobs', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
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

    // job 执行时添加另一个 job，新 job 在同一轮继续执行。
    it('queueJob while flushing', async () => {
      const calls: string[] = []
      /** 记录 job1 后将 job2 入队，验证刷新中的新增任务在同批执行。 */
      const job1 = () => {
        calls.push('job1')
        // job2 在同一批刷新中位于 job1 之后。
        queueJob(job2)
      }
      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job2 = () => {
        calls.push('job2')
      }
      queueJob(job1)

      await nextTick()
      expect(calls).toEqual(['job1', 'job2'])
    })
  })

  // PRE 任务的插入、主动抽取与嵌套调度。
  describe('pre flush jobs', () => {
    // pre 回调内加入普通 job，同一轮先执行 pre 再执行 job。
    it('queueJob inside preFlushCb', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      /** PRE 回调记录 cb1 后加入 job1，供比较新增普通任务的执行顺序。 */
      const cb1: SchedulerJob = () => {
        // PRE 回调向主队列加入 job。
        calls.push('cb1')
        queueJob(job1)
      }
      cb1.flags! |= SchedulerJobFlags.PRE

      queueJob(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1'])
    })

    // pre 回调同时加入普通 job 和同 ID 的 pre 回调，新增 pre 都先于普通 job。
    it('queueJob & preFlushCb inside preFlushCb', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      job1.id = 1

      /** 记录 cb1 后加入同 ID 普通 job1 与 PRE cb2/cb3，构造 PRE 优先插入。 */
      const cb1: SchedulerJob = () => {
        calls.push('cb1')
        queueJob(job1)
        // 同 ID 的 PRE cb2 先于普通 job。
        queueJob(cb2)
        queueJob(cb3)
      }
      cb1.flags! |= SchedulerJobFlags.PRE

      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2: SchedulerJob = () => {
        calls.push('cb2')
      }
      cb2.flags! |= SchedulerJobFlags.PRE
      cb2.id = 1

      /** 将 cb3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb3: SchedulerJob = () => {
        calls.push('cb3')
      }
      cb3.flags! |= SchedulerJobFlags.PRE
      cb3.id = 1

      queueJob(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'cb3', 'job1'])
    })

    // 相同 ID 的新增 pre 任务插在已有 pre 后、普通 job 前。
    it('should insert jobs after pre jobs with the same id', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1: SchedulerJob = () => {
        calls.push('job1')
      }
      job1.id = 1
      job1.flags! |= SchedulerJobFlags.PRE
      /** ID2 的 PRE 任务记录 job2 后加入同 ID 普通 job5 与 PRE job6，观察新增任务的插入位置。 */
      const job2: SchedulerJob = () => {
        calls.push('job2')
        queueJob(job5)
        queueJob(job6)
      }
      job2.id = 2
      job2.flags! |= SchedulerJobFlags.PRE
      /** 将 job3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job3: SchedulerJob = () => {
        calls.push('job3')
      }
      job3.id = 2
      job3.flags! |= SchedulerJobFlags.PRE
      /** 将 job4 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job4: SchedulerJob = () => {
        calls.push('job4')
      }
      job4.id = 3
      job4.flags! |= SchedulerJobFlags.PRE
      /** 将 job5 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job5: SchedulerJob = () => {
        calls.push('job5')
      }
      job5.id = 2
      /** 将 job6 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job6: SchedulerJob = () => {
        calls.push('job6')
      }
      job6.id = 2
      job6.flags! |= SchedulerJobFlags.PRE

      // 用多任务组合覆盖真实的二分插入位置。
      // 避免小队列恰好得到正确顺序掩盖插入错误。
      queueJob(job4)
      queueJob(job2)
      queueJob(job3)
      queueJob(job1)

      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'job3', 'job6', 'job5', 'job4'])
    })

    // 普通 job 内加入 pre 回调，flushPreFlushCbs 先执行这些回调再继续该 job。
    it('preFlushCb inside queueJob', async () => {
      const calls: string[] = []
      /** 加入两个 PRE 回调并立即抽取刷新，最后记录 job1，模拟子 props 更新的同步 pre 阶段。 */
      const job1 = () => {
        // 模拟子 props 更新时，在主任务内加入 PRE 回调。
        // 组件更新会在 updateComponentPreRender 中同步抽取这些回调。
        // 这样 pre watcher 在继续渲染子树之前完成。
        // #1763。
        queueJob(cb1)
        queueJob(cb2)
        flushPreFlushCbs()
        calls.push('job1')
      }
      /** 记录 cb1 后尝试加入仍在执行的 job1，验证父任务不重跑。 */
      const cb1: SchedulerJob = () => {
        calls.push('cb1')
        // cb 尝试重加仍在执行的父任务，应被去重。
        queueJob(job1)
      }
      cb1.flags! |= SchedulerJobFlags.PRE
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2: SchedulerJob = () => {
        calls.push('cb2')
      }
      cb2.flags! |= SchedulerJobFlags.PRE

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'job1'])
    })

    // 无 ID 的 PRE 任务按 -1 插入剩余队列，先于有 ID 的 PRE 任务。
    it('should insert pre jobs without ids first during flushing', async () => {
      const calls: string[] = []
      /** 无 ID PRE 任务记录 job1 后加入无 ID PRE job3/job4，构造剩余队列的优先插入。 */
      const job1: SchedulerJob = () => {
        calls.push('job1')
        queueJob(job3)
        queueJob(job4)
      }
      // job1 没有 ID。
      job1.flags! |= SchedulerJobFlags.PRE
      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job2: SchedulerJob = () => {
        calls.push('job2')
      }
      job2.id = 1
      job2.flags! |= SchedulerJobFlags.PRE
      /** 将 job3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job3: SchedulerJob = () => {
        calls.push('job3')
      }
      // job3 没有 ID。
      job3.flags! |= SchedulerJobFlags.PRE
      /** 将 job4 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job4: SchedulerJob = () => {
        calls.push('job4')
      }
      // job4 没有 ID。
      job4.flags! |= SchedulerJobFlags.PRE

      queueJob(job1)
      queueJob(job2)
      await nextTick()
      expect(calls).toEqual(['job1', 'job3', 'job4', 'job2'])
    })

    // #3806
    // post 回调加入 PRE 任务，尾部递归刷新会在当前 nextTick 返回前执行它。
    it('queue preFlushCb inside postFlushCb', async () => {
      const spy = vi.fn()
      /** 调用 spy 的 PRE 任务，由 post 回调入队，供验证尾部递归刷新。 */
      const cb: SchedulerJob = () => spy()
      cb.flags! |= SchedulerJobFlags.PRE
      queuePostFlushCb(() => {
        queueJob(cb)
      })
      await nextTick()
      expect(spy).toHaveBeenCalled()
    })
  })

  // queuePostFlushCb 收集 DOM 提交后回调并处理嵌套入队。
  describe('queuePostFlushCb', () => {
    // post 回调可按数组或单函数入队，nextTick 后依次执行。
    it('basic usage', async () => {
      const calls: string[] = []
      /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb1 = () => {
        calls.push('cb1')
      }
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2 = () => {
        calls.push('cb2')
      }
      /** 将 cb3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb3 = () => {
        calls.push('cb3')
      }

      queuePostFlushCb([cb1, cb2])
      queuePostFlushCb(cb3)

      expect(calls).toEqual([])
      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2', 'cb3'])
    })

    // 百万 post 回调以数组入队，逐项汇入队列不会触发展开参数的栈限制。
    it('should not overflow the call stack with a very large cb array', async () => {
      // Suspense 挂起期间可缓冲大量 post effects。
      // 解析时会把整批回调一起交给 post 队列。
      // 不能用展开参数向 push 传百万回调，否则超出参数栈限制。
      // 预期所有回调执行完成。
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

    // 活动 post flush 中嵌套合并百万回调，逐项追加后全部执行。
    it('should not overflow the call stack when merging a very large cb array into an active flush', async () => {
      // 本例在已有 post 刷新中加入百万回调。
      // 嵌套 flushPostFlushCbs 将它们合并到 activePostFlushCbs。
      // 检查活动队列追加也不会超出展开参数限制。
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

    // 单函数与数组重复包含同一 post 回调，刷新前按函数引用去重。
    it('should dedupe queued postFlushCb', async () => {
      const calls: string[] = []
      /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb1 = () => {
        calls.push('cb1')
      }
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2 = () => {
        calls.push('cb2')
      }
      /** 将 cb3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
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

    // post 回调执行时加入另一个 post 回调，尾部继续刷新并在当前 nextTick 返回前执行。
    it('queuePostFlushCb while flushing', async () => {
      const calls: string[] = []
      /** 记录 cb1 后加入 cb2，检查 post 新增回调仍在当前 nextTick 前执行。 */
      const cb1 = () => {
        calls.push('cb1')
        // cb2 在同批 post 刷新中晚于 cb1。
        queuePostFlushCb(cb2)
      }
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2 = () => {
        calls.push('cb2')
      }
      queuePostFlushCb(cb1)

      await nextTick()
      expect(calls).toEqual(['cb1', 'cb2'])
    })
  })

  // 主队列 queueJob 与 post-flush 回调相互入队时的阶段顺序。
  describe('queueJob w/ queuePostFlushCb', () => {
    // post 回调内加入普通 job，尾部递归刷新执行新 job。
    it('queueJob inside postFlushCb', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      /** 记录 cb1 后加入主 job1，构造 post 完成后的主队列再刷新。 */
      const cb1 = () => {
        // post 回调向主队列加入 job。
        calls.push('cb1')
        queueJob(job1)
      }

      queuePostFlushCb(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1'])
    })

    // post 回调同时加入普通 job 与新 post 回调，先刷新 job 再执行新 post 回调。
    it('queueJob & postFlushCb inside postFlushCb', async () => {
      const calls: string[] = []
      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1 = () => {
        calls.push('job1')
      }
      /** 记录 cb1 后加入 post cb2 与主 job1，验证下一轮主队列先于新 post 回调。 */
      const cb1 = () => {
        calls.push('cb1')
        queuePostFlushCb(cb2)
        // 新主 job1 在下一轮 post cb2 之前执行。
        // 尾部先重新刷新主队列，再刷新新 post 回调。
        queueJob(job1)
      }
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2 = () => {
        calls.push('cb2')
      }

      queuePostFlushCb(cb1)
      await nextTick()
      expect(calls).toEqual(['cb1', 'job1', 'cb2'])
    })

    // 普通 job 加入 post 回调，主队列结束后执行该回调。
    it('postFlushCb inside queueJob', async () => {
      const calls: string[] = []
      /** 记录 job1 后加入 post cb1，观察主队列结束后的 post 阶段。 */
      const job1 = () => {
        calls.push('job1')
        // 主 job 向 post 队列加入回调。
        queuePostFlushCb(cb1)
      }
      /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb1 = () => {
        calls.push('cb1')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'cb1'])
    })

    // 普通 job 同时加入另一个 job 与 post 回调，两个 job 都先于 post 回调。
    it('queueJob & postFlushCb inside queueJob', async () => {
      const calls: string[] = []
      /** 记录 job1 后加入 post cb1 与主 job2，比较两条队列的阶段顺序。 */
      const job1 = () => {
        calls.push('job1')
        // 先执行新增主 job2，再执行 post cb1。
        // 主队列完成后才刷新 post 回调。
        queuePostFlushCb(cb1)
        queueJob(job2)
      }
      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job2 = () => {
        calls.push('job2')
      }
      /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb1 = () => {
        calls.push('cb1')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'cb1'])
    })

    // 两个串联 job 分别加入 post 回调，主队列完成后按入队顺序执行两个回调。
    it('nested queueJob w/ postFlushCb', async () => {
      const calls: string[] = []
      /** 记录 job1 后加入 post cb1 与主 job2，启动嵌套主任务与 post 回调夹具。 */
      const job1 = () => {
        calls.push('job1')

        queuePostFlushCb(cb1)
        queueJob(job2)
      }
      /** 记录 job2 后加入 post cb2，检查两个 post 回调保持入队顺序。 */
      const job2 = () => {
        calls.push('job2')
        queuePostFlushCb(cb2)
      }
      /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb1 = () => {
        calls.push('cb1')
      }
      /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const cb2 = () => {
        calls.push('cb2')
      }

      queueJob(job1)
      await nextTick()
      expect(calls).toEqual(['job1', 'job2', 'cb1', 'cb2'])
    })

    // post 回调先后加入大、小 ID 的 job，下一次主队列遍历按 ID 升序执行。
    test('jobs added during post flush are ordered correctly', async () => {
      const calls: string[] = []

      /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
      const job1: SchedulerJob = () => {
        calls.push('job1')
      }
      job1.id = 1

      /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
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

  // 无 ID 的 PRE 最前，同 ID 的 PRE 先于普通 job，无 ID 的普通 job 最后。
  test('sort job based on id', async () => {
    const calls: string[] = []
    /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job1 = () => calls.push('job1')
    // job1 没有 ID。
    /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job2 = () => calls.push('job2')
    job2.id = 2
    /** 将 job3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job3 = () => calls.push('job3')
    job3.id = 1
    /** 将 job4 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job4: SchedulerJob = () => calls.push('job4')
    job4.id = 2
    job4.flags! |= SchedulerJobFlags.PRE
    /** 将 job5 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job5: SchedulerJob = () => calls.push('job5')
    // job5 没有 ID。
    job5.flags! |= SchedulerJobFlags.PRE

    queueJob(job1)
    queueJob(job2)
    queueJob(job3)
    queueJob(job4)
    queueJob(job5)
    await nextTick()
    expect(calls).toEqual(['job5', 'job3', 'job4', 'job2', 'job1'])
  })

  // post 回调按 ID 升序执行，无 ID 的回调排在有 ID 的回调之后。
  test('sort SchedulerCbs based on id', async () => {
    const calls: string[] = []
    /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb1 = () => calls.push('cb1')
    // cb1 没有 ID。
    /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb2 = () => calls.push('cb2')
    cb2.id = 2
    /** 将 cb3 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb3 = () => calls.push('cb3')
    cb3.id = 1

    queuePostFlushCb(cb1)
    queuePostFlushCb(cb2)
    queuePostFlushCb(cb3)
    await nextTick()
    expect(calls).toEqual(['cb3', 'cb2', 'cb1'])
  })

  // #1595
  // 正在刷新时重复加入活动队列中尚未执行的 post 回调，不多执行一次。
  test('avoid duplicate postFlushCb invocation', async () => {
    const calls: string[] = []
    /** 记录 cb1 后添加活动队列中已有的 cb2，验证 cb2 不重复执行。 */
    const cb1 = () => {
      calls.push('cb1')
      queuePostFlushCb(cb2)
    }
    /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb2 = () => {
      calls.push('cb2')
    }
    queuePostFlushCb(cb1)
    queuePostFlushCb(cb2)
    await nextTick()
    expect(calls).toEqual(['cb1', 'cb2'])
  })

  // 主队列 job 抛错使本轮 nextTick 拒绝；主队列清理后下一次 nextTick 不再沿用该错误。
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

    // 前一批错误已清理，新的 nextTick 应兑现。
    await nextTick()
  })

  // 主 job 抛错后，未执行任务的 QUEUED 也被清除，两个任务随后都能重新入队。
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

  // 普通 job 执行期间 QUEUED 仍为真，尝试把自己重新入队不会再次执行。
  test('should prevent self-triggering jobs by default', async () => {
    let count = 0
    /** 计数后尝试自入队；没有 ALLOW_RECURSE，供验证默认自触发被去重。 */
    const job = () => {
      if (count < 3) {
        count++
        queueJob(job)
      }
    }
    queueJob(job)
    await nextTick()
    // 普通任务执行期间自入队被去重，只计数一次。
    expect(count).toBe(1)
  })

  // 主 job 和 post 回调显式标 ALLOW_RECURSE 后，均可在执行期间重新入队。
  test('should allow explicitly marked jobs to trigger itself', async () => {
    // 主队列任务。
    let count = 0
    /** 计数至3前反复自入队，配合 ALLOW_RECURSE 验证主队列显式递归。 */
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

    // post 回调。
    /** 计数至5前自加入 post 队列，配合 ALLOW_RECURSE 检查 post 递归。 */
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

  // ALLOW_RECURSE 只放开执行期间自入队，执行前的重复 queueJob 仍被去重。
  test('recursive jobs can only be queued once non-recursively', async () => {
    const job: SchedulerJob = vi.fn()
    job.id = 1
    job.flags = SchedulerJobFlags.ALLOW_RECURSE

    queueJob(job)
    queueJob(job)

    await nextTick()

    expect(job).toHaveBeenCalledTimes(1)
  })

  // 递归 job 一次执行中两次添加自己，只保留一次重跑。
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

  // 递归 job 已再次入队时，其他 job 再添加它也不会造成重复执行。
  test(`recursive jobs can't be re-queued by other jobs`, async () => {
    let recurse = true

    /** 在 recurse 为真时尝试加入已排队 job2，并关闭递归条件，验证跨任务追加仍去重。 */
    const job1: SchedulerJob = () => {
      if (recurse) {
        // job2 已排队，此次再添加不产生重复执行。
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

  // flushPreFlushCbs 抽取 PRE 任务后仍保持去重，显式递归任务只保留一次重跑。
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
        // job2 未允许递归，自入队被去重。
        queueJob(job2)

        // job3 已排队，再添加不产生重复执行。
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

        // 已排队任务再次添加也不增加执行次数。
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

  // #1947：post 刷新须处理嵌套调用。
  // 例如一个 mounted 阶段内再次 app.mount。
  // post 回调内嵌套调用 flushPostFlushCbs，把新回调追加到活动队列后继续执行。
  test('flushPostFlushCbs', async () => {
    let count = 0

    /** 将 hook 加入 post 队列后立即刷新，构造嵌套 post flush。 */
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
  // 父任务给尚未执行的子任务设置 DISPOSED，子任务随后被跳过。
  test('should not run stopped reactive effects', async () => {
    const spy = vi.fn()

    // 模拟父更新卸载子组件。
    /** 给尚未执行的 job2 设置 DISPOSED，模拟父更新卸载已排队子组件。 */
    const job1 = () => {
      // @ts-expect-error
      job2.flags! |= SchedulerJobFlags.DISPOSED
    }
    // 模拟同一次响应式变化已排队的子任务。
    // 父先执行并把该子任务标为 DISPOSED。
    /** 调用 spy 的子任务夹具，供验证 DISPOSED 任务被跳过。 */
    const job2 = () => spy()
    expect(spy).toHaveBeenCalledTimes(0)

    queueJob(job1)
    queueJob(job2)
    await nextTick()

    // 停止后的子任务不应调用 spy。
    expect(spy).toHaveBeenCalledTimes(0)
  })

  // PRE 任务执行时调用 flushPreFlushCbs，不回头重复执行当前任务。
  it('flushPreFlushCbs inside a pre job', async () => {
    const spy = vi.fn()
    /** 调用 spy 后立即刷新剩余 PRE 队列，验证抽取不会回头执行当前任务。 */
    const job: SchedulerJob = () => {
      spy()
      flushPreFlushCbs()
    }
    job.flags! |= SchedulerJobFlags.PRE
    queueJob(job)
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // post 回调中手动 flushPreFlushCbs，两个 PRE 任务立即按 ID 执行且之后不重复。
  test('flushPreFlushCbs inside a post job', async () => {
    const calls: string[] = []
    const callsAfterFlush: string[] = []

    /** 将 job1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job1: SchedulerJob = () => {
      calls.push('job1')
    }
    job1.id = 1
    job1.flags! |= SchedulerJobFlags.PRE

    /** 将 job2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const job2: SchedulerJob = () => {
      calls.push('job2')
    }
    job2.id = 2
    job2.flags! |= SchedulerJobFlags.PRE

    queuePostFlushCb(() => {
      queueJob(job2)
      queueJob(job1)

      // 模拟嵌套 app.mount 的主动 PRE 刷新。
      flushPreFlushCbs()
      callsAfterFlush.push(...calls)
    })

    await nextTick()

    expect(callsAfterFlush).toEqual(['job1', 'job2'])
    expect(calls).toEqual(['job1', 'job2'])
  })

  // nextTick(fn) 返回 Promise，兑现为 fn 的返回值且只调用一次 fn。
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
  // 嵌套 post flush 合并新回调时，id=-1 的回调先于同批无 ID 回调。
  test('nested flushPostFlushCbs', async () => {
    const calls: string[] = []
    /** 将 cb1 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb1 = () => calls.push('cb1')
    // cb1 没有 ID。
    /** 将 cb2 写入 calls，供本例比较执行顺序；函数身份同时用于队列去重。 */
    const cb2 = () => calls.push('cb2')
    cb2.id = -1
    /** 将 hook 加入 post 队列后立即刷新，构造活动队列合并与 id=-1 的排序。 */
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
