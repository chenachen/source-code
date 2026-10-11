/**
 * SSR 组件场景：验证静态/动态/内置组件解析、props、slots 双分支、attrs 透传和自定义指令，
 * 确保服务端 `_push` 路径与无 `_push` 的普通 VNode fallback 使用同一插槽语义。
 */
import { compile } from '../src'

describe('ssr: components', () => {
  /**
   * 场景：foo 根组件有静态 id 与动态 prop=b，快照断言 resolveComponent、显式 props 与 _attrs 合并后交 ssrRenderComponent，再单独 _push 子结果，验证组件输出不塞进字符串插值。
   */
  test('basic', () => {
    expect(compile(`<foo id="a" :prop="b" />`).code).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent, mergeProps: _mergeProps } = require("vue")
      const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _push(_ssrRenderComponent(_component_foo, _mergeProps({
          id: "a",
          prop: _ctx.b
        }, _attrs), null, _parent))
      }"
    `)
  })

  // 组件事件监听仍属于组件 props，SSR 不能像原生元素事件一样删除。
  /**
   * 场景：foo 组件监听 click=bar，快照仍有 onClick:_ctx.bar 并合并 _attrs，验证 SSR 保留组件事件 props，区别于原生元素监听器省略。
   */
  test('event listeners', () => {
    expect(compile(`<foo @click="bar" />`).code).toMatchInlineSnapshot(`
      "const { resolveComponent: _resolveComponent, mergeProps: _mergeProps } = require("vue")
      const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        const _component_foo = _resolveComponent("foo")

        _push(_ssrRenderComponent(_component_foo, _mergeProps({ onClick: _ctx.bar }, _attrs), null, _parent))
      }"
    `)
  })

  /**
   * 场景：component 分别用静态 is=foo 与动态 :is=foo，快照均先 resolveDynamicComponent/createVNode 再 ssrRenderVNode，验证动态解析结果可能是标签或组件，需要统一分派。
   */
  test('dynamic component', () => {
    expect(compile(`<component is="foo" prop="b" />`).code)
      .toMatchInlineSnapshot(`
        "const { resolveDynamicComponent: _resolveDynamicComponent, mergeProps: _mergeProps, createVNode: _createVNode } = require("vue")
        const { ssrRenderVNode: _ssrRenderVNode } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderVNode(_push, _createVNode(_resolveDynamicComponent("foo"), _mergeProps({ prop: "b" }, _attrs), null), _parent)
        }"
      `)

    expect(compile(`<component :is="foo" prop="b" />`).code)
      .toMatchInlineSnapshot(`
        "const { resolveDynamicComponent: _resolveDynamicComponent, mergeProps: _mergeProps, createVNode: _createVNode } = require("vue")
        const { ssrRenderVNode: _ssrRenderVNode } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _ssrRenderVNode(_push, _createVNode(_resolveDynamicComponent(_ctx.foo), _mergeProps({ prop: "b" }, _attrs), null), _parent)
        }"
      `)
  })

  // 插槽分组：每个 slot 同时包含 SSR `_push` 分支与普通 VNode fallback 分支。
  describe('slots', () => {
    /**
     * 场景：foo 的直接文本和 div 形成隐式 default，快照断言 _push 分支输出字符串、无 _push 分支返回两个 VNode，验证同一 slot 的双调用协议。
     */
    test('implicit default slot', () => {
      expect(compile(`<foo>hello<div/></foo>`).code).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, createVNode: _createVNode, createTextVNode: _createTextVNode } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")

          _push(_ssrRenderComponent(_component_foo, _attrs, {
            default: _withCtx((_, _push, _parent, _scopeId) => {
              if (_push) {
                _push(\`hello<div\${_scopeId}></div>\`)
              } else {
                return [
                  _createTextVNode("hello"),
                  _createVNode("div")
                ]
              }
            }),
            _: 1 /* STABLE */
          }, _parent))
        }"
      `)
    })

    /**
     * 场景：foo 的 v-slot 解构 msg，内容引用 msg+outer，快照两分支都仅给 outer 加 _ctx 前缀，验证 slot 参数作用域在 SSR 和克隆 VNode 子转换中一致。
     */
    test('explicit default slot', () => {
      expect(compile(`<foo v-slot="{ msg }">{{ msg + outer }}</foo>`).code)
        .toMatchInlineSnapshot(`
          "const { resolveComponent: _resolveComponent, withCtx: _withCtx, toDisplayString: _toDisplayString, createTextVNode: _createTextVNode } = require("vue")
          const { ssrRenderComponent: _ssrRenderComponent, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

          return function ssrRender(_ctx, _push, _parent, _attrs) {
            const _component_foo = _resolveComponent("foo")

            _push(_ssrRenderComponent(_component_foo, _attrs, {
              default: _withCtx(({ msg }, _push, _parent, _scopeId) => {
                if (_push) {
                  _push(\`\${_ssrInterpolate(msg + _ctx.outer)}\`)
                } else {
                  return [
                    _createTextVNode(_toDisplayString(msg + _ctx.outer), 1 /* TEXT */)
                  ]
                }
              }),
              _: 1 /* STABLE */
            }, _parent))
          }"
        `)
    })

    /**
     * 场景：foo 使用空 v-slot 属性，断言生成代码不出现 (,，验证缺省首参数以占位符补齐。
     */
    test('empty attribute should not produce syntax error', () => {
      // 修复前会生成 `default: _withCtx((, _push, ...)`，缺少首参数导致语法错误。
      expect(compile(`<foo v-slot="">foo</foo>`).code).not.toMatch(`(,`)
    })

    /**
     * 场景：foo 同时声明 template 默认槽与 named 槽，快照两个槽各有对应文本的 SSR/VNode 函数，验证两次 buildSlots 遍历按同一顺序配对。
     */
    test('named slots', () => {
      expect(
        compile(`<foo>
        <template v-slot>foo</template>
        <template v-slot:named>bar</template>
      </foo>`).code,
      ).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, createTextVNode: _createTextVNode } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
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
            named: _withCtx((_, _push, _parent, _scopeId) => {
              if (_push) {
                _push(\`bar\`)
              } else {
                return [
                  _createTextVNode("bar")
                ]
              }
            }),
            _: 1 /* STABLE */
          }, _parent))
        }"
      `)
    })

    /**
     * 场景：named template 槽带 v-if=ok，快照使用 createSlots/DYNAMIC 和条件 slot 描述，验证槽的存在性与其函数体分开生成。
     */
    test('v-if slot', () => {
      expect(
        compile(`<foo>
        <template v-slot:named v-if="ok">foo</template>
      </foo>`).code,
      ).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, createTextVNode: _createTextVNode, createSlots: _createSlots } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")

          _push(_ssrRenderComponent(_component_foo, _attrs, _createSlots({ _: 2 /* DYNAMIC */ }, [
            (_ctx.ok)
              ? {
                  name: "named",
                  fn: _withCtx((_, _push, _parent, _scopeId) => {
                    if (_push) {
                      _push(\`foo\`)
                    } else {
                      return [
                        _createTextVNode("foo")
                      ]
                    }
                  }),
                  key: "0"
                }
              : undefined
          ]), _parent))
        }"
      `)
    })

    /**
     * 场景：循环 names 得 key/index 并以 key 作动态槽名、解构 msg，断言 msg/key/index 保持局部、bar 前缀化，快照验证 renderList 生成 slot 描述及两种函数体。
     */
    test('v-for slot', () => {
      const { code } = compile(`<foo>
      <template v-for="(key, index) in names" v-slot:[key]="{ msg }">{{ msg + key + index + bar }}</template>
    </foo>`)
      expect(code).not.toMatch(`_ctx.msg`)
      expect(code).not.toMatch(`_ctx.key`)
      expect(code).not.toMatch(`_ctx.index`)
      expect(code).toMatch(`_ctx.bar`)
      expect(code).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, toDisplayString: _toDisplayString, createTextVNode: _createTextVNode, renderList: _renderList, createSlots: _createSlots } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")

          _push(_ssrRenderComponent(_component_foo, _attrs, _createSlots({ _: 2 /* DYNAMIC */ }, [
            _renderList(_ctx.names, (key, index) => {
              return {
                name: key,
                fn: _withCtx(({ msg }, _push, _parent, _scopeId) => {
                  if (_push) {
                    _push(\`\${_ssrInterpolate(msg + key + index + _ctx.bar)}\`)
                  } else {
                    return [
                      _createTextVNode(_toDisplayString(msg + key + index + _ctx.bar), 1 /* TEXT */)
                    ]
                  }
                })
              }
            })
          ]), _parent))
        }"
      `)
    })

    /**
     * 场景：foo 与 bar 两个具名槽分别把 list 或 ok 定义为局部参数，并各含 if/for，快照核对两分支的不同前缀，验证独立子转换不泄漏兄弟槽作用域。
     */
    test('nested transform scoping in vnode branch', () => {
      expect(
        compile(`<foo>
        <template v-slot:foo="{ list }">
          <div v-if="ok">
            <span v-for="i in list"></span>
          </div>
        </template>
        <template v-slot:bar="{ ok }">
          <div v-if="ok">
            <span v-for="i in list"></span>
          </div>
        </template>
      </foo>`).code,
      ).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, renderList: _renderList, Fragment: _Fragment, openBlock: _openBlock, createBlock: _createBlock, createCommentVNode: _createCommentVNode } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")

          _push(_ssrRenderComponent(_component_foo, _attrs, {
            foo: _withCtx(({ list }, _push, _parent, _scopeId) => {
              if (_push) {
                if (_ctx.ok) {
                  _push(\`<div\${_scopeId}><!--[-->\`)
                  _ssrRenderList(list, (i) => {
                    _push(\`<span\${_scopeId}></span>\`)
                  })
                  _push(\`<!--]--></div>\`)
                } else {
                  _push(\`<!---->\`)
                }
              } else {
                return [
                  (_ctx.ok)
                    ? (_openBlock(), _createBlock("div", { key: 0 }, [
                        (_openBlock(true), _createBlock(_Fragment, null, _renderList(list, (i) => {
                          return (_openBlock(), _createBlock("span"))
                        }), 256 /* UNKEYED_FRAGMENT */))
                      ]))
                    : _createCommentVNode("v-if", true)
                ]
              }
            }),
            bar: _withCtx(({ ok }, _push, _parent, _scopeId) => {
              if (_push) {
                if (ok) {
                  _push(\`<div\${_scopeId}><!--[-->\`)
                  _ssrRenderList(_ctx.list, (i) => {
                    _push(\`<span\${_scopeId}></span>\`)
                  })
                  _push(\`<!--]--></div>\`)
                } else {
                  _push(\`<!---->\`)
                }
              } else {
                return [
                  ok
                    ? (_openBlock(), _createBlock("div", { key: 0 }, [
                        (_openBlock(true), _createBlock(_Fragment, null, _renderList(_ctx.list, (i) => {
                          return (_openBlock(), _createBlock("span"))
                        }), 256 /* UNKEYED_FRAGMENT */))
                      ]))
                    : _createCommentVNode("v-if", true)
                ]
              }
            }),
            _: 1 /* STABLE */
          }, _parent))
        }"
      `)
    })

    // #7644：插槽中的 v-once 缓存是客户端概念，SSR slot 双分支生成不能出现无效缓存引用。
    /**
     * 场景：foo 槽内容 bar 带 v-once，断言代码无 _cache 并核对 SSR/VNode 双分支，验证 SSR slots 不生成需要 render cache 参数的客户端缓存协议。
     */
    test('slot content with v-once', () => {
      const { code } = compile(`<foo><bar v-once /></foo>`)
      expect(code).not.toMatch(`_cache`)
      expect(compile(`<foo><bar v-once /></foo>`).code).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, createVNode: _createVNode } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")
          const _component_bar = _resolveComponent("bar")

          _push(_ssrRenderComponent(_component_foo, _attrs, {
            default: _withCtx((_, _push, _parent, _scopeId) => {
              if (_push) {
                _push(_ssrRenderComponent(_component_bar, null, null, _parent, _scopeId))
              } else {
                return [
                  _createVNode(_component_bar)
                ]
              }
            }),
            _: 1 /* STABLE */
          }, _parent))
        }"
      `)
    })

    // #13724：插槽中的 v-memo 同样要在 SSR 字符串分支中安全降级，不能泄漏 withMemo 协议。
    /**
     * 场景：foo 槽内容 bar 带 v-memo=[]，断言代码无 _cache 并核对双分支快照，验证 SSR 编译的 memo 指令安全降级。
     */
    test('slot content with v-memo', () => {
      const { code } = compile(`<foo><bar v-memo="[]" /></foo>`)
      expect(code).not.toMatch(`_cache`)
      expect(compile(`<foo><bar v-memo="[]" /></foo>`).code)
        .toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, withCtx: _withCtx, createVNode: _createVNode } = require("vue")
        const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")
          const _component_bar = _resolveComponent("bar")

          _push(_ssrRenderComponent(_component_foo, _attrs, {
            default: _withCtx((_, _push, _parent, _scopeId) => {
              if (_push) {
                _push(_ssrRenderComponent(_component_bar, null, null, _parent, _scopeId))
              } else {
                return [
                  _createVNode(_component_bar)
                ]
              }
            }),
            _: 1 /* STABLE */
          }, _parent))
        }"
      `)
    })

    // 内置组件分派：Transition/KeepAlive 等需要透明或专用处理，而非普通组件 helper。
    describe('built-in fallthroughs', () => {
      /**
       * 场景：唯一 Transition 根包 div，快照只输出带 _attrs 的 div，验证透明内置组件不会走普通组件 helper。
       */
      test('transition', () => {
        expect(compile(`<transition><div/></transition>`).code)
          .toMatchInlineSnapshot(`
            "const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

            return function ssrRender(_ctx, _push, _parent, _attrs) {
              _push(\`<div\${_ssrRenderAttrs(_attrs)}></div>\`)
            }"
          `)
      })

      /**
       * 场景：唯一 KeepAlive 根包 foo，快照直接渲染 foo 并透传 _attrs，验证 SSR 不生成客户端 KeepAlive 缓存包装。
       */
      test('keep-alive', () => {
        expect(compile(`<keep-alive><foo/></keep-alive>`).code)
          .toMatchInlineSnapshot(`
            "const { resolveComponent: _resolveComponent } = require("vue")
            const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

            return function ssrRender(_ctx, _push, _parent, _attrs) {
              const _component_foo = _resolveComponent("foo")

              _push(_ssrRenderComponent(_component_foo, _attrs, null, _parent))
            }"
          `)
      })

      // #5352：slot 根包含透明内置组件时，先向 slotBuffer 推入空字符串。
      // isComment('') 为 false，后续只有空注释也不会误走 slot fallback；空字符串不生成 DOM。
      /**
       * 场景：foo 槽根是 Transition，内部 div 的条件为 false，快照断言先独立 _push 空字符串再输出条件占位，验证为 slot 空内容识别预留标记。
       */
      test('should push marker string if is slot root', () => {
        expect(
          compile(`<foo><transition><div v-if="false"/></transition></foo>`)
            .code,
        ).toMatchInlineSnapshot(`
          "const { resolveComponent: _resolveComponent, withCtx: _withCtx, openBlock: _openBlock, createBlock: _createBlock, createCommentVNode: _createCommentVNode, Transition: _Transition, createVNode: _createVNode } = require("vue")
          const { ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

          return function ssrRender(_ctx, _push, _parent, _attrs) {
            const _component_foo = _resolveComponent("foo")

            _push(_ssrRenderComponent(_component_foo, _attrs, {
              default: _withCtx((_, _push, _parent, _scopeId) => {
                if (_push) {
                  _push(\`\`)
                  if (false) {
                    _push(\`<div\${_scopeId}></div>\`)
                  } else {
                    _push(\`<!---->\`)
                  }
                } else {
                  return [
                    _createVNode(_Transition, null, {
                      default: _withCtx(() => [
                        false
                          ? (_openBlock(), _createBlock("div", { key: 0 }))
                          : _createCommentVNode("v-if", true)
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
    })
  })

  // 自定义指令：通过 ssrGetDirectiveProps 取得服务端 props，并与普通 props 合并。
  describe('custom directive', () => {
    /**
     * 场景：foo 组件使用 v-xxx:x.y=z，快照断言 resolveDirective、值/参数/修饰符传入 ssrGetDirectiveProps 后合并 _attrs，验证自定义指令 props 参与组件调用。
     */
    test('basic', () => {
      expect(compile(`<foo v-xxx:x.y="z" />`).code).toMatchInlineSnapshot(`
        "const { resolveComponent: _resolveComponent, resolveDirective: _resolveDirective, mergeProps: _mergeProps } = require("vue")
        const { ssrGetDirectiveProps: _ssrGetDirectiveProps, ssrRenderComponent: _ssrRenderComponent } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          const _component_foo = _resolveComponent("foo")
          const _directive_xxx = _resolveDirective("xxx")

          _push(_ssrRenderComponent(_component_foo, _mergeProps(_attrs, _ssrGetDirectiveProps(_ctx, _directive_xxx, _ctx.z, "x", { y: true })), null, _parent))
        }"
      `)
    })
  })
})
