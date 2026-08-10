/**
 * SSR TransitionGroup 场景：无 tag 时透明输出 children，有静态/动态 tag 时生成外层标签并
 * 合并 attrs/scopeId；回归用例覆盖 slot scope 与属性表达式不能丢失。
 */
import { compile } from '../src'

// TransitionGroup 应把 children 的多个 Fragment 展平并拼成一个边界，避免嵌套 hydration 标记。
describe('transition-group', () => {
  test('basic', () => {
    expect(
      compile(`<transition-group><div v-for="i in list"/></transition-group>`)
        .code,
    ).toMatchInlineSnapshot(`
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

  test('with static tag', () => {
    expect(
      compile(
        `<transition-group tag="ul"><div v-for="i in list"/></transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<ul\${_ssrRenderAttrs(_attrs)}>\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        _push(\`</ul>\`)
      }"
    `)
  })

  // #11514：静态 tag 内的 v-if 注释占位要保留在外壳内，不能打断开始/结束标签缓冲。
  test('with static tag + v-if comment', () => {
    expect(
      compile(
        `<transition-group tag="ul"><div v-for="i in list"/><div v-if="false"></div></transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<ul\${_ssrRenderAttrs(_attrs)}>\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        if (false) {
          _push(\`<div></div>\`)
        }
        _push(\`</ul>\`)
      }"
    `)
  })

  // #11958：普通注释同样属于 TransitionGroup 静态 tag 的 children，输出顺序必须稳定。
  test('with static tag + comment', () => {
    expect(
      compile(
        `<transition-group tag="ul"><div v-for="i in list"/><!--test--></transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<ul\${_ssrRenderAttrs(_attrs)}>\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        _push(\`</ul>\`)
      }"
    `)
  })

  test('with dynamic tag', () => {
    expect(
      compile(
        `<transition-group :tag="someTag"><div v-for="i in list"/></transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<\${
          _ctx.someTag
        }\${
          _ssrRenderAttrs(_attrs)
        }>\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        _push(\`</\${_ctx.someTag}>\`)
      }"
    `)
  })

  test('with dynamic tag shorthand', () => {
    expect(
      compile(
        `<transition-group :tag><div v-for="i in list"/></transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<\${
          _ctx.tag
        }\${
          _ssrRenderAttrs(_attrs)
        }>\`)
        _ssrRenderList(_ctx.list, (i) => {
          _push(\`<div></div>\`)
        })
        _push(\`</\${_ctx.tag}>\`)
      }"
    `)
  })

  test('with multi fragments children', () => {
    expect(
      compile(
        `<transition-group>
              <div v-for="i in 10"/>
              <div v-for="i in 10"/>
              <template v-if="ok"><div>ok</div></template>
            </transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<!--[-->\`)
        _ssrRenderList(10, (i) => {
          _push(\`<div></div>\`)
        })
        _ssrRenderList(10, (i) => {
          _push(\`<div></div>\`)
        })
        if (_ctx.ok) {
          _push(\`<div>ok</div>\`)
        }
        _push(\`<!--]-->\`)
      }"
    `)
  })

  test('attribute fallthrough', () => {
    expect(
      compile(
        `<transition-group tag="ul" class="red" id="ok">
        </transition-group>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<ul\${_ssrRenderAttrs(_mergeProps({
          class: "red",
          id: "ok"
        }, _attrs))}></ul>\`)
      }"
    `)
  })
})
