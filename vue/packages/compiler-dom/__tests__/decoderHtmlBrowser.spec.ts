/**
 * @vitest-environment jsdom
 */

/**
 * 浏览器实体解码场景：在真实 DOM 元素中验证文本/属性上下文的 HTML 实体差异，并回归
 * script/style/title 等特殊标签内容不能因复用 textarea 解码器而被错误解释。
 */
import { decodeHtmlBrowser } from '../src/decodeHtmlBrowser'

describe('decodeHtmlBrowser', () => {
  it('should decode HTML correctly', () => {
    expect(decodeHtmlBrowser(' abc  123 ')).toBe(' abc  123 ')

    expect(decodeHtmlBrowser('&')).toBe('&')
    expect(decodeHtmlBrowser('&amp;')).toBe('&')
    expect(decodeHtmlBrowser('&amp;amp;')).toBe('&amp;')

    expect(decodeHtmlBrowser('<')).toBe('<')
    expect(decodeHtmlBrowser('&lt;')).toBe('<')
    expect(decodeHtmlBrowser('&amp;lt;')).toBe('&lt;')

    expect(decodeHtmlBrowser('>')).toBe('>')
    expect(decodeHtmlBrowser('&gt;')).toBe('>')
    expect(decodeHtmlBrowser('&amp;gt;')).toBe('&gt;')

    expect(decodeHtmlBrowser('&nbsp;')).toBe('\u00a0')
    expect(decodeHtmlBrowser('&quot;')).toBe('"')
    expect(decodeHtmlBrowser('&apos;')).toBe("'")

    expect(decodeHtmlBrowser('&Eacute;')).toBe('\u00c9')
    expect(decodeHtmlBrowser('&#xc9;')).toBe('\u00c9')
    expect(decodeHtmlBrowser('&#201;')).toBe('\u00c9')

    // #3001：属性上下文中的 `<strong>...` 只是文本，借助 DOM 解码实体时不能被解析成真实元素。
    expect(decodeHtmlBrowser('<strong>Text</strong>', true)).toBe(
      '<strong>Text</strong>',
    )
    expect(decodeHtmlBrowser('<strong>&amp;</strong>', true)).toBe(
      '<strong>&</strong>',
    )
    expect(
      decodeHtmlBrowser(
        '<strong>&lt;strong&gt;&amp;&lt;/strong&gt;</strong>',
        true,
      ),
    ).toBe('<strong><strong>&</strong></strong>')
    expect(decodeHtmlBrowser('"', true)).toBe('"')
    expect(decodeHtmlBrowser("'", true)).toBe("'")
  })
})
