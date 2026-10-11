/**
 * SSR Teleport 场景：覆盖内容函数、动态目标和静态/动态 disabled 参数的代码生成。
 * 内容函数接收 helper 选择的 `_push`，可写入当前位置或目标缓冲。
 */
import { compile } from '../src'

describe('ssr compile: teleport', () => {
  /**
   * 场景：Teleport 动态 :to=target 包 div，快照断言内容函数有独立 _push 参数、target 前缀及 disabled=false，验证目标缓冲由运行时 helper 选择。
   */
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

  /**
   * 场景：分别输入静态 disabled 与动态 :disabled=foo，快照断言第四参数为 true 与 _ctx.foo，验证属性存在型和表达式型分别传递。
   */
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
