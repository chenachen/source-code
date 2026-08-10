import { isFunction, removeDomScope } from '../libs/utils'
import microApp from '../micro_app'

/**
 * 获取 HTML、JavaScript 或 CSS 文本，并统一接入用户自定义抓取器。
 *
 * 调用前清除当前子应用 DOM 作用域，防止异步页面跳转期间基座重写的 `fetch` 被误判为
 * 子应用 DOM 操作。自定义抓取器负责直接返回文本；原生分支只调用 `Response.text()`，
 * 不在此处检查 HTTP 状态。
 *
 * @param url - 已补全或可由抓取器识别的资源地址。
 * @param appName - 发起请求的应用名；全局资源可传 `null`。
 * @param options - 原样传给自定义抓取器或浏览器 `fetch` 的请求选项。
 * @returns 解析后的资源文本 Promise。
 */
export function fetchSource (url: string, appName: string | null = null, options = {}): Promise<string> {
  /**
   * 子应用点击后异步跳转时，事件阶段可能暂时把 DOM 作用域指向子应用；若此时再加载
   * 新资源，基座改写的 `fetch` 可能在错误作用域执行。请求前主动清除该瞬时状态。
   *
   * 已知场景：基座加载带监控属性的 SGM 脚本时，错误作用域会干扰其 fetch 包装逻辑。
   */
  removeDomScope()
  if (isFunction(microApp.options.fetch)) {
    return microApp.options.fetch(url, options, appName)
  }
  // 嵌套应用中必须走当前 `window.fetch` 链；直接调用保存的原始 fetch 会触发 sgm-2.8.0.js 异常。
  return window.fetch(url, options).then((res: Response) => {
    return res.text()
  })
}
