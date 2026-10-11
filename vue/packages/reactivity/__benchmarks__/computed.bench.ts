/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench, describe } from 'vitest'
import type { ComputedRef, Ref } from '../src'
import { computed, effect, ref } from '../dist/reactivity.esm-browser.prod'

declare module '../dist/reactivity.esm-browser.prod' {
  /** 为生产构建文件补充本基准所需的函数类型，运行时仍使用导入产物的 computed。 */
  function computed(...args: any[]): any
}

describe('computed', () => {
  /** 场景：每轮仅创建 getter 恒返回 100 的 computed，未读取 value。测量实例创建开销，不包含 getter 求值或订阅建边。 */
  bench('create computed', () => {
    computed(() => 100)
  })

  {
    const v = ref(100)
    computed(() => v.value * 2)
    let i = 0
    /** 场景：预先创建 ref(100) 与尚未求值、无消费者的二倍 computed；每轮给 ref 写入递增 i，不读 computed。测量未建立 getter 依赖时的 Ref 写入路径。 */
    bench("write ref, don't read computed (without effect)", () => {
      v.value = i++
    })
  }

  {
    const v = ref(100)
    const c = computed(() => {
      return v.value * 2
    })
    effect(() => c.value)
    let i = 0
    /** 场景：先让一个 effect 读取二倍 computed，建立 ref→computed→effect；每轮只显式写 ref。测量同步通知、按需刷新和下游处理，不能因基准体不读 value 就称 getter 未执行。 */
    bench("write ref, don't read computed (with effect)", () => {
      v.value = i++
    })
  }

  {
    const v = ref(100)
    const c = computed(() => {
      return v.value * 2
    })
    let i = 0
    /** 场景：保留无 effect 的二倍 computed；每轮递增写 ref 后读 c.value。测量消费者主动读取时的版本检查与求值，首次调用还会建立 getter 依赖。 */
    bench('write ref, read computed (without effect)', () => {
      v.value = i++
      c.value
    })
  }

  {
    const v = ref(100)
    const c = computed(() => {
      return v.value * 2
    })
    effect(() => c.value)
    let i = 0
    /** 场景：先用 effect 消费二倍 computed；每轮写 ref 后再读 c.value。测量同步下游处理后的再次缓存读取，与无 effect 的主动刷新场景区分。 */
    bench('write ref, read computed (with effect)', () => {
      v.value = i++
      c.value
    })
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      computeds.push(c)
    }
    let i = 0
    /** 场景：预建 1000 个无 effect、未读取的二倍 computed；每轮仅写同一个 ref，不访问这些实例。测量没有 getter Link 时的写入，不能当成 1000 个 computed 都被通知。 */
    bench("write ref, don't read 1000 computeds (without effect)", () => {
      v.value = i++
    })
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      effect(() => c.value)
      computeds.push(c)
    }
    let i = 0
    /** 场景：预建 1000 个 computed，各由独立 effect 首读建立依赖；每轮仅写共同 ref。测量扇出通知与 1000 个消费者处理，基准体虽不显式读 value，下游仍会同步检查。 */
    bench(
      "write ref, don't read 1000 computeds (with multiple effects)",
      () => {
        v.value = i++
      },
    )
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      computeds.push(c)
    }
    effect(() => {
      for (let i = 0; i < 1000; i++) {
        computeds[i].value
      }
    })
    let i = 0
    /** 场景：预建 1000 个 computed，由一个共享 effect 逐个首读；每轮写共同 ref。测量多条 computed 路径汇入同一 effect 时的批内去重与依赖检查。 */
    bench("write ref, don't read 1000 computeds (with single effect)", () => {
      v.value = i++
    })
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      computeds.push(c)
    }
    let i = 0
    /** 场景：预建 1000 个无 effect 的 computed；每轮写共同 ref，再逐个读取 value。测量主动刷新全部派生值的成本，首轮读取才建立各自上游 Link。 */
    bench('write ref, read 1000 computeds (no effect)', () => {
      v.value = i++
      computeds.forEach(c => c.value)
    })
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      effect(() => c.value)
      computeds.push(c)
    }
    let i = 0
    /** 场景：预建 1000 个 computed，各有独立 effect 首读；每轮写共同 ref 后再次遍历 value。测量多消费者同步处理与随后缓存读组合的成本。 */
    bench('write ref, read 1000 computeds (with multiple effects)', () => {
      v.value = i++
      computeds.forEach(c => c.value)
    })
  }

  {
    const v = ref(100)
    const computeds: ComputedRef<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      const c = computed(() => {
        return v.value * 2
      })
      effect(() => c.value)
      computeds.push(c)
    }
    effect(() => {
      for (let i = 0; i < 1000; i++) {
        computeds[i].value
      }
    })
    let i = 0
    /** 场景：1000 个 computed 各有独立 effect，另有一个共享 effect 读取全部实例；每轮写共同 ref 后显式遍历 value。测量扇出／汇合混合通知和再次读缓存，不把共享 effect 误算成 1000 次。 */
    bench(
      'write ref, read 1000 computeds (with 1000 individual effects and 1 shared effect)',
      () => {
        v.value = i++
        computeds.forEach(c => c.value)
      },
    )
  }

  {
    const refs: Ref<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      refs.push(ref(i))
    }
    const c = computed(() => {
      let total = 0
      refs.forEach(ref => (total += ref.value))
      return total
    })
    let i = 0
    const n = refs.length
    /** 场景：1000 个 Ref 初值为索引，单个无 effect 的 computed 求总和；每轮轮换一个 Ref 自增后读取总和。测量多依赖中的局部写入及一个聚合 getter 的刷新。 */
    bench('1000 refs, read 1 computed (without effect)', () => {
      refs[i++ % n].value++
      c.value
    })
  }

  {
    const refs: Ref<number>[] = []
    for (let i = 0, n = 1000; i < n; i++) {
      refs.push(ref(i))
    }
    const c = computed(() => {
      let total = 0
      refs.forEach(ref => (total += ref.value))
      return total
    })
    effect(() => c.value)
    let i = 0
    const n = refs.length
    /** 场景：1000 个 Ref 初值为索引，单个总和 computed 先被 effect 消费；每轮轮换一个 Ref 自增后再读总和。测量聚合计算的同步通知与随后缓存访问。 */
    bench('1000 refs, read 1 computed (with effect)', () => {
      refs[i++ % n].value++
      c.value
    })
  }
})
