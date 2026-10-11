/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench, describe } from 'vitest'
import { ref } from '../dist/reactivity.esm-browser.prod'

describe('ref', () => {
  /** 场景：每轮创建 ref(100) 而不读取 value。测量 RefImpl 与独立 Dep 的分配，不包含依赖登记。 */
  bench('create ref', () => {
    ref(100)
  })

  {
    let i = 0
    const v = ref(100)
    /** 场景：setup 保留 ref(100)；每轮写递增 i，不创建消费者。测量 value setter 的相等判断、存储与无订阅者通知。 */
    bench('write ref', () => {
      v.value = i++
    })
  }

  {
    const v = ref(100)
    /** 场景：setup 保留 ref(100)；每轮只读 value，没有 activeSub。测量 getter 访问，无活动订阅者时不创建 Link。 */
    bench('read ref', () => {
      v.value
    })
  }

  {
    let i = 0
    const v = ref(100)
    /** 场景：setup 保留 ref(100)；每轮写递增 i 后立即读 value。测量无消费者的写／读组合成本，不验证缓存或 effect 重跑。 */
    bench('write/read ref', () => {
      v.value = i++
      v.value
    })
  }
})
