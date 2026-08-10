/**
 * SSR scopeId 场景：给元素、组件、slot 与 slotted 内容追加正确的作用域属性，覆盖嵌套插槽
 * 和 fallthrough，防止 scopeId 重复、遗漏或传播到不属于当前组件的内容。
 */
import { compile } from '../src'

/** 测试统一使用的组件作用域属性，便于快照直接比较传播位置。 */
const scopeId = 'data-v-xxxxxxx'

describe('ssr: scopeId', () => {
  test('basic', () => {
    expect(
      compile(`<div><span>hello</span></div>`, {
        scopeId,
        mode: 'module',
      }).code,
    ).toMatchInlineSnapshot(`
      "import { ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)} data-v-xxxxxxx><span data-v-xxxxxxx>hello</span></div>\`)
      }"
    `)
  })

  test('inside slots (only text)', () => {
    // 插槽函数内部不应因 scopeId 注入产生额外条件分支。
    expect(
      compile(`<foo>foo</foo>`, {
        scopeId,
        mode: 'module',
      }).code,
    ).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent, withCtx as _withCtx, createTextVNode as _createTextVNode } from "vue"
      import { ssrRenderComponent as _ssrRenderComponent } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _push(_ssrRenderComponent(_component_foo, _attrs, {
          default: _withCtx((_, _push, _parent, _scopeId) => {
            if (_push) {
              _push(\`foo\`)
            } else {
              return [
                _createTextVNode("foo")
              ]
            }
          }),
          _: 1 /* STABLE */
        }, _parent))
      }"
    `)
  })

  test('inside slots (with elements)', () => {
    expect(
      compile(`<foo><span>hello</span></foo>`, {
        scopeId,
        mode: 'module',
      }).code,
    ).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent, withCtx as _withCtx, createVNode as _createVNode } from "vue"
      import { ssrRenderComponent as _ssrRenderComponent } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _push(_ssrRenderComponent(_component_foo, _attrs, {
          default: _withCtx((_, _push, _parent, _scopeId) => {
            if (_push) {
              _push(\`<span data-v-xxxxxxx\${_scopeId}>hello</span>\`)
            } else {
              return [
                _createVNode("span", null, "hello")
              ]
            }
          }),
          _: 1 /* STABLE */
        }, _parent))
      }"
    `)
  })

  test('nested slots', () => {
    expect(
      compile(`<foo><span>hello</span><bar><span/></bar></foo>`, {
        scopeId,
        mode: 'module',
      }).code,
    ).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent, withCtx as _withCtx, createVNode as _createVNode } from "vue"
      import { ssrRenderComponent as _ssrRenderComponent } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")
        const _component_bar = _resolveComponent("bar")

        _push(_ssrRenderComponent(_component_foo, _attrs, {
          default: _withCtx((_, _push, _parent, _scopeId) => {
            if (_push) {
              _push(\`<span data-v-xxxxxxx\${_scopeId}>hello</span>\`)
              _push(_ssrRenderComponent(_component_bar, null, {
                default: _withCtx((_, _push, _parent, _scopeId) => {
                  if (_push) {
                    _push(\`<span data-v-xxxxxxx\${_scopeId}></span>\`)
                  } else {
                    return [
                      _createVNode("span")
                    ]
                  }
                }),
                _: 1 /* STABLE */
              }, _parent, _scopeId))
            } else {
              return [
                _createVNode("span", null, "hello"),
                _createVNode(_component_bar, null, {
                  default: _withCtx(() => [
                    _createVNode("span")
                  ]),
                  _: 1 /* STABLE */
                })
              ]
            }
          }),
          _: 1 /* STABLE */
        }, _parent))
      }"
    `)
  })

  // #7554：带 tag 的 TransitionGroup 外壳也必须接收当前 SFC scopeId，不能只给内部 children。
  test('scopeId is correctly transform to scope attribute of transition-group ', () => {
    expect(
      compile(
        `<transition-group tag="div" class="red"><span>hello</span></transition-group>`,
        {
          scopeId,
          mode: 'module',
        },
      ).code,
    ).toMatchInlineSnapshot(`
      "import { mergeProps as _mergeProps } from "vue"
      import { ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_mergeProps({ class: "red" }, _attrs))} data-v-xxxxxxx><span data-v-xxxxxxx>hello</span></div>\`)
      }"
    `)

    // 动态外层 tag 同样要追加 scopeId。
    expect(
      compile(
        `<transition-group :tag="someTag" class="red"><span>hello</span></transition-group>`,
        {
          scopeId,
          mode: 'module',
        },
      ).code,
    ).toMatchInlineSnapshot(`
      "import { mergeProps as _mergeProps } from "vue"
      import { ssrRenderAttrs as _ssrRenderAttrs } from "vue/server-renderer"

      export function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<\${
          _ctx.someTag
        }\${
          _ssrRenderAttrs(_mergeProps({ class: "red" }, _attrs))
        } data-v-xxxxxxx><span data-v-xxxxxxx>hello</span></\${
          _ctx.someTag
        }>\`)
      }"
    `)
  })
})
