/**
 * SSR Transition 场景：未声明 appear 时直接输出 children，声明 appear 时用 template 包装。
 * 这里比较两种编译产物；SSR 默认管线不执行 DOM 编译器的 Transition 多 children 校验。
 */
import { compile } from '../src'

describe('transition', () => {
  /**
   * 场景：无 appear 的 Transition 包唯一 div 根，快照只输出 div 及 _attrs，验证过渡组件在 SSR 中透明。
   */
  test('basic', () => {
    expect(compile(`<transition><div>foo</div></transition>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${_ssrRenderAttrs(_attrs)}>foo</div>\`)
        }"
      `)
  })

  /**
   * 场景：同一 Transition 声明 appear，快照在 div 外添加 template，验证编译器根据属性存在生成水合包装。
   */
  test('with appear', () => {
    expect(compile(`<transition appear><div>foo</div></transition>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<template><div\${_ssrRenderAttrs(_attrs)}>foo</div></template>\`)
        }"
      `)
  })
})
