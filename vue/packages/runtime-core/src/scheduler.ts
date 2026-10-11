import { ErrorCodes, callWithErrorHandling, handleError } from './errorHandling'
import { NOOP, isArray } from '@vue/shared'
import { type ComponentInternalInstance, getComponentName } from './component'

/** 调度任务的状态位。用位掩码避免为每个高频任务分配多个布尔字段。 */
export enum SchedulerJobFlags {
  /** 已进入主队列或 post 队列，用于 O(1) 去重。 */
  QUEUED = 1 << 0,
  /** 组件更新前执行的任务，典型场景是默认 `flush: 'pre'` 的 watcher。 */
  PRE = 1 << 1,
  /**
   * 允许任务在执行期间再次把自己放入队列。
   *
   * 默认禁止自触发：例如 `Array.prototype.push` 同时包含读和写，若 effect 在读取数组时
   * 又 push，可能形成难以理解的无限循环（#1740）。仅组件更新和 watch 回调可显式开启：
   *
   * - #1801：父组件更新子组件 props 后，子的 pre watcher 可能修改父渲染依赖，父更新
   *   需要被重新调度才能收敛到正确 UI。
   * - #1727：watch 回调本身不追踪依赖；若它再次修改 source，通常是用户有意做分步
   *   状态归一化，是否最终稳定应由用户负责。
   */
  ALLOW_RECURSE = 1 << 2,
  /** 任务已显式作废；flushJobs 与 post-flush 循环即使取到它也会跳过。 */
  DISPOSED = 1 << 3,
}

/**
 * Vue 调度器中的最小任务结构。
 *
 * 任务本身就是函数，附加字段用于排序、状态判断和开发错误归因，避免额外包装对象。
 */
export interface SchedulerJob extends Function {
  /** 排序 ID；组件更新使用 uid，未提供时普通任务排在末尾。 */
  id?: number
  /**
   * 任务状态位。技术上可为 `undefined`，JavaScript 位运算会将其视为 0，因此热路径
   * 无需先初始化。
   */
  flags?: SchedulerJobFlags
  /**
   * 渲染器创建组件 render effect 时附加的内部实例。
   * 用于区分组件更新错误，并在递归更新超限时报告组件名。
   */
  i?: ComponentInternalInstance
}

/** 接受单个或批量任务的 post-flush 入队参数。 */
export type SchedulerJobs = SchedulerJob | SchedulerJob[]

/** 主队列：组件更新、pre watcher 等按任务 ID 排序后在同一微任务内执行。 */
const queue: SchedulerJob[] = []
/** 当前正在执行的主队列下标；`-1` 表示未刷新。 */
let flushIndex = -1

/** 等待下一轮 post-flush 的任务，如 mounted/updated 钩子。 */
const pendingPostFlushCbs: SchedulerJob[] = []
/** 正在刷新的 post 队列；单独保存以支持刷新期间嵌套追加。 */
let activePostFlushCbs: SchedulerJob[] | null = null
/** 当前 post 队列下标。特殊 `id === -1` 任务会插在其后立即执行。 */
let postFlushIndex = 0

/** 所有刷新共用的已决 Promise，作为微任务调度基点，避免重复创建。 */
const resolvedPromise = /*@__PURE__*/ Promise.resolve() as Promise<any>
/** 当前刷新 Promise；同时作为“本轮是否已安排”的锁和 `nextTick()` 等待目标。 */
let currentFlushPromise: Promise<void> | null = null

/** 开发环境单轮刷新中同一任务允许执行的上限，用于识别失控递归。 */
const RECURSION_LIMIT = 100
/** 记录单轮刷新内每个任务已执行次数。 */
type CountMap = Map<SchedulerJob, number>

/**
 * 等待当前待处理组件更新和 post-flush 回调全部完成。
 *
 * 若刷新已经排入微任务，则链接到该 Promise；否则链接到已决 Promise，因此回调总在
 * 当前同步栈之后执行。它只保证等待“当前批次”，不是浏览器绘制完成信号。
 */
export function nextTick(): Promise<void>
/** 在当前刷新 Promise 后调用 fn，保留显式 this 绑定，并把 fn 返回值/拒绝传给调用方。 */
export function nextTick<T, R>(
  this: T,
  fn: (this: T) => R | Promise<R>,
): Promise<R>
/** 选择当前批次或已决 Promise；回调的同步抛错会成为返回 Promise 的拒绝。 */
export function nextTick<T, R>(
  this: T,
  fn?: (this: T) => R | Promise<R>,
): Promise<void | R> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

/**
 * 用二分查找确定任务在“尚未执行的队列区间”中的插入位置。
 *
 * 队列按 ID 升序保证父组件先于子组件更新，因为父组件更早创建、uid 更小。若父更新
 * 卸载了子组件，子任务随后可凭 `DISPOSED` 跳过。同一组件的 pre watcher 与更新任务
 * ID 相同，但 watcher 必须排在更新前；若父级卸载该组件，两者也能一起被跳过。
 */
function findInsertionIndex(id: number) {
  let start = flushIndex + 1
  let end = queue.length

  while (start < end) {
    const middle = (start + end) >>> 1
    const middleJob = queue[middle]
    const middleJobId = getId(middleJob)
    if (
      middleJobId < id ||
      (middleJobId === id && middleJob.flags! & SchedulerJobFlags.PRE)
    ) {
      start = middle + 1
    } else {
      end = middle
    }
  }

  return start
}

/**
 * 将组件更新或 pre watcher 加入主队列，并确保只安排一次微任务刷新。
 *
 * 常见的 ID 递增任务直接追加；只有乱序任务才二分插入。`QUEUED` 位同时承担去重，
 * 避免响应式状态在同一同步调用栈内多次修改导致组件重复渲染。
 */
export function queueJob(job: SchedulerJob): void {
  if (!(job.flags! & SchedulerJobFlags.QUEUED)) {
    const jobId = getId(job)
    const lastJob = queue[queue.length - 1]
    if (
      !lastJob ||
      // 常见父到子更新的 ID 单调递增，直接追加可避开二分与数组搬移。
      (!(job.flags! & SchedulerJobFlags.PRE) && jobId >= getId(lastJob))
    ) {
      queue.push(job)
    } else {
      queue.splice(findInsertionIndex(jobId), 0, job)
    }

    job.flags! |= SchedulerJobFlags.QUEUED

    queueFlush()
  }
}

/** 若本批次尚未安排刷新，则创建一个微任务执行主队列。 */
function queueFlush() {
  if (!currentFlushPromise) {
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

/**
 * 将生命周期钩子等任务加入组件更新后的 post-flush 队列。
 *
 * 单任务用状态位去重；生命周期钩子数组来自已去重的主更新任务，无需逐项检查。
 * `id === -1` 表示必须紧跟当前 post 回调执行，供内部嵌套场景保持时序。
 */
export function queuePostFlushCb(cb: SchedulerJobs): void {
  if (!isArray(cb)) {
    if (activePostFlushCbs && cb.id === -1) {
      activePostFlushCbs.splice(postFlushIndex + 1, 0, cb)
    } else if (!(cb.flags! & SchedulerJobFlags.QUEUED)) {
      pendingPostFlushCbs.push(cb)
      cb.flags! |= SchedulerJobFlags.QUEUED
    }
  } else {
    // 数组只会由已去重的组件任务触发生命周期钩子，可跳过去重以缩短热路径。
    // #15142：Suspense 可缓冲任意多 effect，`push(...cb)` 会因参数过多撑爆调用栈；
    // 显式循环不受函数参数数量限制。
    for (let i = 0; i < cb.length; i++) {
      pendingPostFlushCbs.push(cb[i])
    }
  }
  queueFlush()
}

/**
 * 立即执行队列中的 pre watcher，可选只处理指定组件。
 *
 * 渲染器在更新组件 props 后、执行其 render 前调用此函数，使 watcher 看到新 props，
 * 且其状态修改能纳入同一次渲染。执行前从队列移除，避免主循环再次运行。
 */
export function flushPreFlushCbs(
  instance?: ComponentInternalInstance,
  seen?: CountMap,
  // 默认从当前任务之后开始，不能回头重复执行正在运行的任务。
  i: number = flushIndex + 1,
): void {
  if (__DEV__) {
    seen = seen || new Map()
  }
  for (; i < queue.length; i++) {
    const cb = queue[i]
    if (cb && cb.flags! & SchedulerJobFlags.PRE) {
      if (instance && cb.id !== instance.uid) {
        continue
      }
      if (__DEV__ && checkRecursiveUpdates(seen!, cb)) {
        continue
      }
      queue.splice(i, 1)
      i--
      if (cb.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
      cb()
      if (!(cb.flags! & SchedulerJobFlags.ALLOW_RECURSE)) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
    }
  }
}

/**
 * 去重、排序并刷新所有 post-flush 回调。
 *
 * 刷新期间若再次调用，会把新任务追加到当前活动队列而不是递归开启第二套循环，确保
 * 生命周期时序稳定，并与主队列共享递归次数检测。
 */
export function flushPostFlushCbs(seen?: CountMap): void {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)].sort(
      (a, b) => getId(a) - getId(b),
    )
    pendingPostFlushCbs.length = 0

    // #1947：嵌套刷新时复用活动队列，避免重置 `postFlushIndex` 导致漏执行或重复执行。
    if (activePostFlushCbs) {
      for (let i = 0; i < deduped.length; i++) {
        activePostFlushCbs.push(deduped[i])
      }
      return
    }

    activePostFlushCbs = deduped
    if (__DEV__) {
      seen = seen || new Map()
    }

    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      const cb = activePostFlushCbs[postFlushIndex]
      if (__DEV__ && checkRecursiveUpdates(seen!, cb)) {
        continue
      }
      if (cb.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
      if (!(cb.flags! & SchedulerJobFlags.DISPOSED)) cb()
      cb.flags! &= ~SchedulerJobFlags.QUEUED
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

/**
 * 取得排序 ID：无 ID 的 pre 任务排最前，普通无 ID 任务排最后。
 * 组件 render job 和所属 pre watcher 使用 uid；mounted/updated 钩子与普通 post watcher
 * 通常没有 ID，使用 Infinity 后由稳定排序保留其入队顺序。
 */
const getId = (job: SchedulerJob): number =>
  job.id == null ? (job.flags! & SchedulerJobFlags.PRE ? -1 : Infinity) : job.id

/**
 * 刷新主队列，并在 `finally` 中完成状态清理与 post 队列刷新。
 *
 * 主队列任务抛错仍会清除剩余主任务的 `QUEUED` 标记并调用 post flush。post flush
 * 正常返回后先清空 `currentFlushPromise`，再同步递归处理新任务；原 Promise 要等整次
 * 调用返回才兑现。若 post 回调继续抛错，post 状态及 Promise 的复位会被中断。
 */
function flushJobs(seen?: CountMap) {
  if (__DEV__) {
    seen = seen || new Map()
  }

  // 开发分支必须在 try/catch 外决定。Rollup 会保守处理 try/catch 内代码，导致递归
  // 警告逻辑无法 tree-shaking；terser 也许能二次删除，但 esbuild #1610 等场景不会。
  // 提前选择 `check` 可让生产构建稳定消除整段开发逻辑。
  const check = __DEV__
    ? (job: SchedulerJob) => checkRecursiveUpdates(seen!, job)
    : NOOP

  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job && !(job.flags! & SchedulerJobFlags.DISPOSED)) {
        if (__DEV__ && check(job)) {
          continue
        }
        if (job.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
          job.flags! &= ~SchedulerJobFlags.QUEUED
        }
        callWithErrorHandling(
          job,
          job.i,
          job.i ? ErrorCodes.COMPONENT_UPDATE : ErrorCodes.SCHEDULER,
        )
        if (!(job.flags! & SchedulerJobFlags.ALLOW_RECURSE)) {
          job.flags! &= ~SchedulerJobFlags.QUEUED
        }
      }
    }
  } finally {
    // 即使中途出错，也清掉尚未执行任务的 QUEUED 位，使它们之后仍可重新入队。
    for (; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        job.flags! &= ~SchedulerJobFlags.QUEUED
      }
    }

    flushIndex = -1
    queue.length = 0

    flushPostFlushCbs(seen)

    currentFlushPromise = null
    // post 回调可能触发新更新；递归清空，保证 `nextTick()` resolve 前系统已稳定。
    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs(seen)
    }
  }
}

/**
 * 检测单轮刷新中未能收敛的自触发任务。
 *
 * 超过阈值时通过应用错误管道报告，常见来源是 render、updated 或 watcher 在读取同一
 * 响应式依赖后立即修改它。返回 `true` 表示调用方应跳过本次执行以终止循环。
 */
function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob) {
  const count = seen.get(fn) || 0
  if (count > RECURSION_LIMIT) {
    const instance = fn.i
    const componentName = instance && getComponentName(instance.type)
    handleError(
      `Maximum recursive updates exceeded${
        componentName ? ` in component <${componentName}>` : ``
      }. ` +
        `This means you have a reactive effect that is mutating its own ` +
        `dependencies and thus recursively triggering itself. Possible sources ` +
        `include component template, render function, updated hook or ` +
        `watcher source function.`,
      null,
      ErrorCodes.APP_ERROR_HANDLER,
    )
    return true
  }
  seen.set(fn, count + 1)
  return false
}
