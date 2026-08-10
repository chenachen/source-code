/**
 * SSR Transition 场景：服务端不渲染组件外壳，只透明输出唯一有效 child，并与 DOM 编译器的
 * 多 children 校验协作，保证生成 HTML 不出现 Transition 占位元素。
 */
import { compile } from '../src'

describe('transition', () => {
  test('basic', () => {
    expect(compile(`<transition><div>foo</div></transition>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${_ssrRenderAttrs(_attrs)}>foo</div>\`)
        }"
      `)
  })

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
