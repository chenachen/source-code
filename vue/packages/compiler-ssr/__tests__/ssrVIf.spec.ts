/**
 * SSR `v-if` 场景：生成 if/else 控制流而非客户端三元 VNode，验证无 else 时的注释占位、
 * 多根分支 Fragment 边界和 else-if 链输出顺序。
 */
import { compile } from '../src'

describe('ssr: v-if', () => {
  /**
   * 场景：唯一 div v-if=foo 没有 else，快照断言 if 分支输出 div 与 _attrs、else 输出空注释，验证假分支水合占位。
   */
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

  /**
   * 场景：条件 div 内还有文本及 span，快照断言完整子树保留在真分支、假分支仍为空注释，验证控制流隔离输出缓冲。
   */
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

  /**
   * 场景：div if=foo 后接 span else，快照断言两个实体分支各接 _attrs，验证条件链归并及唯一有效根透传。
   */
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

  /**
   * 场景：if=foo 与 else-if=bar 没有最终 else，快照断言嵌套 else-if 之后再补空注释，验证最后条件不成立时仍有占位。
   */
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

  /**
   * 场景：if/else-if/else 三个不同元素，快照断言条件顺序与最终实体 else，验证已有兜底分支时不额外生成空注释。
   */
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

  /**
   * 场景：template v-if 只有 hello 文本，快照断言真分支由 Fragment 包住文本、假分支为空注释，验证非元素根的边界。
   */
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

  /**
   * 场景：template v-if 只有 div，快照真分支直接输出 div 并接 _attrs，验证单元素无需额外 Fragment。
   */
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

  /**
   * 场景：template v-if 有两个 div，快照真分支有 Fragment 而元素不接 _attrs，验证多根分支边界及透传限制。
   */
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

  /**
   * 场景：template v-if 唯一子节点是 div v-for，快照真分支只使用循环自身的列表 Fragment，验证 IfNode 不再重复包裹 ForNode。
   */
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

  /**
   * 场景：template if 的双 div 与普通 div else 组成条件链，快照断言前支有 Fragment、后支接 _attrs，验证每支按各自根形状输出。
   */
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
