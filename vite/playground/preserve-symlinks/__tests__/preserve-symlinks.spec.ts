import { expect, test } from 'vitest'
import { browserLogs, page } from '~utils'

/** 场景：符号链接依赖夹具加载后遍历browserLogs，核对没有404文本。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

/** 场景：依赖经符号链接默认解析到真实文件；读取#root，核对hello vite运行结果。 */
test('not-preserve-symlinks', async () => {
  expect(await page.textContent('#root')).toBe('hello vite')
})
