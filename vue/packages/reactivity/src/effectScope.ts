import type { ReactiveEffect } from './effect'
import { warn } from './warning'

/**
 * 当前正在收集副作用的作用域。
 *
 * 创建 `ReactiveEffect` 时会读取它并把自身登记到作用域中；`run()`、`on()` 和
 * `off()` 负责像栈一样切换该指针。
 */
export let activeEffectScope: EffectScope | undefined

/**
 * 一组可统一暂停、恢复和销毁的响应式副作用。
 *
 * 组件 `setup()`、组合式函数等可把内部创建的 effect/watch 收进同一作用域，
 * 组件卸载或业务实例销毁时只需停止作用域，就能避免逐个保存停止句柄。
 */
export class EffectScope {
  /** 作用域是否仍可运行并接收新副作用。 @internal */
  private _active = true
  /**
   * `on()` 的嵌套调用计数。只有第一次 `on()` 和最后一次 `off()` 真正切换作用域，
   * 因而同一作用域可被嵌套启用。 @internal
   */
  private _on = 0
  /** 当前作用域直接拥有的响应式副作用。 @internal */
  effects: ReactiveEffect[] = []
  /** 停止作用域时依次执行的用户清理回调。 @internal */
  cleanups: (() => void)[] = []

  /** 是否暂停了当前作用域；暂停状态会递归传给子作用域和 effect。 */
  private _isPaused = false
  /** 父作用域已经停止时，禁止子作用域运行但不重复产生警告。 */
  private _warnOnRun = true

  /**
   * 非独立作用域所属的父作用域；独立作用域不参与父子的级联停止。 @internal
   */
  parent: EffectScope | undefined
  /** 直接嵌套的非独立子作用域。 @internal */
  scopes: EffectScope[] | undefined
  /**
   * 当前作用域在 `parent.scopes` 中的位置，用于停止时 O(1) 删除。 @internal
   */
  private index: number | undefined

  /** 阻止作用域实例本身被 `reactive()` 再次代理。 */
  readonly __v_skip = true
  // TODO：启用 isolatedDeclarations 后改用 ReactiveFlags.SKIP。

  /**
   * @param detached 是否创建独立作用域。为 `false` 时会自动挂到当前活动作用域下。
   */
  constructor(public detached = false) {
    if (!detached && activeEffectScope) {
      if (activeEffectScope.active) {
        this.parent = activeEffectScope
        this.index =
          (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
            this,
          ) - 1
      } else {
        // 父作用域已停止：子作用域也必须立即失活，不能意外变成无人管理的活跃作用域。
        this._active = false
        this._warnOnRun = false
      }
    }
  }

  /** 作用域是否仍处于活动状态。 */
  get active(): boolean {
    return this._active
  }

  /**
   * 暂停当前作用域、所有子作用域及直接拥有的 effect。
   *
   * 暂停期间触发的 effect 不会丢失，而是进入待恢复队列；调用 `resume()` 后执行。
   * 遍历前复制子作用域数组，避免暂停钩子间接修改原数组导致漏处理。
   */
  pause(): void {
    if (this._active) {
      this._isPaused = true
      let i, l
      if (this.scopes) {
        const scopes = this.scopes.slice()
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].pause()
        }
      }
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].pause()
      }
    }
  }

  /**
   * 恢复当前作用域，以及全部子作用域和 effect。
   *
   * 同样使用数组快照，保证恢复过程中即使集合被修改，本轮已有成员仍能被处理。
   */
  resume(): void {
    if (this._active) {
      if (this._isPaused) {
        this._isPaused = false
        let i, l
        if (this.scopes) {
          const scopes = this.scopes.slice()
          for (i = 0, l = scopes.length; i < l; i++) {
            scopes[i].resume()
          }
        }
        const effects = this.effects.slice()
        for (i = 0, l = effects.length; i < l; i++) {
          effects[i].resume()
        }
      }
    }
  }

  /**
   * 在当前作用域上下文中执行函数，使函数内新建的 effect 自动归属本作用域。
   *
   * `finally` 保证用户函数抛错时也会恢复外层作用域。已停止的作用域不再执行函数。
   *
   * @param fn 要在作用域中执行的函数。
   * @returns 函数返回值；作用域失活时返回 `undefined`。
   */
  run<T>(fn: () => T): T | undefined {
    if (this._active) {
      const currentEffectScope = activeEffectScope
      try {
        activeEffectScope = this
        return fn()
      } finally {
        activeEffectScope = currentEffectScope
      }
    } else if (__DEV__ && this._warnOnRun) {
      warn(`cannot run an inactive effect scope.`)
    }
  }

  /** `on()` 前的活动作用域，用于退出时恢复；链表结构也支持异步交错修正。 */
  prevScope: EffectScope | undefined
  /**
   * 手动把当前实例设为活动作用域。仅供非独立作用域使用。
   *
   * 嵌套调用通过 `_on` 计数；只有从 0 变为 1 时才保存并替换全局作用域。
   *
   * @internal
   */
  on(): void {
    if (++this._on === 1) {
      this.prevScope = activeEffectScope
      activeEffectScope = this
    }
  }

  /**
   * 结束一次手动启用并在最外层 `off()` 时恢复此前作用域。仅供非独立作用域使用。
   *
   * @internal
   */
  off(): void {
    if (this._on > 0 && --this._on === 0) {
      // 常规后进先出场景：当前实例仍是链顶，直接恢复即可。
      if (activeEffectScope === this) {
        activeEffectScope = this.prevScope
      } else {
        // `withAsyncContext()` 会为当前异步分支恢复组件作用域，并把清理推迟到微任务。
        // 两个同级分支可能按“A 恢复 → B 恢复 → A 清理”交错；A 调用 off() 时，
        // activeEffectScope 已是 B。此时需从链中间摘掉 A，否则全局链会长期引用过期作用域。
        let current = activeEffectScope
        while (current) {
          if (current.prevScope === this) {
            current.prevScope = this.prevScope
            break
          }
          current = current.prevScope
        }
      }
      this.prevScope = undefined
    }
  }

  /**
   * 停止本作用域拥有的全部 effect，执行清理函数，并递归停止子作用域。
   *
   * 非独立作用域还会从父作用域数组中移除。删除采用“末项填洞”，避免普通
   * `splice()` 的 O(n) 移动；被换入的末项同步更新 `index`。
   *
   * @param fromParent 是否由父作用域递归停止；为 `true` 时父数组正统一清空，
   * 无需让每个子作用域再单独删除自己。
   */
  stop(fromParent?: boolean): void {
    if (this._active) {
      this._active = false
      let i, l
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      this.effects.length = 0

      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]()
      }
      this.cleanups.length = 0

      if (this.scopes) {
        const scopes = this.scopes.slice()
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].stop(true)
        }
        this.scopes.length = 0
      }

      // 解除父子引用，防止已停止的嵌套作用域仍被父级持有而无法回收。
      if (!this.detached && this.parent && !fromParent) {
        // 用父数组末项填补当前位置，实现 O(1) 删除。
        const last = this.parent.scopes!.pop()
        if (last && last !== this) {
          this.parent.scopes![this.index!] = last
          last.index = this.index!
        }
      }
      this.parent = undefined
    }
  }
}

/**
 * 创建可捕获内部响应式副作用（如 computed、watch）的作用域，以便统一销毁。
 * 详细场景参见对应的
 * {@link https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md | RFC}。
 *
 * @param detached 是否与当前活动作用域脱离。独立作用域不会随父作用域停止，
 * 使用者必须自行保存并调用 `stop()`。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#effectscope}
 */
export function effectScope(detached?: boolean): EffectScope {
  return new EffectScope(detached)
}

/**
 * 返回当前活动的副作用作用域；没有时返回 `undefined`。
 *
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#getcurrentscope}
 */
export function getCurrentScope(): EffectScope | undefined {
  return activeEffectScope
}

/**
 * 向当前活动作用域登记销毁回调，作用域停止时执行。
 *
 * @param fn 清理函数。
 * @param failSilently 没有活动作用域时是否静默忽略；默认在开发模式发出警告。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#onscopedispose}
 */
export function onScopeDispose(fn: () => void, failSilently = false): void {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__ && !failSilently) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`,
    )
  }
}
