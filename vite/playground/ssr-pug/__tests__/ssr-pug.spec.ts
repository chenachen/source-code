import { describe, expect, test } from 'vitest'
import { port } from './serve'
import { page } from '~utils'

/** custom serve提供的Pug SSR页面地址。 */
const url = `http://localhost:${port}`

describe('injected inline scripts', () => {
  /** 场景：访问Pug SSR转换后的页面，枚举无src且有文本的script；核对内联模块脚本已全部代理化。 */
  test('no injected inline scripts are present', async () => {
    await page.goto(url)
    const inlineScripts = await page.$$eval('script', (nodes) =>
      nodes.filter((n) => !n.getAttribute('src') && n.innerHTML),
    )
    expect(inlineScripts).toHaveLength(0)
  })

  /** 场景：访问页面提取html-proxy脚本URL，核对列表非空；逐URL fetch代码均非空，检查Pug注入脚本代理可取。 */
  test('injected script proxied correctly', async () => {
    await page.goto(url)
    const proxiedScripts = await page.$$eval('script', (nodes) =>
      nodes
        .filter((n) => {
          const src = n.getAttribute('src')
          if (!src) return false
          return src.includes('?html-proxy&index')
        })
        .map((n) => n.getAttribute('src')),
    )

    // 至少有一条代理脚本。
    expect(proxiedScripts).not.toHaveLength(0)

    const scriptContents = await Promise.all(
      proxiedScripts.map((src) => fetch(url + src).then((res) => res.text())),
    )

    // 每条代理URL均返回代码。
    for (const code of scriptContents) {
      expect(code).toBeTruthy()
    }
  })
})
