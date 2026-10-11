import './common/set_ssr_env'
import preFetch from '../prefetch'
import { initGlobalEnv } from '../libs/global_env'
import microApp from '../micro_app'

describe('test ssr environment', () => {
  // 捕获入口的环境错误；本文件未列入当前 Jest 默认 testMatch，须显式选择才能执行。
  beforeAll(() => {
    global.console.error = jest.fn()
  })

  /**
   * 场景：set_ssr_env 在模块导入前移除 global.window，使 utils 的 isBrowser 常量为假。
   * 调用 preFetch([])，断言非浏览器错误日志。
   * 验证环境检查先于数组内容校验，空数组仍被拒绝；不涉及网络预取。
   */
  test('run prefetch in non browser environment', () => {
    preFetch([])
    expect(console.error).toBeCalledWith('[micro-app] preFetch is only supported in browser environment')
  })

  /**
   * 场景：沿用无 window 的模块环境，调用 microApp.start 与 initGlobalEnv。
   * 两次操作后断言“不支持当前环境”的错误日志曾出现。
   * 错误来自 start 的环境检查；initGlobalEnv 非浏览器时直接返回，本例没有断言全局快照字段或 SSR DOM 渲染。
   */
  test('run start in non browser environment', () => {
    microApp.start()
    initGlobalEnv()
    expect(console.error).toBeCalledWith('[micro-app] micro-app is not supported in this environment')
  })
})
