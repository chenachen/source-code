/* eslint-disable promise/param-names */
import '@webcomponents/webcomponentsjs/custom-elements-es5-adapter'
import { setCurrentAppName, defer } from '../../libs/utils'
/** 测试用静态资源服务器模块；各集成用例按端口复用同一进程接口。 */
const liveServer = require('../../../scripts/test_server')
// 让 fixture 请求使用 Node fetch；真实计时器使空闲调度兼容函数、资源回调与测试等待遵循实际任务队列。
global.fetch = require('node-fetch')
jest.useRealTimers()

declare global {
  /** 测试为宿主元素补充的 SSR 请求地址字段。 */
  interface Element {
    /** SSR 场景最终解析出的 HTML 地址。 */
    ssrUrl: string
  }
  /** 宿主测试安装的观察函数；keep-alive demo 的状态监听调用它，不自行创建 mock。 */
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

/**
 * 让当前套件通过独立端口访问 `demos` 下的原始 HTML/CSS/JS 响应。
 *
 * `liveServer.params` 是模块共享配置；传入端口时直接改写它再调用 start，并不等待
 * 网络就绪 Promise。各集成套件在 beforeAll 中调用，在 afterAll 中 shutdown。
 * @param port - `ports` 中分给当前套件的监听端口；省略时沿用服务器现有配置。
 */
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

/**
 * 用转发函数替换 console.warn/error，使框架日志的完整参数进入同一组 Jest mock。
 *
 * 本方法不清除历史调用；Jest clearMocks/beforeEach 决定断言的记录窗口，不能把一次
 * `toHaveBeenCalled()` 自动解释为当前操作新增日志。releaseConsole 负责恢复原引用。
 */
export function rewriteConsole (): void {
  /** 将警告参数原样转给 jestConsoleWarn，不向真实终端重复输出。 */
  global.console.warn = function warn(...rests: any[]) {
    // rawWarn.call(global.console, ...rests)
    jestConsoleWarn(...rests)
  }
  /** 将错误参数原样转给 jestConsoleError，供用例核对错误类型和应用名。 */
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

/**
 * 构造宿主与子应用可互相区分的 DOM、样式和函数观察点。
 *
 * 宿主 `.test-color` 为绿色，demo 同名规则可验证 CSS 作用域；testBindFunction 的
 * prototype 与静态 abc 供绑定函数属性保留测试使用，document.onclick 与子应用点击
 * 处理器形成对照。#app-container 是所有宿主元素的插入点；body 会整体重建。
 */
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

/**
 * 集成套件的统一前置环境：先启动 fixture 服务，再捕获日志，最后构造基座 DOM。
 * @param port - 当前套件的 fixture 服务端口；只负责初始化，不调用 microApp.start。
 */
export function commonStartEffect (port?: number): void {
  startServer(port)
  rewriteConsole()
  initDocument()
}

/**
 * 清空 #app-container 以触发其中元素的断开流程，延迟 200ms 后关闭服务器并恢复 console。
 * 延时为动态资源回调留出执行时间；它不等待各应用的异步卸载 Promise。
 * 实例 Map、远程资源缓存与日志 mock 记录也不在此清空，后续场景须按各自准备步骤判断。
 *
 * @returns 所有延迟清理完成后结算为 `true`。
 */
export function releaseAllEffect (): Promise<boolean> {
  // 在 Jest 清空 document 前先触发容器内元素的断开回调。
  document.querySelector('#app-container')!.innerHTML = ''

  return new Promise((resolve) => {
    // 给动态资源回调留出 200ms，然后关闭测试服务器。
    setTimeout(() => {
      liveServer.shutdown()
      releaseConsole()
      resolve(true)
    }, 200)
  })
}

/**
 * 临时设置动态 DOM 操作归属的应用名，并在下一微任务清空。
 * 同一同步任务内创建的节点会读到该名字；不保留到后续异步任务。
 * @param appName - 本次同步 DOM 操作所属应用。
 */
export function setAppName (appName: string): void {
  setCurrentAppName(appName)
  defer(() => setCurrentAppName(null))
}

/** 立即清空动态 DOM 补丁使用的当前应用作用域。 */
export function clearAppName (): void {
  setCurrentAppName(null)
}
