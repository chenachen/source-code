/**
 * SSR 文本场景：覆盖静态文本、模板字面量字符转义、注释、插值与元素中的混合文本输出。
 */
import { compile } from '../src'
import { getCompiledString } from './utils'

describe('ssr: text', () => {
  /**
   * 场景：普通静态 foo 经父 div 包装编译后抽取内容，快照断言一段模板字面量，验证静态文本不需要插值 helper。
   */
  test('static text', () => {
    expect(getCompiledString(`foo`)).toMatchInlineSnapshot(`"\`foo\`"`)
  })

  /**
   * 场景：静态文本含反引号与字面量 ${foo}，断言生成字面量的转义序列，验证它们不被生成代码误当模板插值。
   */
  test('static text with template string special chars', () => {
    expect(getCompiledString(`\`\${foo}\``)).toMatchInlineSnapshot(
      `"\`\\\`\\\${foo}\\\`\`"`,
    )
  })

  /**
   * 场景：静态文本含反斜杠加 $foo，断言代码与快照中的多层转义，验证反斜杠原字符不会在 render 模板字面量中丢失。
   */
  test('static text with char escape', () => {
    // 目标生成代码是 `\\\$foo`；从快照转成 inline snapshot 会再经历两轮转义，
    // 因此最终文本中共有 3 × 2 × 2 = 12 个反斜杠。
    expect(getCompiledString(`\\$foo`)).toMatchInlineSnapshot(
      `"\`\\\\\\$foo\`"`,
    )
  })

  /**
   * 场景：输入合法 HTML 注释，抽取快照断言原注释标记，验证 COMMENT 节点按 HTML 注释输出。
   */
  test('comments', () => {
    expect(getCompiledString(`<!--bar-->`)).toMatchInlineSnapshot(
      `"\`<!--bar-->\`"`,
    )
  })

  /**
   * 场景：文本输入 &lt;foo&gt;，快照仍是转义 HTML，验证 parser 解码后 SSR 文本输出再次 escape。
   */
  test('static text escape', () => {
    expect(getCompiledString(`&lt;foo&gt;`)).toMatchInlineSnapshot(
      `"\`&lt;foo&gt;\`"`,
    )
  })

  /**
   * 场景：div 下两个 span 各有静态文本，快照断言整段标签/文本并入一个字面量，验证嵌套静态片段保持模板顺序。
   */
  test('nested elements with static text', () => {
    expect(
      getCompiledString(`<div><span>hello</span><span>bye</span></div>`),
    ).toMatchInlineSnapshot(
      `"\`<div><span>hello</span><span>bye</span></div>\`"`,
    )
  })

  /**
   * 场景：静态 foo/baz 之间插值 bar，完整代码快照断言一次 _push 中嵌入 ssrInterpolate(_ctx.bar)，验证表达式转义与连续字符串缓冲。
   */
  test('interpolation', () => {
    expect(compile(`foo {{ bar }} baz`).code).toMatchInlineSnapshot(`
      "const { ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`foo \${_ssrInterpolate(_ctx.bar)} baz\`)
      }"
    `)
  })

  /**
   * 场景：两个 span 的插值分别在文本前后，快照断言同一 _push 保留两处 ssrInterpolate 和根 _attrs，验证跨元素连续片段合并不改变顺序。
   */
  test('nested elements with interpolation', () => {
    expect(
      compile(`<div><span>{{ foo }} bar</span><span>baz {{ qux }}</span></div>`)
        .code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><span>\${
          _ssrInterpolate(_ctx.foo)
        } bar</span><span>baz \${
          _ssrInterpolate(_ctx.qux)
        }</span></div>\`)
      }"
    `)
  })
})
