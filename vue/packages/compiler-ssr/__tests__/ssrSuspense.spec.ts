/**
 * SSR Suspense 场景：把 default/fallback 插槽编译为 `ssrRenderSuspense` 可调用函数，确保插槽
 * children 在第二遍转换中进入各自 body，而不是落入父级输出缓冲。
 */
import { compile } from '../src'

describe('ssr compile: suspense', () => {
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
