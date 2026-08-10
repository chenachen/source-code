/* eslint-disable promise/param-names */
import '@webcomponents/webcomponentsjs/custom-elements-es5-adapter'
import { setCurrentAppName, defer } from '../../libs/utils'
/** 测试用静态资源服务器模块；各集成用例按端口复用同一进程接口。 */
const liveServer = require('../../../scripts/test_server')
global.fetch = require('node-fetch')
jest.useRealTimers()

declare global {
  /** 测试为宿主元素补充的 SSR 请求地址字段。 */
  interface Element {
    /** SSR 场景最终解析出的 HTML 地址。 */
    ssrUrl: string
  }
  /** keep-alive demo 脚本写入的全局测试观察点。 */
  interface Window {
    /** 接收子应用侧 `beforeshow`、`aftershow`、`afterhidden` 状态。 */
    keepAliveListener: (...rest: any[]) => void
  }
}

/** 各集成测试资源服务器的固定端口，避免并行套件互相占用同一监听地址。 */
export const ports = {
  main: 9000,
  create_app: 9001,
  micro_app_element: 9002,
  lifecycles_event: 9003,
  sandbox: 9004,
  effect: 9005,
  effect2: 9006,
  source_index: 9007,
  source_links: 9008,
  load_event: 9009,
  scoped_css: 9010,
  source_scripts: 9011,
  source_scripts2: 9012,
  source_patch: 9013,
  prefetch: 9014,
  micro_app: 9015,
  custom_proxy_document: 9016,
}

/** 启动资源服务器，并在提供端口时覆盖当前监听配置。 */
export function startServer (port?: number): void {
  if (typeof port === 'number') {
    liveServer.params.port = port
  }

  liveServer.start(liveServer.params)
}

// 保存原生 console 方法，测试结束时必须恢复，避免污染其他 Jest 套件。
const rawWarn = global.console.warn
/** 测试启动前保存的原生 `console.error`。 */
const rawError = global.console.error
/** 收集框架警告及其完整参数的 Jest mock。 */
export const jestConsoleWarn = jest.fn()
/** 收集框架错误及其完整参数的 Jest mock。 */
export const jestConsoleError = jest.fn()

/** 把全局警告/错误输出重定向到可断言的 Jest mock。 */
export function rewriteConsole (): void {
  global.console.warn = function warn(...rests: any[]) {
    // rawWarn.call(global.console, ...rests)
    jestConsoleWarn(...rests)
  }
  global.console.error = function error(...rests: any[]) {
    // rawError.call(global.console, ...rests)
    jestConsoleError(...rests)
  }
  // global.console.warn = jestConsoleWarn
  // global.console.error = jestConsoleError
}

/** 恢复测试启动前的全局 console 方法。 */
export function releaseConsole (): void {
  global.console.warn = rawWarn
  global.console.error = rawError
}

/** 重建每个集成套件依赖的基座样式、全局函数和应用容器。 */
export function initDocument (): void {
  const baseStyle = document.createElement('style')
  baseStyle.id = 'base-app-style'
  baseStyle.textContent = `
    body {
      background: #fff;
    }
    .test-color {
      color: green;
    }
  `
  const baseScript = document.createElement('script')
  baseScript.textContent = `
    window.testBindFunction = function () {console.log('testBindFunction 被执行了')};
    testBindFunction.prototype = {a: 1};
    testBindFunction.abc = 11;

    document.onclick = function onClickOfBase () { console.warn('基座的onclick') }
  `
  document.head.append(baseStyle)
  document.head.append(baseScript)
  document.body.innerHTML = `
    <div id='root'>
      <div class='test-color'>text1</div>
      <div id='app-container'></div>
    </div>
  `
}

/** 启动指定端口服务器、重写 console，并初始化基座 DOM。 */
export function commonStartEffect (port?: number): void {
  startServer(port)
  rewriteConsole()
  initDocument()
}

/**
 * 卸载测试创建的全部元素，等待动态资源任务收尾，再关闭服务器并恢复 console。
 *
 * @returns 所有延迟清理完成后结算为 `true`。
 */
export function releaseAllEffect (): Promise<boolean> {
  // 所有test结束后，jest会自动清空document及其内容，从而导致出错，所以要主动卸载所有应用
  document.querySelector('#app-container')!.innerHTML = ''

  return new Promise((resolve) => {
    // 处理动态添加的资源
    setTimeout(() => {
      liveServer.shutdown()
      releaseConsole()
      resolve(true)
    }, 200)
  })
}

/**
 * 绑定应用
 * @param appName 应用名称
 */
export function setAppName (appName: string): void {
  setCurrentAppName(appName)
  defer(() => setCurrentAppName(null))
}

/** 立即清空动态 DOM 补丁使用的当前应用作用域。 */
export function clearAppName (): void {
  setCurrentAppName(null)
}
