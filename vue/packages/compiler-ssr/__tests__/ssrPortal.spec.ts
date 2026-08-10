/**
 * SSR Teleport 场景：生成 `ssrRenderTeleport` 的内容函数、目标和 disabled 参数，并诊断缺少
 * `to`；内容必须进入独立缓冲，不能与父级 `_push` 字符串错误合并。
 */
import { compile } from '../src'

describe('ssr compile: teleport', () => {
  test('should work', () => {
    expect(compile(`<teleport :to="target"><div/></teleport>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderTeleport: _ssrRenderTeleport } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderTeleport(_push, (_push) => {
            _push(\`<div></div>\`)
          }, _ctx.target, false, _parent)
        }"
      `)
  })

  test('disabled prop handling', () => {
    expect(compile(`<teleport :to="target" disabled><div/></teleport>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderTeleport: _ssrRenderTeleport } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderTeleport(_push, (_push) => {
            _push(\`<div></div>\`)
          }, _ctx.target, true, _parent)
        }"
      `)

    expect(
      compile(`<teleport :to="target" :disabled="foo"><div/></teleport>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderTeleport: _ssrRenderTeleport } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderTeleport(_push, (_push) => {
          _push(\`<div></div>\`)
        }, _ctx.target, _ctx.foo, _parent)
      }"
    `)
  })
})
