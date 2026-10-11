import type {
  RequestIdleCallbackInfo,
  RequestIdleCallbackOptions,
} from '@micro-app/types'
import {
  isSupportModuleScript,
  isBrowser,
  getCurrentAppName,
  assign,
} from './utils'
import {
  rejectMicroAppStyle,
} from '../source/patch'
import {
  updateElementInfo,
} from '../sandbox/adapter'

declare global {
  /** 扩展 DOM 节点，记录节点归属、补丁状态和框架内部数据。 */
  interface Node {
    /** 创建或处理该节点时所属的子应用名；DOM 补丁据此选择容器与沙箱。 */
    __MICRO_APP_NAME__?: string | null
    /** 标记由框架为基座用途创建的纯节点，使其跳过子应用归属改写。 */
    __PURE_ELEMENT__?: boolean
    /** 标记节点已安装自定义 `parentNode` 描述符，防止重复定义。 */
    __MICRO_APP_HAS_DPN__?: boolean
    /** `<micro-app>` 元素通过属性之外通道接收的结构化数据。 */
    data?: unknown
    /** 预留的原始父节点引用；本版本 `src` 尚未直接读写该字段。 */
    rawParentNode?: ParentNode | null
  }

  /** 扩展样式节点，记录作用域 CSS 是否已经处理。 */
  interface HTMLStyleElement {
    /** 为真表示当前样式已完成作用域选择器改写，避免重复处理。 */
    __MICRO_APP_HAS_SCOPED__?: boolean
  }

  /** 声明基座 window 与子应用代理 window 共享的框架标记和原生对象出口。 */
  interface Window {
    /** 在浏览器空闲期调度回调；旧环境由工具层提供兼容实现。 */
    requestIdleCallback (
      callback: (info: RequestIdleCallbackInfo) => void,
      opts?: RequestIdleCallbackOptions,
    ): number
    /** babel-polyfill 6 用于阻止重复注入的全局标记。 */
    _babelPolyfill: boolean
    /** 标识当前 window 正运行在 micro-app 子应用环境。 */
    __MICRO_APP_ENVIRONMENT__?: boolean
    /** 标识当前子应用是否采用 UMD 挂载/卸载钩子。 */
    __MICRO_APP_UMD_MODE__?: boolean
    /** 标识当前 window 为承载子应用的基座环境。 */
    __MICRO_APP_BASE_APPLICATION__?: boolean
    /** create-react-app 开发期错误覆盖层使用的全局钩子。 */
    __REACT_ERROR_OVERLAY_GLOBAL_HOOK__: boolean
    /** 预留的原始 Location 出口；本版本 `src` 尚未直接读写该字段。 */
    rawLocation: Location
    /** 沙箱外原始 window 的显式出口。 */
    rawWindow: any
    /** 沙箱外原始 document 的显式出口。 */
    rawDocument: any
  }
}

/**
 * 保存初始化时捕获的原生宿主对象、原型方法及全局沙箱计数。
 *
 * @remarks
 * 后续补丁与释放流程从此对象取初始化时的引用，不在每次 start/stop 中重新读取原型。
 * 此记录属于当前 bundle；activeSandbox 由两种沙箱共用，隐藏 keep-alive 不递减计数。
 */
const globalEnv: Record<string, any> = {
  // 当前处于启动状态的沙箱数量；首个启动时安装全局补丁，归零时释放。
  activeSandbox: 0,
}

/**
 * 捕获浏览器原生全局对象和方法，并注入基座级结构样式。
 *
 * @remarks
 * `MicroApp.start()` 在定义自定义元素前调用本函数；优先使用上层暴露的 rawWindow/rawDocument，
 * 让嵌套应用绕过代理 window 的读取。DOM/History/EventTarget 方法按此刻原型取值保存，
 * 本函数本身不安装/释放原型补丁，也不重置已有 activeSandbox 计数。
 * 非浏览器环境直接跳过初始化。
 */
export function initGlobalEnv (): void {
  if (isBrowser) {
    const rawWindow = window.rawWindow || Function('return window')()
    const rawDocument = window.rawDocument || Function('return document')()
    const rawRootDocument = rawWindow.Document || Function('return Document')()
    const rawRootElement = rawWindow.Element
    const rawRootNode = rawWindow.Node
    const rawRootEventTarget = rawWindow.EventTarget
    const rawDocumentFragment = rawWindow.DocumentFragment

    // 保存 DOM 补丁需要的原始方法；调用方必须显式恢复正确的 `this`。
    const rawAppendChild = rawRootNode.prototype.appendChild
    const rawInsertBefore = rawRootNode.prototype.insertBefore
    const rawReplaceChild = rawRootNode.prototype.replaceChild
    const rawRemoveChild = rawRootNode.prototype.removeChild
    const rawSetAttribute = rawRootElement.prototype.setAttribute
    const rawAppend = rawRootElement.prototype.append
    const rawPrepend = rawRootElement.prototype.prepend
    const rawFragmentAppend = rawDocumentFragment.prototype.append
    const rawFragmentPrepend = rawDocumentFragment.prototype.prepend
    const rawCloneNode = rawRootNode.prototype.cloneNode
    const rawElementQuerySelector = rawRootElement.prototype.querySelector
    const rawElementQuerySelectorAll = rawRootElement.prototype.querySelectorAll
    const rawInsertAdjacentElement = rawRootElement.prototype.insertAdjacentElement
    const rawInnerHTMLDesc = Object.getOwnPropertyDescriptor(rawRootElement.prototype, 'innerHTML')
    const rawParentNodeDesc = Object.getOwnPropertyDescriptor(rawRootNode.prototype, 'parentNode')

    // 保存 Document 原型方法，供文档代理安装与释放时复用。
    const rawCreateElement = rawRootDocument.prototype.createElement
    const rawCreateElementNS = rawRootDocument.prototype.createElementNS
    const rawCreateTextNode = rawRootDocument.prototype.createTextNode
    const rawCreateDocumentFragment = rawRootDocument.prototype.createDocumentFragment
    const rawCreateComment = rawRootDocument.prototype.createComment
    const rawQuerySelector = rawRootDocument.prototype.querySelector
    const rawQuerySelectorAll = rawRootDocument.prototype.querySelectorAll
    const rawGetElementById = rawRootDocument.prototype.getElementById
    const rawGetElementsByClassName = rawRootDocument.prototype.getElementsByClassName
    const rawGetElementsByTagName = rawRootDocument.prototype.getElementsByTagName
    const rawGetElementsByName = rawRootDocument.prototype.getElementsByName

    // TODO: 将ImageProxy移出去
    const ImageProxy = new Proxy(rawWindow.Image, {
      /** 创建图片元素后立即写入当前应用归属，纳入动态资源补丁。 */
      construct (Target, args): HTMLImageElement {
        return updateElementInfo(new Target(...args), getCurrentAppName())
      },
    })

    /**
     * 保存副作用管理需要的原始方法。
     * 定时器方法对 `this` 较敏感，调用时需绑定回原生 window。
     */
    const rawSetInterval = rawWindow.setInterval
    const rawSetTimeout = rawWindow.setTimeout
    const rawClearInterval = rawWindow.clearInterval
    const rawClearTimeout = rawWindow.clearTimeout
    const rawPushState = rawWindow.history.pushState
    const rawReplaceState = rawWindow.history.replaceState
    const rawAddEventListener = rawRootEventTarget.prototype.addEventListener
    const rawRemoveEventListener = rawRootEventTarget.prototype.removeEventListener
    const rawDispatchEvent = rawRootEventTarget.prototype.dispatchEvent

    // 标记当前全局环境为基座，供嵌套应用识别宿主层级。
    window.__MICRO_APP_BASE_APPLICATION__ = true

    assign(globalEnv, {
      supportModuleScript: isSupportModuleScript(),

      // 通用原生全局对象与构造器。
      rawWindow,
      rawDocument,
      rawRootDocument,
      rawRootElement,
      rawRootNode,
      rawDocumentFragment,

      // `source/patch` 安装和释放 DOM 补丁所需的原始引用。
      rawSetAttribute,
      rawAppendChild,
      rawInsertBefore,
      rawReplaceChild,
      rawRemoveChild,
      rawAppend,
      rawPrepend,
      rawFragmentAppend,
      rawFragmentPrepend,
      rawCloneNode,
      rawElementQuerySelector,
      rawElementQuerySelectorAll,
      rawInsertAdjacentElement,
      rawInnerHTMLDesc,
      rawParentNodeDesc,

      rawCreateElement,
      rawCreateElementNS,
      rawCreateDocumentFragment,
      rawCreateTextNode,
      rawCreateComment,
      rawQuerySelector,
      rawQuerySelectorAll,
      rawGetElementById,
      rawGetElementsByClassName,
      rawGetElementsByTagName,
      rawGetElementsByName,
      ImageProxy,

      // 沙箱副作用记录与恢复所需的原始引用。
      rawSetInterval,
      rawSetTimeout,
      rawClearInterval,
      rawClearTimeout,
      rawPushState,
      rawReplaceState,
      rawAddEventListener,
      rawRemoveEventListener,
      rawDispatchEvent,

      // iframe 沙箱也复用以上宿主原生引用。
    })

    // 为当前标签名注入结构样式，使 micro-app-head 隐藏、容器和 body 按块展示。
    rejectMicroAppStyle()
  }
}

export default globalEnv
