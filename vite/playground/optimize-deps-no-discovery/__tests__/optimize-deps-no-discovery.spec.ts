import { expect, test } from 'vitest'
import {
  isBuild,
  isBundledDev,
  page,
  readDepOptimizationMetadata,
} from '~utils'

/** 场景：noDiscovery夹具显式include包；读取.optimized-dep，核对优化依赖执行成功。 */
test('optimized dep', async () => {
  expect(await page.textContent('.optimized-dep')).toBe('[success]')
})

/** 场景：noDiscovery下未include的Vue/Vuex仍被入口使用；读取.vue，核对运行结果成功。 */
test('vue + vuex', async () => {
  expect(await page.textContent('.vue')).toMatch(`[success]`)
})

/** 场景：仅非构建且非bundledDev执行：读取优化清单，核对只有显式include测试包在optimized中，而vue/vuex没有自动进入。 */
test.runIf(!isBuild && !isBundledDev)('metadata', async () => {
  const meta = readDepOptimizationMetadata()
  expect(Object.keys(meta.optimized)).toContain('@vitejs/test-dep-no-discovery')
  expect(Object.keys(meta.optimized)).not.toContain('vue')
  expect(Object.keys(meta.optimized)).not.toContain('vuex')
})
