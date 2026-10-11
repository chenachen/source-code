/**
 * SSR Suspense 场景：把 default/fallback 插槽编译为 `ssrRenderSuspense` 可调用函数，确保插槽
 * children 在第二遍转换中进入各自 body，而不是落入父级输出缓冲。
 */
import { compile } from '../src'

describe('ssr compile: suspense', () => {
  /**
   * 场景：Suspense 直接包 foo 形成隐式 default，快照断言 default 函数内调用 ssrRenderComponent、父级调用 ssrRenderSuspense，验证两遍 slot 组装。
   */
  test('implicit default', () => {
    expect(compile(`<suspense><foo/></suspense>`).code).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent, withCtx: _withCtx } = require("vue")
      const { ssrRenderComponent: _ssrRenderComponent, ssrRenderSuspense: _ssrRenderSuspense } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _ssrRenderSuspense(_push, {
          default: () => {
            _push(_ssrRenderComponent(_component_foo, null, null, _parent))
          },
          _: 1 /* STABLE */
        })
      }"
    `)
  })

  /**
   * 场景：Suspense 显式 default 包组件、fallback 含 loading 文本，快照断言两函数体分开且 STABLE slots 交给 helper，验证插槽函数和 helper 调用的生成。
   */
  test('explicit slots', () => {
    expect(
      compile(`<suspense>
      <template #default>
        <foo/>
      </template>
      <template #fallback>
        loading...
      </template>
    </suspense>`).code,
    ).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent, withCtx: _withCtx } = require("vue")
      const { ssrRenderComponent: _ssrRenderComponent, ssrRenderSuspense: _ssrRenderSuspense } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _ssrRenderSuspense(_push, {
          default: () => {
            _push(_ssrRenderComponent(_component_foo, null, null, _parent))
          },
          fallback: () => {
            _push(\` loading... \`)
          },
          _: 1 /* STABLE */
        })
      }"
    `)
  })
})
