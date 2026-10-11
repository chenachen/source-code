import { describe, expect, test } from 'vitest'
import { port } from './serve'
import { isBuild, page } from '~utils'

/** 自定义 Express SSR 服务的访问地址；端口与本目录 serve.ts 共用。 */
const url = `http://localhost:${port}`

describe.runIf(isBuild)('legacy-ssr', () => {
  /** 仅构建模式访问自定义 SSR 服务，确认 app 包含 Hello，覆盖 legacy 插件配置下的服务端构建。 */
  test('should work', async () => {
    await page.goto(url)
    expect(await page.textContent('#app')).toMatch('Hello')
  })

  /** 仅构建模式检查已加载 SSR 页面的 env 为 false，验证服务端产物使用 modern 分支的 LEGACY 常量。 */
  test('import.meta.env.LEGACY', async () => {
    // 此处检查服务端 HTML 中已经替换的环境常量。
    expect(await page.textContent('#env')).toMatch('false')
  })
})
