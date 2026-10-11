import { patchProp } from '../src/patchProp'
import {
  h,
  nextTick,
  ref,
  render,
  vModelCheckbox,
  withDirectives,
} from '../src'

// 测试组：对input/textarea/select及自定义元素直接补property，读取宿主值、原值缓存与setter计数；错误输入用警告或不抛异常断言观察。
describe('runtime-dom: props patching', () => {
  /** 测试场景：div.id 写 foo 后清 null；property 为空串且 attribute 不存在，核对字符串 property 清理。 */
  test('basic', () => {
    const el = document.createElement('div')
    patchProp(el, 'id', null, 'foo')
    expect(el.id).toBe('foo')
    // 原始 property 为字符串时，null 更新复位为空串。
    patchProp(el, 'id', null, null)
    expect(el.id).toBe('')
    expect(el.getAttribute('id')).toBe(null)
  })

  /** 测试场景：input.value 依次写字符串、null、对象，DOM value 字符串化而 _value 保留原对象；option 未声明 value 时回退文本，显式设置后同步 attribute。 */
  test('value', () => {
    const el = document.createElement('input')
    patchProp(el, 'value', null, 'foo')
    expect(el.value).toBe('foo')
    patchProp(el, 'value', null, null)
    expect(el.value).toBe('')
    expect(el.getAttribute('value')).toBe(null)
    const obj = {}
    patchProp(el, 'value', null, obj)
    expect(el.value).toBe(obj.toString())
    expect((el as any)._value).toBe(obj)

    const option = document.createElement('option')
    patchProp(option, 'textContent', null, 'foo')
    expect(option.value).toBe('foo')
    expect(option.getAttribute('value')).toBe(null)
    patchProp(option, 'value', null, 'foo')
    expect(option.value).toBe('foo')
    expect(option.getAttribute('value')).toBe('foo')
  })

  /** 测试场景：自定义元素 value setter 使用自己的 _value；写字符串、null、对象分别仅调用一次，最终对象保持身份，避免原生表单路径二次覆写。 */
  test('value for custom elements', () => {
    /** value带可观察setter的自定义元素fixture；内部_value保存原始输入、setterCalled计写入次数，验证patchDOMProp不按普通input等值跳过。 */
    class TestElement extends HTMLElement {
      /** 调用HTMLElement原生构造器，value存储与计数由字段初始值建立。 */
      constructor() {
        super()
      }

      // 故意使用普通元素保存原始 value 的同名 _value，验证自定义 setter 不被该缓存误短路。
      /** value accessor保存的原始输入；故意同普通元素内部_value同名，以检验自定义元素分支不被该缓存误短路。 */
      private _value: any
      /** 返回fixture内部_value，保留对象或原始输入类型。 */
      get value() {
        return this._value
      }

      /** 把val保存到_value并累加setterCalled，供补丁断言观察setter是否每次执行。 */
      set value(val) {
        this._value = val
        this.setterCalled++
      }

      /** value setter被调用的累计次数，断言相同值也会再次经过自定义setter。 */
      public setterCalled: number = 0
    }
    window.customElements.define('patch-props-test-element', TestElement)
    const el = document.createElement('patch-props-test-element') as TestElement
    patchProp(el, 'value', null, 'foo')
    expect(el.value).toBe('foo')
    expect(el.setterCalled).toBe(1)
    patchProp(el, 'value', null, null)
    expect(el.value).toBe('')
    expect(el.setterCalled).toBe(2)
    expect(el.getAttribute('value')).toBe(null)
    const obj = {}
    patchProp(el, 'value', null, obj)
    expect(el.value).toBe(obj)
    expect(el.setterCalled).toBe(3)
  })

  // 文本 input 的 value property 写入不创建 value attribute；
  // 因此同时检查其他原生元素的 attribute 移除。
  /** 测试场景：option 文本为 foo 时显式写同值仍建立 value attribute；再设 null并清文本，value 为空且 attribute 移除，核对 option 的比较依据。 */
  test('value for non-text input', () => {
    const el = document.createElement('option')
    el.textContent = 'foo' // #4956
    patchProp(el, 'value', null, 'foo')
    expect(el.getAttribute('value')).toBe('foo')
    expect(el.value).toBe('foo')
    patchProp(el, 'value', null, null)
    el.textContent = ''
    expect(el.value).toBe('')
    // #3475
    expect(el.getAttribute('value')).toBe(null)
  })

  /** 测试场景：select.multiple 依次接受空串、null、true、0、字符串0、false、1、undefined；核对空串为存在、假值为关闭的布尔 property 转换。 */
  test('boolean prop', () => {
    const el = document.createElement('select')
    patchProp(el, 'multiple', null, '')
    expect(el.multiple).toBe(true)
    patchProp(el, 'multiple', null, null)
    expect(el.multiple).toBe(false)
    patchProp(el, 'multiple', null, true)
    expect(el.multiple).toBe(true)
    patchProp(el, 'multiple', null, 0)
    expect(el.multiple).toBe(false)
    patchProp(el, 'multiple', null, '0')
    expect(el.multiple).toBe(true)
    patchProp(el, 'multiple', null, false)
    expect(el.multiple).toBe(false)
    patchProp(el, 'multiple', null, 1)
    expect(el.multiple).toBe(true)
    patchProp(el, 'multiple', null, undefined)
    expect(el.multiple).toBe(false)
  })

  /** 测试场景：div 先挂子组件，随后改 innerHTML=bar；内容替换且原组件 unmounted 调用，核对 renderer 在 HTML 覆盖前执行子树卸载。 */
  test('innerHTML unmount prev children', () => {
    const fn = vi.fn()
    const comp = {
      /** 渲染'foo'。 */
      render: () => 'foo',
      unmounted: fn,
    }
    const root = document.createElement('div')
    render(h('div', null, [h(comp)]), root)
    expect(root.innerHTML).toBe(`<div>foo</div>`)

    render(h('div', { innerHTML: 'bar' }), root)
    expect(root.innerHTML).toBe(`<div>bar</div>`)
    expect(fn).toHaveBeenCalled()
  })

  // #954
  /** 测试场景：原 div 子组件替换为含 g 的 SVG innerHTML，旧组件仍执行 unmounted；断言 namespace 内容和卸载均完成。 */
  test('(svg) innerHTML unmount prev children', () => {
    const fn = vi.fn()
    const comp = {
      /** 渲染'foo'。 */
      render: () => 'foo',
      unmounted: fn,
    }
    const root = document.createElement('div')
    render(h('div', null, [h(comp)]), root)
    expect(root.innerHTML).toBe(`<div>foo</div>`)

    render(h('svg', { innerHTML: '<g></g>' }), root)
    expect(root.innerHTML).toBe(`<svg><g></g></svg>`)
    expect(fn).toHaveBeenCalled()
  })

  /** 测试场景：响应式 div 由 innerHTML=baz 改为 del VNode children；旧 HTML 清理后显示 del，核对从 HTML sink 回到普通 children 的 patch。 */
  test('patch innerHTML porp', async () => {
    const root = document.createElement('div')
    const state = ref(false)
    const Comp = {
      /** 提供空根组件，不返回VNode。 */
      render: () => {
        if (state.value) {
          return h('div', [h('del', null, 'baz')])
        } else {
          return h('div', { innerHTML: 'baz' })
        }
      },
    }
    render(h(Comp), root)
    expect(root.innerHTML).toBe(`<div>baz</div>`)
    state.value = true
    await nextTick()
    expect(root.innerHTML).toBe(`<div><del>baz</del></div>`)
  })

  /** 测试场景：首次 div innerHTML=undefined，元素为空；核对 nullish sink 不执行赋值。 */
  test('patch innerHTML porp w/ undefined value', async () => {
    const root = document.createElement('div')
    render(h('div', { innerHTML: undefined }), root)
    expect(root.innerHTML).toBe(`<div></div>`)
  })

  /** 测试场景：div 子组件改 textContent=bar，内容替换且 unmounted 被调用；核对 renderer 清旧树而不只覆盖 DOM。 */
  test('textContent unmount prev children', () => {
    const fn = vi.fn()
    const comp = {
      /** 渲染'foo'。 */
      render: () => 'foo',
      unmounted: fn,
    }
    const root = document.createElement('div')
    render(h('div', null, [h(comp)]), root)
    expect(root.innerHTML).toBe(`<div>foo</div>`)

    render(h('div', { textContent: 'bar' }), root)
    expect(root.innerHTML).toBe(`<div>bar</div>`)
    expect(fn).toHaveBeenCalled()
  })

  // #1049
  /** 测试场景：video.srcObject 写原对象后保持身份，再清 null 恢复初始值；核对非字符串 DOM property 不提前字符串化。 */
  test('set value as-is for non string-value props', () => {
    const el = document.createElement('video')
    // 此 jsdom 环境中 video.srcObject 默认 undefined，
    // 与浏览器默认 null 的情况不同。
    // 此例验证非字符串 property 遇到 nullish 值时按原类型复位，
    // 不会一律写为空字符串；
    // 断言当前环境可观察的复位值。
    el.srcObject = null
    const initialValue = el.srcObject
    const fakeObject = {}
    patchProp(el, 'srcObject', null, fakeObject)
    expect(el.srcObject).toBe(fakeObject)
    patchProp(el, 'srcObject', null, null)
    expect(el.srcObject).toBe(initialValue)
  })

  /** 测试场景：人为设置抛 TypeError 的 DOM property，patchProp 捕获并给出开发告警；错误不逃逸到整个 patch。 */
  test('catch and warn prop set TypeError', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'someProp', {
      /** fixture的set主动抛出new TypeError('Invalid type')，验证补丁捕获诊断；无正常返回值。 */
      set() {
        throw new TypeError('Invalid type')
      },
    })
    patchProp(el, 'someProp', null, 'foo')

    expect(`Failed setting prop "someProp" on <div>`).toHaveBeenWarnedLast()
  })

  // #1576
  /** 测试场景：div.id 空串仍保留 attribute，null/undefined 移除；img.width 空串/0 与 nullish 的存在性分别断言，避免把所有假值统称为移除。 */
  test('remove attribute when value is falsy', () => {
    const el = document.createElement('div')
    patchProp(el, 'id', null, '')
    expect(el.hasAttribute('id')).toBe(true)
    patchProp(el, 'id', null, null)
    expect(el.hasAttribute('id')).toBe(false)

    patchProp(el, 'id', null, '')
    expect(el.hasAttribute('id')).toBe(true)
    patchProp(el, 'id', null, undefined)
    expect(el.hasAttribute('id')).toBe(false)

    patchProp(el, 'id', null, '')
    expect(el.hasAttribute('id')).toBe(true)

    // #2677
    const img = document.createElement('img')
    patchProp(img, 'width', null, '')
    expect(el.hasAttribute('width')).toBe(false)
    patchProp(img, 'width', null, 0)
    expect(img.hasAttribute('width')).toBe(true)

    patchProp(img, 'width', null, null)
    expect(img.hasAttribute('width')).toBe(false)
    patchProp(img, 'width', null, 0)
    expect(img.hasAttribute('width')).toBe(true)

    patchProp(img, 'width', null, undefined)
    expect(img.hasAttribute('width')).toBe(false)
    patchProp(img, 'width', null, 0)
    expect(img.hasAttribute('width')).toBe(true)
  })

  /** 测试场景：input.form 通过 attribute 写 foo，property 仍 null；更新 null 删除关联标记，核对只读 form property 例外。 */
  test('form attribute', () => {
    const el = document.createElement('input')
    patchProp(el, 'form', null, 'foo')
    // 未注册的自定义标签也走原生属性存在性判断。
    expect(el.form).toBe(null)
    expect(el.getAttribute('form')).toBe('foo')
    // null 更新删除 attribute。
    patchProp(el, 'form', 'foo', null)
    expect(el.getAttribute('form')).toBe(null)
  })

  /** 测试场景：textarea 的只读 type 清为 null，调用结束无异常；本例没有显式状态断言，只检查不会因赋 property 中断。 */
  test('readonly type prop on textarea', () => {
    const el = document.createElement('textarea')
    // 仅验证动态 input→textarea 时修补 type 不抛异常。
    // 参见 https://github.com/vuejs/core/issues/2766
    patchProp(el, 'type', 'text', null)
  })

  /** 测试场景：未知 .x 显式前缀强制 property，写 1 后 el.x=1；核对前缀路由。 */
  test('force patch as prop', () => {
    const el = document.createElement('div') as any
    patchProp(el, '.x', null, 1)
    expect(el.x).toBe(1)
  })

  /** 测试场景：已有 el.x=1，^x 写 2 只产生字符串 attribute，property 仍1；核对强制 attribute。 */
  test('force patch as attribute', () => {
    const el = document.createElement('div') as any
    el.x = 1
    patchProp(el, '^x', null, 2)
    expect(el.x).toBe(1)
    expect(el.getAttribute('x')).toBe('2')
  })

  /** 测试场景：input.size 写100后清null，attribute移除且不告警；写非法foobar才告警，核对数字清理与异常诊断区别。 */
  test('input with size (number property)', () => {
    const el = document.createElement('input')
    patchProp(el, 'size', null, 100)
    expect(el.size).toBe(100)
    patchProp(el, 'size', 100, null)
    expect(el.getAttribute('size')).toBe(null)
    expect('Failed setting prop "size" on <input>').not.toHaveBeenWarned()
    patchProp(el, 'size', null, 'foobar')
    expect('Failed setting prop "size" on <input>').toHaveBeenWarnedLast()
  })

  /** 测试场景：只读 select.type 写 test 后仍 select-one 并告警；核对赋值失败捕获。 */
  test('select with type (string property)', () => {
    const el = document.createElement('select')
    patchProp(el, 'type', null, 'test')
    expect(el.type).toBe('select-one')
    expect('Failed setting prop "type" on <select>').toHaveBeenWarnedLast()
  })

  /** 测试场景：只读 select.willValidate 清null后仍true并告警；核对布尔只读 property 的异常分支。 */
  test('select with willValidate (boolean property)', () => {
    const el = document.createElement('select')
    patchProp(el, 'willValidate', true, null)
    expect(el.willValidate).toBe(true)
    expect(
      'Failed setting prop "willValidate" on <select>',
    ).toHaveBeenWarnedLast()
  })

  /** 测试场景：select 初始 options 包含 foo/bar，再更新为 foo/baz 且 value=baz；断言选中值随最终 options 更新。 */
  test('patch value for select', () => {
    const root = document.createElement('div')
    render(
      h('select', { value: 'foo' }, [
        h('option', { value: 'foo' }, 'foo'),
        h('option', { value: 'bar' }, 'bar'),
      ]),
      root,
    )
    const el = root.children[0] as HTMLSelectElement
    expect(el.value).toBe('foo')

    render(
      h('select', { value: 'baz' }, [
        h('option', { value: 'foo' }, 'foo'),
        h('option', { value: 'baz' }, 'baz'),
      ]),
      root,
    )
    expect(el.value).toBe('baz')
  })

  /** 测试场景：option 明确 value=空串而文本foo，select和option value均空串；显式空value不能回退文本。 */
  test('init empty value for option', () => {
    const root = document.createElement('div')
    render(
      h('select', { value: 'foo' }, [h('option', { value: '' }, 'foo')]),
      root,
    )
    const select = root.children[0] as HTMLSelectElement
    const option = select.children[0] as HTMLOptionElement
    expect(select.value).toBe('')
    expect(option.value).toBe('')
  })

  // #8780
  /** 测试场景：img.width 接收24px，attribute保留该字符串；核对嵌入元素尺寸使用 attribute。 */
  test('embedded tag with width and height', () => {
    // img/video/source/canvas 的 width/height 等嵌入元素尺寸
    // 按 attribute 设置，以接受CSS尺寸字符串。
    const el = document.createElement('img')
    patchProp(el, 'width', null, '24px')
    expect(el.getAttribute('width')).toBe('24px')
  })

  // #9762：非嵌入标签回到 key in el 的 property 存在性判断。
  /** 测试场景：非嵌入标签 foobar.width 接收24px，attribute为24px；核对宽高特判后回到 key in el 的默认选择。 */
  test('width and height on custom elements', () => {
    const el = document.createElement('foobar')
    patchProp(el, 'width', null, '24px')
    expect(el.getAttribute('width')).toBe('24px')
  })

  /** 测试场景：div.translate 写no，attribute为no且property为假；枚举字符串不能被直接写成布尔true。 */
  test('translate attribute', () => {
    const el = document.createElement('div')
    patchProp(el, 'translate', null, 'no')
    expect(el.translate).toBeFalsy()
    expect(el.getAttribute('translate')).toBe('no')
  })

  // #11647
  /** 测试场景：checkbox 的 value=undefined 挂载后观察 attribute mutations，再经过 nextTick；零次回调证明没有额外 value 变异，不扩大为全部表单事件保证。 */
  test('should not trigger input mutation when `value` is `undefined`', async () => {
    const fn = vi.fn()
    const comp = {
      /** 建立checked=ref()。setup返回渲染函数：withDirectives( h('input', { type: 'checkbox', value: undefined, 'onUpdate:modelValue': (value: any) => { checked.value = value }, }), [[vModelCheckbox, checked.value]], )。 */
      setup() {
        const checked = ref()
        return () =>
          withDirectives(
            h('input', {
              type: 'checkbox',
              value: undefined,
              /** 执行checked.value=value。无返回值。 */
              'onUpdate:modelValue': (value: any) => {
                checked.value = value
              },
            }),
            [[vModelCheckbox, checked.value]],
          )
      },
    }

    const root = document.createElement('div')
    render(h(comp), root)
    document.body.append(root)

    const el = root.children[0] as HTMLInputElement
    const observer = new MutationObserver(fn)
    observer.observe(el, {
      attributes: true,
    })

    el.click()
    await nextTick()

    expect(fn).toBeCalledTimes(0)
  })
})
