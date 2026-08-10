/* eslint-disable no-new-func, indent, no-self-compare, @typescript-eslint/explicit-module-boundary-types */
import type {
  Func,
  LocationQueryObject,
  LocationQueryValue,
  MicroLocation,
  AttrsType,
  fiberTasks,
  MicroAppElementTagNameMap,
  MicroAppElementInterface,
} from '@micro-app/types'

/** 构建阶段替换的框架版本占位符。 */
export const version = '__MICRO_APP_VERSION__'

/** 是否正在浏览器环境；模块初始化时 window 可能尚不存在，不能调用依赖它的类型守卫。 */
export const isBrowser = typeof window !== 'undefined'

/**
 * 跨浏览器、Worker 与 Node 环境获取统一全局对象。
 *
 * 此常量在 `isUndefined()` 声明初始化前求值，故使用 `typeof` 直接检测各候选对象。
 */
export const globalObj =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
          ? self
          : Function('return this')()

/** 不执行动作的回调，占位时保持调用签名稳定。 */
export const noop = () => { }
/** 固定返回 `false` 的回调，供默认否决策略复用。 */
export const noopFalse = () => false

/** 保存原生 `Array.isArray` 引用，避免运行时全局被子应用改写。 */
export const isArray = Array.isArray
/** 保存原生 `Object.assign` 引用，避免运行时全局被子应用改写。 */
export const assign = Object.assign

/** 保存原生单属性定义方法。 */
export const rawDefineProperty = Object.defineProperty
/** 保存原生多属性定义方法。 */
export const rawDefineProperties = Object.defineProperties
/** 保存原生类型标签读取方法，调用时显式绑定目标。 */
export const rawToString = Object.prototype.toString
/** 保存原生自有属性判断方法，调用时显式绑定目标。 */
export const rawHasOwnProperty = Object.prototype.hasOwnProperty

/** 返回跨 realm 稳定的 `Object.prototype.toString` 类型标签。 */
export const toTypeString = (value: unknown): string => rawToString.call(value)

/** 判断值是否为 `undefined`，并向 TypeScript 提供类型收窄。 */
export function isUndefined(target: unknown): target is undefined {
  return target === undefined
}

/** 判断值是否为 `null`，并向 TypeScript 提供类型收窄。 */
export function isNull(target: unknown): target is null {
  return target === null
}

/** 判断值是否为原始字符串。 */
export function isString(target: unknown): target is string {
  return typeof target === 'string'
}

/** 判断值是否为原始布尔值。 */
export function isBoolean(target: unknown): target is boolean {
  return typeof target === 'boolean'
}

/** 判断值是否为原始数字；`NaN` 仍属于数字类型。 */
export function isNumber(target: unknown): target is Number {
  return typeof target === 'number'
}

/** 判断值是否可调用。 */
export function isFunction(target: unknown): target is Function {
  return typeof target === 'function'
}

/** 通过跨 realm 类型标签判断普通对象。 */
export function isPlainObject<T = Record<PropertyKey, unknown>>(target: unknown): target is T {
  return toTypeString(target) === '[object Object]'
}

/** 判断值是否为非 null 对象，不限制其原型。 */
export function isObject(target: unknown): target is Object {
  return !isNull(target) && typeof target === 'object'
}

/** 通过类型标签识别原生 Promise；普通 thenable 不计入。 */
export function isPromise(target: unknown): target is Promise<unknown> {
  return toTypeString(target) === '[object Promise]'
}

/** 根据函数名和 prototype 形态识别原生 `bind()` 产物。 */
export function isBoundFunction(target: unknown): boolean {
  return isFunction(target) && target.name?.indexOf('bound ') === 0 && !target.hasOwnProperty('prototype')
}

/**
 * 结合 prototype 成员、传统函数首字母及 class 源码形态，启发式判断可构造函数。
 *
 * 该判断用于决定绑定/代理策略，并不等同于执行 `new` 的完整语言级校验。
 */
export function isConstructor(target: unknown): boolean {
  if (isFunction(target)) {
    const targetStr = Function.prototype.toString.call(target)
    return (
      target.prototype?.constructor === target &&
      Object.getOwnPropertyNames(target.prototype).length > 1
    ) ||
      /^function\s+[A-Z]/.test(targetStr) ||
      /^class\s+/.test(targetStr)
  }
  return false
}

/** 在构造器可用时判断当前 realm 的 ShadowRoot。 */
export function isShadowRoot(target: unknown): target is ShadowRoot {
  return typeof ShadowRoot !== 'undefined' && target instanceof ShadowRoot
}

/** 识别 URL 实例或至少带 `href` 的 URL 形对象。 */
export function isURL(target: unknown): target is URL {
  return target instanceof URL || !!(target as URL)?.href
}

/**
 * 识别 Element；iframe 元素不属于基座 realm，故额外接受带字符串 `tagName` 的对象。
 */
export function isElement(target: unknown): target is Element {
  return target instanceof Element || isString((target as Element)?.tagName)
}

/**
 * 识别 Node；iframe 节点不属于基座 realm，故额外接受带数字 `nodeType` 的对象。
 */
export function isNode(target: unknown): target is Node {
  return target instanceof Node || isNumber((target as Node)?.nodeType)
}

/** 通过跨 realm 类型标签识别 canvas 元素。 */
export function isCanvasElement(target: unknown): target is HTMLCanvasElement {
  return toTypeString(target) === '[object HTMLCanvasElement]'
}

/** 通过跨 realm 类型标签识别锚点元素。 */
export function isAnchorElement(target: unknown): target is HTMLAnchorElement {
  return toTypeString(target) === '[object HTMLAnchorElement]'
}

/** 通过跨 realm 类型标签识别 audio 元素。 */
export function isAudioElement(target: unknown): target is HTMLAudioElement {
  return toTypeString(target) === '[object HTMLAudioElement]'
}

/** 通过跨 realm 类型标签识别 video 元素。 */
export function isVideoElement(target: unknown): target is HTMLVideoElement {
  return toTypeString(target) === '[object HTMLVideoElement]'
}

/** 通过跨 realm 类型标签识别 link 元素。 */
export function isLinkElement(target: unknown): target is HTMLLinkElement {
  return toTypeString(target) === '[object HTMLLinkElement]'
}
/** 通过跨 realm 类型标签识别 body 元素。 */
export function isBodyElement(target: unknown): target is HTMLBodyElement {
  return toTypeString(target) === '[object HTMLBodyElement]'
}

/** 通过跨 realm 类型标签识别 style 元素。 */
export function isStyleElement(target: unknown): target is HTMLStyleElement {
  return toTypeString(target) === '[object HTMLStyleElement]'
}

/** 通过跨 realm 类型标签识别 script 元素。 */
export function isScriptElement(target: unknown): target is HTMLScriptElement {
  return toTypeString(target) === '[object HTMLScriptElement]'
}

/** 通过跨 realm 类型标签识别 iframe 元素。 */
export function isIFrameElement(target: unknown): target is HTMLIFrameElement {
  return toTypeString(target) === '[object HTMLIFrameElement]'
}

/** 通过跨 realm 类型标签识别 div 元素。 */
export function isDivElement(target: unknown): target is HTMLDivElement {
  return toTypeString(target) === '[object HTMLDivElement]'
}

/** 通过跨 realm 类型标签识别 img 元素。 */
export function isImageElement(target: unknown): target is HTMLImageElement {
  return toTypeString(target) === '[object HTMLImageElement]'
}

/** 通过跨 realm 类型标签识别 base 元素。 */
export function isBaseElement(target: unknown): target is HTMLBaseElement {
  return toTypeString(target) === '[object HTMLBaseElement]'
}

/** 通过跨 realm 类型标签识别普通 DocumentFragment。 */
export function isDocumentFragment(target: unknown): target is DocumentFragment {
  return toTypeString(target) === '[object DocumentFragment]'
}

/** 通过跨 realm 类型标签识别 ShadowRoot 形式的 DocumentFragment。 */
export function isDocumentShadowRoot(target: unknown): target is DocumentFragment {
  return toTypeString(target) === '[object ShadowRoot]'
}

/** 判断元素是否是框架改写后的子应用 body 容器。 */
export function isMicroAppBody(target: unknown): target is HTMLElement {
  return isElement(target) && target.tagName.toUpperCase() === 'MICRO-APP-BODY'
}

/** 判断元素是否是框架改写后的子应用 head 容器。 */
export function isMicroAppHead(target: unknown): target is HTMLElement {
  return isElement(target) && target.tagName.toUpperCase() === 'MICRO-APP-HEAD'
}

/**
 * 识别普通自定义 Web Component 元素，并排除框架自身 `MICRO-APP*` 标签。
 */
export function isWebComponentElement(target: unknown): boolean {
  let result = toTypeString(target) === '[object HTMLElement]'
  if (result) {
    const tagName = (target as HTMLElement).tagName.toUpperCase()
    result = result && !tagName.startsWith('MICRO-APP')
  }
  return result
}

/** 通过自定义类型标签识别沙箱代理 document。 */
export function isProxyDocument(target: unknown): target is Document {
  return toTypeString(target) === '[object ProxyDocument]'
}

/** 解析路径并判断最后一个扩展名是否精确匹配目标后缀；非法 URL 返回 false。 */
export function isTargetExtension(path: string, suffix: string): boolean {
  try {
    return createURL(path).pathname.split('.').pop() === suffix
  } catch {
    return false
  }
}

/**
 * ES2016 `Array.prototype.includes` 兼容实现，支持负索引及 SameValueZero 的 `NaN` 语义。
 *
 * @throws 当目标为 null/undefined 时抛出 TypeError，与原生行为一致。
 */
export function includes(target: unknown[], searchElement: unknown, fromIndex?: number): boolean {
  if (target == null) {
    throw new TypeError('includes target is null or undefined')
  }

  const O = Object(target)
  const len = parseInt(O.length, 10) || 0
  if (len === 0) return false
  // @ts-ignore
  fromIndex = parseInt(fromIndex, 10) || 0
  let i = Math.max(fromIndex >= 0 ? fromIndex : len + fromIndex, 0)
  while (i < len) {
    // 显式处理唯一不自等的值 NaN，实现 SameValueZero。
    if (searchElement === O[i] || (searchElement !== searchElement && O[i] !== O[i])) {
      return true
    }
    i++
  }
  return false
}

/**
 * 为错误日志添加统一框架与可选应用名前缀。
 *
 * @param msg - 主消息；非字符串会作为独立 console 参数保留对象结构。
 * @param appName - 错误所属应用名，默认不附加。
 * @param rest - 额外错误上下文。
 */
export function logError(
  msg: unknown,
  appName: string | null = null,
  ...rest: unknown[]
): void {
  const appNameTip = appName && isString(appName) ? ` app ${appName}:` : ''
  if (isString(msg)) {
    console.error(`[micro-app]${appNameTip} ${msg}`, ...rest)
  } else {
    console.error(`[micro-app]${appNameTip}`, msg, ...rest)
  }
}

/**
 * 为警告日志添加统一框架与可选应用名前缀。
 *
 * @param msg - 主消息；非字符串会作为独立 console 参数保留对象结构。
 * @param appName - 警告所属应用名，默认不附加。
 * @param rest - 额外警告上下文。
 */
export function logWarn(
  msg: unknown,
  appName: string | null = null,
  ...rest: unknown[]
): void {
  const appNameTip = appName && isString(appName) ? ` app ${appName}:` : ''
  if (isString(msg)) {
    console.warn(`[micro-app]${appNameTip} ${msg}`, ...rest)
  } else {
    console.warn(`[micro-app]${appNameTip}`, msg, ...rest)
  }
}

/**
 * 在 Promise 微任务中调用函数，使当前同步生命周期先完成。
 *
 * @param fn - 待执行回调。
 * @param args - 预绑定的位置参数。
 */
export function defer(fn: Func, ...args: unknown[]): void {
  Promise.resolve().then(fn.bind(null, ...args))
}

/**
 * 通过定时器宏任务延迟调用函数。
 *
 * @param fn - 待执行回调。
 * @param delay - 延迟毫秒数，默认 0。
 * @param args - 预绑定的位置参数。
 */
export function macro(fn: Func, delay = 0, ...args: unknown[]): void {
  setTimeout(fn.bind(null, ...args), delay)
}

/**
 * 创建带可写微应用路由扩展字段的 URL 对象。
 *
 * 内部子类让返回对象保留原生 URL 行为，同时可按 `MicroLocation` 类型附加沙箱状态。
 */
export const createURL = (function (): (path: string | URL, base?: string) => MicroLocation {
  /** 作为 MicroLocation 载体的本地 URL 子类，不改变原生解析语义。 */
  class Location extends URL { }
  return (path: string | URL, base?: string): MicroLocation => {
    return (base ? new Location('' + path, base) : new Location('' + path)) as MicroLocation
  }
})()

/**
 * 为协议相对地址补上当前全局 location 的协议。
 *
 * @param url - 原始地址。
 */
export function addProtocol(url: string): string {
  return url.startsWith('//') ? `${globalObj.location.protocol}${url}` : url
}

/**
 * 把元素或预取配置中的入口地址规范化为无 hash 的绝对 HTTP/file URL。
 *
 * 保留路径文件名与 search；hash 不参与 HTML 入口请求。非法协议或解析错误返回空字符串。
 *
 * @param url - 待规范化地址。
 * @param appName - 可选应用名，仅用于错误日志上下文。
 */
export function formatAppURL(url: string | null, appName: string | null = null): string {
  if (!isString(url) || !url) return ''

  try {
    const { protocol, origin: rawOrigin, host, pathname, search } = createURL(addProtocol(url), (window.rawWindow || window).location.href)
    /**
     * 保留 `.html`、`.node`、`.php` 等原路径及 search，只移除 hash。不能用 `/` 补齐
     * 入口（issue #1147）；file URL 的 `origin` 存在浏览器差异，故自行拼接协议与 host
     *（上游 PR #1695）。
     */
    const origin = protocol === 'file:' ? `${protocol}//${host}` : rawOrigin
    const fullPath = `${origin}${pathname}${search}`
    return /^(https?|file):\/\//.test(fullPath) ? fullPath : ''
  } catch (e) {
    logError(e, appName)
    return ''
  }
}

/**
 * 删除应用名开头数字及非字母、数字、下划线、连字符字符，生成统一隔离键。
 *
 * 元素、通信、预取、插件和路由 API 都必须使用同一规范化规则；非法或空输入返回空字符串。
 */
export function formatAppName(name: string | null): string {
  if (!isString(name) || !name) return ''
  return name.replace(/(^\d+)|([^\w\d-_])/gi, '')
}

/**
 * 计算应用入口所属目录，用作相对资源的公共基址。
 *
 * 例如 `https://domain/xx/xx.html` 与 `https://domain/xx` 都得到对应目录并以 `/` 结尾。
 *
 * @param url - 已验证的应用入口 URL。
 */
export function getEffectivePath(url: string): string {
  const { protocol, origin: rawOrigin, host, pathname } = createURL(url)
  /*
   * file URL 的 `origin` 存在浏览器差异，故自行拼接协议与 host（上游 PR #1695）。
  */
  const origin = protocol === 'file:' ? `${protocol}//${host}` : rawOrigin

  if (/\.(\w+)$/.test(pathname)) {
    const pathArr = `${origin}${pathname}`.split('/')
    pathArr.pop()
    return pathArr.join('/') + '/'
  }

  return `${origin}${pathname}/`.replace(/\/\/$/, '/')
}

/**
 * 将相对资源路径补全为基于应用目录的绝对地址。
 *
 * 空地址、已有网络/file 协议以及 data/blob 地址原样返回。
 *
 * @param path - 资源地址。
 * @param baseURI - 应用入口 URL。
 */
export function CompletionPath(path: string, baseURI: string): string {
  if (
    !path ||
    /^((((ht|f)tps?)|file):)?\/\//.test(path) ||
    /^(data|blob):/.test(path)
  ) return path

  return createURL(path, getEffectivePath(addProtocol(baseURI))).toString()
}

/**
 * 返回外链样式文件所在目录，用于补全 CSS 内的相对 URL。
 *
 * @param linkPath - 样式文件完整地址。
 */
export function getLinkFileDir(linkPath: string): string {
  const pathArr = linkPath.split('/')
  pathArr.pop()
  return addProtocol(pathArr.join('/') + '/')
}

/**
 * 流式消费一组 Promise/普通值，每项完成后立即携带原索引回调。
 *
 * 单项失败不会终止其余任务；全部项目处理完后才调用 `finallyCb`。
 *
 * @param promiseList - 保留原始顺序的任务或值列表。
 * @param successCb - 单项成功回调，接收 `{ data, index }`。
 * @param errorCb - 单项失败回调，接收 `{ error, index }`。
 * @param finallyCb - 所有项目结算后的可选回调。
 */
export function promiseStream<T>(
  promiseList: Array<Promise<T> | T>,
  successCb: CallableFunction,
  errorCb: CallableFunction,
  finallyCb?: CallableFunction,
): void {
  let finishedNum = 0

  /** 记录已结算项目数，并在最后一项完成时触发汇总回调。 */
  function isFinished() {
    if (++finishedNum === promiseList.length && finallyCb) finallyCb()
  }

  promiseList.forEach((p, i) => {
    if (isPromise(p)) {
      (p as Promise<T>).then((res: T) => {
        successCb({ data: res, index: i })
        isFinished()
      }).catch((err: Error) => {
        errorCb({ error: err, index: i })
        isFinished()
      })
    } else {
      successCb({ data: p, index: i })
      isFinished()
    }
  })
}

/** 通过 script 元素的 `noModule` 属性检测浏览器是否支持 ES module。 */
export function isSupportModuleScript(): boolean {
  const s = document.createElement('script')
  return 'noModule' in s
}

/** 生成以 `inline-` 开头的随机内联脚本缓存键。 */
export function createNonceSrc(): string {
  return 'inline-' + Math.random().toString(36).substr(2, 15)
}

/**
 * 按属性键字符串去重数组并保留首次出现顺序。
 *
 * 该实现面向资源地址等可安全转成属性键的值，不提供对象引用级 Set 语义。
 */
export function unique(array: any[]): any[] {
  return array.filter(function (this: Record<PropertyKey, boolean>, item) {
    return item in this ? false : (this[item] = true)
  }, Object.create(null))
}

/**
 * 原生 `requestIdleCallback` 或定时器降级实现。
 *
 * 降级版本在约 1ms 后执行，并用 50ms 预算近似 `timeRemaining()`。
 */
export const requestIdleCallback = globalObj.requestIdleCallback ||
  function (fn: CallableFunction) {
    const lastTime = Date.now()
    return setTimeout(function () {
      fn({
        didTimeout: false,
        /** 返回本次降级空闲任务估算的剩余执行预算。 */
        timeRemaining() {
          return Math.max(0, 50 - (Date.now() - lastTime))
        },
      })
    }, 1)
  }

/**
 * 把空闲回调包装为 Promise，并把 resolve 控制权交给任务本身。
 *
 * 回调必须显式调用收到的 resolve；适合在空闲阶段完成异步编排后再结算。
 */
export function promiseRequestIdle(callback: CallableFunction): Promise<void> {
  return new Promise((resolve) => {
    requestIdleCallback(() => {
      callback(resolve)
    })
  })
}

/**
 * 当前同步 DOM 操作所属应用名；动态节点补丁据此决定资源归属。
 */
let currentAppName: string | null = null

/** 直接设置或清空当前 DOM 作用域应用名。 */
export function setCurrentAppName(appName: string | null): void {
  currentAppName = appName
}

/** 返回当前 DOM 作用域应用名。 */
export function getCurrentAppName(): string | null {
  return currentAppName
}

/**
 * 设置当前 DOM 作用域，并在下一微任务自动清空。
 *
 * `preventSetState` 开启时跳过，供强制返回基座作用域的代码块使用。
 */
export function throttleDeferForSetAppName(appName: string): void {
  if (currentAppName !== appName && !getPreventSetState()) {
    setCurrentAppName(appName)
    defer(() => {
      setCurrentAppName(null)
    })
  }
}

/** iframe document 的 head/body 查询临时所属应用名，与普通 DOM 作用域分开记录。 */
let iframeCurrentAppName: string | null = null

/** 直接设置或清空 iframe document 查询作用域。 */
export function setIframeCurrentAppName(appName: string | null) {
  iframeCurrentAppName = appName
}

/** 返回 iframe document 查询当前所属应用名。 */
export function getIframeCurrentAppName(): string | null {
  return iframeCurrentAppName
}

/** 设置 iframe 查询作用域，并在下一微任务自动清空。 */
export function throttleDeferForIframeAppName(appName: string): void {
  if (iframeCurrentAppName !== appName && !getPreventSetState()) {
    setIframeCurrentAppName(appName)
    defer(() => {
      setIframeCurrentAppName(null)
    })
  }
}

/** 是否暂时禁止任何代码重新写入 DOM 作用域。 */
let preventSetState = false

/** 返回 DOM 作用域写入抑制状态。 */
export function getPreventSetState(): boolean {
  return preventSetState
}

/**
 * 清除 DOM/iframe 作用域，并可在一轮微任务内强制保持基座作用域。
 *
 * `removeDomScope(true)` 到 `removeDomScope(false)` 之间，元素操作明确归属基座；若未手动
 * 关闭，强制标记也会在下一微任务自动释放，避免长期污染。
 *
 * @param force - `false` 仅解除抑制；`true` 清空并临时抑制重设；缺省只清空。
 */
export function removeDomScope(force?: boolean): void {
  if (force !== false) {
    setCurrentAppName(null)
    setIframeCurrentAppName(null)
    if (force && !preventSetState) {
      preventSetState = true
      defer(() => {
        preventSetState = false
      })
    }
  } else {
    preventSetState = false
  }
}

/** 通过 UA 粗略识别非 Chrome 的 Safari。 */
export function isSafari(): boolean {
  return /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
}

/**
 * 使用保存的原生 document 创建不归属任何子应用的“纯”元素。
 *
 * 清除可能继承的应用名并写入 `__PURE_ELEMENT__`，动态 DOM 补丁会跳过资源劫持。
 */
export function pureCreateElement<K extends keyof MicroAppElementTagNameMap>(tagName: K, options?: ElementCreationOptions): MicroAppElementTagNameMap[K] {
  const element = (window.rawDocument || document).createElement(tagName, options)
  if (element.__MICRO_APP_NAME__) delete element.__MICRO_APP_NAME__
  element.__PURE_ELEMENT__ = true
  return element
}

/**
 * 判断字符串能否直接作为简单 querySelector 键。
 *
 * 测试环境使用更窄字符集保持断言稳定；生产环境额外允许中文字符。
 */
export function isInvalidQuerySelectorKey(key: string): boolean {
  if (__TEST__) return !key || /(^\d)|([^\w\d-_$])/gi.test(key)
  return !key || /(^\d)|([^\w\d-_\u4e00-\u9fa5])/gi.test(key)
}

/** 判断选择器是否指向文档级唯一元素，CSS 作用域改写会对它们特殊处理。 */
export function isUniqueElement(key: string): boolean {
  return (
    /^body$/i.test(key) ||
    /^head$/i.test(key) ||
    /^html$/i.test(key) ||
    /^title$/i.test(key) ||
    /^:root$/i.test(key)
  )
}

/** 带框架挂载/卸载协议的 `<micro-app>` 根元素。 */
export type RootContainer = HTMLElement & MicroAppElementInterface
/**
 * 从普通宿主或 ShadowRoot 取得真正实现微应用协议的根元素。
 *
 * @param target - 应用当前容器。
 */
export function getRootContainer(target: HTMLElement | ShadowRoot): RootContainer {
  return (isShadowRoot(target) ? (target as ShadowRoot).host : target) as RootContainer
}

/**
 * 去除字符串首尾空白；空字符串保持为空。
 */
export function trim(str: string): string {
  return str ? str.replace(/^\s+|\s+$/g, '') : ''
}

/** 通过 UA 判断当前浏览器是否为 Firefox。 */
export function isFireFox(): boolean {
  return navigator.userAgent.indexOf('Firefox') > -1
}

/**
 * 将不带前导 `?` 的查询串解析为保留重复键的对象。
 *
 * 键和值故意不解码，保证路由信息写回 URL 时字节表示不变；无等号的键记为 `null`。
 *
 * @param search - 待解析查询串。
 * @returns 查询对象；重复键对应值数组。
 */
export function parseQuery(search: string): LocationQueryObject {
  const result: LocationQueryObject = {}
  const queryList = search.split('&')

  // 不解码键值，避免路由状态更新 URL 时改变原始编码。
  for (const queryItem of queryList) {
    const eqPos = queryItem.indexOf('=')
    const key = eqPos < 0 ? queryItem : queryItem.slice(0, eqPos)
    const value = eqPos < 0 ? null : queryItem.slice(eqPos + 1)

    if (key in result) {
      let currentValue = result[key]
      if (!isArray(currentValue)) {
        currentValue = result[key] = [currentValue]
      }
      currentValue.push(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * 将查询对象序列化为不带前导 `?` 的查询串。
 *
 * `null` 生成无等号键，`undefined` 被跳过，数组为同一键生成多个条目。
 *
 * @param queryObject - 待序列化对象。
 * @returns 查询串。
 */
export function stringifyQuery(queryObject: LocationQueryObject): string {
  let result = ''

  for (const key in queryObject) {
    const value = queryObject[key]
    if (isNull(value)) {
      result += (result.length ? '&' : '') + key
    } else {
      const valueList: LocationQueryValue[] = isArray(value) ? value : [value]

      valueList.forEach(value => {
        if (!isUndefined(value)) {
          result += (result.length ? '&' : '') + key
          if (!isNull(value)) result += '=' + value
        }
      })
    }
  }

  return result
}

/**
 * 创建基于 Set 的处理器注册表。
 *
 * `add()` 返回幂等注销函数，`list()` 暴露当前集合供同步迭代。
 */
export function useSetRecord<T>() {
  const handlers: Set<T> = new Set()

  /** 注册处理器并返回只删除本处理器的注销函数。 */
  function add(handler: T): () => boolean {
    handlers.add(handler)
    return (): boolean => {
      if (handlers.has(handler)) return handlers.delete(handler)
      return false
    }
  }

  return {
    add,
    list: () => handlers,
  }
}

/**
 * 创建基于 Map 的键值注册表。
 *
 * 每次 `add()` 覆盖同键值并返回幂等删除函数，供路由默认页等配置保存所有权。
 */
export function useMapRecord<T>() {
  const data: Map<PropertyKey, T> = new Map()

  /** 写入键值并返回只删除该键的注销函数。 */
  function add(key: PropertyKey, value: T): () => boolean {
    data.set(key, value)
    return (): boolean => {
      if (data.has(key)) return data.delete(key)
      return false
    }
  }

  return {
    add,
    get: (key: PropertyKey) => data.get(key),
    delete: (key: PropertyKey): boolean => {
      if (data.has(key)) return data.delete(key)
      return false
    }
  }
}

/** 把元素当前属性复制为 Map 快照，后续元素变化不会回写该结果。 */
export function getAttributes(element: Element): AttrsType {
  const attr = element.attributes
  const attrMap: AttrsType = new Map()
  for (let i = 0; i < attr.length; i++) {
    attrMap.set(attr[i].name, attr[i].value)
  }
  return attrMap
}

/**
 * 有 fiber 队列时把动作包装为空闲 Promise 入队，否则立即执行。
 *
 * @param fiberTasks - fiber 任务列表；为空表示同步模式。
 * @param callback - 待执行动作。
 */
export function injectFiberTask(fiberTasks: fiberTasks, callback: CallableFunction): void {
  if (fiberTasks) {
    fiberTasks.push(() => promiseRequestIdle((resolve: PromiseConstructor['resolve']) => {
      callback()
      resolve()
    }))
  } else {
    callback()
  }
}

/**
 * 串行执行 link、style、script 阶段积累的 fiber 任务。
 *
 * @param tasks - 空闲任务数组或空值。
 * @returns 任务链 Promise；没有任务时为 `null`。
 */
export function serialExecFiberTasks(tasks: fiberTasks): Promise<void> | null {
  return tasks?.reduce((pre, next) => pre.then(next), Promise.resolve()) || null
}

/**
 * 判断脚本地址是否是框架生成的 `inline-*` 缓存键。
 *
 * @param address - 脚本源地址或内联键。
 */
export function isInlineScript(address: string): boolean {
  return address.startsWith('inline-')
}

/**
 * 调用子应用全局生命周期钩子，并把同步异常转成带应用上下文的日志。
 *
 * @param fn - 目标钩子；空值或非函数会跳过。
 * @param appName - 应用名。
 * @param hookName - 全局钩子属性名。
 * @param args - 传给钩子的参数。
 */
export function execMicroAppGlobalHook(
  fn: Func | null,
  appName: string,
  hookName: string,
  ...args: unknown[]
): void {
  try {
    isFunction(fn) && fn(...args)
  } catch (e) {
    logError(`An error occurred in app ${appName} window.${hookName} \n`, null, e)
  }
}

/**
 * 逐个移除目标的全部子节点，确保原生移除钩子按节点触发。
 *
 * @param $dom - 待清空的元素、ShadowRoot 或 Document。
 */
export function clearDOM($dom: HTMLElement | ShadowRoot | Document): void {
  while ($dom?.firstChild) {
    $dom.removeChild($dom.firstChild)
  }
}

/**
 * 沿显式原型链执行跨 realm 友好的 `instanceof` 判断。
 *
 * 原始值直接返回 false；构造器不可调用时与原生 `instanceof` 一样抛出 TypeError。
 */
export function instanceOf<T extends new (...args: unknown[]) => unknown>(
  instance: unknown,
  constructor: T,
): instance is T extends new (...args: unknown[]) => infer R ? R : boolean {
  if (instance === null || instance === undefined) {
    return false
  } else if (!isFunction(constructor)) {
    throw new TypeError("Right-hand side of 'instanceof' is not callable")
  } else if (typeof instance === 'number' || typeof instance === 'string' || typeof instance === 'boolean') {
    // 原始值没有可遍历原型链，不把它们视作包装器实例。
    return false
  }
  let proto = Object.getPrototypeOf(instance)
  while (proto) {
    if (proto === constructor.prototype) {
      return true
    }
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

/**
 * 为会与基座生命周期重名的子应用事件追加应用名。
 *
 * with 沙箱把子应用事件和基座生命周期都绑定到 microAppElement，`mounted`/`unmount`
 * 若不改名会互相触发（上游 issue #1161）。
 *
 * @param type - 原事件名。
 * @param appName - 用于隔离的应用名。
 */
/** 需要按应用名隔离的冲突事件集合。 */
const formatEventList = ['mounted', 'unmount']

/** 返回必要时追加应用名后的事件类型。 */
export function formatEventType(type: string, appName: string): string {
  return formatEventList.includes(type) ? `${type}-${appName}` : type
}

/**
 * 判断目标是否不是普通对象，或是没有自有可枚举键的普通对象。
 *
 * 数字、字符串、数组等非普通对象按本工具的领域语义视为空。
 */
export function isEmptyObject(target: unknown): boolean {
  return isPlainObject(target) ? !Object.keys(target).length : true
}
