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
  // 场景：在新建作用域中执行函数；验证 run 会立即调用传入函数。
  it('should run', () => {
    const fnSpy = vi.fn(() => {})
    effectScope().run(fnSpy)
    expect(fnSpy).toHaveBeenCalledTimes(1)
  })

  // 场景：不传 detached 参数创建作用域；验证默认构造方式可正常运行。
  it('should accept zero argument', () => {
    const scope = effectScope()
    expect(scope.effects.length).toBe(0)
  })

  // 场景：作用域函数返回结果；验证 run 会透传用户函数返回值。
  it('should return run value', () => {
    expect(effectScope().run(() => 1)).toBe(1)
  })

  // 场景：创建并停止作用域；验证 active 属性准确反映生命周期状态。
  it('should work w/ active property', () => {
    const scope = effectScope()
    scope.run(() => 1)
    expect(scope.active).toBe(true)
    scope.stop()
    expect(scope.active).toBe(false)
  })

  // 场景：在作用域 run 内创建 effect；验证作用域会自动收集并管理这些 effect。
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

  // 场景：停止包含多个 effect 的作用域；验证全部 effect 停止响应且 stop 保持幂等。
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

  // 场景：活动作用域内创建普通子作用域；验证父作用域会收集并级联停止子作用域。
  it('should collect nested scope', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
      // nested scope
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

    // stop the nested scope as well
    scope.stop()

    counter.num = 6
    expect(dummy).toBe(7)
    expect(doubled).toBe(14)
  })

  // 场景：父作用域内创建 detached 子作用域；验证子作用域可脱离父级停止流程继续存活。
  it('nested scope can be escaped', () => {
    let dummy, doubled
    const counter = reactive({ num: 0 })

    const scope = effectScope()
    scope.run(() => {
      effect(() => (dummy = counter.num))
      // nested scope
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

    // nested scope should not be stopped
    expect(doubled).toBe(12)
  })

  // 场景：多次进入同一活动作用域运行函数；验证作用域上下文每次均正确建立和恢复。
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

  // 场景：作用域停止后再次调用 run；验证函数不执行并在开发模式发出警告。
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

  // 场景：活动作用域注册多个 onScopeDispose；验证停止时执行全部销毁回调。
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

  // 场景：无活动作用域时调用 onScopeDispose；验证默认警告及静默选项行为。
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

  // 场景：单独停止普通子作用域；验证它会从父级数组解除引用，避免内存泄漏。
  it('should dereference child scope from parent scope after stopping child scope (no memleaks)', () => {
    const parent = effectScope()
    const child = parent.run(() => effectScope())!
    expect(parent.scopes!.includes(child)).toBe(true)
    child.stop()
    expect(parent.scopes!.includes(child)).toBe(false)
  })

  // 场景：作用域结合 computed、watch 等高层 API；验证停止后统一清理各类响应式副作用。
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
    // should not trigger anymore
    expect(computedSpy).toHaveBeenCalledTimes(2)
    expect(watchSpy).toHaveBeenCalledTimes(1)
    expect(watchEffectSpy).toHaveBeenCalledTimes(2)
  })

  // 场景：活动父作用域中运行 detached 子作用域；验证退出后 getCurrentScope 恢复父级。
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

  // 场景：活动作用域内误调用 detached 作用域 off；验证当前作用域指针不被破坏。
  it('calling .off() of a detached scope inside an active scope should not break currentScope', () => {
    const parentScope = effectScope()

    parentScope.run(() => {
      const childScope = effectScope(true)
      childScope.on()
      childScope.off()
      expect(getCurrentScope()).toBe(parentScope)
    })
  })

  // 场景：多个作用域异步交错并乱序 off；验证中间作用域能从活动链正确摘除。
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

  // 场景：暂停和恢复包含子作用域/effect 的作用域；验证暂停期间更新在恢复后合并触发。
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

  // 场景：作用域停止过程中 watcher 同时从作用域数组移除自己；验证遍历不会漏停其他成员。
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

  // 场景：作用域实例被放入响应式对象并停止；验证其内部标记避免代理破坏后续更新行为。
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

    const handleBegin = () => {
      const status = rs.value
      status.stage = 1
      status.scope = effectScope()
      status.scope.run(() => {
        watch([() => status.stage], () => {})
      })
    }

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

    // 1. Click begin
    handleBegin()
    expect(rs.value.stage).toBe(1)
    expect(renderCount).toBe(2)

    // 2. Click add
    rs.value.stage++
    expect(rs.value.stage).toBe(2)
    expect(renderCount).toBe(3)

    // 3. Click end
    handleExit()
    expect(rs.value.stage).toBe(0)
    expect(renderCount).toBe(4)

    handleBegin()
    expect(rs.value.stage).toBe(1)
    expect(renderCount).toBe(5)
  })

  // 场景：父作用域清理时某子作用域停止同级作用域；验证所有子作用域仍会被完整停止。
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

  // 场景：恢复作用域时某 watcher 停止同级 watcher；验证其余 effect 仍能恢复执行。
  it('should resume effects when a watcher stops a sibling watcher', () => {
    const count = ref(0)
    const scope = effectScope()
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
