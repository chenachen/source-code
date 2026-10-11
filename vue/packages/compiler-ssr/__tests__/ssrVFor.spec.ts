/**
 * SSR `v-for` 场景：生成 `ssrRenderList` 迭代函数，声明 value/key/index，并为整个列表及
 * 需要包装的单项添加 Fragment 边界，覆盖 template、嵌套循环与局部变量前缀。
 */
import { compile } from '../src'

describe('ssr: v-for', () => {
  /**
   * 场景：根 div v-for=i in list，快照断言列表整体 Fragment 和 ssrRenderList(_ctx.list,(i)=>...)，验证别名参数与列表输出协议。
   */
  test('basic', () => {
    expect(compile(`<div v-for="i in list" />`).code).toMatchInlineSnapshot(`
      "const { ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        _push(\`<!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：循环 div 含静态文本及 span，快照断言每项内保持完整 div 内容、外层仍只有列表边界，验证普通嵌套子元素不增加单项 Fragment。
   */
  test('nested content', () => {
    expect(compile(`<div v-for="i in list">foo<span>bar</span></div>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<!--[-->\`)
          _ssrRenderList(_ctx.list, (i) => {
            _push(\`<div>foo<span>bar</span></div>\`)
          })
          _push(\`<!--]-->\`)
        }"
      `)
  })

  /**
   * 场景：外层遍历 list 得 row/i、内层遍历 row 得 j，快照断言内层使用局部 row/i/j 且自身保留 Fragment，验证嵌套作用域与边界独立。
   */
  test('nested v-for', () => {
    expect(
      compile(
        `<div v-for="row, i in list">` +
          `<div v-for="j in row">{{ i }},{{ j }}</div>` +
          `</div>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(_ctx.list, (row, i) => {
          _push(\`<div><!--[-->\`)
          _ssrRenderList(row, (j) => {
            _push(\`<div>\${
              _ssrInterpolate(i)
            },\${
              _ssrInterpolate(j)
            }</div>\`)
          })
          _push(\`<!--]--></div>\`)
        })
        _push(\`<!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：template v-for 每项只有插值文本，快照在整体列表和每个文本单项都添加 Fragment，验证非元素单项的认领范围。
   */
  test('template v-for (text)', () => {
    expect(compile(`<template v-for="i in list">{{ i }}</template>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<!--[-->\`)
          _ssrRenderList(_ctx.list, (i) => {
            _push(\`<!--[-->\${_ssrInterpolate(i)}<!--]-->\`)
          })
          _push(\`<!--]-->\`)
        }"
      `)
  })

  /**
   * 场景：template v-for 每项只有一个 span 插值，快照仅有整体列表边界，验证单元素单项无需额外包装。
   */
  test('template v-for (single element)', () => {
    expect(
      compile(`<template v-for="i in list"><span>{{ i }}</span></template>`)
        .code,
    ).toMatchInlineSnapshot(`
      "const { ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<span>\${_ssrInterpolate(i)}</span>\`)
        })
        _push(\`<!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：template v-for 每项有两个 span，快照在每项外补 Fragment，验证多根单项与整体列表的双层边界。
   */
  test('template v-for (multi element)', () => {
    expect(
      compile(
        `<template v-for="i in list"><span>{{ i }}</span><span>{{ i + 1 }}</span></template>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<!--[--><span>\${
            _ssrInterpolate(i)
          }</span><span>\${
            _ssrInterpolate(i + 1)
          }</span><!--]-->\`)
        })
        _push(\`<!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：循环参数解构出 foo 并绑定 index，表达式还引用外部 bar，断言只有 bar 变成 _ctx.bar 并核对快照，验证别名登记和标识符前缀化。
   */
  test('render loop args should not be prefixed', () => {
    const { code } = compile(
      `<div v-for="{ foo }, index in list">{{ foo + bar + index }}</div>`,
    )
    expect(code).toMatch(`_ctx.bar`)
    expect(code).not.toMatch(`_ctx.foo`)
    expect(code).not.toMatch(`_ctx.index`)
    expect(code).toMatchInlineSnapshot(`
      "const { ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(_ctx.list, ({ foo }, index) => {
          _push(\`<div>\${_ssrInterpolate(foo + _ctx.bar + index)}</div>\`)
        })
        _push(\`<!--]-->\`)
      }"
    `)
  })
})
