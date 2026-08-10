/**
 * 测试阅读说明：本文件验证 `runtime-dom/patchClass` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { patchProp } from '../src/patchProp'
import {
  type ElementWithTransition,
  vtcKey,
} from '../src/components/Transition'
import { svgNS } from '../src/nodeOps'

// 测试组：runtime-dom 对 HTML、SVG 元素的 class 修补规则。
describe('runtime-dom: class patching', () => {
  // 测试场景：基础知识。
  test('basics', () => {
    const el = document.createElement('div')
    patchProp(el, 'class', null, 'foo')
    expect(el.className).toBe('foo')
    patchProp(el, 'class', null, null)
    expect(el.className).toBe('')
  })

  // 测试场景：更新用户 class 时保留 Transition 临时附加的过渡 class。
  test('transition class', () => {
    const el = document.createElement('div') as ElementWithTransition
    el[vtcKey] = new Set(['bar', 'baz'])
    patchProp(el, 'class', null, 'foo')
    expect(el.className).toBe('foo bar baz')
    patchProp(el, 'class', null, null)
    expect(el.className).toBe('bar baz')
    delete el[vtcKey]
    patchProp(el, 'class', null, 'foo')
    expect(el.className).toBe('foo')
  })

  // 测试场景：SVG 元素通过 attribute 正确设置和移除 class。
  test('svg', () => {
    const el = document.createElementNS(svgNS, 'svg')
    patchProp(el, 'class', null, 'foo', 'svg')
    expect(el.getAttribute('class')).toBe('foo')
  })
})
