import { describe, expect, test } from 'vitest'
import { modulePreloadLinkRE } from '../index'

describe('modulePreloadLinkRE', () => {
  /** 可删除的真实 modulepreload link：属性顺序、引号、跨行与两种自闭合写法均纳入输入表。 */
  const matches: Array<[string, string]> = [
    ['rel first', '<link rel="modulepreload" crossorigin href="/assets/x.js">'],
    [
      'rel after other attributes',
      '<link href="/assets/x.js" rel="modulepreload">',
    ],
    ['rel only', '<link rel="modulepreload">'],
    ['self-closing', '<link rel="modulepreload"/>'],
    ['self-closing with space', '<link rel="modulepreload" />'],
    ['single quotes', "<link rel='modulepreload' href='/assets/x.js'>"],
    [
      'attributes across multiple lines',
      '<link\n  rel="modulepreload"\n  href="/assets/x.js"\n>',
    ],
  ]

  for (const [name, html] of matches) {
    /** 当前行提供一种合法 modulepreload 标签；全局替换后应为空，证明整个标签都被识别和移除。 */
    test(`matches: ${name}`, () => {
      expect(html.replace(modulePreloadLinkRE, '')).toBe('')
    })
  }

  /** 保留的近似输入：错误标签名、缺少/错误 rel、属性名后缀和不配对引号均不得误匹配。 */
  const nonMatches: Array<[string, string]> = [
    ['tag name with suffix', '<linkfoo rel="modulepreload">'],
    ['custom element with hyphen', '<link-preview rel="modulepreload">'],
    ['bare link tag', '<link>'],
    ['stylesheet link', '<link rel="stylesheet" href="/assets/x.css">'],
    ['preload (not modulepreload)', '<link rel="preload" href="/assets/x.js">'],
    [
      'attribute name ending in rel',
      '<link xrel="modulepreload" href="/assets/x.js">',
    ],
    ['mismatched quotes', `<link rel="modulepreload'>`],
  ]

  for (const [name, html] of nonMatches) {
    /** 当前行提供一种近似但无效的标签；替换后仍等于原 HTML，防止正则误删其他标签或属性。 */
    test(`does not match: ${name}`, () => {
      expect(html.replace(modulePreloadLinkRE, '')).toBe(html)
    })
  }
})
