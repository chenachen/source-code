/**
 * SSR `v-model` 场景：覆盖 input/textarea/select 初始状态表达式、动态 type、
 * radio/checkbox 比较、option 遍历与对象 v-bind 合并；模型值在生成代码运行时求值。
 */
import { compile } from '../src'

/** 用稳定父元素包住表单控件，使断言只关注 v-model 的 SSR 输出。 */
function compileWithWrapper(src: string) {
  return compile(`<div>${src}</div>`)
}

describe('ssr: v-model', () => {
  /**
   * 场景：无 type 与静态 email 两种 input 均绑定 bar，快照断言 value 由 ssrRenderAttr 输出而不生成客户端指令/监听器，验证文本类控件只生成初始 HTML 状态。
   */
  test('<input> (text types)', () => {
    expect(compileWithWrapper(`<input v-model="bar">`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttr: _ssrRenderAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><input\${
            _ssrRenderAttr("value", _ctx.bar)
          }></div>\`)
        }"
      `)

    expect(compileWithWrapper(`<input type="email" v-model="bar">`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttr: _ssrRenderAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><input type="email"\${
            _ssrRenderAttr("value", _ctx.bar)
          }></div>\`)
        }"
      `)
  })

  /**
   * 场景：select 下分别放静态 option、直接 for/if option、显式 selected、slot、optgroup 中普通/slot/for/if option，以及 template 的 if→for 与 for→if，共十一份模板。
   * 快照核对未显式 selected 的 option 都用 Array.isArray(model) 选择 looseContain/looseEqual 条件；已 selected 的 option 保持原样，slot 仅生成出口 helper。
   * 验证递归穿过 optgroup 与结构节点并修改已完成 option 开始标签；局部循环值不能加 _ctx 前缀。
   */
  test('<select v-model>', () => {
    expect(
      compileWithWrapper(
        `<select v-model="model"><option value="1"></option></select>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><select><option value="1"\${
          (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
            ? _ssrLooseContain(_ctx.model, "1")
            : _ssrLooseEqual(_ctx.model, "1"))) ? " selected" : ""
        }></option></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(
        `<select v-model="model"><option v-for="i in items" :value="i"></option></select>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select><!--[-->\`)
        _ssrRenderList(_ctx.items, (i) => {
          _push(\`<option\${
            _ssrRenderAttr("value", i)
          }\${
            (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
              ? _ssrLooseContain(_ctx.model, i)
              : _ssrLooseEqual(_ctx.model, i))) ? " selected" : ""
          }></option>\`)
        })
        _push(\`<!--]--></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(
        `<select v-model="model"><option v-if="true" :value="i"></option></select>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select>\`)
        if (true) {
          _push(\`<option\${
            _ssrRenderAttr("value", _ctx.i)
          }\${
            (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
              ? _ssrLooseContain(_ctx.model, _ctx.i)
              : _ssrLooseEqual(_ctx.model, _ctx.i))) ? " selected" : ""
          }></option>\`)
        } else {
          _push(\`<!---->\`)
        }
        _push(\`</select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(
        `<select multiple v-model="model"><option value="1" selected></option><option value="2"></option></select>`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><select multiple><option value="1" selected></option><option value="2"\${
          (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
            ? _ssrLooseContain(_ctx.model, "2")
            : _ssrLooseEqual(_ctx.model, "2"))) ? " selected" : ""
        }></option></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`<select multiple v-model="model"><slot/></select>`)
        .code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple>\`)
        _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent)
        _push(\`</select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup label="foo">
            <option value="bar">bar</option>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><select multiple><optgroup label="foo"><option value="bar"\${
          (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
            ? _ssrLooseContain(_ctx.model, "bar")
            : _ssrLooseEqual(_ctx.model, "bar"))) ? " selected" : ""
        }>bar</option></optgroup></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup label="foo">
            <slot/>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderSlot: _ssrRenderSlot, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple><optgroup label="foo">\`)
        _ssrRenderSlot(_ctx.$slots, "default", {}, null, _push, _parent)
        _push(\`</optgroup></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup>
            <option v-for="item in items" :value="item">{{item}}</option>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple><optgroup><!--[-->\`)
        _ssrRenderList(_ctx.items, (item) => {
          _push(\`<option\${
            _ssrRenderAttr("value", item)
          }\${
            (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
              ? _ssrLooseContain(_ctx.model, item)
              : _ssrLooseEqual(_ctx.model, item))) ? " selected" : ""
          }>\${
            _ssrInterpolate(item)
          }</option>\`)
        })
        _push(\`<!--]--></optgroup></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup>
            <option v-if="true" :value="item">{{item}}</option>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple><optgroup>\`)
        if (true) {
          _push(\`<option\${
            _ssrRenderAttr("value", _ctx.item)
          }\${
            (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
              ? _ssrLooseContain(_ctx.model, _ctx.item)
              : _ssrLooseEqual(_ctx.model, _ctx.item))) ? " selected" : ""
          }>\${
            _ssrInterpolate(_ctx.item)
          }</option>\`)
        } else {
          _push(\`<!---->\`)
        }
        _push(\`</optgroup></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup>
            <template v-if="ok">
              <option v-for="item in items" :value="item">{{item}}</option>
            </template>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple><optgroup>\`)
        if (_ctx.ok) {
          _push(\`<!--[-->\`)
          _ssrRenderList(_ctx.items, (item) => {
            _push(\`<option\${
              _ssrRenderAttr("value", item)
            }\${
              (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
                ? _ssrLooseContain(_ctx.model, item)
                : _ssrLooseEqual(_ctx.model, item))) ? " selected" : ""
            }>\${
              _ssrInterpolate(item)
            }</option>\`)
          })
          _push(\`<!--]-->\`)
        } else {
          _push(\`<!---->\`)
        }
        _push(\`</optgroup></select></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`
        <select multiple v-model="model">
          <optgroup>
            <template v-for="item in items" :value="item">
              <option v-if="item===1" :value="item">{{item}}</option>
            </template>
          </optgroup>
        </select>`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrLooseContain: _ssrLooseContain, ssrLooseEqual: _ssrLooseEqual, ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate, ssrRenderList: _ssrRenderList } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${_ssrRenderAttrs(_attrs)}><select multiple><optgroup><!--[-->\`)
        _ssrRenderList(_ctx.items, (item) => {
          _push(\`<!--[-->\`)
          if (item===1) {
            _push(\`<option\${
              _ssrRenderAttr("value", item)
            }\${
              (_ssrIncludeBooleanAttr((Array.isArray(_ctx.model))
                ? _ssrLooseContain(_ctx.model, item)
                : _ssrLooseEqual(_ctx.model, item))) ? " selected" : ""
            }>\${
              _ssrInterpolate(item)
            }</option>\`)
          } else {
            _push(\`<!---->\`)
          }
          _push(\`<!--]-->\`)
        })
        _push(\`<!--]--></optgroup></select></div>\`)
      }"
    `)
  })

  /**
   * 场景：radio 的静态 value=foo 与模型 bar，快照断言 looseEqual(bar,foo) 经布尔 helper 决定 checked，验证单选初始状态的宽松比较表达式。
   */
  test('<input type="radio">', () => {
    expect(
      compileWithWrapper(`<input type="radio" value="foo" v-model="bar">`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrLooseEqual: _ssrLooseEqual, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input type="radio" value="foo"\${
          (_ssrIncludeBooleanAttr(_ssrLooseEqual(_ctx.bar, "foo"))) ? " checked" : ""
        }></div>\`)
      }"
    `)
  })

  /**
   * 场景：checkbox 分别无 value、静态 value=foo、动态 true/false-value、静态 true/false-value。
   * 前两份快照在数组模型时分别比较 null/foo，标量时直接用模型布尔值；后两份改用模型与 true-value 的 looseEqual，true/false-value 本身不输出为 HTML。
   * 验证 checkbox 的数组/标量/自定义真值分支各生成正确 checked 条件。
   */
  test('<input type="checkbox">', () => {
    expect(compileWithWrapper(`<input type="checkbox" v-model="bar">`).code)
      .toMatchInlineSnapshot(`
        "const { ssrLooseContain: _ssrLooseContain, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><input type="checkbox"\${
            (_ssrIncludeBooleanAttr((Array.isArray(_ctx.bar))
              ? _ssrLooseContain(_ctx.bar, null)
              : _ctx.bar)) ? " checked" : ""
          }></div>\`)
        }"
      `)

    expect(
      compileWithWrapper(`<input type="checkbox" value="foo" v-model="bar">`)
        .code,
    ).toMatchInlineSnapshot(`
      "const { ssrLooseContain: _ssrLooseContain, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input type="checkbox" value="foo"\${
          (_ssrIncludeBooleanAttr((Array.isArray(_ctx.bar))
            ? _ssrLooseContain(_ctx.bar, "foo")
            : _ctx.bar)) ? " checked" : ""
        }></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(
        `<input type="checkbox" :true-value="foo" :false-value="bar" v-model="baz">`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrLooseEqual: _ssrLooseEqual, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input type="checkbox"\${
          (_ssrIncludeBooleanAttr(_ssrLooseEqual(_ctx.baz, _ctx.foo))) ? " checked" : ""
        }></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(
        `<input type="checkbox" true-value="foo" false-value="bar" v-model="baz">`,
      ).code,
    ).toMatchInlineSnapshot(`
      "const { ssrLooseEqual: _ssrLooseEqual, ssrIncludeBooleanAttr: _ssrIncludeBooleanAttr, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input type="checkbox"\${
          (_ssrIncludeBooleanAttr(_ssrLooseEqual(_ctx.baz, "foo"))) ? " checked" : ""
        }></div>\`)
      }"
    `)
  })

  /**
   * 场景：textarea 绑定 foo 但原内容是 bar，快照内容只调用 ssrInterpolate(foo)，验证模型表达式替换模板 children 并进行文本转义。
   */
  test('<textarea>', () => {
    expect(compileWithWrapper(`<textarea v-model="foo">bar</textarea>`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttrs: _ssrRenderAttrs, ssrInterpolate: _ssrInterpolate } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><textarea>\${
            _ssrInterpolate(_ctx.foo)
          }</textarea></div>\`)
        }"
      `)
  })

  /**
   * 场景：动态 :type=x 的 input 分别无 value、静态 value=bar、动态 :value=bar，快照动态 model helper 第三参依次为 null/字符串/前缀表达式，验证类型与比较值在运行时共同分派。
   */
  test('<input :type="x">', () => {
    expect(compileWithWrapper(`<input :type="x" v-model="foo">`).code)
      .toMatchInlineSnapshot(`
        "const { ssrRenderAttr: _ssrRenderAttr, ssrRenderDynamicModel: _ssrRenderDynamicModel, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><input\${
            _ssrRenderAttr("type", _ctx.x)
          }\${
            _ssrRenderDynamicModel(_ctx.x, _ctx.foo, null)
          }></div>\`)
        }"
      `)

    expect(
      compileWithWrapper(`<input :type="x" v-model="foo" value="bar">`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrRenderDynamicModel: _ssrRenderDynamicModel, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input\${
          _ssrRenderAttr("type", _ctx.x)
        }\${
          _ssrRenderDynamicModel(_ctx.x, _ctx.foo, "bar")
        } value="bar"></div>\`)
      }"
    `)

    expect(
      compileWithWrapper(`<input :type="x" v-model="foo" :value="bar">`).code,
    ).toMatchInlineSnapshot(`
      "const { ssrRenderAttr: _ssrRenderAttr, ssrRenderDynamicModel: _ssrRenderDynamicModel, ssrRenderAttrs: _ssrRenderAttrs } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input\${
          _ssrRenderAttr("type", _ctx.x)
        }\${
          _ssrRenderDynamicModel(_ctx.x, _ctx.foo, _ctx.bar)
        }\${
          _ssrRenderAttr("value", _ctx.bar)
        }></div>\`)
      }"
    `)
  })

  /**
   * 场景：input 的 type 可能来自对象 v-bind，分别只有对象绑定和前后混合 id/class；快照先用 _temp0 缓存最终 props，再合并 ssrGetDynamicModelProps，验证只求值一次且 helper 读取合并后的 type。
   */
  test('<input v-bind="obj">', () => {
    expect(compileWithWrapper(`<input v-bind="obj" v-model="foo">`).code)
      .toMatchInlineSnapshot(`
        "const { mergeProps: _mergeProps } = require("vue")
        const { ssrRenderAttrs: _ssrRenderAttrs, ssrGetDynamicModelProps: _ssrGetDynamicModelProps } = require("vue/server-renderer")

        return function ssrRender(_ctx, _push, _parent, _attrs) {
          let _temp0

          _push(\`<div\${
            _ssrRenderAttrs(_attrs)
          }><input\${
            _ssrRenderAttrs((_temp0 = _ctx.obj, _mergeProps(_temp0, _ssrGetDynamicModelProps(_temp0, _ctx.foo))))
          }></div>\`)
        }"
      `)

    expect(
      compileWithWrapper(`<input id="x" v-bind="obj" v-model="foo" class="y">`)
        .code,
    ).toMatchInlineSnapshot(`
      "const { mergeProps: _mergeProps } = require("vue")
      const { ssrRenderAttrs: _ssrRenderAttrs, ssrGetDynamicModelProps: _ssrGetDynamicModelProps } = require("vue/server-renderer")

      return function ssrRender(_ctx, _push, _parent, _attrs) {
        let _temp0

        _push(\`<div\${
          _ssrRenderAttrs(_attrs)
        }><input\${
          _ssrRenderAttrs((_temp0 = _mergeProps({ id: "x" }, _ctx.obj, { class: "y" }), _mergeProps(_temp0, _ssrGetDynamicModelProps(_temp0, _ctx.foo))))
        }></div>\`)
      }"
    `)
  })
})
