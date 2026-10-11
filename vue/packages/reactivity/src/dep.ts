import { extend, isArray, isIntegerKey, isMap, isSymbol } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import { type TrackOpTypes, TriggerOpTypes } from './constants'
import {
  type DebuggerEventExtraInfo,
  EffectFlags,
  type Subscriber,
  activeSub,
  endBatch,
  shouldTrack,
  startBatch,
} from './effect'

/**
 * 计算属性快速路径使用的全局触发版本。
 *
 * 每次 Dep.trigger() 都递增；target 尚无 depsMap 时，导出的 trigger() 也递增。
 * 它不是业务赋值次数：写入未命中任何 Dep 时可能不增，一次写入命中多个 Dep 时
 * 也可能增加多次。计算属性保存上次检查到的版本；两者相等时可直接复用缓存，
 * 无需逐项扫描自身依赖。
 */
export let globalVersion = 0

/**
 * 表示一个依赖源 `Dep` 与一个订阅者（effect 或 computed）之间的订阅关系。
 *
 * Dep 与订阅者是多对多关系，每一对关系对应一个 Link。Link 用两组指针服务两条链：
 *
 * - `nextDep/prevDep`：让订阅者列出自己读取过的全部 Dep；
 * - `nextSub/prevSub`：让 Dep 列出所有依赖自己的订阅者。
 *
 * 新 Link 会加入订阅者的依赖链；只有订阅者开启 TRACKING，才同时挂入 Dep 的
 * 通知链。无下游的 computed 仍保留自己的 Link 与版本记录，但暂不订阅上游通知。
 *
 * 与“每个 Dep 一个 Set”相比，Link 可同时保存版本和两侧指针，动态清理分支依赖时
 * 无需分配临时 Set，也能 O(1) 摘除已知节点；整轮清理仍需扫描依赖链。
 *
 * @internal
 */
export class Link {
  /**
   * 当前关系上次确认的 Dep 版本：
   *
   * - 每次订阅者运行前，全部旧 Link 版本重置为 -1；
   * - 运行期间再次读取该 Dep 时，同步为 Dep 当前版本；
   * - 运行后仍为 -1 的 Link 代表本轮分支未使用，需要清理。
   */
  version: number

  /** 同一订阅者的下一个依赖。 */
  nextDep?: Link
  /** 同一订阅者的上一个依赖。 */
  prevDep?: Link
  /** 同一 Dep 的下一个订阅者。 */
  nextSub?: Link
  /** 同一 Dep 的上一个订阅者。 */
  prevSub?: Link
  /** 嵌套依赖收集前该 Dep 的 activeLink，用于退出时恢复。 */
  prevActiveLink?: Link

  /**
   * 初始化一条订阅关系及版本快照；此处只建立对象身份，两侧链表由调用方接入。
   *
   * @param sub 订阅当前依赖的 effect 或 computed。
   * @param dep 被订阅的依赖源。
   */
  constructor(
    public sub: Subscriber,
    public dep: Dep,
  ) {
    this.version = dep.version
    this.nextDep =
      this.prevDep =
      this.nextSub =
      this.prevSub =
      this.prevActiveLink =
        undefined
  }
}

/**
 * 一个可独立追踪和触发的依赖源，通常对应“某原始对象的某个 key”或一个 Ref。
 *
 * `version` 负责脏检查，订阅者链负责通知；计算属性自身的 Dep 还通过 `computed`
 * 反向引用计算实例，以便首个订阅者出现时懒订阅其上游、最后一个离开时懒退订。
 *
 * @internal
 */
export class Dep {
  /** 依赖版本：普通 Dep 触发时递增；computed 首次发布、结果变化或 getter 抛错时递增。 */
  version = 0
  /** 当前 Dep 与正在收集的订阅者之间的 Link，用于本轮 O(1) 查找/复用。 */
  activeLink?: Link = undefined

  /** 订阅者双向链表尾；生产模式通知时从尾向前遍历。 */
  subs?: Link = undefined

  /**
   * 订阅者双向链表头。只在开发模式保存，用于按原订阅顺序调用 `onTrigger`。
   */
  subsHead?: Link

  /** 所属对象的 key → Dep 表；非软移除使 sc 降为 0 时用于删除自身。 */
  map?: KeyToDepMap = undefined
  /** 当前 Dep 在 `map` 中对应的属性键。 */
  key?: unknown = undefined

  /**
   * Dep 删除判断使用的登记计数：addSub() 递增，非软 removeSub() 递减。
   * 软退订不减；保留 Link 再次接入时又会递增，因此它不严格等于 Link 数或通知链长度。
   */
  sc: number = 0

  /** 阻止 Dep 实例本身被 `reactive()` 代理。 @internal */
  readonly __v_skip = true
  // TODO：启用 isolatedDeclarations 后改用 ReactiveFlags.SKIP。

  /** 创建尚无订阅者的依赖源；computed 引用连接懒订阅与反向版本检查。
   * @param computed 若本 Dep 表示 computed.value，指向所属计算属性；普通 key/Ref 不传。
   */
  constructor(public computed?: ComputedRefImpl | undefined) {
    if (__DEV__) {
      this.subsHead = undefined
    }
  }

  /**
   * 让当前活动订阅者订阅本 Dep，并返回对应 Link。
   *
   * 没有活动订阅者、全局暂停追踪或计算属性读取自身时直接跳过。新关系加入订阅者
   * 依赖链，并在订阅者开启 TRACKING 时接入 Dep 通知链。旧关系在新一轮再次命中时
   * 同步版本并按实际访问顺序移到依赖链尾，便于后续清理动态分支。
   *
   * 同一轮重复读取复用已有 Link，不重复 addSub 或改变版本；只有 -1 的旧 Link
   * 才表示尚未在本轮读取。嵌套订阅者借 prepareDeps/cleanupDeps 保存和恢复 activeLink。
   *
   * @param debugInfo 开发模式调试事件上下文。
   * @returns 当前关系的 Link；无活动订阅者、暂停追踪或 computed 自读时为 undefined。
   */
  track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return
    }

    let link = this.activeLink
    if (link === undefined || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this)

      // 新 Link 按读取顺序追加到当前订阅者依赖链尾。
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
      }

      addSub(link)
    } else if (link.version === -1) {
      // 复用上轮 Link，确认本轮仍读取该依赖；是否接入 Dep 通知链由 TRACKING 控制。
      link.version = this.version

      // 非尾节点说明本轮访问顺序改变，将其移到尾部，使依赖链始终反映本轮读取顺序。
      if (link.nextDep) {
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
          link.prevDep.nextDep = next
        }

        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        // 若移动的是原链表头，下一节点成为新头。
        if (activeSub.deps === link) {
          activeSub.deps = next
        }
      }
    }

    if (__DEV__ && activeSub.onTrack) {
      activeSub.onTrack(
        extend(
          {
            effect: activeSub,
          },
          debugInfo,
        ),
      )
    }

    return link
  }

  /**
   * 标记当前依赖发生变化：递增局部/全局版本并通知订阅者。
   *
   * @param debugInfo 开发模式下传给 `onTrigger` 的写操作上下文。
   */
  trigger(debugInfo?: DebuggerEventExtraInfo): void {
    this.version++
    globalVersion++
    this.notify(debugInfo)
  }

  /**
   * 在批处理中通知当前 Dep 的所有订阅者，但不递增版本。
   *
   * 计算属性脏传播使用 `notify()`：其自身 Dep 的值尚未重新计算，不能提前递增版本，
   * 只需继续把“可能变化”传给下游。用 `finally` 配对批处理，调试钩子或通知抛错时
   * 也会结束本层 batch。外层 trigger() 自己的 batch 不在此 finally 管理范围内。
   * onTrigger 在正式通知前同步调用，NOTIFIED 用来避免本批重复的调试通知。
   */
  notify(debugInfo?: DebuggerEventExtraInfo): void {
    startBatch()
    try {
      if (__DEV__) {
        // 生产通知从链尾逆序入栈，批结束后又按栈顺序执行，最终仍是原订阅顺序。
        // onTrigger 在此处立即调用，故开发模式额外从链头正序遍历才能保持相同顺序。
        for (let head = this.subsHead; head; head = head.nextSub) {
          if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
            head.sub.onTrigger(
              extend(
                {
                  effect: head.sub,
                },
                debugInfo,
              ),
            )
          }
        }
      }
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.notify()) {
          // 返回 true 表示订阅者是 computed；继续通知依赖 computed.value 的下游。
          // 在当前循环中传播而非 Computed.notify() 内递归，可压低长计算链的调用栈深度。
          ;(link.sub as ComputedRefImpl).dep.notify()
        }
      }
    } finally {
      endBatch()
    }
  }
}

/**
 * 递增 Dep 登记计数；订阅者开启 TRACKING 时，把 Link 接入 Dep 通知链。
 *
 * 计算属性采用懒订阅：首次迎来开启 TRACKING 的下游订阅者时才接入全部上游 Dep；
 * 没有活动下游时，只保留 Link 元数据而不参与触发链，从而让无用计算链可被回收。
 */
function addSub(link: Link) {
  link.dep.sc++
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed
    // 计算属性迎来首个开启 TRACKING 的下游：启用追踪、标脏，并恢复全部上游订阅。
    if (computed && !link.dep.subs) {
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l)
      }
    }

    const currentTail = link.dep.subs
    if (currentTail !== link) {
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link
    }

    if (__DEV__ && link.dep.subsHead === undefined) {
      link.dep.subsHead = link
    }

    link.dep.subs = link
  }
}

/** 单个响应式目标的“属性键 → Dep”映射。 */
type KeyToDepMap = Map<any, Dep>

/**
 * 响应式系统主依赖表，结构为 `原始 target → key → Dep → Subscriber`。
 *
 * 外层使用 WeakMap，不阻止原始目标回收。概念上可把 Dep 想成订阅者 Set，但实际使用
 * Link 双向链表，以承载版本、双向关系并降低动态清理时的额外内存分配。
 */
export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

/** 对象键集合、Set 值集合及 Map 键值对遍历使用的虚拟依赖键。 */
export const ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Object iterate' : '',
)
/** 仅遍历 Map 键时使用；修改已有键的值不应触发该依赖。 */
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Map keys iterate' : '',
)
/** 数组批量读取/值迭代使用；任意数字索引变化都会触发。 */
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Array iterate' : '',
)

/**
 * 收集一次响应式属性访问。
 *
 * 在主依赖表中按 target、key 找到或创建 Dep，再让当前活动 effect/computed 订阅它。
 * 只有 `shouldTrack` 开启且存在 `activeSub` 时才工作，普通业务读取不会创建无用 Dep。
 *
 * @param target 持有响应式属性的原始对象。
 * @param type 读取、存在性检查或遍历等访问类型。
 * @param key 要追踪的属性键；遍历使用上面的特殊 Symbol。
 */
export function track(target: object, type: TrackOpTypes, key: unknown): void {
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Dep()))
      dep.map = depsMap
      dep.key = key
    }
    if (__DEV__) {
      dep.track({
        target,
        type,
        key,
      })
    } else {
      dep.track()
    }
  }
}

/**
 * 根据写操作找出所有受影响的 Dep，并批量通知其中的订阅者。
 *
 * 除直接修改的 key 外，还需按数据结构和操作类型触发遍历/长度依赖。例如数组新增索引
 * 影响 length，Map 修改已有值影响值迭代但不影响仅键迭代，集合清空则影响全部 Dep。
 *
 * @param target 被修改的原始响应式对象。
 * @param type SET、ADD、DELETE 或 CLEAR。
 * @param key 被修改的属性键或集合键。
 * @param newValue 新值；数组 length 分支也用它计算被截断索引。
 * @param oldValue 旧值，供开发模式 onTrigger 使用；本版集合 clear 的快照也由此参数传入。
 * @param oldTarget 可选的清空前集合快照；本版集合 clear 调用未传入此参数。
 *
 * 这里只通知已存在的 Dep，不为从未读取的 key 新建依赖。一个订阅者可能同时命中
 * key、length、迭代 Dep，NOTIFIED 在最外层 endBatch 前去重。原生写入已经完成，
 * effect 因而读取最终状态；此层没有 try/finally，调试／通知异常不保证结束其 batch。
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>,
): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // 目标从未被追踪，无订阅者可通知；仍递增全局版本以保证 computed 快速路径正确。
    globalVersion++
    return
  }

  /** 通知单个候选 Dep；开发模式补充本次写操作的完整调试上下文。 */
  const run = (dep: Dep | undefined) => {
    if (dep) {
      if (__DEV__) {
        dep.trigger({
          target,
          type,
          key,
          newValue,
          oldValue,
          oldTarget,
        })
      } else {
        dep.trigger()
      }
    }
  }

  startBatch()

  if (type === TriggerOpTypes.CLEAR) {
    // clear 会使集合所有键、值、size 和迭代结果失效，因此触发该目标的全部 Dep。
    depsMap.forEach(run)
  } else {
    const targetIsArray = isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    if (targetIsArray && key === 'length') {
      const newLength = Number(newValue)
      // 缩短 length 会删除所有索引 >= newLength 的元素；这些索引依赖与数组迭代依赖
      // 都必须触发。增大 length 虽不新增元素，也会影响 length/迭代观察结果。
      depsMap.forEach((dep, key) => {
        if (
          key === 'length' ||
          key === ARRAY_ITERATE_KEY ||
          (!isSymbol(key) && key >= newLength)
        ) {
          run(dep)
        }
      })
    } else {
      // SET / ADD / DELETE 首先通知被直接操作的 key。
      if (key !== void 0 || depsMap.has(void 0)) {
        run(depsMap.get(key))
      }

      // 任意数字索引变化都会改变批量读取或值迭代结果；length 已在上一分支处理。
      if (isArrayIndex) {
        run(depsMap.get(ARRAY_ITERATE_KEY))
      }

      // 再按操作类型补充通知结构性依赖。
      switch (type) {
        case TriggerOpTypes.ADD:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          } else if (isArrayIndex) {
            // 新增超出原范围的数组索引会改变 length。
            run(depsMap.get('length'))
          }
          break
        case TriggerOpTypes.DELETE:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          }
          break
        case TriggerOpTypes.SET:
          if (isMap(target)) {
            // Map 已有键换值不影响 keys()，但会影响 values()/entries()/forEach()。
            run(depsMap.get(ITERATE_KEY))
          }
          break
      }
    }
  }

  endBatch()
}

/**
 * 获取某原始对象属性已存在的 Dep，供运行时核心调试和内部优化使用。
 * 不会创建新 Dep，也不会收集依赖。
 */
export function getDepFromReactive(
  object: any,
  key: string | number | symbol,
): Dep | undefined {
  const depMap = targetMap.get(object)
  return depMap && depMap.get(key)
}
