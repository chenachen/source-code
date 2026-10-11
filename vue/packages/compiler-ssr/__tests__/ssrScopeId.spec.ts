/**
 * SSR scopeId 场景：给元素、组件、slot 与 slotted 内容追加正确的作用域属性，覆盖嵌套插槽
 * 和 fallthrough，防止 scopeId 重复、遗漏或传播到不属于当前组件的内容。
 */
import { compile } from '../src'

/** 测试统一使用的组件作用域属性，便于快照直接比较传播位置。 */
const scopeId = 'data-v-xxxxxxx'

describe('ssr: scopeId', () => {
  /**
   * 场景：module 模式指定 data-v-xxxxxxx，div/span 两层元素快照都带该静态 scope 属性，验证本组件 scopeId 逐元素输出。
   */
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

  /**
   * 场景：作用域组件的 foo 默认插槽仅有文本，快照断言文本 SSR 分支无额外 scope 拼接、VNode fallback 仍返回文本节点，验证 scope 属性仅作用于元素。
   */
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

  /**
   * 场景：foo 插槽含 span，快照断言 SSR 开始标签同时带本组件静态 scopeId 与入参 _scopeId，验证声明方 scoped 与消费方 slotted 可叠加。
   */
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

  /**
   * 场景：foo 插槽内还嵌套 bar 插槽，快照断言 bar 调用继续传 _scopeId、两层 span 都输出作用域，验证嵌套 slot 的参数传播和 VNode fallback 作用域。
   */
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
  /**
   * 场景：带 class 的 TransitionGroup 分别使用静态 div 与动态 :tag，module 快照断言外壳和 span 都带 scopeId，验证外壳专用输出不会遗漏本组件作用域。
   */
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
