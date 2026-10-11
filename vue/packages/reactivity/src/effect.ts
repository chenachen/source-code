import { extend, hasChanged } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'
import { type Link, globalVersion } from './dep'
import { activeEffectScope } from './effectScope'
import { warn } from './warning'

/** effect 被触发时使用的自定义调度器；可决定立即执行、入队或去重。 */
export type EffectScheduler = (...args: any[]) => any

/** 开发模式调试事件：订阅者信息与本次收集/触发操作的详情。 */
export type DebuggerEvent = {
  /** 收到收集／通知事件的订阅者，可能是普通 effect 或 computed。 */
  effect: Subscriber
} & DebuggerEventExtraInfo

/** `onTrack` / `onTrigger` 调试事件携带的操作上下文。 */
export type DebuggerEventExtraInfo = {
  /** 发生读取或写入的原始响应式目标。 */
  target: object
  /** 本次依赖收集或触发的操作类型。 */
  type: TrackOpTypes | TriggerOpTypes
  /** 被访问的属性键、数组索引或集合键。 */
  key: any
  /** 写操作后的值。 */
  newValue?: any
  /** 写操作前的值；本版集合 clear 事件在此字段携带清空前快照。 */
  oldValue?: any
  /** 清空前集合快照的可选字段；本版 Map/Set.clear() 将快照传给 oldValue，未填充此字段。 */
  oldTarget?: Map<any, any> | Set<any>
}

/** effect/computed 的开发模式调试钩子。 */
export interface DebuggerOptions {
  /** 成功收集一项依赖时调用。 */
  onTrack?: (event: DebuggerEvent) => void
  /** 某项依赖通知当前订阅者时调用。 */
  onTrigger?: (event: DebuggerEvent) => void
}

/** 创建底层 `ReactiveEffect` 时可覆盖的行为。 */
export interface ReactiveEffectOptions extends DebuggerOptions {
  /** 依赖变化时替代默认立即重跑逻辑。 */
  scheduler?: EffectScheduler
  /** 保留的配置字段；本版 effect() 仅拷贝此属性，不将它映射到 ALLOW_RECURSE 状态位。 */
  allowRecurse?: boolean
  /** effect 首次停止时调用。 */
  onStop?: () => void
}

/** `effect()` 的可调用返回值；附带底层实例，便于停止或高级调度。 */
export interface ReactiveEffectRunner<T = any> {
  /** 手动执行原始函数；effect 仍活动时为它重新收集依赖。 */
  (): T
  /** 当前 runner 绑定的底层副作用实例。 */
  effect: ReactiveEffect
}

/**
 * 当前正在执行并收集依赖的订阅者，可能是 `ReactiveEffect` 或计算属性。
 * 嵌套执行时由 `run()` / `refreshComputed()` 保存并恢复。
 */
export let activeSub: Subscriber | undefined

/**
 * 订阅者运行状态位；用位运算组合，避免多个布尔字段的内存开销。
 *
 * 生命周期大致为：effect 创建时 `ACTIVE | TRACKING`；执行期间临时增加 `RUNNING`；
 * 入批时增加 `NOTIFIED`；停止时清除 `ACTIVE`。computed 主要使用 `DIRTY`、
 * `EVALUATED`、`TRACKING`，从而与普通 effect 共用订阅者协议而不共用完整类实现。
 */
export enum EffectFlags {
  /** 副作用尚未停止；仅 `ReactiveEffect` 使用。 */
  ACTIVE = 1 << 0,
  /** 订阅者函数正在执行，用于阻止意外的同步自递归。 */
  RUNNING = 1 << 1,
  /** 当前订阅者应实际挂到依赖的订阅链。 */
  TRACKING = 1 << 2,
  /** 已加入本轮批处理队列，防止同一订阅者重复入队。 */
  NOTIFIED = 1 << 3,
  /** 计算属性的上游可能变化，下次读取需检查或重算。 */
  DIRTY = 1 << 4,
  /** 允许订阅者在执行过程中由自身写操作再次排队。 */
  ALLOW_RECURSE = 1 << 5,
  /** 暂停实际调度；期间收到的通知记录到恢复队列。 */
  PAUSED = 1 << 6,
  /** 计算属性至少成功发布过一次结果。 */
  EVALUATED = 1 << 7,
}

/**
 * 订阅一组 `Dep` 的统一协议，由 `ReactiveEffect` 和 `ComputedRefImpl` 实现。
 *
 * 每个订阅关系由 `Link` 表示；Link 沿 `nextDep/prevDep` 组成订阅者的依赖链。
 * 订阅者开启 TRACKING 时，还沿 `nextSub/prevSub` 加入各个 Dep 的通知链。
 */
export interface Subscriber extends DebuggerOptions {
  /** 当前订阅者依赖双向链表的头节点。 @internal */
  deps?: Link
  /** 同一依赖双向链表的尾节点，用于按访问顺序 O(1) 追加。 @internal */
  depsTail?: Link
  /** 组合后的运行状态位。 @internal */
  flags: EffectFlags
  /** 批处理单向链表中的下一个订阅者。 @internal */
  next?: Subscriber
  /**
   * 接收依赖通知并把自己加入批处理。
   * 返回 `true` 表示当前订阅者是计算属性，调用方还需继续通知其自身 `dep` 的下游。
   *
   * @internal
   */
  notify(): true | void
}

/**
 * 暂停期间至少被触发过一次的 effect 集合。
 * WeakSet 不会阻止已无其他引用的 effect 被垃圾回收；恢复时只需补触发一次。
 */
const pausedQueueEffects = new WeakSet<ReactiveEffect>()

/**
 * 响应式副作用实例：执行用户函数、动态收集其依赖，并在依赖变化时重新调度。
 *
 * effect 每次运行前把旧 Link 标记为未使用，运行中复用本次再次访问的 Link，运行后
 * 删除未访问 Link，从而正确处理 `flag ? state.a : state.b` 一类会切换依赖的分支。
 */
export class ReactiveEffect<T = any>
  implements Subscriber, ReactiveEffectOptions
{
  /** 当前副作用依赖链表头。 @internal */
  deps?: Link = undefined
  /** 当前副作用依赖链表尾。 @internal */
  depsTail?: Link = undefined
  /** 初始状态为活动且允许加入依赖订阅链。 @internal */
  flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
  /** 批处理队列指针。 @internal */
  next?: Subscriber = undefined
  /** 下一次运行前或停止时执行的一次性清理函数。 @internal */
  cleanup?: () => void = undefined

  /** 依赖变化时的自定义调度器。 */
  scheduler?: EffectScheduler = undefined
  /** 停止钩子，只在从活动状态首次停止时调用。 */
  onStop?: () => void
  /** 开发模式依赖收集调试钩子。 */
  onTrack?: (event: DebuggerEvent) => void
  /** 开发模式依赖触发调试钩子。 */
  onTrigger?: (event: DebuggerEvent) => void

  /**
   * 创建副作用并自动登记到当前活动作用域。
   *
   * `<Suspense>` 场景中，组件 `setup()` 可能暂停在顶层 `await`，等待期间组件已卸载，
   * 但编译器生成的 `withAsyncContext().__restore()` 随后仍恢复了已停止作用域。若此时
   * 新 effect 继续激活，它不会被任何可停止的作用域持有，却能永久订阅依赖。这里检测
   * 失活作用域并立即去掉 `ACTIVE`，防止这种孤儿 effect 泄漏和持续触发。
   *
   * @param fn 每次运行的用户函数。
   */
  constructor(public fn: () => T) {
    if (activeEffectScope) {
      if (activeEffectScope.active) {
        activeEffectScope.effects.push(this)
      } else {
        // 已停止作用域中创建的 effect 保持可手动调用，但不得成为会持续订阅的活动 effect。
        this.flags &= ~EffectFlags.ACTIVE
      }
    }
  }

  /** 暂停调度；依赖关系保持不变，期间的触发会被记住。 */
  pause(): void {
    this.flags |= EffectFlags.PAUSED
  }

  /** 恢复调度；若暂停期间触发过，则合并为一次补触发。 */
  resume(): void {
    if (this.flags & EffectFlags.PAUSED) {
      this.flags &= ~EffectFlags.PAUSED
      if (pausedQueueEffects.has(this)) {
        pausedQueueEffects.delete(this)
        this.trigger()
      }
    }
  }

  /**
   * 接收某个依赖的变化通知。
   *
   * 默认禁止运行中的 effect 因自己的写操作再次入队；显式启用 `ALLOW_RECURSE` 的
   * 调度场景除外。`NOTIFIED` 保证同一批内只入队一次。
   *
   * @internal
   */
  notify(): void {
    if (
      this.flags & EffectFlags.RUNNING &&
      !(this.flags & EffectFlags.ALLOW_RECURSE)
    ) {
      return
    }
    if (!(this.flags & EffectFlags.NOTIFIED)) {
      batch(this)
    }
  }

  /**
   * 执行用户函数并重新收集本轮真实依赖。
   *
   * 已停止 effect 的 runner 仍可手动执行，但不会重新激活自身或恢复自己的订阅。
   * 若它在另一活动 effect 内执行，读取仍会收集到外层 effect。活动 effect 先执行
   * 上轮清理、标记旧依赖，再设置全局收集上下文；用户函数退出时在 finally 中恢复，
   * 保证 try 内用户函数抛错后仍恢复依赖上下文。cleanupEffect 位于 try 之前；
   * 清理抛错时不会进入本次用户函数，也不会执行下方 finally 清 RUNNING。
   *
   * @returns 用户函数本次返回值；Promise 不被等待，await 之后不延续此依赖上下文。
   */
  run(): T {
    // TODO：评估 cleanupEffect 与依赖准备阶段是否还能进一步合并。

    if (!(this.flags & EffectFlags.ACTIVE)) {
      // 已停止 effect 直接执行原函数，不切换 activeSub；存在外层收集上下文时读取归入外层。
      return this.fn()
    }

    this.flags |= EffectFlags.RUNNING
    cleanupEffect(this)
    prepareDeps(this)
    const prevEffect = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = this
    shouldTrack = true

    try {
      return this.fn()
    } finally {
      if (__DEV__ && activeSub !== this) {
        warn(
          'Active effect was not restored correctly - ' +
            'this is likely a Vue internal bug.',
        )
      }
      cleanupDeps(this)
      activeSub = prevEffect
      shouldTrack = prevShouldTrack
      this.flags &= ~EffectFlags.RUNNING
    }
  }

  /**
   * 停止自动响应：先移除全部 Dep 订阅，再执行清理与 onStop，最后清 ACTIVE。
   * 正常完成后再次停止无效果；清理／onStop 若抛错会直接传播，后续步骤不执行。
   * 停止后的 runner 仍可手动调用，不恢复自身订阅；在另一活动 effect 内调用时，
   * 函数中的读取仍会被外层 effect 收集。
   */
  stop(): void {
    if (this.flags & EffectFlags.ACTIVE) {
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link)
      }
      this.deps = this.depsTail = undefined
      cleanupEffect(this)
      this.onStop && this.onStop()
      this.flags &= ~EffectFlags.ACTIVE
    }
  }

  /**
   * 真正调度一次 effect：暂停时记入队列，有 scheduler 时交给 scheduler，否则仅在脏时运行。
   */
  trigger(): void {
    if (this.flags & EffectFlags.PAUSED) {
      pausedQueueEffects.add(this)
    } else if (this.scheduler) {
      this.scheduler()
    } else {
      this.runIfDirty()
    }
  }

  /**
   * 检查依赖版本，只在结果确实可能变化时运行。
   *
   * @internal
   */
  runIfDirty(): void {
    if (isDirty(this)) {
      this.run()
    }
  }

  /** 当前任一依赖的版本是否已经过期。 */
  get dirty(): boolean {
    return isDirty(this)
  }
}

/** 调试辅助：展开订阅者依赖链。需要排查链表结构时可临时启用。 */
// function printDeps(sub: Subscriber) {
//   let d = sub.deps
//   let ds = []
//   while (d) {
//     ds.push(d)
//     d = d.nextDep
//   }
//   return ds.map(d => ({
//     id: d.id,
//     prev: d.prevDep?.id,
//     next: d.nextDep?.id,
//   }))
// }

/** 当前嵌套批处理深度；归零时才允许冲刷 effect。 */
let batchDepth = 0
/** 待触发普通 effect 的单向链表头。 */
let batchedSub: Subscriber | undefined
/** 已通知计算属性的单向链表头；用于本批结束时清除 `NOTIFIED`。 */
let batchedComputed: Subscriber | undefined

/**
 * 把订阅者加入当前批处理队列，并用 `NOTIFIED` 标记去重。
 *
 * 队列复用订阅者自身的 `next` 字段，避免每次触发分配额外数组或任务对象。计算属性与
 * 普通 effect 分开：computed 队列只清 NOTIFIED；普通 effect 在批结束时调用 trigger，
 * 有 scheduler 时只交出调度控制权，不能据出队就判断用户函数已经重跑。
 */
export function batch(sub: Subscriber, isComputed = false): void {
  sub.flags |= EffectFlags.NOTIFIED
  if (isComputed) {
    sub.next = batchedComputed
    batchedComputed = sub
    return
  }
  sub.next = batchedSub
  batchedSub = sub
}

/**
 * 开始一层批处理。嵌套调用只增加深度，由最外层 `endBatch()` 负责统一冲刷。
 *
 * @internal
 */
export function startBatch(): void {
  batchDepth++
}

/**
 * 结束一层批处理，并在最外层结束时运行所有待处理 effect。
 *
 * 先清空计算属性的入队标记，再执行普通 effect；执行期间新产生的 effect 会形成新一段
 * 链表，由外层 `while` 继续冲刷。某个 effect 抛错不会阻止其余 effect 执行，最终抛出
 * 捕获到的第一个真值错误。当前实现用 if (!error) 保存、if (error) 抛出；
 * 抛出的 0、false、undefined 等假值不会作为最终错误保留。此函数同步冲刷，不建立微任务。
 *
 * @internal
 */
export function endBatch(): void {
  if (--batchDepth > 0) {
    return
  }

  if (batchedComputed) {
    let e: Subscriber | undefined = batchedComputed
    batchedComputed = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      e = next
    }
  }

  let error: unknown
  while (batchedSub) {
    let e: Subscriber | undefined = batchedSub
    batchedSub = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      if (e.flags & EffectFlags.ACTIVE) {
        try {
          // ACTIVE 仅 ReactiveEffect 拥有，因此此处分支可安全收窄类型。
          ;(e as ReactiveEffect).trigger()
        } catch (err) {
          if (!error) error = err
        }
      }
      e = next
    }
  }

  if (error) throw error
}

/**
 * 在订阅者重新运行前准备依赖链。
 *
 * 所有旧 Link 版本先置为 -1，表示“本轮尚未读取”；同时把 Link 安装为对应 Dep 的
 * `activeLink`，运行中再次读取便可 O(1) 找回并复用。嵌套收集时保存上一 activeLink。
 */
function prepareDeps(sub: Subscriber) {
  for (let link = sub.deps; link; link = link.nextDep) {
    // -1 是本轮未使用标记；Dep.track() 再次命中时会同步成当前 dep.version。
    link.version = -1
    // 保存嵌套执行前的 activeLink，清理时恢复。
    link.prevActiveLink = link.dep.activeLink
    link.dep.activeLink = link
  }
}

/**
 * 在订阅者运行后清除本轮未使用的依赖，并恢复各 Dep 的嵌套收集上下文。
 *
 * 从尾向头遍历，既方便删除节点后确定新头尾，也保留本轮访问顺序。Link 版本仍为 -1
 * 说明分支已不再读取该依赖，需要同时从 Dep 的订阅链和订阅者的依赖链移除。
 */
function cleanupDeps(sub: Subscriber) {
  let head
  let tail = sub.depsTail
  let link = tail
  while (link) {
    const prev = link.prevDep
    if (link.version === -1) {
      if (link === tail) tail = prev
      // 本轮未使用：从依赖源的订阅者链移除。
      removeSub(link)
      // 同时从当前订阅者的依赖链移除。
      removeDep(link)
    } else {
      // 逆序扫描中最后遇到的保留节点就是新链表头。
      head = link
    }

    // 恢复进入本轮收集前的 activeLink，支持 computed/effect 嵌套求值。
    link.dep.activeLink = link.prevActiveLink
    link.prevActiveLink = undefined
    link = prev
  }
  // 写回经过删减后的链表边界。
  sub.deps = head
  sub.depsTail = tail
}

/**
 * 比较订阅者记录的 Link 版本与每个 Dep 当前版本，判断是否需要重新运行。
 *
 * 按读取顺序逐条比较：版本已不等时立即返回 true，不先刷新 computed。版本相等且
 * 依赖来自 computed 时才刷新后再比较：上游可能触发过而派生值仍相等，此时下游可跳过。
 * 本函数不把正在比较的 Link 同步为新版本；同步由实际读取的 Dep.track/value getter 完成。
 * 全部依赖相等后再检查 `_dirty` 兼容通道；嵌套刷新抛错会直接传播。
 */
function isDirty(sub: Subscriber): boolean {
  for (let link = sub.deps; link; link = link.nextDep) {
    if (
      link.dep.version !== link.version ||
      (link.dep.computed &&
        (refreshComputed(link.dep.computed) ||
          link.dep.version !== link.version))
    ) {
      return true
    }
  }
  // @ts-expect-error：兼容旧库手动设置 `_dirty`，例如 Pinia testing 模块。
  if (sub._dirty) {
    return true
  }
  return false
}

/**
 * 按需刷新计算属性的缓存。
 *
 * 快速路径从便宜到昂贵依次为：仍在追踪且未标脏、全局版本没有任何变化、逐依赖版本
 * 检查后确认当前依赖版本仍匹配；只有这些判断都失败才真正执行 getter。
 *
 * 上游通知只设置 DIRTY，不先发布结果版本；此处 getter 结果变化或首次发布才递增
 * computed.dep.version，让下游区分“可能变化”和“结果已变”。第三条快路之前已保存
 * globalVersion、清 DIRTY；isDirty 中嵌套刷新若抛错，本层尚未进入 try/finally。
 * SSR 跳过逐依赖／无依赖快路，但仍保留全局版本快路；try 中异常递增版本而不回滚缓存。
 *
 * @returns 当前实现只返回 `undefined`；调用方通过计算属性 `dep.version` 判断值是否变化。
 * @internal
 */
export function refreshComputed(computed: ComputedRefImpl): undefined {
  if (
    computed.flags & EffectFlags.TRACKING &&
    !(computed.flags & EffectFlags.DIRTY)
  ) {
    return
  }
  computed.flags &= ~EffectFlags.DIRTY

  // 全局触发版本未变时复用缓存，无需扫描依赖链；它不等于整个系统没有发生过赋值。
  if (computed.globalVersion === globalVersion) {
    return
  }
  computed.globalVersion = globalVersion

  // SSR 求值仍收集并保留依赖 Link，但 !computed.isSSR 会跳过下面的依赖版本快路径。
  // 全局版本相同仍复用缓存；全局版本变化后，即使自身依赖版本没变，也会重新求值。
  // issue #12337 场景：`computed(() => constant)` 不读取任何响应式数据。它求值一次后
  // 非 SSR 下，已发布结果、无 deps 且未设置兼容 _dirty 的 computed 会直接复用缓存，
  // 不因别处触发使 globalVersion 增长而再次执行 getter。
  if (
    !computed.isSSR &&
    computed.flags & EffectFlags.EVALUATED &&
    ((!computed.deps && !(computed as any)._dirty) || !isDirty(computed))
  ) {
    return
  }
  computed.flags |= EffectFlags.RUNNING

  const dep = computed.dep
  const prevSub = activeSub
  const prevShouldTrack = shouldTrack
  activeSub = computed
  shouldTrack = true

  try {
    prepareDeps(computed)
    const value = computed.fn(computed._value)
    // 只有首次求值或结果按 Object.is 语义真正变化，才递增自身 dep.version，
    // 从而让依赖 computed.value 的下游 effect 精确跳过“上游变、派生值未变”的更新。
    if (dep.version === 0 || hasChanged(value, computed._value)) {
      computed.flags |= EffectFlags.EVALUATED
      computed._value = value
      dep.version++
    }
  } catch (err) {
    // getter 抛错时递增版本并继续抛出，保留现有 _value；不会回退 globalVersion 或补设 DIRTY。
    // 后续读取仍由前面的快速路径判断是否重算，不能据此保证立即重试。
    dep.version++
    throw err
  } finally {
    activeSub = prevSub
    shouldTrack = prevShouldTrack
    cleanupDeps(computed)
    computed.flags &= ~EffectFlags.RUNNING
  }
}

/**
 * 从一个 Dep 的订阅者链中摘除 Link。
 *
 * 计算属性失去最后一个下游订阅者后，会“软退订”全部上游 Dep，使整条计算链可被 GC；
 * 但计算属性仍保留 Link 以支持未来再次读取时恢复订阅，所以软退订不减少 `sc`。
 *
 * @param link 要移除的订阅关系。
 * @param soft 是否只从 Dep 链摘除、保留订阅计数和计算属性自己的 Link。
 */
function removeSub(link: Link, soft = false) {
  const { dep, prevSub, nextSub } = link
  if (prevSub) {
    prevSub.nextSub = nextSub
    link.prevSub = undefined
  }
  if (nextSub) {
    nextSub.prevSub = prevSub
    link.nextSub = undefined
  }
  if (__DEV__ && dep.subsHead === link) {
    // 删除开发模式正向链表头，更新为下一节点。
    dep.subsHead = nextSub
  }

  if (dep.subs === link) {
    // 删除订阅链尾，更新为上一节点。
    dep.subs = prevSub

    if (!prevSub && dep.computed) {
      // 计算属性已无任何下游：从上游依赖退订，使计算属性及缓存值可以被垃圾回收。
      dep.computed.flags &= ~EffectFlags.TRACKING
      for (let l = dep.computed.deps; l; l = l.nextDep) {
        // 这里只软退订：computed 仍持有这些 Link，将来出现新下游时可低成本恢复。
        removeSub(l, true)
      }
    }
  }

  if (!soft && !--dep.sc && dep.map) {
    // issue #11979：targetMap 的外层 WeakMap 不会阻止 target 回收，但只要 target 本身
    // 长期存活，其 KeyToDepMap 就会一直保留所有曾被短暂追踪的属性。动态 key、大表格
    // 或虚拟列表会让 Map 持续增长。非软移除使 sc 降为 0 时按 key 删除该 Dep。
    dep.map.delete(dep.key)
  }
}

/** 从订阅者自己的依赖双向链表中摘除 Link。 */
function removeDep(link: Link) {
  const { prevDep, nextDep } = link
  if (prevDep) {
    prevDep.nextDep = nextDep
    link.prevDep = undefined
  }
  if (nextDep) {
    nextDep.prevDep = prevDep
    link.nextDep = undefined
  }
}

/**
 * 创建并立即运行一个响应式副作用，返回可手动再次执行的 runner。
 *
 * 若传入已有 runner，会提取其原始函数创建独立 effect，避免把 runner 自身再包一层。
 * 首次执行若抛错，会先停止并清理已经收集的部分依赖再继续抛出，防止失败 effect 留在
 * 依赖图中。后续依赖变化默认同步运行，也可通过 `scheduler` 自定义调度。
 *
 * @param fn 需要自动追踪响应式读取的函数。
 * @param options 调度器、停止钩子与开发调试配置。
 * @returns 绑定底层 `ReactiveEffect` 的可调用 runner。
 */
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const e = new ReactiveEffect(fn)
  if (options) {
    extend(e, options)
  }
  try {
    e.run()
  } catch (err) {
    e.stop()
    throw err
  }
  const runner = e.run.bind(e) as ReactiveEffectRunner
  runner.effect = e
  return runner
}

/**
 * 停止 runner 对应的 effect，使其不再自动响应依赖变化。
 *
 * @param runner `effect()` 返回的执行函数。
 */
export function stop(runner: ReactiveEffectRunner): void {
  runner.effect.stop()
}

/**
 * 全局依赖收集开关。数组写方法等内部操作会暂时关闭它，避免把实现细节读操作记为依赖。
 *
 * @internal
 */
export let shouldTrack = true
/** 收集开关栈；支持 pause/enable 的嵌套调用并精确恢复此前状态。 */
const trackStack: boolean[] = []

/**
 * 暂停依赖收集，并把此前状态压栈。
 */
export function pauseTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * 强制启用依赖收集，并把此前状态压栈。
 *
 * 与直接赋值不同，配合 `resetTracking()` 可安全嵌套在已暂停的内部流程中。
 */
export function enableTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

/**
 * 弹出并恢复上一层依赖收集状态；栈为空时恢复默认 `true`。
 */
export function resetTracking(): void {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 为当前活动 effect 注册一次性清理函数。清理会在下次运行前或 effect 停止时调用。
 *
 * 每次调用会替换当前尚未执行的清理函数；需要多个清理动作时应在同一函数中组合。
 * 没有活动 effect 时开发模式会警告，可用第二个参数静默忽略。
 *
 * @param fn 要登记的清理函数。
 * @param failSilently 为 `true` 时，没有活动 effect 也不发出警告。
 */
export function onEffectCleanup(fn: () => void, failSilently = false): void {
  if (activeSub instanceof ReactiveEffect) {
    activeSub.cleanup = fn
  } else if (__DEV__ && !failSilently) {
    warn(
      `onEffectCleanup() was called when there was no active effect` +
        ` to associate with.`,
    )
  }
}

/**
 * 执行并清空 effect 当前清理函数。
 *
 * 执行清理时临时取消 `activeSub`，保证清理函数读取响应式数据不会被错误收集为新依赖；
 * 先清空字段还可防止清理函数抛错或递归停止时被重复调用。
 */
function cleanupEffect(e: ReactiveEffect) {
  const { cleanup } = e
  e.cleanup = undefined
  if (cleanup) {
    // 清理属于上一轮资源释放，不属于下一轮 effect 依赖计算。
    const prevSub = activeSub
    activeSub = undefined
    try {
      cleanup()
    } finally {
      activeSub = prevSub
    }
  }
}
