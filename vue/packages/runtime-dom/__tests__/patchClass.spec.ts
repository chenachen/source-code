import { patchProp } from '../src/patchProp'
import {
  type ElementWithTransition,
  vtcKey,
} from '../src/components/Transition'
import { svgNS } from '../src/nodeOps'

// 测试组：对HTML/SVG元素写class，并给vtcKey对应的Set记录动画类；比较实际class字符串及移除结果。
describe('runtime-dom: class patching', () => {
  /** 测试场景：空 div 写 class=foo 后 className 为 foo，更新 null 清空；核对 HTML className 路径。 */
  test('basics', () => {
    const el = document.createElement('div')
    patchProp(el, 'class', null, 'foo')
    expect(el.className).toBe('foo')
    patchProp(el, 'class', null, null)
    expect(el.className).toBe('')
  })

  /** 测试场景：元素的vtcKey对应Set保存 bar/baz，用户 class 写 foo 或 null 时仍保留临时类；清掉集合后只剩用户 foo，核对过渡类合并。 */
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

  /** 测试场景：SVG 元素写 class=foo，通过 getAttribute 读取 foo；核对 SVG 使用 attribute 的分支。 */
  test('svg', () => {
    const el = document.createElementNS(svgNS, 'svg')
    patchProp(el, 'class', null, 'foo', 'svg')
    expect(el.getAttribute('class')).toBe('foo')
  })
})
