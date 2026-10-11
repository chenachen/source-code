import { describe, expect, test } from 'vitest'
import { port } from './serve'
import { isBuild, page } from '~utils'

/** 自定义 Express SSR 服务的访问地址；端口与本目录 serve.ts 共用。 */
const url = `http://localhost:${port}`

describe.runIf(isBuild)('client-legacy-ssr-sequential-builds', () => {
  /** 仅构建模式执行：自定义服务已依次构建 client 与 SSR，访问其端口，验证服务端渲染的 app 包含 Hello。 */
  test('should work', async () => {
    await page.goto(url)
    expect(await page.textContent('#app')).toMatch('Hello')
  })

  /** 仅构建模式执行：沿用上一用例加载的 SSR 页面，检查 mode 文本为 test，验证顺序构建时传入的 mode 在服务端产物中生效。 */
  test('import.meta.env.MODE', async () => {
    // 此处检查服务端 HTML 中已经替换的环境常量。
    expect(await page.textContent('#mode')).toMatch('test')
  })
})
