/**
 * 测试阅读说明：本文件验证 `runtime-core/apiWatch` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { nextTick, ref, watch, watchEffect } from '../src'
import { bench } from 'vitest'

bench('create watcher', () => {
  const v = ref(100)
  watch(v, v => {})
})

{
  const v = ref(100)
  watch(v, v => {})
  let i = 0
  bench('update ref to trigger watcher (scheduled but not executed)', () => {
    v.value = i++
  })
}

{
  const v = ref(100)
  watch(v, v => {})
  let i = 0
  bench('update ref to trigger watcher (executed)', async () => {
    v.value = i++
    return nextTick()
  })
}

{
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
  bench('update ref to trigger watchEffect (executed)', async () => {
    v.value = i++
    await nextTick()
  })
}
