import { patchProp } from '../src/patchProp'
import { xlinkNS } from '../src/modules/attrs'

// 测试组：对真实DOM元素直接调用patchProp，读取attribute/property；覆盖SVG、Boolean、Symbol、对象输入与自定义setAttribute/sandbox setter。
describe('runtime-dom: attrs patching', () => {
  /** 测试场景：SVG use 元素的 xlink:href 写 a 后可由 XLink 命名空间读取，更新 null 后移除；核对 namespace API。 */
  test('xlink attributes', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    patchProp(el, 'xlink:href', null, 'a', 'svg')
    expect(el.getAttributeNS(xlinkNS, 'href')).toBe('a')
    patchProp(el, 'xlink:href', 'a', null, 'svg')
    expect(el.getAttributeNS(xlinkNS, 'href')).toBe(null)
  })

  /** 测试场景：SVG use 的 textContent 写 foo 后无同名 attribute、内容为 foo；核对 SVG property 例外。 */
  test('textContent attributes /w svg', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    patchProp(el, 'textContent', null, 'foo', 'svg')
    expect(el.attributes.length).toBe(0)
    expect(el.innerHTML).toBe('foo')
  })

  /** 测试场景：input.readonly 依次传 true、false、空串、0、字符串0、1、undefined；断言 attribute 是否存在，核对特殊布尔值只表达存在性。 */
  test('boolean attributes', () => {
    const el = document.createElement('input')
    patchProp(el, 'readonly', null, true)
    expect(el.getAttribute('readonly')).toBe('')
    patchProp(el, 'readonly', true, false)
    expect(el.getAttribute('readonly')).toBe(null)
    patchProp(el, 'readonly', false, '')
    expect(el.getAttribute('readonly')).toBe('')
    patchProp(el, 'readonly', '', 0)
    expect(el.getAttribute('readonly')).toBe(null)
    patchProp(el, 'readonly', 0, '0')
    expect(el.getAttribute('readonly')).toBe('')
    patchProp(el, 'readonly', '0', false)
    expect(el.getAttribute('readonly')).toBe(null)
    patchProp(el, 'readonly', false, 1)
    expect(el.getAttribute('readonly')).toBe('')
    patchProp(el, 'readonly', 1, undefined)
    expect(el.getAttribute('readonly')).toBe(null)
  })

  /** 测试场景：div 的未知 foo 键写 a 后可读取，更新 null 后消失；核对普通 attribute 增删。 */
  test('attributes', () => {
    const el = document.createElement('div')
    patchProp(el, 'foo', null, 'a')
    expect(el.getAttribute('foo')).toBe('a')
    patchProp(el, 'foo', 'a', null)
    expect(el.getAttribute('foo')).toBe(null)
  })

  // #949
  /** 测试场景：div 的小写 onwards 不匹配事件 prop 规则；写 a/移除按普通 attribute 处理。 */
  test('onxxx but non-listener attributes', () => {
    const el = document.createElement('div')
    patchProp(el, 'onwards', null, 'a')
    expect(el.getAttribute('onwards')).toBe('a')
    patchProp(el, 'onwards', 'a', null)
    expect(el.getAttribute('onwards')).toBe(null)
  })

  // #10597
  /** 测试场景：未知 foo attribute 接收 Symbol(foo)，断言其显式字符串表示，避免 Symbol 隐式 DOM 转换失败。 */
  test('should allow setting attribute to symbol', () => {
    const el = document.createElement('div')
    const symbol = Symbol('foo')
    patchProp(el, 'foo', null, symbol)
    expect(el.getAttribute('foo')).toBe(symbol.toString())
  })

  // #10598
  /** 测试场景：input.value 接收 Symbol(foo)，最终 value 为该符号的字符串表示；核对 value 专用转换。 */
  test('should allow setting value to symbol', () => {
    const el = document.createElement('input')
    const symbol = Symbol('foo')
    patchProp(el, 'value', null, symbol)
    expect(el.value).toBe(symbol.toString())
  })

  // #11177
  /** 测试场景：普通对象写 data-test 时浏览器调用 toString；替换 setAttribute 的第二元素收到原对象，证明 patchAttr 没有提前把对象转为字符串。 */
  test('should allow setting value to object, leaving stringification to the element/browser', () => {
    // 原生 setAttribute 的字符串转换。
    const el = document.createElement('div')
    const obj = {
      /** 把对象输入序列化为foo字符串，供普通DOM attribute写入结果断言。 */
      toString: () => 'foo'
    }
    patchProp(el, 'data-test', null, obj)
    expect(el.dataset.test).toBe('foo')

    const el2 = document.createElement('div')
    let testvalue: null | typeof obj = null
    // 模拟自定义元素覆盖 setAttribute，观察传入原始值。
    /** 覆盖fixture的setAttribute，记录调用时传入的value而不作字符串转换，验证对象值原样交给自定义实现。 */
    el2.setAttribute = (name, value) => {
      testvalue = value
    }
    patchProp(el2, 'data-test', null, obj)
    expect(el2.dataset.test).toBe(undefined)
    expect(testvalue).toBe(obj)
  })

  // #13946
  /** 测试场景：iframe 上人为定义 sandbox setter 后写限制、null、空串；setter 次数始终零，attribute 分别保留/移除/存在，核对 sandbox 特判。 */
  test('sandbox should be handled as attribute even if property exists', () => {
    const iframe = document.createElement('iframe') as any
    let propSetCount = 0
    // 为 jsdom 的 iframe 构造可计数的 sandbox accessor。
    Object.defineProperty(iframe, 'sandbox', {
      configurable: true,
      enumerable: true,
      /** 返回fixture保存的_sandbox属性值；供自定义sandbox属性路径比较property写入。 */
      get() {
        return this._sandbox
      },
      /** 每次setter执行递增propSetCount，再保存v到_sandbox；断言iframe的sandbox更新走attribute而不调用此property setter。 */
      set(v) {
        propSetCount++
        this._sandbox = v
      },
    })

    patchProp(iframe, 'sandbox', null, 'allow-scripts')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(propSetCount).toBe(0)

    patchProp(iframe, 'sandbox', 'allow-scripts', null)
    expect(iframe.hasAttribute('sandbox')).toBe(false)
    expect(iframe.getAttribute('sandbox')).toBe(null)
    expect(propSetCount).toBe(0)

    patchProp(iframe, 'sandbox', null, '')
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.hasAttribute('sandbox')).toBe(true)
    expect(propSetCount).toBe(0)

    delete iframe.sandbox
  })
})
