/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench, describe } from 'vitest'
import type { Ref } from '../src'
import { effect, ref } from '../dist/reactivity.esm-browser.prod'

describe('effect', () => {
  {
    let i = 0
    const n = ref(0)
    effect(() => n.value)
    /** 场景：先用一个 effect 读取 ref(0)；每轮给 ref 写入递增 i。测量单依赖通知与同步重跑，首个 i=0 写入可能命中同值跳过。 */
    bench('single ref invoke', () => {
      n.value = i++
    })
  }

  /** 按 size=1／10／100／1000 注册创建基准；每次采样新建 Ref 数组并让 effect 同步首读。 */
  function benchEffectCreate(size: number) {
    /** 场景：size 依次为 1／10／100／1000；每轮新建 size 个 Ref 并创建立即遍历它们的 effect。测量实例与 Link 建立，当前场景不调用 stop。 */
    bench(`create an effect that tracks ${size} refs`, () => {
      const refs: Ref[] = []
      for (let i = 0; i < size; i++) {
        refs.push(ref(i))
      }
      effect(() => {
        for (let i = 0; i < size; i++) {
          refs[i].value
        }
      })
    })
  }

  benchEffectCreate(1)
  benchEffectCreate(10)
  benchEffectCreate(100)
  benchEffectCreate(1000)

  /** 按 size=1／10／100／1000 注册创建后停止基准，覆盖同一轮的 Link 接入和摘除。 */
  function benchEffectCreateAndStop(size: number) {
    /** 场景：size 依次为 1／10／100／1000；每轮建 Ref 与遍历 effect，随后停止该 effect。测量建边和从所有 Dep 摘除的组合成本，与只创建场景区分。 */
    bench(`create and stop an effect that tracks ${size} refs`, () => {
      const refs: Ref[] = []
      for (let i = 0; i < size; i++) {
        refs.push(ref(i))
      }
      const e = effect(() => {
        for (let i = 0; i < size; i++) {
          refs[i].value
        }
      })
      e.effect.stop()
    })
  }

  benchEffectCreateAndStop(1)
  benchEffectCreateAndStop(10)
  benchEffectCreateAndStop(100)
  benchEffectCreateAndStop(1000)

  /** 为 size=10／100／1000 准备固定 Ref 数组和一个全读 effect，注册逐项独立赋值基准。 */
  function benchWithRefs(size: number) {
    let j = 0
    const refs: Ref[] = []
    for (let i = 0; i < size; i++) {
      refs.push(ref(i))
    }
    effect(() => {
      for (let i = 0; i < size; i++) {
        refs[i].value
      }
    })
    /** 场景：size 依次为 10／100／1000；setup 让一个 effect 读取全部 Ref，每轮逐个写不同值。测量 size 次独立同步写入及反复重跑，不存在跨这些赋值的外层 batch。 */
    bench(`1 effect, mutate ${size} refs`, () => {
      for (let i = 0; i < size; i++) {
        refs[i].value = i + j++
      }
    })
  }

  benchWithRefs(10)
  benchWithRefs(100)
  benchWithRefs(1000)

  /** 准备始终读取 toggle、条件读取 size 个 Ref 的 effect，注册切换分支依赖的基准。 */
  function benchWithBranches(size: number) {
    const toggle = ref(true)
    const refs: Ref[] = []
    for (let i = 0; i < size; i++) {
      refs.push(ref(i))
    }
    effect(() => {
      if (toggle.value) {
        for (let i = 0; i < size; i++) {
          refs[i].value
        }
      }
    })
    /** 场景：size 依次为 10／100／1000；effect 始终读 toggle，仅为真时读全部 Ref。每轮翻转 toggle，交替清除／恢复数据依赖，测量动态分支 Link 整理。 */
    bench(`${size} refs branch toggle`, () => {
      toggle.value = !toggle.value
    })
  }

  benchWithBranches(10)
  benchWithBranches(100)
  benchWithBranches(1000)

  /** 让 size=10／100／1000 个 effect 共享同一 Ref，注册单次写入的通知扇出基准。 */
  function benchMultipleEffects(size: number) {
    let i = 0
    const n = ref(0)
    for (let i = 0; i < size; i++) {
      effect(() => n.value)
    }
    /** 场景：size 依次为 10／100／1000；setup 让 size 个 effect 读取同一 Ref，每轮写递增值。测量单 Dep 向多个消费者的扇出通知与同步调度。 */
    bench(`1 ref invoking ${size} effects`, () => {
      n.value = i++
    })
  }

  benchMultipleEffects(10)
  benchMultipleEffects(100)
  benchMultipleEffects(1000)
})
