import { expect, test } from 'vitest'
import { isServe, testDir, viteServer } from '~utils'

/** 场景：仅isServe执行：用viteServer.ssrLoadModule导入入口，核对默认对象dep/nonDep/builtin三类别名结果均ok。 */
test.runIf(isServe)('dev', async () => {
  const mod = await viteServer.ssrLoadModule('/src/main.js')
  expect(mod.default).toEqual({
    dep: 'ok',
    nonDep: 'ok',
    builtin: 'ok',
  })
})

/** 场景：仅非serve执行：直接导入dist/main.js构建产物，核对依赖/普通模块/builtin三类别名均ok。 */
test.runIf(!isServe)('build', async () => {
  const mod = await import(`${testDir}/dist/main.js`)
  expect(mod.default).toEqual({
    dep: 'ok',
    nonDep: 'ok',
    builtin: 'ok',
  })
})
