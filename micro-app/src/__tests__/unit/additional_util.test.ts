import { AppInterface } from '@micro-app/types'

import { initEnvOfNestedApp } from '../../libs/nest_app'
import { AppManager } from '../../app_manager'

/**
 * 嵌套卸载的历史用例，当前 jest.config.js 的 testMatch 未纳入本文件。
 * initEnvOfNestedApp 只在 __MICRO_APP_ENVIRONMENT__ 为真时登记监听；这里在 describe 阶段初始化，
 * beforeEach 才设置标记。第二用例也没有显式调用释放函数，因此这些断言不构成当前清理流程的证据。
 */
/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('Additional Util', () => {
  const appManager = AppManager.getInstance()
  const appName = 'nest-app'
  const container = document.createElement('div') as HTMLElement
  // @ts-ignore
  container.disconnectedCallback = jest.fn()
  const app = {
    name: appName,
    container
  } as AppInterface

  initEnvOfNestedApp()

  beforeEach(() => {
    window.__MICRO_APP_ENVIRONMENT__ = true
    appManager.set(appName, app)
  })

  afterEach(() => {
    window.__MICRO_APP_ENVIRONMENT__ = undefined
    appManager.clear()
  })

  /**
   * describe 初始化时尚未设置嵌套环境标记，beforeEach 才登记带 disconnectedCallback mock
   *  的应用并置标记，再派发 unmount。当前没有提前注册监听，因此实例通常保留、断开 mock 不调用；正文期待删除/断开，
   * 与初始化顺序不符。
   */
  test('期望 listenUmountOfNestedApp 可以卸载嵌套子应用', () => {
    const unmountEvent = new CustomEvent('unmount')
    window.dispatchEvent(unmountEvent)
    expect(appManager.get(appName)).toBe(undefined)
    // @ts-ignore
    expect(container.disconnectedCallback).toBeCalled()
  })

  /**
   * 再次登记同一应用并派发 unmount，正文没有调用 releaseUnmountOfNestedApp。由于初始阶段未注册监听，
   * 实例保留和 mock 未调用可成立，但不能证明释放函数成功移除监听。
   */
  test('期望 releaseUnmountOfNestedApp 可以移除监听事件', () => {
    const unmountEvent = new CustomEvent('unmount')
    window.dispatchEvent(unmountEvent)
    expect(appManager.get(appName)).toBe(app)
    // @ts-ignore
    expect(container.disconnectedCallback).not.toBeCalled()
  })
})
