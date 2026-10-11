/**
 * SSR TransitionGroup 场景：覆盖无 tag、静态/动态 tag、Fragment 展平、注释过滤与 attrs 透传。
 * 无 tag 时以 Fragment 包围展平的 children，有 tag 时生成外层元素。
 */
import { compile } from '../src'

// TransitionGroup 应把 children 的多个 Fragment 展平并拼成一个边界，避免嵌套 hydration 标记。
describe('transition-group', () => {
  /**
   * 场景：无 tag 的 TransitionGroup 直接包循环 div，快照只有最外层一对 Fragment、循环无独立边界，验证列表展平。
   */
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

  /**
   * 场景：静态 tag=ul 包循环 div，快照以 ul 开闭标签和 _attrs 包围列表，验证有外壳时不再输出根 Fragment。
   */
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

  // #11514：有静态 tag 时，false 的 v-if 不输出空注释占位；输出仍以该 tag 的结束标签收尾。
  /**
   * 场景：静态 ul 外壳内有循环与 v-if=false，快照保留 if 语句但无 else 空注释，验证条件占位过滤与正确结束标签。
   */
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

  // #11958：有静态 tag 时同样过滤模板普通注释，与运行时 TransitionGroup 的 children 保持一致。
  /**
   * 场景：静态 ul 外壳内有循环及普通注释，快照不含注释，验证 TransitionGroup 的模板注释过滤也适用于有 tag 的路径。
   */
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

  /**
   * 场景：动态 :tag=someTag 包循环，快照开闭标签都使用 _ctx.someTag，中间列表无重复 Fragment，验证动态外壳的分段输出。
   */
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

  /**
   * 场景：动态 :tag 简写包循环，快照使用 _ctx.tag 开闭标签，验证 shorthand 先补齐表达式后进入动态外壳路径。
   */
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

  /**
   * 场景：无 tag 外壳包两个循环与一个 template v-if，快照用一个 Fragment 围住三个控制流、条件无 else 占位，验证同层多个子 Fragment 展平。
   */
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

  /**
   * 场景：唯一 TransitionGroup 根有 ul tag、class 与 id，快照断言 mergeProps(显式属性,_attrs) 后序列化到 ul，验证透传作用于真实外壳。
   */
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
