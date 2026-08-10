/**
 * 测试阅读说明：本文件验证 `runtime-dom/patchEvents` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { patchProp } from '../src/patchProp'

/** 等待一个宏任务，使事件时间戳和监听器附加时机跨过同一事件循环边界。 */
const timeout = () => new Promise(r => setTimeout(r))

// 测试组：runtime-dom：事件修补。
describe(`runtime-dom: events patching`, () => {
  // 测试场景：应该分配事件处理程序。
  it('should assign event handler', async () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    patchProp(el, 'onClick', null, fn)
    el.dispatchEvent(new Event('click'))
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  // 测试场景：应该更新事件处理程序。
  it('should update event handler', async () => {
    const el = document.createElement('div')
    const prevFn = vi.fn()
    const nextFn = vi.fn()
    patchProp(el, 'onClick', null, prevFn)
    el.dispatchEvent(new Event('click'))
    patchProp(el, 'onClick', prevFn, nextFn)
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(prevFn).toHaveBeenCalledTimes(1)
    expect(nextFn).toHaveBeenCalledTimes(2)
  })

  // 测试场景：应该支持多个事件处理程序。
  it('should support multiple event handlers', async () => {
    const el = document.createElement('div')
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    patchProp(el, 'onClick', null, [fn1, fn2])
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该在调度期间快照事件处理程序数组。
  it('should snapshot event handler arrays during dispatch', async () => {
    const el = document.createElement('div')
    const fn2 = vi.fn()
    const fn3 = vi.fn()
    const fn4 = vi.fn()
    const handlers: Function[] = [
      vi.fn(() => {
        handlers[1] = fn3
        handlers.push(fn4)
      }),
      fn2,
    ]

    patchProp(el, 'onClick', null, handlers)
    el.dispatchEvent(new Event('click'))
    await timeout()

    expect(handlers[0]).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn3).not.toHaveBeenCalled()
    expect(fn4).not.toHaveBeenCalled()
  })

  // 测试场景：应该取消分配事件处理程序。
  it('should unassign event handler', async () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    patchProp(el, 'onClick', null, fn)
    patchProp(el, 'onClick', fn, null)
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).not.toHaveBeenCalled()
  })

  // 测试场景：应该支持事件选项修饰符。
  it('should support event option modifiers', async () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    patchProp(el, 'onClickOnceCapture', null, fn)
    el.dispatchEvent(new Event('click'))
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该使用选项取消分配事件处理程序。
  it('should unassign event handler with options', async () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    patchProp(el, 'onClickCapture', null, fn)
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)

    patchProp(el, 'onClickCapture', fn, null)
    el.dispatchEvent(new Event('click'))
    await timeout()
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该支持原生onclick。
  it('should support native onclick', async () => {
    const el = document.createElement('div')

    // string should be set as attribute
    const fn = ((el as any).spy = vi.fn())
    patchProp(el, 'onclick', null, 'this.spy(1)')
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).toHaveBeenCalledWith(1)

    const fn2 = vi.fn()
    patchProp(el, 'onclick', 'this.spy(1)', fn2)
    const event = new Event('click')
    el.dispatchEvent(event)
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith(event)
  })

  // 测试场景：应该在多个监听器上支持 stopImmediatePropagation。
  it('should support stopImmediatePropagation on multiple listeners', async () => {
    const el = document.createElement('div')
    const fn1 = vi.fn((e: Event) => {
      e.stopImmediatePropagation()
    })
    const fn2 = vi.fn()
    patchProp(el, 'onClick', null, [fn1, fn2])
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(0)
  })

  // #1747
  // 测试场景：应该处理绑定在多个目标上的相同 computed 处理函数。
  it('should handle same computed handler function being bound on multiple targets', async () => {
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')

    // const event = new Event('click')
    const prevFn = vi.fn()
    const nextFn = vi.fn()

    patchProp(el1, 'onClick', null, prevFn)
    patchProp(el2, 'onClick', null, prevFn)

    el1.dispatchEvent(new Event('click'))
    el2.dispatchEvent(new Event('click'))
    await timeout()
    expect(prevFn).toHaveBeenCalledTimes(2)
    expect(nextFn).toHaveBeenCalledTimes(0)

    patchProp(el1, 'onClick', prevFn, nextFn)
    patchProp(el2, 'onClick', prevFn, nextFn)

    el1.dispatchEvent(new Event('click'))
    el2.dispatchEvent(new Event('click'))
    await timeout()
    expect(prevFn).toHaveBeenCalledTimes(2)
    expect(nextFn).toHaveBeenCalledTimes(2)

    el1.dispatchEvent(new Event('click'))
    el2.dispatchEvent(new Event('click'))
    await timeout()
    expect(prevFn).toHaveBeenCalledTimes(2)
    expect(nextFn).toHaveBeenCalledTimes(4)
  })

  // vuejs/vue#6566
  // 测试场景：不应触发事件本身附加的处理程序。
  it('should not fire handler attached by the event itself', async () => {
    const el = document.createElement('div')
    const child = document.createElement('div')
    el.appendChild(child)
    document.body.appendChild(el)
    const childFn = vi.fn()
    const parentFn = vi.fn()

    patchProp(child, 'onClick', null, () => {
      childFn()
      patchProp(el, 'onClick', null, parentFn)
    })

    await timeout()
    child.dispatchEvent(new Event('click', { bubbles: true }))

    expect(childFn).toHaveBeenCalled()
    expect(parentFn).not.toHaveBeenCalled()
  })

  // #2841
  // 测试场景：应该在网络组件中正确修补事件。
  test('should patch event correctly in web-components', async () => {
    class TestElement extends HTMLElement {
      constructor() {
        super()
      }
    }
    window.customElements.define('test-element', TestElement)
    const testElement = document.createElement('test-element', {
      is: 'test-element',
    })
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    // in webComponents, @foo-bar will patch prop 'onFooBar'
    // and @foobar will patch prop 'onFoobar'

    patchProp(testElement, 'onFooBar', null, fn1)
    testElement.dispatchEvent(new CustomEvent('foo-bar'))
    expect(fn1).toHaveBeenCalledTimes(1)

    patchProp(testElement, 'onFoobar', null, fn2)
    testElement.dispatchEvent(new CustomEvent('foobar'))
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  // #8334
  // 测试场景：应该支持一次被动捕获。
  test('should support once passive capture', async () => {
    const el = document.createElement('div')

    const onOnce = vi.fn()
    const onPassive = vi.fn()
    const onCapture = vi.fn()

    patchProp(el, 'onOnce', null, onOnce)
    patchProp(el, 'onPassive', null, onPassive)
    patchProp(el, 'onCapture', null, onCapture)

    el.dispatchEvent(new Event('once'))
    await timeout()
    expect(onOnce).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new Event('passive'))
    await timeout()
    expect(onPassive).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new Event('capture'))
    await timeout()
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该支持网络组件中的一次被动捕获。
  test('should support once passive capture in web-components', async () => {
    class TestCustomElement extends HTMLElement {
      constructor() {
        super()
      }
    }

    if (!window.customElements.get('hello-world')) {
      window.customElements.define('hello-world', TestCustomElement)
    }

    const customElement = document.createElement('hello-world')

    const onOnce = vi.fn()
    const onPassive = vi.fn()
    const onCapture = vi.fn()

    patchProp(customElement, 'onOnce', null, onOnce)
    patchProp(customElement, 'onPassive', null, onPassive)
    patchProp(customElement, 'onCapture', null, onCapture)

    customElement.dispatchEvent(new CustomEvent('once'))
    expect(onOnce).toHaveBeenCalledTimes(1)

    customElement.dispatchEvent(new CustomEvent('passive'))
    expect(onPassive).toHaveBeenCalledTimes(1)

    customElement.dispatchEvent(new CustomEvent('capture'))
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该支持带有once修饰符的once事件。
  test('should support once event with the once modifier', async () => {
    const el = document.createElement('div')

    const onOnce = vi.fn()

    patchProp(el, 'onOnceOnce', null, onOnce)

    el.dispatchEvent(new Event('once'))
    await timeout()
    expect(onOnce).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new Event('once'))
    await timeout()
    expect(onOnce).toHaveBeenCalledTimes(1)
  })

  // 测试场景：应该支持保留大小写的选项修饰符事件名称。
  test('should support preserved-case option modifier event names', async () => {
    const el = document.createElement('div')

    const onOnce = vi.fn()
    const onPassive = vi.fn()
    const onCapture = vi.fn()

    patchProp(el, 'on:Once', null, onOnce)
    patchProp(el, 'on:Passive', null, onPassive)
    patchProp(el, 'on:Capture', null, onCapture)

    el.dispatchEvent(new Event('Once'))
    await timeout()
    expect(onOnce).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new Event('Passive'))
    await timeout()
    expect(onPassive).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new Event('Capture'))
    await timeout()
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  // 测试场景：事件对象的类型未知时，事件修补逻辑仍能安全处理。
  it('handles an unknown type', () => {
    const el = document.createElement('div')
    patchProp(el, 'onClick', null, 'test')
    el.dispatchEvent(new Event('click'))
    expect(
      `Wrong type passed as event handler to onClick - did you forget @ or : ` +
        `in front of your prop?\nExpected function or array of functions, received type string.`,
    ).toHaveBeenWarned()
  })
})
