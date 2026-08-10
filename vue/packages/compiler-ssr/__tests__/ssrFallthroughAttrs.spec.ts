/**
 * SSR attrs 透传场景：在单根元素、组件和结构指令根上注入 `_attrs`，多根/文本根不误注入；
 * 同时验证 v-bind 合并顺序与已有动态属性不会丢失。
 */
import { compile } from '../src'

describe('ssr: attrs fallthrough', () => {
  test('basic', () => {
    expect(compile(`<div/>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
      }"
    `)
  })

  test('with comments', () => {
    expect(compile(`<!--!--><div/>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[--><!--!--><div\${_ssrRenderAttrs(_attrs)}></div><!--]-->\`)
      }"
    `)
  })

  // #5140：任一 v-if 分支不是单根时都不能向条件结构注入 `_attrs`，否则分支间透传语义不一致。
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
