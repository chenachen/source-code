import { expect, test } from 'vitest'
import { isBuild, serverLogs } from '~utils'

/** 仅开发模式遍历服务器日志，确认 Tailwind 转换后没有 source map 指向缺失源文件的警告。 */
test.runIf(!isBuild)('should not output missing source file warning', () => {
  serverLogs.forEach((log) => {
    expect(log).not.toMatch(/Sourcemap for .+ points to missing source files/)
  })
})

/** 仅构建模式遍历服务器日志，确认没有 Sourcemap is likely to be incorrect 警告，覆盖合并映射时的回归。 */
test.runIf(isBuild)('should not output sourcemap warning (#4939)', () => {
  serverLogs.forEach((log) => {
    expect(log).not.toMatch('Sourcemap is likely to be incorrect')
  })
})
