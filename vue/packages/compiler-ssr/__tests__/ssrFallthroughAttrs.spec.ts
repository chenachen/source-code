/**
 * SSR attrs 透传场景：覆盖单根元素、根注释/空白、根 v-if 链和 Transition 内的根元素；
 * 条件链或 Transition 之外存在其他有效根时，不注入 `_attrs`。
 */
import { compile } from '../src'

describe('ssr: attrs fallthrough', () => {
  /**
   * 场景：唯一 div 根经 SSR compile，快照断言开始标签调用 ssrRenderAttrs(_attrs)，验证唯一原生根的透传注入。
   */
  test('basic', () => {
    expect(compile(`<div/>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
      }"
    `)
  })

  /**
   * 场景：根注释加唯一 div，快照断言外层 Fragment 边界与 div 的 _attrs 并存，验证有效根计数过滤注释，而输出仍保留注释。
   */
  test('with comments', () => {
    expect(compile(`<!--!--><div/>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[--><!--!--><div\${_ssrRenderAttrs(_attrs)}></div><!--]-->\`)
      }"
    `)
  })

  // #5140：根 v-if 链之外还有其他有效根时，不向该条件链注入 `_attrs`。
  // 只有模板的有效根就是这条条件链时，才分别给其中的单根分支注入；多根分支自身不注入。
  /**
   * 场景：根 v-if div 之外还有一个 div，快照断言条件和兄弟元素都不接 _attrs，验证多根模板不能把透传属性擅自分给条件链。
   */
  test('should not inject to non-single-root if branches', () => {
    expect(compile(`<div v-if="true"/><div/>`).code).toMatchInlineSnapshot(`
      "
      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        if (true) {
          _push(\`<div></div>\`)
        } else {
          _push(\`<!---->\`)
        }
        _push(\`<div></div><!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：根注释旁是仅含一个 div 的 Transition，快照断言透明组件内 div 接 _attrs，验证注释不妨碍唯一根包装器透传。
   */
  test('fallthrough component content (root with comments)', () => {
    expect(compile(`<!--root--><transition><div/></transition>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<!--[--><!--root--><div\${_ssrRenderAttrs(_attrs)}></div><!--]-->\`)
        }"
      `)
  })

  // #8072：preserve 空白下组件根周围的纯空白不能被误计为多根，attrs 仍应透传到组件。
  /**
   * 场景：whitespace=preserve 的 if/else 两个 a 分支周围有格式空白，快照断言两支分别接 _attrs，验证有效根识别仍按同一互斥条件链。
   */
  test(`fallthrough component content (with whitespace: 'preserve')`, () => {
    expect(
      compile(
        `
      <a v-if="to">Foo</a>
      <a v-else>Bar</a>
    `,
        {
          whitespace: 'preserve',
        },
      ).code,
    ).toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.to) {
            _push(\`<a\${_ssrRenderAttrs(_attrs)}>Foo</a>\`)
          } else {
            _push(\`<a\${_ssrRenderAttrs(_attrs)}>Bar</a>\`)
          }
        }"
      `)
  })

  /**
   * 场景：普通 div 与 Transition 互为根兄弟，快照断言 Transition 内 div 不接 _attrs，验证透明包装器也必须位于唯一有效根。
   */
  test('should not inject to fallthrough component content if not root', () => {
    expect(compile(`<div/><transition><div/></transition>`).code)
      .toMatchInlineSnapshot(`
              "
              return function ssrRender(_ctx, _push, _parent, _attrs) {
                _push(\`<!--[--><div></div><div></div><!--]-->\`)
              }"
          `)
  })
})
