import { nextTick, watch, watchEffect } from '@vue/runtime-core'
import {
  type ComputedRef,
  EffectScope,
  computed,
  effect,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from '../src'

describe('reactivity/effect/scope', () => {
  /**
   * 创建 effectScope 后用 run 执行 spy；spy 调用一次，验证活动作用域运行传入回调。
   */
  it('should run', () => {
    const fnSpy = vi.fn(() => {})
    effectScope().run(fnSpy)
    expect(fnSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * 无参数创建 effectScope，尚未运行任何 effect；effects 数组长度为 0，验证默认空作用域。
   */
  it('should accept zero argument', () => {
    const scope = effectScope()
    expect(scope.effects.length).toBe(0)
  })

  /**
   * 在 effectScope.run 中返回 1；run 的返回值也为 1，验证回调结果透传。
   */
  it('should return run value', () => {
    expect(effectScope().run(() => 1)).toBe(1)
  })

  /**
   * 新作用域先成功运行并保持 active = true，调用 stop 后 active = false，验证活动状态切换。
   */
  it('should work w/ active property', () => {
    const scope = effectScope()
    scope.run(() => 1)
    expect(scope.active).toBe(true)
    scope.stop()
    expect(scope.active).toBe(false)
  })

  /**
   * scope.run 内创建读取 counter.num = 0 的 effect；修改为 7 后 dummy 为 7，scope.effects 长度为 1，验证当前作用域收集新 effect。
   */
  it('should collect the effects', () => {
    const scope = effectScope()
    scope.run(() => {
      let dummy
      const counter = reactive({ num: 0 })
      effect(() => (dummy = counter.num))

      expect(dummy).toBe(0)
      counter.num = 7
      expect(dummy).toBe(7)
    })

    expect(scope.effects.length).toBe(1)
  })

  /**
   * 同一 scope 收集读取 counter 与其两倍的两个 effect；counter 改为 7 后为 7、14，stop 后再改为 6 仍保留 7、14，验证统一停止。
   */
  it('stop', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
      effect(() => (doubled = counter.num * 2))
    })

    expect(scope.effects.length).toBe(2)

    expect(dummy).toBe(0)
    counter.num = 7
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)

    scope.stop()

    counter.num = 6
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)
  })

  /**
   * 父 scope 内创建普通子 scope，各自订阅 counter；父级收集一个 effect 和一个子 scope，改 counter 后两者更新，父 stop 后再次修改都不更新，验证嵌套作用域递归停止。
   */
  it('should collect nested scope', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
      // 在父作用域运行期间建立子作用域。
      effectScope().run(() => {
        effect(() => (doubled = counter.num * 2))
      })
    })

    expect(scope.effects.length).toBe(1)
    expect(scope.scopes!.length).toBe(1)
    expect(scope.scopes![0]).toBeInstanceOf(EffectScope)

    expect(dummy).toBe(0)
    counter.num = 7
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)

    // 父级停止时连同普通子作用域一起停止。
    scope.stop()

    counter.num = 6
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)
  })

  /**
   * 父 scope 内创建 detached 子 scope，分别订阅 counter；父 stop 后 counter 改为 6，父 dummy 保留 7、分离子 dummy 更新为 12，验证 detached 不归父级停止。
   */
  it('nested scope can be escaped', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
      // 在父作用域运行期间建立子作用域。
      effectScope(true).run(() => {
        effect(() => (doubled = counter.num * 2))
      })
    })

    expect(scope.effects.length).toBe(1)

    expect(dummy).toBe(0)
    counter.num = 7
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)

    scope.stop()

    counter.num = 6
    expect(dummy).toBe(7)

    // detached 子作用域保持活动，继续接收源更新。
    expect(doubled).toBe(12)
  })

  /**
   * 同一活动 scope 先后运行两个回调各注册一个 effect；counter 改为 7 时结果为 7、14，验证 scope 可多次 run 并共同收集。
   */
  it('able to run the scope', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
    })

    expect(scope.effects.length).toBe(1)

    scope.run(() => {
      effect(() => (doubled = counter.num * 2))
    })

    expect(scope.effects.length).toBe(2)

    counter.num = 7
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)

    scope.stop()
  })

  /**
   * scope 注册 effect 后停止，再尝试 run 新回调；发出 inactive scope 警告，effects 为空且后续 counter 改为 7 时旧 dummy 保留 0、新结果未赋值，验证已停止作用域拒绝运行。
   */
  it('can not run an inactive scope', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
    })

    expect(scope.effects.length).toBe(1)

    scope.stop()

    scope.run(() => {
      effect(() => (doubled = counter.num * 2))
    })

    expect('[Vue warn] cannot run an inactive effect scope.').toHaveBeenWarned()

    expect(scope.effects.length).toBe(0)

    counter.num = 7
    expect(dummy).toBe(0)
    expect(doubled).toBe(undefined)
  })

  /**
   * 同一 scope 的两次 run 中注册累加 1、2、4 的 onScopeDispose；停止前计数为 0，stop 后为 7，验证多个作用域清理只在停止时执行。
   */
  it('should fire onScopeDispose hook', () => {
    let dummy = 0

    const scope = effectScope()
    scope.run(() => {
      onScopeDispose(() => (dummy += 1))
      onScopeDispose(() => (dummy += 2))
    })

    scope.run(() => {
      onScopeDispose(() => (dummy += 4))
    })

    expect(dummy).toBe(0)

    scope.stop()
    expect(dummy).toBe(7)
  })

  /**
   * 活动 scope 内注册清理 spy，随后在作用域外调用 onScopeDispose；外部调用发出无活动作用域警告，stop 时内部 spy 一次，验证清理注册边界。
   */
  it('should warn onScopeDispose() is called when there is no active effect scope', () => {
    const spy = vi.fn()
    const scope = effectScope()
    scope.run(() => {
      onScopeDispose(spy)
    })

    expect(spy).toHaveBeenCalledTimes(0)

    onScopeDispose(spy)

    expect(
      '[Vue warn] onScopeDispose() is called when there is no active effect scope to be associated with.',
    ).toHaveBeenWarned()

    scope.stop()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  /**
   * 在父 scope 内创建子 scope，先检查父 scopes 包含它；子 stop 后父 scopes 不再包含，验证子作用域停止时解除父级引用。
   */
  it('should dereference child scope from parent scope after stopping child scope (no memleaks)', () => {
    const parent = effectScope()
    const child = parent.run(() => effectScope())!
    expect(parent.scopes!.includes(child)).toBe(true)
    child.stop()
    expect(parent.scopes!.includes(child)).toBe(false)
  })

  /**
   * scope.run 内创建 r + 1 的 computed，runtime watch 订阅 r，watchEffect 读取 r 和计算值；初始 getter/watch/watchEffect 次数为 1、0、1，源自增后等待 tick 为 2、1、2，stop 后再次更新不变，验证作用域停止两个 watcher 后也不再推动计算求值。
   */
  it('test with higher level APIs', async () => {
    const r = ref(1)

    const computedSpy = vi.fn()
    const watchSpy = vi.fn()
    const watchEffectSpy = vi.fn()

    let c: ComputedRef
    const scope = effectScope()
    scope.run(() => {
      c = computed(() => {
        computedSpy()
        return r.value + 1
      })

      watch(r, watchSpy)
      watchEffect(() => {
        watchEffectSpy()
        r.value
        c.value
      })
    })

    expect(computedSpy).toHaveBeenCalledTimes(1)
    expect(watchSpy).toHaveBeenCalledTimes(0)
    expect(watchEffectSpy).toHaveBeenCalledTimes(1)

    r.value++
    await nextTick()
    expect(computedSpy).toHaveBeenCalledTimes(2)
    expect(watchSpy).toHaveBeenCalledTimes(1)
    expect(watchEffectSpy).toHaveBeenCalledTimes(2)

    scope.stop()

    r.value++
    await nextTick()
    // 停止作用域后，高层 API 不再因源变化执行。
    expect(computedSpy).toHaveBeenCalledTimes(2)
    expect(watchSpy).toHaveBeenCalledTimes(1)
    expect(watchEffectSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 父 scope.run 内再运行 detached 子 scope；子回调结束后 getCurrentScope 仍为父 scope，验证 run 恢复外层当前作用域。
   */
  it('getCurrentScope() stays valid when running a detached nested EffectScope', () => {
    const parentScope = effectScope()

    parentScope.run(() => {
      const currentScope = getCurrentScope()
      expect(currentScope).toBeDefined()
      const detachedScope = effectScope(true)
      detachedScope.run(() => {})

      expect(getCurrentScope()).toBe(currentScope)
    })
  })

  /**
   * 父 scope.run 内对 detached 子 scope 执行 on、off；off 后 getCurrentScope 仍为父 scope，验证手动切换恢复外层。
   */
  it('calling .off() of a detached scope inside an active scope should not break currentScope', () => {
    const parentScope = effectScope()

    parentScope.run(() => {
      const childScope = effectScope(true)
      childScope.on()
      childScope.off()
      expect(getCurrentScope()).toBe(parentScope)
    })
  })

  /**
   * 按 parent、first、second 次序手动 on 三个 detached scope；先 off 中间 first 不改变当前 second，再 off second 回到 parent，最后 off parent 为 undefined，验证乱序退出能修复活动链。
   */
  it('calling .off() out of order should unlink the scope from the active chain', () => {
    const parentScope = effectScope(true)
    const firstScope = effectScope(true)
    const secondScope = effectScope(true)

    parentScope.on()
    firstScope.on()
    secondScope.on()

    firstScope.off()
    expect(getCurrentScope()).toBe(secondScope)

    secondScope.off()
    expect(getCurrentScope()).toBe(parentScope)

    parentScope.off()
    expect(getCurrentScope()).toBeUndefined()
  })

  /**
   * scope 中 effect 首次运行一次，counter 自增后为两次；pause 期间两次更新不运行，resume 后立即为三次，验证作用域暂停合并待处理更新。
   */
  it('should pause/resume EffectScope', async () => {
    const counter = reactive({ num: 0 })
    const fnSpy = vi.fn(() => counter.num)
    const scope = new EffectScope()
    scope.run(() => {
      effect(fnSpy)
    })

    expect(fnSpy).toHaveBeenCalledTimes(1)

    counter.num++
    await nextTick()
    expect(fnSpy).toHaveBeenCalledTimes(2)

    scope.pause()
    counter.num++
    await nextTick()
    expect(fnSpy).toHaveBeenCalledTimes(2)

    counter.num++
    await nextTick()
    expect(fnSpy).toHaveBeenCalledTimes(2)

    scope.resume()
    expect(fnSpy).toHaveBeenCalledTimes(3)
  })

  /**
   * scope 内注册三个 watcher，第二个 watcher 的清理会停止第一个；一次更新后回调三次，scope.stop 再更新不新增回调，清理一次且 effects、cleanups 均为空，验证停止过程中的移除仍清完列表。
   */
  test('removing a watcher while stopping its effectScope', async () => {
    const count = ref(0)
    const scope = effectScope()
    let watcherCalls = 0
    let cleanupCalls = 0

    scope.run(() => {
      const stop1 = watch(count, () => {
        watcherCalls++
      })
      watch(count, (val, old, onCleanup) => {
        watcherCalls++
        onCleanup(() => {
          cleanupCalls++
          stop1()
        })
      })
      watch(count, () => {
        watcherCalls++
      })
    })

    expect(watcherCalls).toBe(0)
    expect(cleanupCalls).toBe(0)

    count.value++
    await nextTick()
    expect(watcherCalls).toBe(3)
    expect(cleanupCalls).toBe(0)

    scope.stop()
    count.value++
    await nextTick()
    expect(watcherCalls).toBe(3)
    expect(cleanupCalls).toBe(1)

    expect(scope.effects.length).toBe(0)
    expect(scope.cleanups.length).toBe(0)
  })

  /**
   * Ref 中保存 stage = 0 与 scope = null，外层 effect 记录 stage；依次创建 scope、增加 stage、清空槽位并 stop、再次创建，renderCount 依次为 2、3、4、5，验证存放在响应式对象中的作用域停止后后续阶段仍触发。
   */
  it('should still trigger updates after stopping scope stored in reactive object', () => {
    const rs = ref({
      stage: 0,
      scope: null as any,
    })

    let renderCount = 0
    effect(() => {
      renderCount++
      return rs.value.stage
    })

    /**
     * 把阶段改为 1，保存新作用域，并在其内部建立 stage watcher。
     */
    const handleBegin = () => {
      const status = rs.value
      status.stage = 1
      status.scope = effectScope()
      status.scope.run(() => {
        watch([() => status.stage], () => {})
      })
    }

    /**
     * 先把阶段归零并清空作用域槽位，再停止保存的旧作用域。
     */
    const handleExit = () => {
      const status = rs.value
      status.stage = 0
      const watchScope = status.scope
      status.scope = null
      if (watchScope) {
        watchScope.stop()
      }
    }

    expect(rs.value.stage).toBe(0)
    expect(renderCount).toBe(1)

    // 第一步：开始阶段并保存新的作用域。
    handleBegin()
    expect(rs.value.stage).toBe(1)
    expect(renderCount).toBe(2)

    // 第二步：增加阶段值，检查订阅仍生效。
    rs.value.stage++
    expect(rs.value.stage).toBe(2)
    expect(renderCount).toBe(3)

    // 第三步：结束阶段并停止旧作用域。
    handleExit()
    expect(rs.value.stage).toBe(0)
    expect(renderCount).toBe(4)

    handleBegin()
    expect(rs.value.stage).toBe(1)
    expect(renderCount).toBe(5)
  })

  /**
   * 父 scope 的第一个子 scope 清理时主动停止第二个子 scope；调用父 stop 不抛错且第二个已 inactive，验证递归停止允许清理提前停止同级作用域。
   */
  it('should stop child scopes when cleanup stops a sibling scope', () => {
    const parent = effectScope()
    let sibling!: EffectScope

    parent.run(() => {
      effectScope().run(() => {
        onScopeDispose(() => sibling.stop())
      })
      sibling = effectScope()
    })

    expect(() => parent.stop()).not.toThrow()
    expect(sibling.active).toBe(false)
  })

  /**
   * scope 的第一个同步 watcher 会停止第二个；暂停 scope 后更新源，resume 不抛错，第一 spy 一次、第二零次且 effects 剩一个，验证恢复遍历中移除同级 watcher。
   */
  it('should resume effects when a watcher stops a sibling watcher', () => {
    const count = ref(0)
    const scope = effectScope()
    /**
     * 初始为空操作，注册第二个 watcher 后替换为其 stop 句柄，供第一 watcher 停止它。
     */
    let stopSecond = () => {}
    const firstSpy = vi.fn(() => stopSecond())
    const secondSpy = vi.fn()

    scope.run(() => {
      watch(count, firstSpy, { flush: 'sync' })
      stopSecond = watch(count, secondSpy, { flush: 'sync' })
    })

    scope.pause()
    count.value++

    expect(() => scope.resume()).not.toThrow()
    expect(firstSpy).toHaveBeenCalledTimes(1)
    expect(secondSpy).not.toHaveBeenCalled()
    expect(scope.effects).toHaveLength(1)
  })
})
