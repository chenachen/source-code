import { AppInterface } from '@micro-app/types'

import { waitFor } from '../../../common/util'
import { HTMLLoader } from '../../../../source/loader/html'
import { MOCK_APP_URL, MOCK_APP_URL_UMD } from '../../mocks/app'
import { MOCK_BASIC_HTML, MOCK_APP_HTML } from '../../mocks/html'
import { setupMockFetch } from '../../mocks/fetch'
import microApp from '../../../../micro_app'

/**
 * 为 HTMLLoader 用例安装固定 fetch，并创建成功、错误和应用错误观察点。
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

describe('HTMLLoader', () => {
  beforeAll(() => {
    console.error = jest.fn()
  })

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
   * Given：fetch stub 对应用 HTML 请求返回 Promise rejection。
   * When：HTMLLoader 执行该入口地址。
   * Then：记录加载失败，且不进入空 HTML 使用的应用 `onerror` 通道。
   *
   * 验证机制：等待异步链结束后断言错误日志出现且 `onerror` 未调用，区分网络 catch 与空响应路径；
   * 当前用例虽然注入了 `onLoadError`，但没有直接断言它收到的参数。
   * 对应源码：`HTMLLoader.run()` 的 fetch catch 分支、`CreateApp.onLoadError()`。
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
