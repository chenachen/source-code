/**
 * 验证原生元素直接父子标签的嵌套规则。转换器仅传入父子 tag，不扫描任意祖先，
 * 也不按 namespace 排除 SVG；下面分别断言 HTML 与 SVG 相关标签对的规则结果。
 */
import { type CompilerError, compile } from '../../src'
import { isValidHTMLNesting } from '../../src/htmlNesting'

describe('validate html nesting', () => {
  /**
   * 场景：编译 p 直接包 div 的模板，收集 onWarn 并检查父子标签诊断，验证开发期矩阵检查以警告指出可能被 HTML parser 重排的结构。
   */
  it('should warn with p > div', () => {
    let err: CompilerError | undefined
    compile(`<p><div></div></p>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeDefined()
    expect(err!.message).toMatch(`<div> cannot be child of <p>`)
  })

  /**
   * 场景：select 直接包 hr，编译后断言无警告，验证该标签已在 select 的允许子元素集合中。
   */
  it('should not warn with select > hr', () => {
    let err: CompilerError | undefined
    compile(`<select><hr></select>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeUndefined()
  })

  // #13318：普通 `<template>` 保持原生元素路径，内容存放在 DocumentFragment。
  // isValidHTMLNesting 对 template 父标签直接放行，因此这个标签对不报嵌套警告。
  /**
   * 场景：普通 template 包 tr，编译后断言无警告，验证 template 父标签的特殊放行先于 tr 的允许父元素白名单。
   */
  it('should not warn when parent tag is template', () => {
    let err: CompilerError | undefined
    compile(`<template><tr/></template>`, {
      onWarn: e => (err = e),
    })
    expect(err).toBeUndefined()
  })
})

/**
 * 用例来源：https://github.com/MananTank/validate-html-nesting
 * 原规则来自 validate-html-nesting，遵循 ISC 许可证。
 */
// 直接标签对规则矩阵：验证各白名单和黑名单的返回结果。
describe('isValidHTMLNesting', () => {
  /**
   * 场景：直接调用标签对判断，form 嵌套 form 返回 false，div/input/select/button/label/h1 返回 true，验证同类 form 黑名单不误禁普通表单内容。
   */
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

  /**
   * 场景：p 分别包含块级/同类标签与 phrasing 标签，断言前组 false、后组 true，验证父标签黑名单只拒绝已列出的会隐式闭合 p 的组合。
   */
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

  /**
   * 场景：a 嵌套 a 返回 false，a 包 div/span 返回 true，验证 a 的同类嵌套黑名单不禁止普通元素内容。
   */
  test('a', () => {
    // 非法组合。
    expect(isValidHTMLNesting('a', 'a')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('a', 'div')).toBe(true)
    expect(isValidHTMLNesting('a', 'span')).toBe(true)
  })

  /**
   * 场景：button 嵌套 button 返回 false，button 包 div/span 返回 true，验证特殊子标签约束不等同于禁止 button 的所有元素后代。
   */
  test('button', () => {
    // 非法组合。
    expect(isValidHTMLNesting('button', 'button')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('button', 'div')).toBe(true)
    expect(isValidHTMLNesting('button', 'span')).toBe(true)
  })

  /**
   * 场景：table 的直接 tr/table/td 均被拒绝，thead/tbody/tfoot/caption/colgroup 被允许，验证严格子元素白名单要求显式表格层级。
   */
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

  /**
   * 场景：td 包 span 与 tr 包 td 被允许，td 包 td 和 div 包 td 被拒绝，验证单元格的允许父级与普通单元格内容分开检查。
   */
  test('td', () => {
    // 合法组合。
    expect(isValidHTMLNesting('td', 'span')).toBe(true)
    expect(isValidHTMLNesting('tr', 'td')).toBe(true)

    // 非法组合。
    expect(isValidHTMLNesting('td', 'td')).toBe(false)
    expect(isValidHTMLNesting('div', 'td')).toBe(false)
  })

  /**
   * 场景：tbody 直接包 td 返回 false、包 tr 返回 true，验证表体只允许行，不能跳过行层。
   */
  test('tbody', () => {
    // 非法组合。
    expect(isValidHTMLNesting('tbody', 'td')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('tbody', 'tr')).toBe(true)
  })

  /**
   * 场景：tr 包 tr、table 直接包 tr 被拒绝；各表体包 tr 及 tr 包 td/th 被允许，验证行的父子双向严格约束。
   */
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

  /**
   * 场景：li 包 li 被拒绝，li 包 div/ul 被允许，验证同类嵌套黑名单仍允许在 li 内容内建立子列表。
   */
  test('li', () => {
    // 非法组合。
    expect(isValidHTMLNesting('li', 'li')).toBe(false)
    // 合法组合。
    expect(isValidHTMLNesting('li', 'div')).toBe(true)
    expect(isValidHTMLNesting('li', 'ul')).toBe(true)
  })

  /**
   * 场景：标题之间的同类/异类嵌套都返回 false，h1 包 div 返回 true，验证所有标题共享 headings 禁止父级集合。
   */
  test('headings', () => {
    // 非法组合。
    expect(isValidHTMLNesting('h1', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h2', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h3', 'h1')).toBe(false)
    expect(isValidHTMLNesting('h1', 'h6')).toBe(false)

    // 合法组合。
    expect(isValidHTMLNesting('h1', 'div')).toBe(true)
  })

  // SVG 与 foreignObject 标签对在当前规则矩阵中的结果；该函数不接收 namespace。
  describe('SVG', () => {
    /**
     * 场景：svg 包 div/img/p/h2/span 被拒绝，包 a/textarea/input/select 与 g/ellipse/feOffset 被允许，验证当前标签对矩阵的实际范围；函数不依据命名空间保证完整 SVG 合法性。
     */
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

    /**
     * 场景：foreignObject 包 g/div/a/textarea 都返回 true，验证此标签未命中特殊白名单/黑名单；调用目标是标签矩阵函数 isValidHTMLNesting。
     */
    test('foreignObject', () => {
      // 合法组合。
      expect(isValidHTMLNesting('foreignObject', 'g')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'div')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'a')).toBe(true)
      expect(isValidHTMLNesting('foreignObject', 'textarea')).toBe(true)
    })

    /**
     * 场景：g 包 div/p/a/textarea/g 都返回 true，验证未列入规则的父子对默认放行，而非对 SVG 后代作完整规范校验。
     */
    test('g', () => {
      // 合法组合。
      expect(isValidHTMLNesting('g', 'div')).toBe(true)
      expect(isValidHTMLNesting('g', 'p')).toBe(true)
      expect(isValidHTMLNesting('g', 'a')).toBe(true)
      expect(isValidHTMLNesting('g', 'textarea')).toBe(true)
      expect(isValidHTMLNesting('g', 'g')).toBe(true)
    })

    /**
     * 场景：dl/div 包 dt/dd 被允许，span 包 dt/dd 被拒绝，验证描述项的允许父级白名单，且 dl 可以有 div 分组。
     */
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
