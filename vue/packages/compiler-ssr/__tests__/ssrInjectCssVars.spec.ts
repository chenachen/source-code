/**
 * SSR CSS vars 注入场景：覆盖单根、多根、组件、v-if 分支与 Suspense 内容的 CSS vars 注入，
 * 以及表达式 helper 的登记；多根的合格元素分别接收 `_cssVars`。
 */
import { BindingTypes } from '@vue/compiler-dom'
import { compile } from '../src'

describe('ssr: inject <style vars>', () => {
  /**
   * 场景：唯一 div 根指定 ssrCssVars={color}，快照断言 render 开头求得 _cssVars、与 _attrs 合并后输出，验证表达式前缀化及单根注入。
   */
  test('basic', () => {
    expect(
      compile(`<div/>`, {
        ssrCssVars: `{ color }`,
      }).code,
    ).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _cssVars = { style: { color: _ctx.color }}
        _push(\`<div\${_ssrRenderAttrs(_mergeProps(_attrs, _cssVars))}></div>\`)
      }"
    `)
  })

  /**
   * 场景：两个 div 根共享 ssrCssVars，快照断言 _cssVars 只声明一次并分别用于两个根，验证多根 CSS vars 注入与普通 attrs 透传不同。
   */
  test('fragment', () => {
    expect(
      compile(`<div/><div/>`, {
        ssrCssVars: `{ color }`,
      }).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _cssVars = { style: { color: _ctx.color }}
        _push(\`<!--[--><div\${
          _ssrRenderAttrs(_cssVars)
        }></div><div\${
          _ssrRenderAttrs(_cssVars)
        }></div><!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：div 和 foo 组件互为根，快照断言 div 输出 CSS attrs、组件调用接收同一 _cssVars props，验证元素/组件两种注入消费方式。
   */
  test('passing on to components', () => {
    expect(
      compile(`<div/><foo/>`, {
        ssrCssVars: `{ color }`,
      }).code,
    ).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        const _cssVars = { style: { color: _ctx.color }}
        _push(\`<!--[--><div\${_ssrRenderAttrs(_cssVars)}></div>\`)
        _push(_ssrRenderComponent(_component_foo, _cssVars, null, _parent))
        _push(\`<!--]-->\`)
      }"
    `)
  })

  /**
   * 场景：if 的单 div 分支与 else 的双 div 分支同存，快照断言每个合格根接 _cssVars，但仅单根分支合并 _attrs，验证 CSS vars 与 fallthrough 的不同根数条件。
   */
  test('v-if branches', () => {
    expect(
      compile(`<div v-if="ok"/><template v-else><div/><div/></template>`, {
        ssrCssVars: `{ color }`,
      }).code,
    ).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _cssVars = { style: { color: _ctx.color }}
        if (_ctx.ok) {
          _push(\`<div\${_ssrRenderAttrs(_mergeProps(_attrs, _cssVars))}></div>\`)
        } else {
          _push(\`<!--[--><div\${
            _ssrRenderAttrs(_cssVars)
          }></div><div\${
            _ssrRenderAttrs(_cssVars)
          }></div><!--]-->\`)
        }
      }"
    `)
  })

  /**
   * 场景：Suspense 有 default 与 fallback div，快照断言两插槽体都接 _cssVars，验证注入穿过 template 插槽；只验证两函数被编译，不声称 SSR 执行 fallback。
   */
  test('w/ suspense', () => {
    expect(
      compile(
        `<Suspense>
          <div>ok</div>
          <template #fallback>
            <div>fallback</div>
          </template>
        </Suspense>`,
        {
          ssrCssVars: `{ color }`,
        },
      ).code,
    ).toMatchInlineSnapshot(`
      "const { withCtx: _withCtx } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs, ssrRenderSuspense: _ssrRenderSuspense } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _cssVars = { style: { color: _ctx.color }}
        _ssrRenderSuspense(_push, {
          fallback: () => {
            _push(\`<div\${_ssrRenderAttrs(_cssVars)}>fallback</div>\`)
          },
          default: () => {
            _push(\`<div\${_ssrRenderAttrs(_cssVars)}>ok</div>\`)
          },
          _: 1 /* STABLE */
        })
      }"
    `)
  })

  /**
   * 场景：inline 模式把 dynamic 标为 SETUP_MAYBE_REF，并以它构造 CSS vars，断言代码使用 unref 且 ast.helpers 登记 mergeProps/unref，验证独立 CSS 表达式分析的 helper 回流到根。
   */
  test('inject helpers', () => {
    const result = compile(`<div/>`, {
      inline: true,
      bindingMetadata: { dynamic: BindingTypes.SETUP_MAYBE_REF },
      ssrCssVars: '{ "--hash": (dynamic) }',
    })

    expect(result.code).toMatchInlineSnapshot(`
      "(_ctx, _push, _parent, _attrs) => {
        const _cssVars = { style: { "--hash": (_unref(dynamic)) }}
        _push(\`<div\${_ssrRenderAttrs(_mergeProps(_attrs, _cssVars))}></div>\`)
      }"
    `)
    expect(result.ast.helpers).toMatchInlineSnapshot(`
      Set {
        Symbol(mergeProps),
        Symbol(unref),
      }
    `)
  })
})
