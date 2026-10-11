/**
 * 比较 watch/watchEffect 的创建成本，以及 ref 修改后的调度与执行成本。
 * 不等待 nextTick 的基准只计入同步通知和入队；等待 nextTick 的基准包含队列刷新。
 * 这些 bench 记录性能，不执行行为断言。
 */
import { nextTick, ref, watch, watchEffect } from '../src'
import { bench } from 'vitest'

/** 每次基准新建值为100的 ref 与空 watch 回调，计量 watcher 创建成本；没有行为断言。 */
bench('create watcher', () => {
  const v = ref(100)
  watch(v, v => {})
})

{
  const v = ref(100)
  watch(v, v => {})
  let i = 0
  /** 基准外先建立 ref 与 watch，每次递增写入但不等待 nextTick，计量同步通知与入队成本；回调执行不在本次计量边界内。 */
  bench('update ref to trigger watcher (scheduled but not executed)', () => {
    v.value = i++
  })
}

{
  const v = ref(100)
  watch(v, v => {})
  let i = 0
  /** 基准外先建立 ref 与 watch，每次递增写入并返回 nextTick Promise，计量包含队列刷新与空回调执行的更新成本；没有行为断言。 */
  bench('update ref to trigger watcher (executed)', async () => {
    v.value = i++
    return nextTick()
  })
}

{
  /** 每次基准创建空 watchEffect，计量创建与首次同步执行成本；函数不读取响应式数据，也没有行为断言。 */
  bench('create watchEffect', () => {
    watchEffect(() => {})
  })
}

{
  const v = ref(100)
  watchEffect(() => {
    v.value
  })
  let i = 0
  /** 基准外建立读取 ref 的 watchEffect，每次递增写入但不等待刷新，计量依赖通知与 effect 入队成本；没有行为断言。 */
  bench(
    'update ref to trigger watchEffect (scheduled but not executed)',
    () => {
      v.value = i++
    },
  )
}

{
  const v = ref(100)
  watchEffect(() => {
    v.value
  })
  let i = 0
  /** 基准外建立读取 ref 的 watchEffect，每次递增写入并 await nextTick，计量包含 effect 再执行与队列刷新的成本；没有行为断言。 */
  bench('update ref to trigger watchEffect (executed)', async () => {
    v.value = i++
    await nextTick()
  })
}
