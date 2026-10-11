/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench } from 'vitest'
import {
  effect,
  reactive,
  shallowReadArray,
} from '../dist/reactivity.esm-browser.prod'

for (let amount = 1e1; amount < 1e4; amount *= 10) {
  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)

    /** 场景：amount 为 10／100／1000，独立原数组预填 0…amount-1；每轮创建 for 索引求和 effect。测量 length 与逐索引访问的建依赖成本，不含停止。 */
    bench(`track for loop, ${amount} elements`, () => {
      let sum = 0
      effect(() => {
        for (let i = 0; i < arr.length; i++) {
          sum += arr[i]
        }
      })
    })
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)

    /** 场景：amount 为 10／100／1000，数组预填索引值；每轮创建 effect，先 shallowReadArray 再在 raw 数组求和。测量单个 ARRAY_ITERATE_KEY 收集，标签保留原名，实际未调用 reactiveReadArray。 */
    bench(`track manual reactiveReadArray, ${amount} elements`, () => {
      let sum = 0
      effect(() => {
        const raw = shallowReadArray(arr)
        for (let i = 0; i < raw.length; i++) {
          sum += raw[i]
        }
      })
    })
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)

    /** 场景：amount 为 10／100／1000，数组预填索引值；每轮创建 for…of 求和 effect。测量值迭代器统一收集依赖与消费元素的成本。 */
    bench(`track iteration, ${amount} elements`, () => {
      let sum = 0
      effect(() => {
        for (let x of arr) {
          sum += x
        }
      })
    })
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)

    /** 场景：amount 为 10／100／1000，数组预填索引值；每轮创建 forEach 求和 effect。测量回调类插桩的迭代依赖收集。 */
    bench(`track forEach, ${amount} elements`, () => {
      let sum = 0
      effect(() => {
        arr.forEach(x => (sum += x))
      })
    })
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)

    /** 场景：amount 为 10／100／1000，数组预填索引值；每轮创建从初始累加值 0 开始的 reduce effect。测量归并插桩与统一迭代依赖，不覆盖省略初始 acc 的分支。 */
    bench(`track reduce, ${amount} elements`, () => {
      let sum = 0
      effect(() => {
        sum = arr.reduce((v, a) => a + v, 0)
      })
    })
  }

  {
    const rawArray: any[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const r = reactive(rawArray)
    effect(() => r.reduce((v, a) => a + v, 0))

    /** 场景：amount 为 10／100／1000；setup 已创建 reduce effect，每轮只给 r[0] 自增。测量数字索引 SET 通知 ARRAY_ITERATE_KEY 后的聚合重算。 */
    bench(
      `trigger index mutation (1st only), tracked with reduce, ${amount} elements`,
      () => {
        r[0]++
      },
    )
  }

  {
    const rawArray: any[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const r = reactive(rawArray)
    effect(() => r.reduce((v, a) => a + v, 0))

    /** 场景：amount 为 10／100／1000；setup 已创建 reduce effect，每轮循环自增所有索引。各次写入独立同步触发，测量重复重算，不等于一次批量更新。 */
    bench(
      `trigger index mutation (all), tracked with reduce, ${amount} elements`,
      () => {
        for (let i = 0, n = r.length; i < n; i++) {
          r[i]++
        }
      },
    )
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)
    let sum = 0
    effect(() => {
      for (let x of arr) {
        sum += x
      }
    })

    /** 场景：amount 为 10／100／1000；setup 用 for…of 建立迭代依赖，每轮 push(1)。测量新增索引／长度批处理及迭代重跑；原数组在各轮间持续增长，没有还原长度。 */
    bench(`push() trigger, tracked via iteration, ${amount} elements`, () => {
      arr.push(1)
    })
  }

  {
    const rawArray: number[] = []
    for (let i = 0, n = amount; i < n; i++) {
      rawArray.push(i)
    }
    const arr = reactive(rawArray)
    let sum = 0
    effect(() => {
      arr.forEach(x => (sum += x))
    })

    /** 场景：amount 为 10／100／1000；setup 用 forEach 建立迭代依赖，每轮 push(1)。测量写方法通知与回调类重跑；sum 和数组跨轮保留，不作为求和正确性的断言。 */
    bench(`push() trigger, tracked via forEach, ${amount} elements`, () => {
      arr.push(1)
    })
  }
}
