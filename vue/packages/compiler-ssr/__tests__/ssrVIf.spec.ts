/**
 * SSR `v-if` 场景：生成 if/else 控制流而非客户端三元 VNode，验证无 else 时的注释占位、
 * 多根分支 Fragment 边界和 else-if 链输出顺序。
 */
import { compile } from '../src'

describe('ssr: v-if', () => {
  test('basic', () => {
    expect(compile(`<div v-if="foo"></div>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (_ctx.foo) {
          _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
        } else {
          _push(\`<!---->\`)
        }
      }"
    `)
  })

  test('with nested content', () => {
    expect(compile(`<div v-if="foo">hello<span>ok</span></div>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.foo) {
            _push(\`<div\${_ssrRenderAttrs(_attrs)}>hello<span>ok</span></div>\`)
          } else {
            _push(\`<!---->\`)
          }
        }"
      `)
  })

  test('v-if + v-else', () => {
    expect(compile(`<div v-if="foo"/><span v-else/>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.foo) {
            _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
          } else {
            _push(\`<span\${_ssrRenderAttrs(_attrs)}></span>\`)
          }
        }"
      `)
  })

  test('v-if + v-else-if', () => {
    expect(compile(`<div v-if="foo"/><span v-else-if="bar"/>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.foo) {
            _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
          } else if (_ctx.bar) {
            _push(\`<span\${_ssrRenderAttrs(_attrs)}></span>\`)
          } else {
            _push(\`<!---->\`)
          }
        }"
      `)
  })

  test('v-if + v-else-if + v-else', () => {
    expect(compile(`<div v-if="foo"/><span v-else-if="bar"/><p v-else/>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.foo) {
            _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
          } else if (_ctx.bar) {
            _push(\`<span\${_ssrRenderAttrs(_attrs)}></span>\`)
          } else {
            _push(\`<p\${_ssrRenderAttrs(_attrs)}></p>\`)
          }
        }"
      `)
  })

  test('<template v-if> (text)', () => {
    expect(compile(`<template v-if="foo">hello</template>`).code)
      .toMatchInlineSnapshot(`
      "
      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (_ctx.foo) {
          _push(\`<!--[-->hello<!--]-->\`)
        } else {
          _push(\`<!---->\`)
        }
      }"
    `)
  })

  test('<template v-if> (single element)', () => {
    // 单元素分支无需额外 Fragment hydration 边界。
    expect(compile(`<template v-if="foo"><div>hi</div></template>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          if (_ctx.foo) {
            _push(\`<div\${_ssrRenderAttrs(_attrs)}>hi</div>\`)
          } else {
            _push(\`<!---->\`)
          }
        }"
      `)
  })

  test('<template v-if> (multiple element)', () => {
    expect(
      compile(`<template v-if="foo"><div>hi</div><div>ho</div></template>`)
        .code,
    ).toMatchInlineSnapshot(`
      "
      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (_ctx.foo) {
          _push(\`<!--[--><div>hi</div><div>ho</div><!--]-->\`)
        } else {
          _push(\`<!---->\`)
        }
      }"
    `)
  })

  test('<template v-if> (with v-for inside)', () => {
    expect(
      compile(`<template v-if="foo"><div v-for="i in list"/></template>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (_ctx.foo) {
          _push(\`<!--[-->\`)
          _ssrRenderList(_ctx.list, (i) => {
            _push(\`<div></div>\`)
          })
          _push(\`<!--]-->\`)
        } else {
          _push(\`<!---->\`)
        }
      }"
    `)
  })

  test('<template v-if> + normal v-else', () => {
    expect(
      compile(
        `<template v-if="foo"><div>hi</div><div>ho</div></template><div v-else/>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (_ctx.foo) {
          _push(\`<!--[--><div>hi</div><div>ho</div><!--]-->\`)
        } else {
          _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
        }
      }"
    `)
  })
})
