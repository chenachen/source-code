import { patchEvent } from '../../src/modules/events'
import { withKeys, withModifiers } from '@vue/runtime-dom'

/** 执行(e as any).button=0；target.dispatchEvent(e)。返回e。 */
function triggerEvent(
  target: Element,
  event: string,
  process?: (e: any) => any,
) {
  const e = new Event(event, {
    bubbles: true,
    cancelable: true,
  })
  if (event === 'click') {
    ;(e as any).button = 0
  }
  if (process) process(e)
  target.dispatchEvent(e)
  return e
}

// 测试组：triggerEvent派发可冒泡和取消的原生事件，withModifiers/withKeys包装spy；通过按键、鼠标及系统键输入比较默认取消、传播和调用次数。
describe('runtime-dom: v-on directive', () => {
  /** 测试场景：input 嵌套于 div，两者绑定 click；子处理器使用 prevent/stop 后触发可冒泡点击，事件 defaultPrevented=true 且父处理器不调用。 */
  test('it should support "stop" and "prevent"', () => {
    const parent = document.createElement('div')
    const child = document.createElement('input')
    parent.appendChild(child)
    const childNextValue = withModifiers(vi.fn(), ['prevent', 'stop'])
    patchEvent(child, 'onClick', null, childNextValue, null)
    const parentNextValue = vi.fn()
    patchEvent(parent, 'onClick', null, parentNextValue, null)
    expect(triggerEvent(child, 'click').defaultPrevented).toBe(true)
    expect(parentNextValue).not.toBeCalled()
  })

  /** 测试场景：父 div 处理器加 self，点击嵌套 input；target 与 currentTarget 不同，父处理器被过滤。 */
  test('it should support "self"', () => {
    const parent = document.createElement('div')
    const child = document.createElement('input')
    parent.appendChild(child)
    const fn = vi.fn()
    const handler = withModifiers(fn, ['self'])
    patchEvent(parent, 'onClick', null, handler, null)
    triggerEvent(child, 'click')
    expect(fn).not.toBeCalled()
  })

  /** 测试场景：逐一组合 ctrl/shift/meta/alt 与 esc、arrow-left；普通 a 或缺少系统键时不调用，系统键按下并使用 Escape/ArrowLeft 别名时各调用一次，验证两层守卫共同通过。 */
  test('it should support key modifiers and system modifiers', () => {
    const keyNames = ['ctrl', 'shift', 'meta', 'alt'] as const

    keyNames.forEach(keyName => {
      const el = document.createElement('div')
      const fn = vi.fn()
      // <div @keyup[keyName].esc="test"/>
      const nextValue = withKeys(withModifiers(fn, [keyName]), [
        'esc',
        'arrow-left',
      ])
      patchEvent(el, 'onKeyup', null, nextValue, null)

      triggerEvent(el, 'keyup', e => (e.key = 'a'))
      expect(fn).not.toBeCalled()

      triggerEvent(el, 'keyup', e => {
        e[`${keyName}Key`] = false
        e.key = 'esc'
      })
      expect(fn).not.toBeCalled()

      triggerEvent(el, 'keyup', e => {
        e[`${keyName}Key`] = true
        e.key = 'Escape'
      })
      expect(fn).toBeCalledTimes(1)

      triggerEvent(el, 'keyup', e => {
        e[`${keyName}Key`] = true
        e.key = 'ArrowLeft'
      })
      expect(fn).toBeCalledTimes(2)
    })
  })

  /** 测试场景：先为 exact 单独触发无系统键和 ctrl 事件，再组合 ctrl+exact+a；只有无多余系统键的匹配组合调用，ctrl+alt+a 被过滤。 */
  test('it should support "exact" modifier', () => {
    const el = document.createElement('div')
    // 场景一：<div @keyup.exact="test"/>，无其他系统键才通过。
    const fn1 = vi.fn()
    const next1 = withModifiers(fn1, ['exact'])
    patchEvent(el, 'onKeyup', null, next1, null)
    triggerEvent(el, 'keyup')
    expect(fn1.mock.calls.length).toBe(1)
    triggerEvent(el, 'keyup', e => (e.ctrlKey = true))
    expect(fn1.mock.calls.length).toBe(1)
    // 场景二：<div @keyup.ctrl.a.exact="test"/>，只允许 ctrl 与 a。
    const fn2 = vi.fn()
    const next2 = withKeys(withModifiers(fn2, ['ctrl', 'exact']), ['a'])
    patchEvent(el, 'onKeyup', null, next2, null)
    triggerEvent(el, 'keyup', e => (e.key = 'a'))
    expect(fn2).not.toBeCalled()
    triggerEvent(el, 'keyup', e => {
      e.key = 'a'
      e.ctrlKey = true
    })
    expect(fn2.mock.calls.length).toBe(1)
    triggerEvent(el, 'keyup', e => {
      // 带有未声明系统键 alt 时被 exact 过滤。
      e.key = 'a'
      e.ctrlKey = true
      e.altKey = true
    })
    expect(fn2.mock.calls.length).toBe(1)
  })

  /** 测试场景：循环 left/middle/right 并遍历 0/1/2 按钮事件；非对应按钮不调用，对应按钮调用，核对鼠标 button 守卫。 */
  it('should support mouse modifiers', () => {
    const buttons = ['left', 'middle', 'right'] as const
    const buttonCodes = { left: 0, middle: 1, right: 2 }
    buttons.forEach(button => {
      const el = document.createElement('div')
      const fn = vi.fn()
      const handler = withModifiers(fn, [button])
      patchEvent(el, 'onMousedown', null, handler, null)
      buttons
        .filter(b => b !== button)
        .forEach(button => {
          triggerEvent(el, 'mousedown', e => (e.button = buttonCodes[button]))
        })
      expect(fn).not.toBeCalled()
      triggerEvent(el, 'mousedown', e => (e.button = buttonCodes[button]))
      expect(fn).toBeCalled()
    })
  })

  /** 测试场景：ctrl 点击通过守卫后手动向包装器传 event、value、true；原处理器收到全部三个参数，验证包装不丢弃额外参数。 */
  it('should handle multiple arguments when using modifiers', () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    const handler = withModifiers(fn, ['ctrl'])
    const event = triggerEvent(el, 'click', e => (e.ctrlKey = true))
    handler(event, 'value', true)
    expect(fn).toBeCalledWith(event, 'value', true)
  })

  /** 测试场景：同一处理器分别以 a、b 生成按键包装并绑定两个按钮；包装对象不同，各自匹配按键后原处理器累计两次，防止缓存串用修饰符。 */
  it('withKeys cache wrapped listener separately for different modifiers', () => {
    const el1 = document.createElement('button')
    const el2 = document.createElement('button')
    const fn = vi.fn()
    const handler1 = withKeys(fn, ['a'])
    const handler2 = withKeys(fn, ['b'])
    expect(handler1 === handler2).toBe(false)
    patchEvent(el1, 'onKeyup', null, handler1, null)
    patchEvent(el2, 'onKeyup', null, handler2, null)
    triggerEvent(el1, 'keyup', e => (e.key = 'a'))
    triggerEvent(el2, 'keyup', e => (e.key = 'b'))
    expect(fn).toBeCalledTimes(2)
  })

  /** 测试场景：同一处理器分别以 ctrl、shift 生成包装并绑定两个按钮；包装对象不同，各自匹配系统键后原处理器累计两次，防止缓存串用守卫。 */
  it('withModifiers cache wrapped listener separately for different modifiers', () => {
    const el1 = document.createElement('button')
    const el2 = document.createElement('button')
    const fn = vi.fn()
    const handler1 = withModifiers(fn, ['ctrl'])
    const handler2 = withModifiers(fn, ['shift'])
    expect(handler1 === handler2).toBe(false)
    patchEvent(el1, 'onClick', null, handler1, null)
    patchEvent(el2, 'onClick', null, handler2, null)
    triggerEvent(el1, 'click', e => (e.ctrlKey = true))
    triggerEvent(el2, 'click', e => (e.shiftKey = true))
    expect(fn).toBeCalledTimes(2)
  })

  /** 测试场景：传入 null、undefined 处理器并指定修饰符；不抛错且分别原样返回 null、undefined，验证空处理器不会被包成可调用函数。 */
  it('withModifiers should handle null or undefined handler', () => {
    expect(() => {
      const handler1 = withModifiers(null as any, ['ctrl'])
      expect(handler1).toBe(null)
    }).not.toThrow()

    expect(() => {
      const handler2 = withModifiers(undefined as any, ['shift'])
      expect(handler2).toBe(undefined)
    }).not.toThrow()
  })
})
