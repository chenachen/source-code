/**
 * SSR 原生元素场景：覆盖原生标签、void 元素、静态/动态属性、class/style 合并、内容指令与
 * 自定义指令的代码生成，核对 `_push` 模板字面量及 helper 调用。
 */
import { getCompiledString } from './utils'
import { compile } from '../src'

describe('ssr: element', () => {
  /**
   * 场景：分别用显式闭合 div 与自闭合 div 输入，抽取 SSR 内容都断言有完整开闭标签，验证普通元素自闭合语法不输出 XML 形式。
   */
  test('basic elements', () => {
    expect(getCompiledString(`<div></div>`)).toMatchInlineSnapshot(
      `"\`<div></div>\`"`,
    )
    expect(getCompiledString(`<div/>`)).toMatchInlineSnapshot(
      `"\`<div></div>\`"`,
    )
  })

  /**
   * 场景：div 内有两个 span，快照保持父子开闭标签与兄弟顺序，验证第二遍递归输出连续元素。
   */
  test('nested elements', () => {
    expect(
      getCompiledString(`<div><span></span><span></span></div>`),
    ).toMatchInlineSnapshot(`"\`<div><span></span><span></span></div>\`"`)
  })

  /**
   * 场景：input 没有结束标签，快照也只输出开始标签，验证 DOM void 标签表用于 SSR 结束标签判断。
   */
  test('void element', () => {
    expect(getCompiledString(`<input>`)).toMatchInlineSnapshot(`"\`<input>\`"`)
  })

  // 内容专用路径：v-html/v-text 与 textarea value 决定标签体，不作为普通 HTML 属性输出。
  describe('children override', () => {
    /**
     * 场景：div v-html=foo，快照直接嵌入 (_ctx.foo)??空串，验证 HTML 内容采用原始值及 nullish 回退，不调用文本转义 helper。
     */
    test('v-html', () => {
      expect(getCompiledString(`<div v-html="foo"/>`)).toMatchInlineSnapshot(`
        "\`<div>\${
            (_ctx.foo) ?? ''
          }</div>\`"
      `)
    })

    /**
     * 场景：div v-text=foo，快照内容调用 ssrInterpolate(_ctx.foo)，验证展示文本经转义进入标签体。
     */
    test('v-text', () => {
      expect(getCompiledString(`<div v-text="foo"/>`)).toMatchInlineSnapshot(`
        "\`<div>\${
            _ssrInterpolate(_ctx.foo)
          }</div>\`"
      `)
    })

    /**
     * 场景：textarea :value=foo，快照将值经 ssrInterpolate 放进内容而不输出 value 属性，验证 textarea 的 HTML 初始值协议。
     */
    test('<textarea> with dynamic value', () => {
      expect(getCompiledString(`<textarea :value="foo"/>`))
        .toMatchInlineSnapshot(`
        "\`<textarea>\${
            _ssrInterpolate(_ctx.foo)
          }</textarea>\`"
      `)
    })

    /**
     * 场景：textarea 静态 value 含 > 实体，快照内容是转义文本，验证解析后原静态值按 textarea 内容重新 escape。
     */
    test('<textarea> with static value', () => {
      expect(
        getCompiledString(`<textarea value="fo&gt;o"/>`),
      ).toMatchInlineSnapshot(`"\`<textarea>fo&gt;o</textarea>\`"`)
    })

    /**
     * 场景：textarea v-bind=obj 且有 fallback 文本，快照缓存合并 props 一次，以 value 属性是否存在选择值或 fallback，验证动态 value 及求值次数。
     */
    test('<textarea> with dynamic v-bind', () => {
      expect(compile(`<textarea v-bind="obj">fallback</textarea>`).code)
        .toMatchInlineSnapshot(`
          "const { mergeProps: _mergeProps } = require("vue")
          const { ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

          return function ssrRender(_ctx, _push, _parent, _attrs) {
            let _temp0

            _push(\`<textarea\${
              _ssrRenderAttrs(_temp0 = _mergeProps(_ctx.obj, _attrs), "textarea")
            }>\${
              _ssrInterpolate(("value" in _temp0) ? _temp0.value : "fallback")
            }</textarea>\`)
          }"
        `)
    })

    /**
     * 场景：根 div 插值与子 textarea 动态 value 都使用 ssrInterpolate，快照断言 helper 只导入一次并生成 _temp0，验证父子共用 helper 集合。
     */
    test('multiple _ssrInterpolate at parent and child import dependency once', () => {
      expect(
        compile(`<div>{{ hello }}<textarea v-bind="a"></textarea></div>`).code,
      ).toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          let _temp0

          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }>\${
            _ssrInterpolate(_ctx.hello)
          }<textarea\${
            _ssrRenderAttrs(_temp0 = _ctx.a, "textarea")
          }>\${
            _ssrInterpolate(("value" in _temp0) ? _temp0.value : "")
          }</textarea></div>\`)
        }"
      `)
    })

    /**
     * 场景：isCustomElement 识别 my-foo，且其 v-bind=obj，快照断言 ssrRenderAttrs 收到 my-foo 标签名，验证自定义元素属性语义由 helper 使用标签区别。
     */
    test('should pass tag to custom elements w/ dynamic v-bind', () => {
      expect(
        compile(`<my-foo v-bind="obj"></my-foo>`, {
          isCustomElement: () => true,
        }).code,
      ).toMatchInlineSnapshot(`
        "const { mergeProps: _mergeProps } = require("vue")
        const { ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<my-foo\${_ssrRenderAttrs(_mergeProps(_ctx.obj, _attrs), "my-foo")}></my-foo>\`)
        }"
      `)
    })
  })

  // 属性分组：分别锁定静态串联和动态 helper 路径，以及属性名安全校验。
  describe('attrs', () => {
    /**
     * 场景：div 有静态 id/class，抽取快照直接包含转义属性串，验证无动态覆盖时采用静态串联路径。
     */
    test('static attrs', () => {
      expect(
        getCompiledString(`<div id="foo" class="bar"></div>`),
      ).toMatchInlineSnapshot(`"\`<div id="foo" class="bar"></div>\`"`)
    })

    /**
     * 场景：div 静态 key/ref，快照不含这两个属性，验证 VNode 身份信息不序列化为 HTML。
     */
    test('ignore static key/ref', () => {
      expect(
        getCompiledString(`<div key="1" ref="el"></div>`),
      ).toMatchInlineSnapshot(`"\`<div></div>\`"`)
    })

    /**
     * 场景：div 绑定 :key 与 :ref，快照同样不含这两属性，验证动态身份信息也不进入 SSR HTML。
     */
    test('ignore v-bind key/ref', () => {
      expect(
        getCompiledString(`<div :key="1" :ref="el"></div>`),
      ).toMatchInlineSnapshot(`"\`<div></div>\`"`)
    })

    /**
     * 场景：div 静态 id 加动态 :class=bar，快照仅 class 调 ssrRenderClass，验证逐属性快速路径。
     */
    test('v-bind:class', () => {
      expect(getCompiledString(`<div id="foo" :class="bar"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div id="foo" class="\${
              _ssrRenderClass(_ctx.bar)
            }"></div>\`"
        `)
    })

    /**
     * 场景：静态 class=foo 写在 :class=bar 前，快照只有一个 class 且 helper 输入为 [bar,foo]，验证静态片段移除后合并规范化。
     */
    test('static class + v-bind:class', () => {
      expect(getCompiledString(`<div class="foo" :class="bar"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div class="\${
              _ssrRenderClass([_ctx.bar, "foo"])
            }"></div>\`"
        `)
    })

    /**
     * 场景：静态 class=foo 写在 :class=bar 后，快照仍合成一个 class helper，验证这种快速路径的结果不依赖两属性书写顺序。
     */
    test('v-bind:class + static class', () => {
      expect(getCompiledString(`<div :class="bar" class="foo"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div class="\${
              _ssrRenderClass([_ctx.bar, "foo"])
            }"></div>\`"
        `)
    })

    /**
     * 场景：静态 id 与动态 :style=bar，快照 style 调 ssrRenderStyle，验证样式序列化独立于普通属性转义。
     */
    test('v-bind:style', () => {
      expect(getCompiledString(`<div id="foo" :style="bar"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div id="foo" style="\${
              _ssrRenderStyle(_ctx.bar)
            }"></div>\`"
        `)
    })

    /**
     * 场景：静态 color:red 与动态 style=bar 同存，快照 helper 输入 [静态对象,bar]，验证 transformStyle 改写后按覆盖顺序合并一次输出。
     */
    test('static style + v-bind:style', () => {
      expect(getCompiledString(`<div style="color:red;" :style="bar"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div style="\${
              _ssrRenderStyle([{"color":"red"}, _ctx.bar])
            }"></div>\`"
        `)
    })

    /**
     * 场景：checkbox 的 :checked=checked，快照由 ssrIncludeBooleanAttr 决定输出属性名或空串，验证布尔属性以存在性编码。
     */
    test('v-bind:arg (boolean)', () => {
      expect(getCompiledString(`<input type="checkbox" :checked="checked">`))
        .toMatchInlineSnapshot(`
          "\`<input type="checkbox"\${
              (_ssrIncludeBooleanAttr(_ctx.checked)) ? " checked" : ""
            }>\`"
        `)
    })

    /**
     * 场景：div :id=id 与静态 class 同存，快照 id 走 ssrRenderAttr，验证安全静态属性名的动态值 helper。
     */
    test('v-bind:arg (non-boolean)', () => {
      expect(getCompiledString(`<div :id="id" class="bar"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttr("id", _ctx.id)
            } class="bar"></div>\`"
        `)
    })

    /**
     * 场景：两个 span 的 hidden 分别是 false 与 until-found，快照两者都调用 ssrRenderDynamicAttr，验证 hidden 需兼顾布尔与特殊字符串而不用一般布尔分支。
     */
    test('v-bind:arg (hidden)', () => {
      expect(
        getCompiledString(
          `<div><span :hidden="false"></span><span :hidden="'until-found'"></span></div>`,
        ),
      ).toMatchInlineSnapshot(`
        "\`<div><span\${
            _ssrRenderDynamicAttr("hidden", false)
          }></span><span\${
            _ssrRenderDynamicAttr("hidden", 'until-found')
          }></span></div>\`"
      `)
    })

    /**
     * 场景：动态参数绑定分别独立、与静态 class、与动态 id 共存，三份快照均把 [_ctx.key||空串] 放入完整 props 对象后 ssrRenderAttrs，验证未知键统一合并且假值键回退为空串。
     */
    test('v-bind:[arg]', () => {
      expect(getCompiledString(`<div v-bind:[key]="value"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs({ [_ctx.key || ""]: _ctx.value })
            }></div>\`"
        `)

      expect(getCompiledString(`<div class="foo" v-bind:[key]="value"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs({
                class: "foo",
                [_ctx.key || ""]: _ctx.value
              })
            }></div>\`"
        `)

      expect(getCompiledString(`<div :id="id" v-bind:[key]="value"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs({
                id: _ctx.id,
                [_ctx.key || ""]: _ctx.value
              })
            }></div>\`"
        `)
    })

    /**
     * 场景：对象 v-bind 分别独立及混合静态 class、动态 id、动态键、静态/动态 class、静态/动态 style，逐份快照核对 mergeProps 顺序与值数组，验证未知覆盖要求整对象序列化。
     */
    test('v-bind="obj"', () => {
      expect(getCompiledString(`<div v-bind="obj"></div>`))
        .toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_ctx.obj)
          }></div>\`"
      `)

      expect(getCompiledString(`<div class="foo" v-bind="obj"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_mergeProps({ class: "foo" }, _ctx.obj))
            }></div>\`"
        `)

      expect(getCompiledString(`<div :id="id" v-bind="obj"></div>`))
        .toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_mergeProps({ id: _ctx.id }, _ctx.obj))
          }></div>\`"
      `)

      // 动态属性 key 与无参数 `v-bind="object"` 组合。
      expect(getCompiledString(`<div :[key]="id" v-bind="obj"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_mergeProps({ [_ctx.key || ""]: _ctx.id }, _ctx.obj))
            }></div>\`"
        `)

      // 静态 class 与动态 :class 应合并规范化。
      expect(getCompiledString(`<div class="a" :class="b" v-bind="obj"></div>`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_mergeProps({
                class: ["a", _ctx.b]
              }, _ctx.obj))
            }></div>\`"
        `)

      // 静态 style 与动态 :style 应合并规范化。
      expect(
        getCompiledString(
          `<div style="color:red;" :style="b" v-bind="obj"></div>`,
        ),
      ).toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_mergeProps({
              style: [{"color":"red"}, _ctx.b]
            }, _ctx.obj))
          }></div>\`"
      `)
    })

    /**
     * 场景：原生 div 分别用 @click、对象 v-on、以及 v-bind+v-on，快照仅保留 id/绑定 attrs，验证服务端原生 HTML 不序列化事件监听器。
     */
    test('should ignore v-on', () => {
      expect(
        getCompiledString(`<div id="foo" @click="bar"/>`),
      ).toMatchInlineSnapshot(`"\`<div id="foo"></div>\`"`)
      expect(
        getCompiledString(`<div id="foo" v-on="bar"/>`),
      ).toMatchInlineSnapshot(`"\`<div id="foo"></div>\`"`)
      expect(getCompiledString(`<div v-bind="foo" v-on="bar"/>`))
        .toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_ctx.foo)
          }></div>\`"
      `)
    })
  })

  // 指令分组：SSR 专用 getSSRProps 结果进入 attrs，空结果不产生多余 merge/helper。
  describe('custom directives', () => {
    // #8112：元素没有模板 children 时，也必须尊重指令 getSSRProps 返回的 textContent/innerHTML。
    /**
     * 场景：无 children 的 div 用自定义指令，快照缓存 getSSRProps 结果并按 textContent 优先于 innerHTML 生成内容，验证指令可提供标签体。
     */
    test('custom dir without children', () => {
      expect(getCompiledString(`<div v-xxx:x.y="z" />`)).toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_temp0 = _ssrGetDirectiveProps(_ctx, _directive_xxx, _ctx.z, "x", { y: true }))
          }>\${
            ("textContent" in _temp0) ? _ssrInterpolate(_temp0.textContent) : _temp0.innerHTML ?? ''
          }</div>\`"
      `)
    })

    /**
     * 场景：自定义指令与 hello children 共存，快照指令只进入 attrs、内容仍为 hello，验证已有模板内容不会自动走指令内容兜底。
     */
    test('custom dir with children', () => {
      expect(getCompiledString(`<div v-xxx:x.y="z">hello</div>`))
        .toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_ssrGetDirectiveProps(_ctx, _directive_xxx, _ctx.z, "x", { y: true }))
          }>hello</div>\`"
      `)
    })

    /**
     * 场景：静态 class 与自定义指令同存且无 children，快照先合并显式 props 和指令结果，再用同一临时对象决定内容，验证一次合并供属性/内容复用。
     */
    test('custom dir with normal attrs', () => {
      expect(getCompiledString(`<div class="foo" v-xxx />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_temp0 = _mergeProps({ class: "foo" }, _ssrGetDirectiveProps(_ctx, _directive_xxx)))
            }>\${
              ("textContent" in _temp0) ? _ssrInterpolate(_temp0.textContent) : _temp0.innerHTML ?? ''
            }</div>\`"
        `)
    })

    /**
     * 场景：动态 title/class 与自定义指令同存，快照 mergeProps 后缓存结果并决定内容，验证动态普通属性也参与完整 props 路径。
     */
    test('custom dir with v-bind', () => {
      expect(getCompiledString(`<div :title="foo" :class="bar" v-xxx />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_temp0 = _mergeProps({
                title: _ctx.foo,
                class: _ctx.bar
              }, _ssrGetDirectiveProps(_ctx, _directive_xxx)))
            }>\${
              ("textContent" in _temp0) ? _ssrInterpolate(_temp0.textContent) : _temp0.innerHTML ?? ''
            }</div>\`"
        `)
    })

    /**
     * 场景：自定义指令与显式 v-text=foo 同存，快照内容直接 ssrInterpolate(foo)、不检查指令 textContent/innerHTML，验证显式内容指令优先。
     */
    test('custom dir with v-text', () => {
      expect(getCompiledString(`<div v-xxx v-text="foo" />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_ssrGetDirectiveProps(_ctx, _directive_xxx))
            }>\${
              _ssrInterpolate(_ctx.foo)
            }</div>\`"
        `)
    })

    /**
     * 场景：静态 class、自定义指令与 v-text 共存，快照合并 attrs 后仍直接输出 foo 文本，验证普通 props 不改变显式内容覆盖优先级。
     */
    test('custom dir with v-text and normal attrs', () => {
      expect(getCompiledString(`<div class="test" v-xxx v-text="foo" />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_mergeProps({ class: "test" }, _ssrGetDirectiveProps(_ctx, _directive_xxx)))
            }>\${
              _ssrInterpolate(_ctx.foo)
            }</div>\`"
        `)
    })

    /**
     * 场景：两个自定义指令与 v-text 同存，快照两个 getSSRProps 按序合并、内容仍取 foo，验证多指令合并不挤掉显式文本来源。
     */
    test('mulptiple custom dirs with v-text', () => {
      expect(getCompiledString(`<div v-xxx v-yyy v-text="foo" />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_mergeProps(_ssrGetDirectiveProps(_ctx, _directive_xxx), _ssrGetDirectiveProps(_ctx, _directive_yyy)))
            }>\${
              _ssrInterpolate(_ctx.foo)
            }</div>\`"
        `)
    })

    /**
     * 场景：对象 v-bind=x 与自定义指令同存、没有模板 children，快照 mergeProps(x,指令) 缓存一次并决定内容，验证指令结果在对象绑定之后覆盖。
     */
    test('custom dir with object v-bind', () => {
      expect(getCompiledString(`<div v-bind="x" v-xxx />`))
        .toMatchInlineSnapshot(`
          "\`<div\${
              _ssrRenderAttrs(_temp0 = _mergeProps(_ctx.x, _ssrGetDirectiveProps(_ctx, _directive_xxx)))
            }>\${
              ("textContent" in _temp0) ? _ssrInterpolate(_temp0.textContent) : _temp0.innerHTML ?? ''
            }</div>\`"
        `)
    })

    /**
     * 场景：v-bind=x、静态 class/title 与指令混合，快照按对象→显式属性组→指令合并并复用临时结果，验证源码属性顺序和内容读取保持一致。
     */
    test('custom dir with object v-bind + normal bindings', () => {
      expect(
        getCompiledString(`<div v-bind="x" class="foo" v-xxx title="bar" />`),
      ).toMatchInlineSnapshot(`
        "\`<div\${
            _ssrRenderAttrs(_temp0 = _mergeProps(_ctx.x, {
              class: "foo",
              title: "bar"
            }, _ssrGetDirectiveProps(_ctx, _directive_xxx)))
          }>\${
            ("textContent" in _temp0) ? _ssrInterpolate(_temp0.textContent) : _temp0.innerHTML ?? ''
          }</div>\`"
      `)
    })
  })
})
