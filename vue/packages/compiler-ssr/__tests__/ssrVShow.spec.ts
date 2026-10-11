/**
 * SSR `v-show` 场景：覆盖根节点、静态/动态 style、display 冲突和对象 v-bind 合并时的
 * display:none 输出；false 分支仍保留元素。
 */
import { compile } from '../src'

/** 用额外 div 包住被测指令，排除根 attrs 透传对快照的干扰。 */
function compileWithWrapper(src: string) {
  return compile(`<div>${src}</div>`)
}

describe('ssr: v-show', () => {
  /**
   * 场景：唯一 div 根 v-show=foo，快照把条件 style 在 _attrs 后合并，验证根透传样式不能覆盖 false 时的 display:none。
   */
  test('basic as root', () => {
    expect(compile(`<div v-show="foo"/>`).code).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_mergeProps(_attrs, {
          style: (_ctx.foo) ? null : { display: "none" }
        }))}></div>\`)
      }"
    `)
  })

  /**
   * 场景：父 div 包装非根 v-show 元素，快照直接调用 ssrRenderStyle(foo?null:display:none)，验证快速属性路径仍保留元素并只控制样式。
   */
  test('basic', () => {
    expect(compileWithWrapper(`<div v-show="foo"/>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderStyle: _ssrRenderStyle, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><div style="\${
            _ssrRenderStyle((_ctx.foo) ? null : { display: "none" })
          }"></div></div>\`)
        }"
      `)
  })

  /**
   * 场景：静态 color:red 与 v-show 同存，快照 style 数组先静态对象再条件 display，验证静态样式转换与隐藏样式合并。
   */
  test('with static style', () => {
    expect(compileWithWrapper(`<div style="color:red" v-show="foo"/>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderStyle: _ssrRenderStyle, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><div style="\${
            _ssrRenderStyle([
              {"color":"red"},
              (_ctx.foo) ? null : { display: "none" }
            ])
          }"></div></div>\`)
        }"
      `)
  })

  /**
   * 场景：动态 style 对象与 v-show 同存，快照先用户表达式后条件 display，验证隐藏样式最后覆盖而不丢用户色值。
   */
  test('with dynamic style', () => {
    expect(
      compileWithWrapper(`<div :style="{ color: 'red' }" v-show="foo"/>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderStyle: _ssrRenderStyle, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><div style="\${
          _ssrRenderStyle([
            { color: 'red' },
            (_ctx.foo) ? null : { display: "none" }
          ])
        }"></div></div>\`)
      }"
    `)
  })

  /**
   * 场景：静态 color 与动态 fontSize 同时配 v-show，快照保留三项有序 style 数组，验证全部样式来源参与一次序列化。
   */
  test('with static + dynamic style', () => {
    expect(
      compileWithWrapper(
        `<div style="color:red" :style="{ fontSize: 14 }" v-show="foo"/>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderStyle: _ssrRenderStyle, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><div style="\${
          _ssrRenderStyle([
            {"color":"red"},
            { fontSize: 14 },
            (_ctx.foo) ? null : { display: "none" }
          ])
        }"></div></div>\`)
      }"
    `)
  })

  /**
   * 场景：v-show 写在静态 display:flex 之前，快照仍把条件 display 放最后，验证转换器原位重排指令取得隐藏优先级。
   */
  test('with style + display', () => {
    expect(compileWithWrapper(`<div v-show="foo" style="display:flex" />`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderStyle: _ssrRenderStyle, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><div style="\${
            _ssrRenderStyle([
              {"display":"flex"},
              (_ctx.foo) ? null : { display: "none" }
            ])
          }"></div></div>\`)
        }"
      `)
  })

  /**
   * 场景：对象 v-bind、静态 color、动态 fontSize 与 v-show 混合，快照 mergeProps 的最后显式 style 数组含条件 display，验证完整 props 路径与快速路径保持隐藏优先级。
   */
  test('with v-bind', () => {
    expect(
      compileWithWrapper(
        `<div v-bind="baz" style="color:red" :style="{ fontSize: 14 }" v-show="foo"/>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><div\${
          _ssrRenderAttrs(_mergeProps(_ctx.baz, {
            style: [
              {"color":"red"},
              { fontSize: 14 },
              (_ctx.foo) ? null : { display: "none" }
            ]
          }))
        }></div></div>\`)
      }"
    `)
  })
})
