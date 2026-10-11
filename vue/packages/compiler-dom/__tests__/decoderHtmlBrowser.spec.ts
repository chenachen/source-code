/**
 * @vitest-environment jsdom
 */

/**
 * 在 jsdom 中验证常见字符实体，以及属性模式中的标签文本与引号。
 */
import { decodeHtmlBrowser } from '../src/decodeHtmlBrowser'

describe('decodeHtmlBrowser', () => {
  /**
   * 场景：在 jsdom 中对文本实体、十进制/十六进制字符码与嵌套转义各解码一次，断言空白及单层结果；属性模式另输入标签与引号，确认保留标签文本而不当作真实元素。
   */
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
