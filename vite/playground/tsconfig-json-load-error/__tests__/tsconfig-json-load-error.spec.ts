import { describe, expect, test } from 'vitest'
import { clearServeError, serveError } from './serve'
import {
  browserLogs,
  editFile,
  isBuild,
  isBundledDev,
  isServe,
  page,
  readFile,
} from '~utils'

/** 兼容 tsconfck JSONError 与带 TSCONFIG_ERROR 前缀的构建错误消息。 */
const tsconfigLoadErrorRE =
  /(\[TSCONFIG_ERROR\] )*Failed to load tsconfig|JSONError/

describe.runIf(isBuild)('build', () => {
  /** 仅构建模式检查自定义 serve 捕获的错误存在且匹配 tsconfig 加载或 JSON 解析错误，随后清除它以免 afterAll 再次抛出同一预期错误。 */
  test('should throw an error on build', () => {
    expect(serveError).toBeTruthy()
    expect(serveError.message).toMatch(tsconfigLoadErrorRE)
    clearServeError() // 预期错误已检查，清除状态，避免 afterAll 再次抛出。
  })

  /** 仅构建模式读取 dist/index.html 并捕获 ENOENT，确认失败构建没有该 HTML 输出。 */
  test('should not output files to dist', () => {
    let err
    try {
      readFile('dist/index.html')
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy()
    expect(err.code).toBe('ENOENT')
  })
})

describe.runIf(isServe)('server', () => {
  /** 仅普通开发模式检查浏览器日志中有 500 且无修复成功消息，覆盖畸形 tsconfig 导致模块请求失败。 */
  test.runIf(!isBundledDev)(
    'should log 500 error in browser for malformed tsconfig',
    () => {
      // 浏览器完整消息受语言设置影响，此处只检查 Chrome 稳定输出的 500。
      expect(browserLogs.find((x) => x.includes('500'))).toBeTruthy()
      expect(browserLogs).not.toContain('tsconfig error fixed, file loaded')
    },
  )

  /** 仅 bundled dev 检查全局 fallback page 标记为 true 且无修复成功消息，覆盖首轮 bundle 失败后的占位页。 */
  test.runIf(isBundledDev)(
    'should keep the fallback page for malformed tsconfig',
    async () => {
      // bundled dev 不逐个请求源模块；首轮 bundle 构建失败后，
      // 服务器继续提供状态为 200 的 fallback 页面，
      // 构建错误通过 overlay 显示，
      // 下面的场景检查该 overlay。
      expect(
        await page.evaluate(
          () => (globalThis as any).__vite_is_fallback_page__,
        ),
      ).toBe(true)
      expect(browserLogs).not.toContain('tsconfig error fixed, file loaded')
    },
  )

  /** 仅开发模式等待错误 overlay，并从消息体匹配 tsconfig 错误正则；文件名和位置差异不参与固定字符串匹配。 */
  test('should show error overlay for tsconfig error', async () => {
    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()
    const message = await errorOverlay.$$eval('.message-body', (m) => {
      return m[0].innerHTML
    })
    // Windows 的文件名与位置文本不同，用正则匹配共同的错误主体。
    expect(message).toMatch(tsconfigLoadErrorRE)
  })

  // bundled dev 尚不能从首轮构建失败重新构建（vitejs/vite#23028，rolldown#9598）。
  /** bundled dev 尚不能从首轮构建失败恢复，故跳过；普通 dev 修复 tsconfig 的 compilerOptions 语法后，轮询浏览器日志出现成功加载消息。 */
  test.skipIf(isBundledDev)(
    'should reload when tsconfig is changed',
    async () => {
      editFile('has-error/tsconfig.json', (content) => {
        return content.replace('"compilerOptions":', '"compilerOptions":{}')
      })
      await expect
        .poll(() => browserLogs)
        .toContain('tsconfig error fixed, file loaded')
    },
  )
})
