import { expect, test } from 'vitest'
import { isBuild, serverLogs } from '~utils'

/** 场景：仅构建执行，关闭 codeSplitting 的夹具有动态导入；检查构建日志没有“动态导入不会移到另一chunk”的警告。 */
test.runIf(isBuild)(
  "don't warn when codeSplitting is set to false",
  async () => {
    const log = serverLogs.join('\n')
    expect(log).not.toContain(
      'dynamic import will not move module into another chunk',
    )
  },
)
