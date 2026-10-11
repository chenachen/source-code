import { expect, test } from 'vitest'
import { page } from '~utils'

/**
 * 场景：base 与磁盘绝对路径共享首段（如 /Users/），插件虚拟模块又导入该绝对文件。
 * 目标：页面最终显示 absolute import，验证 import analysis 不把磁盘路径首段误当成已加的 base，
 * 生成的请求经 baseMiddleware 后仍能定位真实模块。
 */
test('absolute imports keep base prefix', async () => {
  await expect.poll(() => page.textContent('.message')).toBe('absolute import')
})
