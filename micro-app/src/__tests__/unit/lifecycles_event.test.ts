
import dispatchLifecyclesEvent, { dispatchCustomEventToMicroApp } from '../../interact/lifecycles_event'
import microApp from '../../micro_app'

/**
 * 保留的旧生命周期接口用例，当前 jest.config.js 的 testMatch 未纳入本文件。
 * rc.32 的 dispatchCustomEventToMicroApp 接收应用实例，空容器走 console.warn，全局钩子保存在
 * microApp.options.lifeCycles；下面的字符串参数、console.error 与 microApp.lifeCycles 沿用旧接口。
 */
/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('LifeCycles Event', () => {
  describe('dispatchCustomEventToMicroApp', () => {
    /**
     * 在宿主 window 监听 event-app，再以两个字符串调用 dispatchCustomEventToMicroApp。
     * 当前首参应为应用实例，字符串没有 sandBox，optional chain 不派发；
     * 原宿主回调断言不适用于当前沙箱 window 事件路径。
     */
    test('使用 dispatchCustomEventToMicroApp 方法发送事件，window 可以接收到事件', () => {
      const callback = jest.fn()
      window.addEventListener('event-app', callback)

      dispatchCustomEventToMicroApp('event', 'app')

      expect(callback).toBeCalled()
    })
  })

  describe('dispatchLifecyclesEvent', () => {
    const appName = 'app'
    beforeAll(() => {
      console.error = jest.fn()
    })

    /**
     * 传 undefined 容器调用生命周期派发并立即检查旧 console.error 文本。当前同步调用 logWarn，
     * 故空元素确实被拒绝但日志级别与旧断言不同，验证目标是缺容器出口。
     */
    test('element 为空，报错', () => {
      // @ts-ignore
      dispatchLifecyclesEvent(undefined, appName, 'mount')

      expect(console.error).toBeCalledWith(`[micro-app] app ${appName}: element does not exist in lifecycle mount`)
    })

    /**
     * 给真实 div 绑定 mount 监听器，再同步派发该名称。回调应收到 detail 中的应用名与原容器，
     * target/currentTarget 也指向 div；验证 DOM 派发与详情构造，
     * 本例 mount 字符串不是当前公开枚举中的 mounted。
     */
    test('发送 mount 事件，接收成功', () => {
      const container = document.createElement('div')
      container.addEventListener('mount', (e) => {
        const { name, container: detailContainer } = (e as CustomEvent).detail
        expect(name).toEqual(appName)
        expect(detailContainer).toEqual(container)
        expect(e.target).toEqual(container)
        expect(e.currentTarget).toEqual(container)
      })
      dispatchLifecyclesEvent(container, appName, 'mount')
    })

    /**
     * 把 created mock 写到旧 microApp.lifeCycles 属性，再派发 created。
     * 当前读取 options.lifeCycles，这个旧属性不会触发全局钩子；原期待调用的断言不构成当前插件式生命周期覆盖。
     */
    test('发送 created 事件，主应用监听了这个事件可以被触发', () => {
      const container = document.createElement('div')
      const onCreated = jest.fn()

      microApp.lifeCycles = { created: onCreated }
      dispatchLifecyclesEvent(container, appName, 'created')

      expect(onCreated).toBeCalled()
      microApp.lifeCycles = undefined
    })
  })
})
