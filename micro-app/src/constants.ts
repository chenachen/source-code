/** `<micro-app>` 元素会观察并触发重建流程的核心属性名。 */
export enum ObservedAttrName {
  /** 应用唯一标识属性；变化时切换到新名称对应的实例及数据通道。 */
  NAME = 'name',
  /** 应用入口地址属性；变化时重新校验并加载资源。 */
  URL = 'url',
}

/** 应用实例从创建、加载、挂载到卸载的内部状态。 */
export enum appStates {
  /** 实例刚创建、尚未开始加载资源。 */
  CREATED = 'created',
  /** HTML、样式或脚本仍在加载。 */
  LOADING = 'loading',
  /** HTML 加载失败，由 `onLoadError()` 写入。 */
  LOAD_FAILED = 'load_failed',
  /** 准备挂载；复用实例时可在沙箱 ready 之前提前写入。 */
  BEFORE_MOUNT = 'before_mount',
  /** 容器、沙箱和脚本正在完成挂载。 */
  MOUNTING = 'mounting',
  /** 挂载收尾已开始；先写入状态，再执行 onmount 和 mounted 事件。 */
  MOUNTED = 'mounted',
  /** 卸载流程已开始；异步钩子和清理可能仍在执行，保留实例时可再挂载。 */
  UNMOUNT = 'unmount',
}

/** 基座可通过元素事件或全局钩子观察的生命周期事件名。 */
export enum lifeCycles {
  /** 自定义元素一次有效连接的延迟回调开始执行，每次重新连接均可派发。 */
  CREATED = 'created',
  /** 应用内容写入并执行前。 */
  BEFOREMOUNT = 'beforemount',
  /** 执行器完成通知或捕获的 UMD mount 结算后派发；UMD 可在后续脚本完成前触发收尾。 */
  MOUNTED = 'mounted',
  /** 沙箱停止后、容器清理前派发的卸载事件。 */
  UNMOUNT = 'unmount',
  /** CreateApp.onerror 向宿主报告错误；HTMLLoader 失败会走此通道，脚本错误的日志并不自动产生该事件。 */
  ERROR = 'error',
  /** keep-alive 副作用已恢复，但 DOM 尚未转入新宿主。 */
  BEFORESHOW = 'beforeshow',
  /** keep-alive 应用恢复并重新展示后。 */
  AFTERSHOW = 'aftershow',
  /** 已标记 keep-alive 隐藏；在路由移除、DOM 转存和副作用释放前派发。 */
  AFTERHIDDEN = 'afterhidden',
}

/** 子应用 window 上可选的全局挂载与卸载钩子名。 */
export enum microGlobalEvent {
  /** 应用进入已挂载状态时调用的 `window.onmount`。 */
  ONMOUNT = 'onmount',
  /** 应用停止沙箱前调用的 `window.onunmount`。 */
  ONUNMOUNT = 'onunmount',
}

/** keep-alive 实例当前处于展示还是后台隐藏状态。 */
export enum keepAliveStates {
  /** 恢复流程已越过 beforeshow；随后才转回 DOM 并恢复 search 路由。 */
  KEEP_ALIVE_SHOW = 'keep_alive_show',
  /** 隐藏流程已开始；写入时 DOM 转存和副作用释放尚未执行。 */
  KEEP_ALIVE_HIDDEN = 'keep_alive_hidden',
}

/** 可由元素属性或手动渲染参数传入的配置键。 */
export enum MicroAppConfig {
  /** 卸载时删除实例及其内联脚本缓存，共享外链源码仍可复用。 */
  DESTROY = 'destroy',
  /** 为兼容旧拼写保留的销毁配置键。 */
  DESTORY = 'destory',
  /** 将脚本以内联方式执行。 */
  INLINE = 'inline',
  /** 兼容驼峰形式的关闭样式隔离配置。 */
  DISABLESCOPECSS = 'disableScopecss',
  /** 兼容驼峰形式的关闭沙箱配置。 */
  DISABLESANDBOX = 'disableSandbox',
  /** 关闭样式作用域改写的连字符配置键。 */
  DISABLE_SCOPECSS = 'disable-scopecss',
  /** 关闭 JavaScript 沙箱的连字符配置键。 */
  DISABLE_SANDBOX = 'disable-sandbox',
  /** 兼容旧接口：关闭内存路由并使用原生路由模式。 */
  DISABLE_MEMORY_ROUTER = 'disable-memory-router',
  /** 禁止为子应用改写请求地址。 */
  DISABLE_PATCH_REQUEST = 'disable-patch-request',
  /** 卸载时保留子应用路由状态。 */
  KEEP_ROUTER_STATE = 'keep-router-state',
  /** 断开元素时隐藏实例而非普通卸载。 */
  KEEP_ALIVE = 'keep-alive',
  /** 卸载时同时清理数据中心缓存。 */
  CLEAR_DATA ='clear-data',
  /** 使用服务端渲染内容作为应用初始 HTML。 */
  SSR = 'ssr',
  /** 将脚本任务拆到浏览器空闲时段串行执行。 */
  FIBER = 'fiber',
}

/**
 * with 沙箱执行脚本时注入到顶层函数参数的稳定全局键列表。
 *
 * @remarks
 * 这些键的值在每段脚本调用内层函数时作为参数捕获；随后改写 `window.Array` 等同名属性，裸变量仍指向本次调用捕获的值。
 * 请求相关对象需要由沙箱补丁动态代理，因此不得加入 `fetch`、`XMLHttpRequest` 或 `EventSource`。
 */
export const GLOBAL_CACHED_KEY = 'window,self,globalThis,document,Document,Array,Object,String,Boolean,Math,Number,Symbol,Date,Function,Proxy,WeakMap,WeakSet,Set,Map,Reflect,Element,Node,RegExp,Error,TypeError,JSON,isNaN,parseFloat,parseInt,performance,console,decodeURI,encodeURI,decodeURIComponent,encodeURIComponent,navigator,undefined,location,history'

/** 合法预取级别；级别 2 预解析脚本，级别 3 进一步预渲染应用。 */
export const PREFETCH_LEVEL: number[] = [1, 2, 3]

/**
 * 内存路由模式约束。
 *
 * @remarks
 * `native` 与 `native-scope` 的主要差异是 `location.origin`：后者指向子应用源；`native` 等价于旧配置 `disable-memory-router`。
*/
// 临时注释，1.0版本放开，默认模式切换为state
// // 默认模式：把子应用路由信息同步到 history.state
// export const DEFAULT_ROUTER_MODE = 'state'
// // 把子应用路由信息同步到浏览器 URL 的 search
// export const ROUTER_MODE_SEARCH = 'search'

// 临时放开，1.0版本去除
/** 把子应用路由信息写入 `history.state`。 */
export const ROUTER_MODE_STATE = 'state'
/** 未显式配置时采用的路由模式；当前版本为 `search`。 */
export const DEFAULT_ROUTER_MODE = 'search'

/** 按浏览器 URL 渲染，且 `location.origin`、`href` 指向基座地址。 */
export const ROUTER_MODE_NATIVE = 'native'
/** 按浏览器 URL 渲染，但 `location.origin`、`href` 映射到子应用地址。 */
export const ROUTER_MODE_NATIVE_SCOPE = 'native-scope'
/** 使用 search 模式的内部位置对象，但不把子应用路由同步到浏览器 URL。 */
export const ROUTER_MODE_PURE = 'pure'
/** 路由初始化接受的模式白名单；非法值回退到默认模式。 */
export const ROUTER_MODE_LIST: string[] = [
  DEFAULT_ROUTER_MODE,
  ROUTER_MODE_STATE,
  ROUTER_MODE_NATIVE,
  ROUTER_MODE_NATIVE_SCOPE,
  ROUTER_MODE_PURE,
]

/** with 与 iframe 沙箱都会绑定到子应用 window 语义空间的基础事件。 */
const BASE_SCOPE_WINDOW_EVENT = [
  'popstate',
  'hashchange',
  'load',
  'unload',
  'unmount',
  'appstate-change',
  'statechange',
  'mounted',
  'error'
  // 'beforeunload', // cangdu 于 2024-05-30 移除
]

/** with 沙箱需要定向到子应用 window 的事件集合。 */
export const SCOPE_WINDOW_EVENT_OF_WITH = BASE_SCOPE_WINDOW_EVENT

/** iframe 沙箱事件集合；额外纳入 Promise 拒绝与跨窗口消息事件。 */
export const SCOPE_WINDOW_EVENT_OF_IFRAME = BASE_SCOPE_WINDOW_EVENT.concat([
  'unhandledrejection',
  'message'
])

/** 需要绑定到子应用 window 的 `on*` 属性基础集合。 */
// TODO: with和iframe处理方式不同，需修改
const BASE_SCOPE_WINDOW_ON_EVENT = [
  'onpopstate',
  'onhashchange',
  'onload',
  'onunload',
  'onerror'
  // 'onbeforeunload', // cangdu 于 2024-05-30 移除
]

/** with 沙箱在子应用 window 内保存的 `on*` 属性集合。 */
export const SCOPE_WINDOW_ON_EVENT_OF_WITH = BASE_SCOPE_WINDOW_ON_EVENT

/** iframe 沙箱 `on*` 属性集合；额外包含未处理 Promise 拒绝回调。 */
export const SCOPE_WINDOW_ON_EVENT_OF_IFRAME = BASE_SCOPE_WINDOW_ON_EVENT.concat([
  'onunhandledrejection',
])

/** 应绑定到子应用 document 语义空间的文档事件。 */
export const SCOPE_DOCUMENT_EVENT = [
  'DOMContentLoaded',
  'readystatechange',
]

/** 应保留在子应用 document 上的 `on*` 事件属性。 */
export const SCOPE_DOCUMENT_ON_EVENT = [
  'onreadystatechange',
]

/** 在代理 window 中必须返回代理自身、不能透传原生 window 的全局别名。 */
export const GLOBAL_KEY_TO_WINDOW: Array<PropertyKey> = [
  'window',
  'self',
  'globalThis',
]

/** 读取时需要先清除当前 DOM 作用域标记的原生全局对象入口。 */
export const RAW_GLOBAL_TARGET: Array<PropertyKey> = ['rawWindow', 'rawDocument']

/** 路由代理会按模式切换到基座或子应用来源的 Location 字段。 */
export const HIJACK_LOCATION_KEYS = [
  'host',
  'hostname',
  'port',
  'protocol',
  'origin',
]
