/**
 * SSR `<slot>` 出口场景：覆盖名称、props、fallback、scopeId 转发，以及
 * Transition/TransitionGroup 中使用 ssrRenderSlotInner 的普通或 v-if slot 出口。
 */
import { compile } from '../src'
import { SSR_RENDER_SLOT_INNER, ssrHelpers } from '../src/runtimeHelpers'

describe('ssr: <slot>', () => {
  /**
   * 场景：无名称/内容的 slot 出口，快照断言默认名、空 props、null fallback 与 push/parent 参数，验证 ssrRenderSlot 的基础调用协议。
   */
  test('basic', () => {
    expect(compile(`<slot/>`).code).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent)
      }"
    `)
  })

  /**
   * 场景：slot name=foo，快照断言第二参数为静态 foo 而非普通 props，验证名称单独消费。
   */
  test('with name', () => {
    expect(compile(`<slot name="foo" />`).code).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlot(_ctx.$slots, "foo", {}, null, _push, _parent)
      }"
    `)
  })

  /**
   * 场景：slot :name=bar.baz，快照断言第二参数是前缀化成员表达式，验证动态插槽选择不写死名称。
   */
  test('with dynamic name', () => {
    expect(compile(`<slot :name="bar.baz" />`).code).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlot(_ctx.$slots, _ctx.bar.baz, {}, null, _push, _parent)
      }"
    `)
  })

  /**
   * 场景：具名 slot 同时传 :p=1 与 bar=2，快照断言 props 保留数字表达式与静态字符串差异，验证出口属性打包。
   */
  test('with props', () => {
    expect(compile(`<slot name="foo" :p="1" bar="2" />`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderSlot(_ctx.$slots, "foo", {
            p: 1,
            bar: "2"
          }, null, _push, _parent)
        }"
      `)
  })

  /**
   * 场景：slot fallback 含文本和插值，快照断言第四参数为使用 ssrInterpolate 的 SSR 函数，验证第二遍补齐 fallback 的独立函数体。
   */
  test('with fallback', () => {
    expect(compile(`<slot>some {{ fallback }} content</slot>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderSlot: _ssrRenderSlot, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderSlot(_ctx.$slots, "default", {}, () => {
            _push(\`some \${_ssrInterpolate(_ctx.fallback)} content\`)
          }, _push, _parent)
        }"
      `)
  })

  /**
   * 场景：slot 出口指定 scopeId=hello，快照断言第七参数为 hello-s，验证默认 slotted 开关添加消费方作用域后缀；async 回调中仍只做同步编译。
   */
  test('with scopeId', async () => {
    expect(
      compile(`<slot/>`, {
        scopeId: 'hello',
      }).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent, "hello-s")
      }"
    `)
  })

  /**
   * 场景：相同 scopeId 配合 slotted=false，快照断言不传第七作用域参数，验证显式关闭 slotted 的分支。
   */
  test('with scopeId + slotted:false', async () => {
    expect(
      compile(`<slot/>`, {
        scopeId: 'hello',
        slotted: false,
      }).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent)
      }"
    `)
  })

  /**
   * 场景：Comp 的默认插槽转发 slot 且有 scopeId=hello，快照断言 hello-s 与外层 _scopeId 拼接，并保留普通 renderSlot fallback，验证两层作用域共存。
   */
  test('with forwarded scopeId', async () => {
    expect(
      compile(`<Comp><slot/></Comp>`, {
        scopeId: 'hello',
      }).code,
    ).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent, withCtx: _withCtx, renderSlot: _renderSlot } = require("vue")
      const { ssrRenderSlot: _ssrRenderSlot, ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_Comp = _resolveComponent("Comp")

        _push(_ssrRenderComponent(_component_Comp, _attrs, {
          default: _withCtx((_, _push, _parent, _scopeId) => {
            if (_push) {
              _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent, "hello-s" + _scopeId)
            } else {
              return [
                _renderSlot(_ctx.$slots, "default")
              ]
            }
          }),
          _: 3 /* FORWARDED */
        }, _parent))
      }"
    `)
  })

  /**
   * 场景：Transition 唯一子节点为 slot，断言调用 SSR_RENDER_SLOT_INNER，并用 null 占第七参后追加 true，验证禁用 Fragment 参数位置。
   */
  test('inside transition', () => {
    const { code } = compile(`<transition><slot/></transition>`)
    expect(code).toMatch(ssrHelpers[SSR_RENDER_SLOT_INNER])
    expect(code).toMatchInlineSnapshot(`
      "const { ssrRenderSlotInner: _ssrRenderSlotInner } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _ssrRenderSlotInner(_ctx.$slots, "default", {}, null, _push, _parent, null, true)
      }"
    `)
  })

  /**
   * 场景：有 div tag 的 TransitionGroup 唯一子节点为 slot，断言内层 slot helper 与外壳输出顺序，验证出口 Fragment 展平而外壳保留。
   */
  test('inside transition-group', () => {
    const { code } = compile(
      `<TransitionGroup tag="div"><slot/></TransitionGroup>`,
    )
    expect(code).toMatch(ssrHelpers[SSR_RENDER_SLOT_INNER])
    expect(code).toMatchInlineSnapshot(`
      "const { ssrRenderSlotInner: _ssrRenderSlotInner, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}>\`)
        _ssrRenderSlotInner(_ctx.$slots, "default", {}, null, _push, _parent, null, true)
        _push(\`</div>\`)
      }"
    `)
  })

  /**
   * 场景：Transition 内 slot 带 v-if=true，断言仍选内层 helper、if/else 占位快照正确，验证转换器穿过 IfBranch 识别祖父过渡组件。
   */
  test('with v-if inside transition', () => {
    const { code } = compile(`<transition><slot v-if="true"/></transition>`)
    expect(code).toMatch(ssrHelpers[SSR_RENDER_SLOT_INNER])
    expect(code).toMatchInlineSnapshot(`
      "const { ssrRenderSlotInner: _ssrRenderSlotInner } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        if (true) {
          _ssrRenderSlotInner(_ctx.$slots, "default", {}, null, _push, _parent, null, true)
        } else {
          _push(\`<!---->\`)
        }
      }"
    `)
  })
})
