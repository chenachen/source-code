/**
 * 使用预构建生产产物的性能场景；setup 状态跨采样轮次保留。
 * 下列 bench 衡量指定操作成本，没有正确性断言；场景说明不代表本轮执行过性能测量。
 */
import { bench } from 'vitest'
import { reactive } from '../dist/reactivity.esm-browser.prod'

/** 场景：每轮新建 {a:1} 并调用 reactive。测量新目标创建代理与写缓存，不覆盖相同 raw 的复用。 */
bench('create reactive obj', () => {
  reactive({ a: 1 })
})

{
  const raw = { a: 1 }
  reactive(raw)
  /** 场景：setup 对同一个 raw={a:1} 首次调用 reactive；每轮再转换该 raw。测量 reactiveMap 已有代理的缓存命中。 */
  bench('return cached reactive obj', () => {
    reactive(raw)
  })
}

{
  const r = reactive({ a: 1 })
  /** 场景：setup 创建 reactive({a:1})；每轮只读 a，没有活动 effect。测量普通 get 访问，不包含实际 Dep 订阅。 */
  bench('read reactive obj property', () => {
    r.a
  })
}

{
  const r = reactive({ a: { b: 1 } })
  /** 场景：setup 创建 reactive({a:{b:1}})；每轮读 r.a.b。测量惰性嵌套包装与随后代理缓存复用；无 effect，不将访问当成依赖收集。 */
  bench('read nested reactive obj property', () => {
    r.a.b
  })
}

{
  let i = 0
  const r = reactive({ a: 1 })
  /** 场景：setup 保留可变代理；每轮给已有属性 a 写递增 i。测量 SET／相等比较和无订阅者的触发路径。 */
  bench('write reactive obj property', () => {
    r.a = i++
  })
}
