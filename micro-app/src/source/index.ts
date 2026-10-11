import type { AppInterface, fiberTasks } from '@micro-app/types'
import {
  logError,
  CompletionPath,
  injectFiberTask,
  serialExecFiberTasks,
  isBodyElement,
} from '../libs/utils'
import {
  extractLinkFromHtml,
  fetchLinksFromHtml,
} from './links'
import {
  extractScriptElement,
  fetchScriptsFromHtml,
  checkExcludeUrl,
  checkIgnoreUrl,
} from './scripts'
import scopedCSS from '../sandbox/scoped_css'
import globalEnv from '../libs/global_env'

/**
 * 扫描已解析入口中的资源元素，并完成静态资源登记或预处理。
 *
 * link/script 会交给各自提取器；内联 style 的 CSS 隔离可进入 fiber 队列；图片地址在
 * 插入真实容器前补全。标记为 `exclude` 的资源由注释节点占位，`ignore` 资源保留节点、跳过
 * 框架转换；其中由 DOMParser 解析出的静态 script 不会因保留节点就执行。
 *
 * @param body - 包含入口后代节点的解析容器。
 * @param app - 持有资源集合、隔离配置和入口基址的应用实例。
 * @param fiberStyleTasks - 非空时收集需在空闲阶段串行执行的 style 隔离任务。
 */
function flatBodyChildren(
  body: HTMLElement,
  app: AppInterface,
  fiberStyleTasks: fiberTasks,
): void {
  if (!body || !isBodyElement(body)) {
    return
  }
  const links = Array.from(body.getElementsByTagName('link'))

  links.map((dom) => {
    if (dom.hasAttribute('exclude') || checkExcludeUrl(dom.getAttribute('href'), app.name)) {
      dom.parentElement!.replaceChild(document.createComment('link element with exclude attribute ignored by micro-app'), dom)
    } else if (!(dom.hasAttribute('ignore') || checkIgnoreUrl(dom.getAttribute('href'), app.name))) {
      extractLinkFromHtml(dom, dom.parentElement, app)
    } else if (dom.hasAttribute('href')) {
      globalEnv.rawSetAttribute.call(dom, 'href', CompletionPath(dom.getAttribute('href')!, app.url))
    }
    return dom
  })

  const styles = Array.from(body.getElementsByTagName('style'))

  styles.map((dom) => {
    if (dom.hasAttribute('exclude')) {
      dom.parentElement!.replaceChild(document.createComment('style element with exclude attribute ignored by micro-app'), dom)
    } else if (app.scopecss && !dom.hasAttribute('ignore')) {
      injectFiberTask(fiberStyleTasks, () => scopedCSS(dom, app))
    }
    return dom
  })

  const scripts = Array.from(body.getElementsByTagName('script'))

  scripts.map((dom) => {
    extractScriptElement(dom, dom.parentElement, app)
    return dom
  })
  const images = Array.from(body.getElementsByTagName('img'))

  images.map((dom) => {
    if (dom.hasAttribute('src')) {
      globalEnv.rawSetAttribute.call(dom, 'src', CompletionPath(dom.getAttribute('src')!, app.url))
    }
    return dom
  })
}

/**
 * 把规范化 HTML 转成应用 DOM，并启动样式与脚本两条资源加载链。
 *
 * 入口必须同时含 `micro-app-head` 和 `micro-app-body`。样式链与脚本链各调用一次
 * `app.onLoad()`；`CreateApp.loadSourceLevel` 收齐两次信号后保存 DOM 并继续挂载。这里表示
 * 样式处理与挂载前脚本抓取已结算，失败项也计入完成，defer/async 通常留到挂载时下载。
 * fiber 模式中 link 下载与内联 style 隔离并行，外链 style 的转换等待内联 style 队列结束；
 * 外链仍替换各自占位节点，保持入口中的样式位置。
 *
 * @param htmlStr - 已经过插件处理并改写容器标签的 HTML 字符串。
 * @param app - 接收 DOM、资源集合和完成信号的应用实例。
 */
export function extractSourceDom(htmlStr: string, app: AppInterface): void {
  const wrapElement = app.parseHtmlString(htmlStr)
  const microAppHead = globalEnv.rawElementQuerySelector.call(wrapElement, 'micro-app-head')
  const microAppBody = globalEnv.rawElementQuerySelector.call(wrapElement, 'micro-app-body')

  if (!microAppHead || !microAppBody) {
    const msg = `element ${microAppHead ? 'body' : 'head'} is missing`
    app.onerror(new Error(msg))
    return logError(msg, app.name)
  }

  const fiberStyleTasks: fiberTasks = app.isPrefetch || app.fiber ? [] : null

  flatBodyChildren(wrapElement, app, fiberStyleTasks)

  // 外链 CSS 下载期间并行隔离内联 style；随后由 links 流程等待此 Promise 并保持落地顺序。
  const fiberStyleResult = serialExecFiberTasks(fiberStyleTasks)

  if (app.source.links.size) {
    fetchLinksFromHtml(wrapElement, app, microAppHead, fiberStyleResult)
  } else if (fiberStyleResult) {
    fiberStyleResult.then(() => app.onLoad({ html: wrapElement }))
  } else {
    app.onLoad({ html: wrapElement })
  }

  if (app.source.scripts.size) {
    fetchScriptsFromHtml(wrapElement, app)
  } else {
    app.onLoad({ html: wrapElement })
  }
}
