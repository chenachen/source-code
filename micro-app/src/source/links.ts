import type {
  AppInterface,
  LinkSourceInfo,
  AttrsType,
  fiberTasks,
} from '@micro-app/types'
import { fetchSource } from './fetch'
import {
  CompletionPath,
  promiseStream,
  pureCreateElement,
  defer,
  logError,
  getAttributes,
  injectFiberTask,
  serialExecFiberTasks,
} from '../libs/utils'
import scopedCSS, { createPrefix } from '../sandbox/scoped_css'
import {
  dispatchOnLoadEvent,
  dispatchOnErrorEvent,
} from './load_event'
import sourceCenter from './source_center'
import globalEnv from '../libs/global_env'

/**
 * 从同一外链样式的其他应用空间复用已隔离代码，并替换成当前应用前缀。
 *
 * 原始 CSS 全局共享，但隔离前缀属于应用；只有其他应用已经生成 `parsedCode` 时才能复用，
 * 替换前缀后仍需存入当前应用空间，避免后续重复扫描 CSS。
 *
 * @param appName - 当前应用名，查找时必须排除自身空间。
 * @param prefix - 当前应用的 CSS 选择器前缀。
 * @param linkInfo - 当前资源地址对应的全局样式信息。
 * @returns 可复用并已换前缀的 CSS；没有候选时返回 `undefined`。
 */
function getExistParseCode (
  appName: string,
  prefix: string,
  linkInfo: LinkSourceInfo,
): string | void {
  const appSpace = linkInfo.appSpace
  for (const item in appSpace) {
    if (item !== appName) {
      const appSpaceData = appSpace[item]
      if (appSpaceData.parsedCode) {
        return appSpaceData.parsedCode.replace(new RegExp(createPrefix(item, true), 'g'), prefix)
      }
    }
  }
}

/**
 * 把原 link 属性迁移到替代 style 元素。
 *
 * `rel` 对 style 无意义而被丢弃；`href` 改存为 `data-origin-href` 供调试和追溯。使用
 * 原始 `setAttribute` 可绕过动态 DOM 补址补丁，避免已完成的地址再次转换。
 */
function setConvertStyleAttr (convertStyle: HTMLStyleElement, attrs: AttrsType): void {
  attrs.forEach((value, key) => {
    if (key === 'rel') return
    if (key === 'href') key = 'data-origin-href'
    globalEnv.rawSetAttribute.call(convertStyle, key, value)
  })
}

/**
 * 提取或规范化一个 link 元素，并按静态/动态场景返回后续处理信息。
 *
 * stylesheet 会登记到全局资源中心：静态入口用注释占位并加入应用资源集合，动态插入则
 * 返回地址与缓存项，由 DOM 补丁异步转换成 style。同一应用的同地址资源保留首次属性；
 * 静态重复地址在 Set 中只出现一次，占位引用则更新到最后一次出现的位置。
 * prefetch/preload/prerender/modulepreload/icon 节点移除，其他带 href 的 link 仅补全地址。
 *
 * @param link - 待处理的原始 link 元素。
 * @param parent - 静态入口中用于替换或移除元素的父节点。
 * @param app - 当前应用实例。
 * @param isDynamic - 是否来自运行期 DOM 插入。
 * @returns 动态模式的资源信息/占位节点，或静态模式的 DOM 替换结果。
 */
export function extractLinkFromHtml (
  link: HTMLLinkElement,
  parent: Node | null,
  app: AppInterface,
  isDynamic = false,
): any {
  const rel = link.getAttribute('rel')
  let href = link.getAttribute('href')
  let replaceComment: Comment | null = null
  if (rel === 'stylesheet' && href) {
    href = CompletionPath(href, app.url)
    let linkInfo = sourceCenter.link.getInfo(href)
    const appSpaceData = {
      attrs: getAttributes(link),
    }
    if (!linkInfo) {
      linkInfo = {
        code: '',
        appSpace: {
          [app.name]: appSpaceData,
        }
      }
    } else {
      linkInfo.appSpace[app.name] = linkInfo.appSpace[app.name] || appSpaceData
    }

    sourceCenter.link.setInfo(href, linkInfo)

    if (!isDynamic) {
      app.source.links.add(href)
      replaceComment = document.createComment(`link element with href=${href} move to micro-app-head as style element`)
      linkInfo.appSpace[app.name].placeholder = replaceComment
    } else {
      return { address: href, linkInfo }
    }
  } else if (rel && ['prefetch', 'preload', 'prerender', 'modulepreload', 'icon'].includes(rel)) {
    // 这些预取或图标关系不参与子应用样式执行；静态节点移除，动态节点用注释替代。
    if (isDynamic) {
      replaceComment = document.createComment(`link element with rel=${rel}${href ? ' & href=' + href : ''} removed by micro-app`)
    } else {
      parent?.removeChild(link)
    }
  } else if (href) {
    // dns-prefetch、preconnect、search 等保留原生语义，只把相对地址补成应用绝对地址。
    globalEnv.rawSetAttribute.call(link, 'href', CompletionPath(href, app.url))
  }

  if (isDynamic) {
    return { replaceComment }
  } else if (replaceComment) {
    return parent?.replaceChild(replaceComment, link)
  }
}

/**
 * 并行获取入口中的外链 CSS，逐项处理结果，并在全部请求结算后通知样式链完成。
 *
 * 非空缓存代码直接进入流；请求失败记录错误并参与结算。非 fiber 模式收到单项结果就替换
 * 该资源的占位，不等所有下载结束；fiber 模式按结果到达顺序收集转换任务，等待内联 style
 * 隔离结束后再串行处理，最后调用一次 `app.onLoad()`。占位替换保留 CSS 在入口中的顺序。
 *
 * @param wrapElement - 最终交给应用挂载的解析 DOM。
 * @param app - 当前应用实例及其样式资源集合。
 * @param microAppHead - 接收由 link 转换出的 style 元素的隔离头部。
 * @param fiberStyleResult - 内联 style 隔离队列；非 fiber 模式为 `null`。
 */
export function fetchLinksFromHtml (
  wrapElement: HTMLElement,
  app: AppInterface,
  microAppHead: Element,
  fiberStyleResult: Promise<void> | null,
): void {
  const styleList: Array<string> = Array.from(app.source.links)
  const fetchLinkPromise: Array<Promise<string> | string> = styleList.map((address) => {
    const linkInfo = sourceCenter.link.getInfo(address)!
    return linkInfo.code ? linkInfo.code : fetchSource(address, app.name)
  })

  const fiberLinkTasks: fiberTasks = fiberStyleResult ? [] : null

  promiseStream<string>(fetchLinkPromise, (res: {
    /** 当前外链样式的文本。 */
    data: string,
    /** 与 `styleList`、`fetchLinkPromise` 对齐的稳定索引。 */
    index: number
  }) => {
    injectFiberTask(fiberLinkTasks, () => fetchLinkSuccess(
      styleList[res.index],
      res.data,
      microAppHead,
      app,
    ))
  }, (err: {
    /** 单个样式请求的失败原因。 */
    error: Error,
    /** 失败请求在样式列表中的索引。 */
    index: number
  }) => {
    logError(err, app.name)
  }, () => {
    /**
     * `fiberStyleResult` 存在时 `fiberLinkTasks` 必然存在。外链下载与内联 style 处理并行，
     * 但 DOM 写入顺序固定为内联 style 完成后再串行执行 link 转换；最后一个任务发出样式链
     * 的 `onLoad` 信号。
     */
    if (fiberStyleResult) {
      fiberStyleResult.then(() => {
        fiberLinkTasks!.push(() => Promise.resolve(app.onLoad({ html: wrapElement })))
        serialExecFiberTasks(fiberLinkTasks)
      })
    } else {
      app.onLoad({ html: wrapElement })
    }
  })
}

/**
 * 缓存外链 CSS，并把静态入口中的占位注释替换成隔离后的 style。
 *
 * 此函数服务静态资源提取后的处理；同一实例重挂载复用已生成 DOM，动态 link 走 `formatDynamicLink()`。
 * 相同应用前缀可复用 `parsedCode`，prefetch/fiber 模式下调用方会把本操作放进空闲任务。
 *
 * @param address - 完整样式资源地址。
 * @param code - 已下载的原始 CSS。
 * @param microAppHead - 占位节点失联时的兜底插入容器。
 * @param app - 当前应用实例；对应 `appSpace` 在提取阶段已经建立。
 */
export function fetchLinkSuccess (
  address: string,
  code: string,
  microAppHead: Element,
  app: AppInterface,
): void {
  // 提取阶段已建立 linkInfo；请求完成后补写全局原始代码，供其他应用和重挂载复用。
  const linkInfo = sourceCenter.link.getInfo(address)!
  linkInfo.code = code
  const appSpaceData = linkInfo.appSpace[app.name]
  const placeholder = appSpaceData.placeholder!
  /**
   * 预加载实例处理期间可能被同名正式实例替换；两者共享 linkInfo，正式实例可能已经消费
   * 并清空占位节点。常见触发条件是预加载 URL 或参数与 `<micro-app>` 最终配置不同，
   * 因而这里必须把空占位视为已处理，而非再次插入重复样式。
   */
  if (placeholder) {
    const convertStyle = pureCreateElement('style')

    handleConvertStyle(
      app,
      address,
      convertStyle,
      linkInfo,
      appSpaceData.attrs,
    )

    if (placeholder.parentNode) {
      placeholder.parentNode.replaceChild(convertStyle, placeholder)
    } else {
      microAppHead.appendChild(convertStyle)
    }

    // 占位只允许消费一次；清空后也作为并发预加载场景的幂等标记。
    appSpaceData.placeholder = null
  }
}

/**
 * 生成或复用应用级 CSS 隔离结果，并填充替代 style 元素。
 *
 * 首次处理优先复用其他应用的解析结果并替换前缀，否则调用 `scopedCSS()`；结果写回当前
 * `appSpace`。未启用 CSS 隔离时直接使用全局原始代码。最后迁移原 link 的可保留属性。
 * 缓存命中只判断 parsedCode 非空，不核对 optionCss、入口基址或原始 code 是否改变；
 * 跨应用复用也只替换旧前缀，已补全 URL 和控制注释结果不会重新解析。
 *
 * @param app - 决定隔离开关和前缀的应用实例。
 * @param address - 用于 CSS 相对 URL 补全的外链地址。
 * @param convertStyle - 接收最终 CSS 和属性的 style 元素。
 * @param linkInfo - 全局原始代码及各应用解析缓存。
 * @param attrs - 提取阶段保存的原 link 属性。
 */
export function handleConvertStyle (
  app: AppInterface,
  address: string,
  convertStyle: HTMLStyleElement,
  linkInfo: LinkSourceInfo,
  attrs: AttrsType,
): void {
  if (app.scopecss) {
    const appSpaceData = linkInfo.appSpace[app.name]
    appSpaceData.prefix = appSpaceData.prefix || createPrefix(app.name)
    if (!appSpaceData.parsedCode) {
      const existParsedCode = getExistParseCode(app.name, appSpaceData.prefix, linkInfo)
      if (!existParsedCode) {
        convertStyle.textContent = linkInfo.code
        scopedCSS(convertStyle, app, address)
      } else {
        convertStyle.textContent = existParsedCode
      }
      appSpaceData.parsedCode = convertStyle.textContent
    } else {
      convertStyle.textContent = appSpaceData.parsedCode
    }
  } else {
    convertStyle.textContent = linkInfo.code
  }

  setConvertStyleAttr(convertStyle, attrs)
}

/**
 * 为运行期插入的 stylesheet link 创建同步占位 style，并异步填入隔离 CSS。
 *
 * 非空缓存命中也延迟到微任务填充并发送 load；未命中则等待 fetch 完成。请求链中的下载或
 * 填充异常会记录并向原 link 发送 error。CSS 解析异常由 `scopedCSS()` 内部记录，仍会继续
 * 填充原始 CSS 并发送 load。调用方可立即用返回元素替换原 link。
 * 命中缓存的 defer 没有相应 catch，填充或 load 回调异常会成为未接住的 Promise 拒绝；
 * code 为 '' 仍视为未命中，且资源中心不去重进行中的请求。
 *
 * @param address - 已补全的样式地址。
 * @param app - 当前应用实例。
 * @param linkInfo - 提取阶段登记的共享样式信息。
 * @param originLink - 接收 load/error 通知的原始 link 元素。
 * @returns 立即插入 DOM、稍后填充内容的 style 元素。
 */
export function formatDynamicLink (
  address: string,
  app: AppInterface,
  linkInfo: LinkSourceInfo,
  originLink: HTMLLinkElement,
): HTMLStyleElement {
  const convertStyle = pureCreateElement('style')

  /** 填充动态 style、保存应用级解析结果并通知原 link 加载成功。 */
  const handleDynamicLink = () => {
    handleConvertStyle(
      app,
      address,
      convertStyle,
      linkInfo,
      linkInfo.appSpace[app.name].attrs,
    )
    dispatchOnLoadEvent(originLink)
  }

  if (linkInfo.code) {
    defer(handleDynamicLink)
  } else {
    fetchSource(address, app.name).then((data: string) => {
      linkInfo.code = data
      handleDynamicLink()
    }).catch((err) => {
      logError(err, app.name)
      dispatchOnErrorEvent(originLink)
    })
  }

  return convertStyle
}
