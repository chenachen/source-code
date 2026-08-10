import { AppInterface, plugins } from '@micro-app/types'
import { fetchSource } from '../fetch'
import { isFunction, isPlainObject, logError, isTargetExtension } from '../../libs/utils'
import microApp from '../../micro_app'

/** HTML 入口加载器契约；负责把入口内容交给后续 DOM 资源提取阶段。 */
export interface IHTMLLoader {
  /** 加载并规范化指定应用的 HTML，成功后把字符串和应用实例交给回调。 */
  run (app: AppInterface, successCb: CallableFunction): void
}

/**
 * HTML 入口加载与预处理单例。
 *
 * 实例自身不保存应用状态；每次调用都从应用及当前全局插件配置读取上下文，随后把
 * 原生 `head/body` 改写为 micro-app 的隔离容器，供资源提取器继续处理。
 */
export class HTMLLoader implements IHTMLLoader {
  /** 进程内共享实例，避免为每个子应用重复创建无状态加载器。 */
  private static instance: HTMLLoader;

  /** 获取共享加载器，并在第一次调用时延迟创建。 */
  public static getInstance (): HTMLLoader {
    if (!this.instance) {
      this.instance = new HTMLLoader()
    }
    return this.instance
  }

  /**
   * 加载应用入口并完成 HTML 级插件处理与容器改写。
   *
   * JS 入口会合成只含脚本的最小 HTML；普通入口通过 `fetchSource()` 禁用 HTTP 缓存。
   * 空响应走应用渲染错误通道；抓取、插件转换或成功回调抛出的 Promise 链异常统一走
   * `onLoadError()`，两类失败都不会继续正常完成路径。
   *
   * @param app - 正在加载资源的应用实例。
   * @param successCb - 接收规范化 HTML 字符串与应用实例的下游资源提取回调。
   */
  public run (app: AppInterface, successCb: CallableFunction): void {
    const appName = app.name
    const htmlUrl = app.ssrUrl || app.url
    const isJsResource = isTargetExtension(htmlUrl, 'js')
    const htmlPromise = isJsResource
      ? Promise.resolve(`<micro-app-head><script src='${htmlUrl}'></script></micro-app-head><micro-app-body></micro-app-body>`)
      : fetchSource(htmlUrl, appName, { cache: 'no-cache' })
    htmlPromise.then((htmlStr: string) => {
      if (!htmlStr) {
        const msg = 'html is empty, please check in detail'
        app.onerror(new Error(msg))
        return logError(msg, appName)
      }

      htmlStr = this.formatHTML(htmlUrl, htmlStr, appName)

      successCb(htmlStr, app)
    }).catch((e) => {
      logError(`Failed to fetch data from ${app.url}, micro-app stop rendering`, appName, e)
      app.onLoadError(e)
    })
  }

  /**
   * 先运行 HTML 插件链，再把原生 `head/body` 标签替换为隔离容器标签。
   *
   * 插件必须先看到原始入口内容；容器改写放在其后，避免插件依赖标准 HTML 结构时失效。
   */
  private formatHTML (htmlUrl: string, htmlStr: string, appName: string) {
    return this.processHtml(htmlUrl, htmlStr, appName, microApp.options.plugins)
      .replace(/<head[^>]*>[\s\S]*?<\/head>/i, (match) => {
        return match
          .replace(/<head/i, '<micro-app-head')
          .replace(/<\/head>/i, '</micro-app-head>')
      })
      .replace(/<body[^>]*>[\s\S]*?<\/body>/i, (match) => {
        return match
          .replace(/<body/i, '<micro-app-body')
          .replace(/<\/body>/i, '</micro-app-body>')
      })
  }

  /**
   * 按“全局插件 → 当前应用插件”的顺序串行转换 HTML。
   *
   * 非对象插件或没有 `processHtml` 的配置保持输入不变；后一个插件总是接收前一个插件
   * 的输出，因此插件顺序也是代码转换顺序。未配置插件时直接返回原字符串。
   */
  private processHtml (url: string, code: string, appName: string, plugins: plugins | void): string {
    if (!plugins) return code

    const mergedPlugins: NonNullable<plugins['global']> = []
    plugins.global && mergedPlugins.push(...plugins.global)
    plugins.modules?.[appName] && mergedPlugins.push(...plugins.modules[appName])

    if (mergedPlugins.length > 0) {
      return mergedPlugins.reduce((preCode, plugin) => {
        if (isPlainObject(plugin) && isFunction(plugin.processHtml)) {
          return plugin.processHtml!(preCode, url)
        }
        return preCode
      }, code)
    }
    return code
  }
}
