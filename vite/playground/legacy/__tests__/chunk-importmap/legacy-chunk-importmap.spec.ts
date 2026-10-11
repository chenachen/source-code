import { expect, test } from 'vitest'
import { browserLogs } from '~utils'

/** 使用带 import map 的 legacy 页面已完成加载，逐条检查浏览器日志，确认没有 404 请求记录。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})
