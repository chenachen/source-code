import { expect, test } from 'vitest'
import { page } from '~utils'

/**
 * 场景：项目配置非根 base，源码又使用绝对 import URL。
 * 目标：确认 baseMiddleware 只在请求入口剥离一次 base，转换后的绝对导入仍保留公开 base，
 * 不会因内部 URL 规范化而生成错误地址。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.message')”。
 * 验证目标：“page.textContent('.message')” 应等于 “'absolute import'”，从而确认baseMiddleware 只在请求入口剥离 base，转换后公开 URL 仍带前缀。
 */
test('absolute imports keep base prefix', async () => {
  await expect.poll(() => page.textContent('.message')).toBe('absolute import')
})
