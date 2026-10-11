/* eslint-disable promise/param-names */
import {
  commonStartEffect,
  releaseAllEffect,
  ports,
  jestConsoleError,
} from './common/initial'
import microApp from '..'

/** 公共 API 集成套件；首次用例启动单例，后续场景沿用其宿主、应用注册与 hasInit，只有显式 await 的 Promise 纳入用例完成边界。 */
describe('micro_app', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.micro_app)
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 场景：当前模块单例尚未 start，传入 inline 和两个旧驼峰隔离配置。
   * 调用 start 后立即断言 customElements 已注册 micro-app 标签。
   * 验证首次启动能完成同步元素注册；没有创建子应用，也没有断言所有全局配置的归一化结果。
   */
  test('just define micro-app in pure start', () => {
    microApp.start({
      shadowDOM: false,
      destroy: false,
      inline: true,
      disableScopecss: false,
      disableSandbox: false,
    })

    expect(Boolean(window.customElements.get('micro-app'))).toBeTruthy()
  })

  /**
   * 场景：前例已注册自定义元素，目标容器由 beforeAll 构造。
   * 用 renderApp 提供 test-app1/common 入口与元素容器，await 其完成后检查 getAllApps 包含名称。
   * 验证命令式渲染与实例注册衔接；then 未读取返回布尔值，本例不单独检查事件参数或容器内容。
   */
  test('test microApp.renderApp', async () => {
    await microApp.renderApp({
      name: 'test-app1',
      url: `http://127.0.0.1:${ports.micro_app}/common/`,
      container: appCon,
    }).then(() => {
      expect(microApp.getAllApps().includes('test-app1')).toBeTruthy()
    })
  })

  /**
   * 场景：沿用前例已挂载的 test-app1，不重新创建或清理应用。
   * 直接查询 getActiveApps 和 getAllApps，分别断言都包含 test-app1。
   * 验证当前活跃实例同时属于全量注册表；没有覆盖隐藏、预取或 UNMOUNT 的筛选参数。
   */
  test('test microApp.getActiveApps/getAllApps', async () => {
    expect(microApp.getActiveApps().includes('test-app1')).toBeTruthy()
    expect(microApp.getAllApps().includes('test-app1')).toBeTruthy()
  })

  /**
   * 场景：test-app1 已有宿主，调用公开 reload。
   * 在完成回调里检查活跃表仍含该名称，观察重载后的查询目标。
   * 本例没有 return/await reload Promise，也未比较实例身份、重载数据或两次生命周期，异步断言未成为测试函数的等待边界。
   */
  test('test microApp.reload', async () => {
    microApp.reload('test-app1').then(() => {
      expect(microApp.getActiveApps().includes('test-app1')).toBeTruthy()
    })
  })

  /**
   * 场景：对前例的 test-app1 先发单应用卸载，再发全量串行卸载。
   * 各自 then 回调要求活跃表已排除该名称，验证公开入口期望的退出活跃状态。
   * 两条 Promise 均未 return/await，且相互可交叠；不据此声称严格卸载顺序或全部清理已经验证。
   */
  test('test microApp.unmountApp/unmountAllApps', async () => {
    microApp.unmountApp('test-app1').then(() => {
      expect(microApp.getActiveApps().includes('test-app1')).toBeFalsy()
    })

    microApp.unmountAllApps().then(() => {
      expect(microApp.getActiveApps().includes('test-app1')).toBeFalsy()
    })
  })

  /**
   * 场景：单例虽已 start，临时把 window.customElements 改成 undefined。
   * 再次 start 后核对“不支持当前环境”的完整错误文本，再恢复原 customElements 引用。
   * 验证浏览器能力检查先于 hasInit 的重复启动检查。
   */
  test('log error message if customElements is not supported in this environment', () => {
    const rawCustomElements = window.customElements
    Object.defineProperty(window, 'customElements', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    microApp.start()
    expect(jestConsoleError).toBeCalledWith('[micro-app] micro-app is not supported in this environment')

    window.customElements = rawCustomElements
  })

  /**
   * 场景：单例已经 start，再传入非法 tagName=error-name。
   * 断言错误是 microApp.start executed repeatedly，验证 hasInit 检查先于标签校验。
   * 本例没有执行非法标签正则分支，不能用标题认定标签校验已覆盖。
   */
  test('log error message if config error tagName', () => {
    microApp.start({
      tagName: 'error-name',
    })

    expect(jestConsoleError).toBeCalledWith('[micro-app] microApp.start executed repeatedly')
  })

  /**
   * 场景：已启动单例再次收到含特殊应用名的 modules 插件配置。
   * 调用 start 后没有断言；当前流程在 hasInit 处记录重复启动并返回。
   * 此正文只调用重复启动路径，未进入插件名规范化，也未验证 12$、special-&name 的映射结果。
   */
  test('format appName for plugins modules', () => {
    microApp.start({
      tagName: 'micro-app-plugins-modules',
      plugins: {
        modules: {
          '12$': [],
          'special-&name': [],
          'normal-name': []
        }
      }
    })
  })
})
