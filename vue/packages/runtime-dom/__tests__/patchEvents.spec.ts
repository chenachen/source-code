import { patchProp } from '../src/patchProp'

/** 等待一个宏任务，使事件时间戳和监听器附加时机跨过同一事件循环边界。 */
const timeout = () => new Promise(r => setTimeout(r))

// 测试组：向真实元素挂载、替换和移除spy事件处理器，再dispatch原生事件；比较调用计数、数组中止、选项、命名和监听时间过滤。
describe(`runtime-dom: events patching`, () => {
  /** 测试场景：空 div 绑定 onClick 后连续派发三次 click，处理器调用三次，核对 DOM 监听注册。 */
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

  /** 测试场景：先绑定 prevFn 并触发，再把同事件更新 nextFn；旧函数仅一次，新函数后续两次，核对稳定代理替换 value。 */
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

  /** 测试场景：onClick 绑定两函数数组，一次 click 两函数各一次，核对数组事件分发。 */
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

  /** 测试场景：第一处理器在分发中替换数组第二项并追加第四项；当前事件仍调用旧第二项，新项不调用，核对 value.slice 快照。 */
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

  /** 测试场景：绑定 onClick 后更新 null，再派发 click；处理器不调用，核对同一 invoker 解绑。 */
  it('should unassign event handler', async () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    patchProp(el, 'onClick', null, fn)
    patchProp(el, 'onClick', fn, null)
    el.dispatchEvent(new Event('click'))
    await timeout()
    expect(fn).not.toHaveBeenCalled()
  })

  /** 测试场景：onClickOnceCapture 派发多次 click 只一次，核对尾部 options 解析与原生 once。 */
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

  /** 测试场景：onClickCapture 首次事件调用后移除，后续事件不再增加次数，核对解绑使用相同 options。 */
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

  /** 测试场景：小写 onclick 先传事件源码字符串调用 this.spy，再改函数收到 Event；核对 attribute 与原生 property 两条路径。 */
  it('should support native onclick', async () => {
    const el = document.createElement('div')

    // 字符串 onClick 作为 attribute 写入。
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

  /** 测试场景：两处理器中第一调用 stopImmediatePropagation，一次 click 仅第一执行，核对 invoker 数组停止标记。 */
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
  /** 测试场景：两元素共用旧处理器，再各自更新同一个新处理器；次数按目标分别增加，核对缓存归元素而不是归原函数。 */
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
  /** 测试场景：子 click 冒泡期间新增父 onClick；本次仅子处理器调用，核对 _vts/attached 拒绝事件自身新增监听。 */
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
  /** 测试场景：自定义元素分别监听 foo-bar 与 foobar，一次对应 CustomEvent 各调用一次，核对事件名称规范化保持区分。 */
  test('should patch event correctly in web-components', async () => {
    /** 注册可手动创建的HTMLElement子类fixture；只调用原生构造器，用来检查自定义元素事件名称保留大小写。 */
    class TestElement extends HTMLElement {
      /** 调用HTMLElement原生构造器初始化测试自定义元素，未添加额外状态或监听器。 */
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

    // 自定义元素中的 @foo-bar 编译为 onFooBar，
    // @foobar 编译为 onFoobar，分别匹配原名事件。

    patchProp(testElement, 'onFooBar', null, fn1)
    testElement.dispatchEvent(new CustomEvent('foo-bar'))
    expect(fn1).toHaveBeenCalledTimes(1)

    patchProp(testElement, 'onFoobar', null, fn2)
    testElement.dispatchEvent(new CustomEvent('foobar'))
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  // #8334
  /** 测试场景：普通 div 监听本名 once/passive/capture 并派发，各调用一次；这些唯一事件名不能被当作 option 剥离。 */
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

  /** 测试场景：自定义元素同样派发 once/passive/capture，各命中原名处理器，核对 option 本名保护。 */
  test('should support once passive capture in web-components', async () => {
    /** 注册可手动创建的HTMLElement子类fixture；只调用原生构造器，用来检查自定义元素事件名称保留大小写。 */
    class TestCustomElement extends HTMLElement {
      /** 调用HTMLElement原生构造器初始化测试自定义元素，未添加额外状态或监听器。 */
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

  /** 测试场景：onOnceOnce 监听 once 本名并启用 once option，多次派发仅一次；只剥离真正的尾修饰符。 */
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

  /** 测试场景：on:Once/on:Passive/on:Capture 监听保留大小写的 Event 名，各一次，核对冒号路径不转 kebab-case。 */
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

  /** 测试场景：onClick 误传字符串 test 后派发 click，只断言开发告警；sanitizeEventValue 使用 NOOP 防止把字符串作为函数调用。 */
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
