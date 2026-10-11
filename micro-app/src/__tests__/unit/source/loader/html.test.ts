import { AppInterface } from '@micro-app/types'

import { waitFor } from '../../../common/util'
import { HTMLLoader } from '../../../../source/loader/html'
import { MOCK_APP_URL, MOCK_APP_URL_UMD } from '../../mocks/app'
import { MOCK_BASIC_HTML, MOCK_APP_HTML } from '../../mocks/html'
import { setupMockFetch } from '../../mocks/fetch'
import microApp from '../../../../micro_app'

/**
 * 这组用例保留旧 HTMLLoader 接口：插件写入 microApp.plugins 并期待三个回调参数；rc.32 读取
 * microApp.options.plugins，只传 code、url。HTML 预期 fixture 还删去了 zeromock 脚本，而当前
 * 内置容器转换只改写 head/body，不做该删除。本文件不在默认 Jest testMatch 中。
 */

/**
 * 为 HTMLLoader 用例安装固定 fetch，并创建成功、错误和应用错误观察点。
 *
 * 返回的 errorCb 用作应用 onerror，onLoadError 只做次数观察，不包含真实 CreateApp 的
 * 状态/DOM 错误传播；等待函数只跨到下一计时器任务，不等待任意网络请求。
 *
 * @param html - fetch 成功时返回的 HTML。
 * @param error - 是否模拟网络拒绝。
 */
const setup = (html: string, error?: boolean) => {
  // @ts-ignore：测试需用桩替换全局 fetch（原注：cangdu）。
  global.fetch = jest.fn().mockImplementation(setupMockFetch(html, error))
  const htmlLoader = HTMLLoader.getInstance()
  const successCb = jest.fn()
  const errorCb = jest.fn()
  const onLoadError = jest.fn()

  return {
    htmlLoader,
    successCb,
    errorCb,
    onLoadError
  }
}

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('HTMLLoader', () => {
  beforeAll(() => {
    console.error = jest.fn()
  })

  /**
   * 让 fetch stub 返回包含四个脚本的 MOCK_BASIC_HTML，调用普通 URL 入口并在下一计时器任务检查成功输出。
   * 当前只替换 head/body，保留 zeromock 外链；MOCK_APP_HTML 少该脚本，旧逐字预期不匹配实际格式化职责。
   *
   */
  test('给定一个 url，可以获取到 html 字符串', async () => {
    const { htmlLoader, successCb } = setup(MOCK_BASIC_HTML)
    const app = {
      name: 'app-1',
      url: MOCK_APP_URL
    } as AppInterface
    htmlLoader.run(app, successCb)

    await waitFor(() => {
      expect(successCb).toBeCalledWith(MOCK_APP_HTML, app)
    })
  })

  /**
   * 让 fetch 返回空字符串，应用分别注入 onerror/onLoadError mock，再运行加载器并等下一任务。
   * 应同步进入 then 内空响应出口，调用 onerror、记录空 HTML 日志而不调用 onLoadError；
   * 验证空响应和抓取拒绝的区分。
   */
  test('给定一个 url，获取到空的 html 字符串，应该报错', async () => {
    const { htmlLoader, successCb, errorCb, onLoadError } = setup('')
    const app = {
      name: 'app-1',
      url: MOCK_APP_URL,
      onerror: errorCb as any,
      onLoadError: onLoadError as any,
    } as AppInterface
    htmlLoader.run(app, successCb)

    const logError = jest.spyOn(console, 'error')
    await waitFor(() => {
      expect(onLoadError).not.toBeCalled()
      expect(logError).toHaveBeenLastCalledWith(`[micro-app] app ${app.name}: html is empty, please check in detail`)
      expect(errorCb).toBeCalled()
    })
  })

  /**
   * 令 fetch Promise 拒绝，应用注入独立 onLoadError mock，再运行并等下一任务。
   * catch 会记录日志并调用 onLoadError，断言只观察日志及直接 onerror 未调用；
   * 该 mock 不执行真实 CreateApp 的错误传播，也未直接断言 successCb/onLoadError 次数。
   */
  test('给定一个 url，网络错误，应该报错', async () => {
    const { htmlLoader, successCb, errorCb, onLoadError } = setup(MOCK_BASIC_HTML, true)
    const app = {
      name: 'app-1',
      url: MOCK_APP_URL,
      onerror: errorCb as any,
      onLoadError: onLoadError as any,
    } as AppInterface
    htmlLoader.run(app, successCb)

    const logError = jest.spyOn(console, 'error')
    await waitFor(() => {
      expect(logError).toBeCalled()
      expect(errorCb).not.toBeCalled()
    })
  })

  /**
   * 应用入口 pathname 以 .js 结尾，虽然已安装返回 HTML 的 fetch stub，
   * run 会直接合成带该 src 的最小 HTML，不发 fetch。旧预期仍用普通 MOCK_APP_HTML，
   * 因此这不是可通过的 componentMode 转换测试，而是 JS 入口特判的不匹配断言。
   */
  test('测试一个compomentMode', async () => {
    const { htmlLoader, successCb } = setup(MOCK_BASIC_HTML)
    const app = {
      name: 'app-2',
      url: MOCK_APP_URL_UMD
    } as AppInterface
    htmlLoader.run(app, successCb)

    await waitFor(() => {
      expect(successCb).toBeCalledWith(MOCK_APP_HTML, app)
    })
  })

  describe('plugin', () => {
    afterEach(() => {
      microApp.plugins = undefined
    })

    /**
     * 把应用插件写入旧 microApp.plugins，stub 返回普通 HTML，再运行并期待 processHtml 收到三参。
     * 当前读取 options.plugins 且只传 code/url，故这个 mock 不由所写配置调用；
     * 验证意图是模块插件但配置与参数契约都已变化。
     */
    test('预期插件配置里的 processHtml 可以生效', async () => {
      const processHtml = jest.fn().mockImplementation(code => code)
      microApp.plugins = {
        global: undefined,
        modules: {
          'app-1': [{
            processHtml
          }]
        }
      }

      const { htmlLoader, successCb } = setup(MOCK_BASIC_HTML)
      const app = {
        name: 'app-1',
        url: MOCK_APP_URL
      } as AppInterface
      htmlLoader.run(app, successCb)

      await waitFor(() => {
        expect(processHtml).toBeCalledWith(MOCK_BASIC_HTML, app.url, undefined)
      })
    })

    /**
     * 把全局插件写入旧 microApp.plugins，再运行普通入口并期待 processHtml 收到三参。
     * 当前 options.plugins 才是插件来源，本例不能证明全局链；若配置迁移正确，源码也只传 code/url 两参。
     */
    test('预期插件 global 配置里的 processHtml 可以生效', async () => {
      const processHtml = jest.fn().mockImplementation(code => code)
      microApp.plugins = {
        global: [{
          processHtml
        }]
      }

      const { htmlLoader, successCb } = setup(MOCK_BASIC_HTML)
      const app = {
        name: 'app-1',
        url: MOCK_APP_URL
      } as AppInterface
      htmlLoader.run(app, successCb)

      await waitFor(() => {
        expect(processHtml).toBeCalledWith(MOCK_BASIC_HTML, app.url, undefined)
      })
    })
  })
})
