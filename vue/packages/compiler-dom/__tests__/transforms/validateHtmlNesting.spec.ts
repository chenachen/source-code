/**
 * HTML 嵌套合法性场景：覆盖浏览器会隐式闭合/重排节点的父子和祖先组合，并单独验证 SVG
 * 不套用 HTML 限制；编译期警告可提前避免 SSR hydration 因 DOM 树形变化而失败。
 */
import { type CompilerError, compile } from '../../src'
import { isValidHTMLNesting } from '../../src/htmlNesting'

describe('validate html nesting', () => {
  it('should warn with p > div', () => {
    let err: CompilerError | undefined
    compile(`<p><div></div></p>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeDefined()
    expect(err!.message).toMatch(`<div> cannot be child of <p>`)
  })

  it('should not warn with select > hr', () => {
    let err: CompilerError | undefined
    compile(`<select><hr></select>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeUndefined()
  })

  // #13318：Vue `<template>` 是编译期透明容器，不是原生 template 元素，不能用其标签名误报嵌套。
  it('should not warn when parent tag is template', () => {
    let err: CompilerError | undefined
    compile(`<template><tr/></template>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeUndefined()
  })
})

/**
 * Copied from https://github.com/MananTank/validate-html-nesting
 * 原规则来自 validate-html-nesting，遵循 ISC 许可证。
 */
// 纯规则矩阵：直接验证标签对，便于区分“非法直接 parent”与“非法任意 ancestor”。
describe('isValidHTMLNesting', () => {
  test('form', () => {
    // 非法组合。
    expect(isValidHTMLNesting('form', 'form')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('form', 'div')).toBe(true)
    expect(isValidHTMLNesting('form', 'input')).toBe(true)
    expect(isValidHTMLNesting('form', 'select')).toBe(true)
    expect(isValidHTMLNesting('form', 'button')).toBe(true)
    expect(isValidHTMLNesting('form', 'label')).toBe(true)
    expect(isValidHTMLNesting('form', 'h1')).toBe(true)
  })

  test('p', () => {
    // 非法组合。
    expect(isValidHTMLNesting('p', 'p')).toBe(false)
    expect(isValidHTMLNesting('p', 'div')).toBe(false)
    expect(isValidHTMLNesting('p', 'hr')).toBe(false)
    expect(isValidHTMLNesting('p', 'blockquote')).toBe(false)
    expect(isValidHTMLNesting('p', 'pre')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('p', 'a')).toBe(true)
    expect(isValidHTMLNesting('p', 'span')).toBe(true)
    expect(isValidHTMLNesting('p', 'abbr')).toBe(true)
    expect(isValidHTMLNesting('p', 'button')).toBe(true)
    expect(isValidHTMLNesting('p', 'b')).toBe(true)
    expect(isValidHTMLNesting('p', 'i')).toBe(true)
    expect(isValidHTMLNesting('p', 'input')).toBe(true)
    expect(isValidHTMLNesting('p', 'label')).toBe(true)
  })

  test('a', () => {
    // 非法组合。
    expect(isValidHTMLNesting('a', 'a')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('a', 'div')).toBe(true)
    expect(isValidHTMLNesting('a', 'span')).toBe(true)
  })

  test('button', () => {
    // 非法组合。
    expect(isValidHTMLNesting('button', 'button')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('button', 'div')).toBe(true)
    expect(isValidHTMLNesting('button', 'span')).toBe(true)
  })

  test('table', () => {
    // 非法组合。
    expect(isValidHTMLNesting('table', 'tr')).toBe(false)
    expect(isValidHTMLNesting('table', 'table')).toBe(false)
    expect(isValidHTMLNesting('table', 'td')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('table', 'thead')).toBe(true)
    expect(isValidHTMLNesting('table', 'tbody')).toBe(true)
    expect(isValidHTMLNesting('table', 'tfoot')).toBe(true)
    expect(isValidHTMLNesting('table', 'caption')).toBe(true)
    expect(isValidHTMLNesting('table', 'colgroup')).toBe(true)
  })

  test('td', () => {
    // 合法组合。
    expect(isValidHTMLNesting('td', 'span')).toBe(true)
    expect(isValidHTMLNesting('tr', 'td')).toBe(true)

    // 非法组合。
    expect(isValidHTMLNesting('td', 'td')).toBe(false)
    expect(isValidHTMLNesting('div', 'td')).toBe(false)
  })

  test('tbody', () => {
    // 非法组合。
    expect(isValidHTMLNesting('tbody', 'td')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('tbody', 'tr')).toBe(true)
  })

  test('tr', () => {
    // 非法组合。
    expect(isValidHTMLNesting('tr', 'tr')).toBe(false)
    expect(isValidHTMLNesting('table', 'tr')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('tbody', 'tr')).toBe(true)
    expect(isValidHTMLNesting('thead', 'tr')).toBe(true)
    expect(isValidHTMLNesting('tfoot', 'tr')).toBe(true)
    expect(isValidHTMLNesting('tr', 'td')).toBe(true)
    expect(isValidHTMLNesting('tr', 'th')).toBe(true)
  })

  test('li', () => {
    // 非法组合。
    expect(isValidHTMLNesting('li', 'li')).toBe(false)
    // 合法组合。
    expect(isValidHTMLNesting('li', 'div')).toBe(true)
    expect(isValidHTMLNesting('li', 'ul')).toBe(true)
  })

  test('headings', () => {
    // 非法组合。
    expect(isValidHTMLNesting('h1', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h2', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h3', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h1', 'h6')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('h1', 'div')).toBe(true)
  })

  // SVG 子树不受 HTML content model 限制，但 foreignObject 返回 HTML 后应恢复校验。
  describe('SVG', () => {
    test('svg', () => {
      // 非 SVG 标签作为 child：非法。
      expect(isValidHTMLNesting('svg', 'div')).toBe(false)
      expect(isValidHTMLNesting('svg', 'img')).toBe(false)
      expect(isValidHTMLNesting('svg', 'p')).toBe(false)
      expect(isValidHTMLNesting('svg', 'h2')).toBe(false)
      expect(isValidHTMLNesting('svg', 'span')).toBe(false)

      // 非 SVG 标签作为 child：合法。
      expect(isValidHTMLNesting('svg', 'a')).toBe(true)
      expect(isValidHTMLNesting('svg', 'textarea')).toBe(true)
      expect(isValidHTMLNesting('svg', 'input')).toBe(true)
      expect(isValidHTMLNesting('svg', 'select')).toBe(true)

      // SVG 标签作为 child：合法。
      expect(isValidHTMLNesting('svg', 'g')).toBe(true)
      expect(isValidHTMLNesting('svg', 'ellipse')).toBe(true)
      expect(isValidHTMLNesting('svg', 'feOffset')).toBe(true)
    })

    test('foreignObject', () => {
      // 合法组合。
      expect(isValidHTMLNesting('foreignObject', 'g')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'div')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'a')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'textarea')).toBe(true)
    })

    test('g', () => {
      // 合法组合。
      expect(isValidHTMLNesting('g', 'div')).toBe(true)
      expect(isValidHTMLNesting('g', 'p')).toBe(true)
      expect(isValidHTMLNesting('g', 'a')).toBe(true)
      expect(isValidHTMLNesting('g', 'textarea')).toBe(true)
      expect(isValidHTMLNesting('g', 'g')).toBe(true)
    })

    test('dl', () => {
      // 合法组合。
      expect(isValidHTMLNesting('dl', 'dt')).toBe(true)
      expect(isValidHTMLNesting('dl', 'dd')).toBe(true)
      expect(isValidHTMLNesting('dl', 'div')).toBe(true)
      expect(isValidHTMLNesting('div', 'dt')).toBe(true)
      expect(isValidHTMLNesting('div', 'dd')).toBe(true)

      // 非法组合。
      expect(isValidHTMLNesting('span', 'dt')).toBe(false)
      expect(isValidHTMLNesting('span', 'dd')).toBe(false)
    })
  })
})
