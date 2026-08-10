/**
 * 测试阅读说明：本文件验证 `runtime-dom/patchAttrs` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { patchProp } from '../src/patchProp'
import { xlinkNS } from '../src/modules/attrs'

// 测试组：runtime-dom 的 DOM attributes 修补规则。
describe('runtime-dom: attrs patching', () => {
  // 测试场景：正确设置、更新和移除 SVG 的 XLink attributes。
  test('xlink attributes', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    patchProp(el, 'xlink:href', null, 'a', 'svg')
    expect(el.getAttributeNS(xlinkNS, 'href')).toBe('a')
    patchProp(el, 'xlink:href', 'a', null, 'svg')
    expect(el.getAttributeNS(xlinkNS, 'href')).toBe(null)
  })

  // 测试场景：SVG use 元素的 textContent 必须按 attribute 而非同名 property 修补。
  test('textContent attributes /w svg', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    patchProp(el, 'textContent', null, 'foo', 'svg')
    expect(el.attributes.length).toBe(0)
    expect(el.innerHTML).toBe('foo')
  })

  // 测试场景：布尔属性。
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

  // 测试场景：普通 attribute 的添加、更新与移除。
  test('attributes', () => {
    const el = document.createElement('div')
    patchProp(el, 'foo', null, 'a')
    expect(el.getAttribute('foo')).toBe('a')
    patchProp(el, 'foo', 'a', null)
    expect(el.getAttribute('foo')).toBe(null)
  })

  // #949
  // 测试场景：onxxx 但非监听属性。
  test('onxxx but non-listener attributes', () => {
    const el = document.createElement('div')
    patchProp(el, 'onwards', null, 'a')
    expect(el.getAttribute('onwards')).toBe('a')
    patchProp(el, 'onwards', 'a', null)
    expect(el.getAttribute('onwards')).toBe(null)
  })

  // #10597
  // 测试场景：应该允许设置符号属性。
  test('should allow setting attribute to symbol', () => {
    const el = document.createElement('div')
    const symbol = Symbol('foo')
    patchProp(el, 'foo', null, symbol)
    expect(el.getAttribute('foo')).toBe(symbol.toString())
  })

  // #10598
  // 测试场景：应该允许为符号设置值。
  test('should allow setting value to symbol', () => {
    const el = document.createElement('input')
    const symbol = Symbol('foo')
    patchProp(el, 'value', null, symbol)
    expect(el.value).toBe(symbol.toString())
  })

  // #11177
  // 测试场景：应该允许为对象设置值，将字符串化留给元素/浏览器。
  test('should allow setting value to object, leaving stringification to the element/browser', () => {
    // normal behavior
    const el = document.createElement('div')
    const obj = { toString: () => 'foo' }
    patchProp(el, 'data-test', null, obj)
    expect(el.dataset.test).toBe('foo')

    const el2 = document.createElement('div')
    let testvalue: null | typeof obj = null
    // simulating a web component that implements its own setAttribute handler
    el2.setAttribute = (name, value) => {
      testvalue = value
    }
    patchProp(el2, 'data-test', null, obj)
    expect(el2.dataset.test).toBe(undefined)
    expect(testvalue).toBe(obj)
  })

  // #13946
  // 测试场景：即使元素上存在同名 property，iframe sandbox 也必须按 attribute 修补。
  test('sandbox should be handled as attribute even if property exists', () => {
    const iframe = document.createElement('iframe') as any
    let propSetCount = 0
    // simulate sandbox property in jsdom environment
    Object.defineProperty(iframe, 'sandbox', {
      configurable: true,
      enumerable: true,
      get() {
        return this._sandbox
      },
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
