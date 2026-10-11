/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench } from 'vitest'
import type { ComputedRef } from '../src'
import { computed, reactive } from '../dist/reactivity.esm-browser.prod'

/** 从普通对象的自有可枚举字符串键构造新 Map，统一小集合 fixture；继承属性不加入。 */
function createMap(obj: Record<string, any>) {
  const map = new Map()
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      map.set(key, obj[key])
    }
  }
  return map
}

/** 场景：每轮从普通对象 {a:1} 创建新 Map 再转 reactive。测量建容器和代理的组合成本，不能单独当成缓存命中。 */
bench('create reactive map', () => {
  reactive(createMap({ a: 1 }))
})

{
  let i = 0
  const r = reactive(createMap({ a: 1 }))
  /** 场景：setup 保留 reactive(Map{a:1})；每轮给已有键 a 写递增 i。测量集合 SET 与同值比较路径，没有 effect 消费。 */
  bench('write reactive map property', () => {
    r.set('a', i++)
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  computed(() => {
    return r.get('a') * 2
  })
  let i = 0
  /** 场景：为 Map 的 a 创建二倍 computed，但从未读 value；每轮只 set a。测量未建立 computed getter 依赖时的集合写入。 */
  bench("write reactive map, don't read computed (never invoked)", () => {
    r.set('a', i++)
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  const c = computed(() => {
    return r.get('a') * 2
  })
  c.value
  let i = 0
  /** 场景：二倍 computed 在 setup 首读过，但无 effect 消费；每轮只 set a，不再次读 computed。测量保留版本快照、无活动下游通知链时的集合写入。 */
  bench("write reactive map, don't read computed (invoked)", () => {
    r.set('a', i++)
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  const c = computed(() => {
    return r.get('a') * 2
  })
  let i = 0
  /** 场景：保留二倍 computed；每轮 set a 后读 value。测量集合 key 依赖、版本检查和主动刷新，首次读取建立依赖。 */
  bench('write reactive map, read computed', () => {
    r.set('a', i++)
    c.value
  })
}

{
  const _m = new Map()
  for (let i = 0; i < 10000; i++) {
    _m.set(i, i)
  }
  const r = reactive(_m)
  const c = computed(() => {
    let total = 0
    r.forEach((value, key) => {
      total += value
    })
    return total
  })
  /** 场景：setup Map 含 10000 个数字键，computed 用 forEach 求和；每轮读并递增键 5000 的值，再读总和。测量已有键 SET 对 ITERATE_KEY 的失效和大集合遍历。 */
  bench("write reactive map (10'000 items), read computed", () => {
    r.set(5000, r.get(5000) + 1)
    c.value
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  const computeds: any[] = []
  for (let i = 0, n = 1000; i < n; i++) {
    const c = computed(() => {
      return r.get('a') * 2
    })
    computeds.push(c)
  }
  let i = 0
  /** 场景：预建 1000 个 computed 但均未首读；每轮只 set 共同 Map 的 a。测量无 getter Link 的写入，不将这些尚未建立依赖的实例计为通知消费者。 */
  bench("write reactive map, don't read 1000 computeds (never invoked)", () => {
    r.set('a', i++)
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  const computeds: any[] = []
  for (let i = 0, n = 1000; i < n; i++) {
    const c = computed(() => {
      return r.get('a') * 2
    })
    c.value
    computeds.push(c)
  }
  let i = 0
  /** 场景：1000 个 computed 均在 setup 首读，随后无 effect 继续消费；每轮只 set a。测量保留依赖快照而未接入上游通知链时的写入。 */
  bench("write reactive map, don't read 1000 computeds (invoked)", () => {
    r.set('a', i++)
  })
}

{
  const r = reactive(createMap({ a: 1 }))
  const computeds: ComputedRef<number>[] = []
  for (let i = 0, n = 1000; i < n; i++) {
    const c = computed(() => {
      return r.get('a') * 2
    })
    computeds.push(c)
  }
  let i = 0
  /** 场景：预建 1000 个 computed；每轮 set a 后逐个读 value。测量一个集合属性供多派生值主动刷新，首次基准调用同时建立依赖。 */
  bench('write reactive map, read 1000 computeds', () => {
    r.set('a', i++)
    computeds.forEach(c => c.value)
  })
}

{
  const reactives: Map<any, any>[] = []
  for (let i = 0, n = 1000; i < n; i++) {
    reactives.push(reactive(createMap({ a: i })))
  }
  const c = computed(() => {
    let total = 0
    reactives.forEach(r => (total += r.get('a')))
    return total
  })
  let i = 0
  const n = reactives.length
  /** 场景：1000 个 reactive Map 由单个 computed 读取 a 求和；每轮 set 一个 Map 后读总和。代码两次 i++：写入索引与取新值索引不同且循环推进两步，测量按该真实输入更新的聚合刷新。 */
  bench('1000 reactive maps, 1 computed', () => {
    reactives[i++ % n].set('a', reactives[i++ % n].get('a') + 1)
    c.value
  })
}
