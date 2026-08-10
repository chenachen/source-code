/** `<micro-app>` 元素会观察并触发重建流程的核心属性名。 */
export enum ObservedAttrName {
  /** 应用唯一标识属性；变化时更新实例索引。 */
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
  /** 资源加载或渲染失败。 */
  LOAD_FAILED = 'load_failed',
  /** 沙箱已就绪，即将进入挂载流程。 */
  BEFORE_MOUNT = 'before_mount',
  /** 容器、沙箱和脚本正在完成挂载。 */
  MOUNTING = 'mounting',
  /** 挂载流程及对应回调已经完成。 */
  MOUNTED = 'mounted',
  /** 应用已经卸载；保留缓存时仍可再次挂载。 */
  UNMOUNT = 'unmount',
}

/** 基座可通过元素事件或全局钩子观察的生命周期事件名。 */
export enum lifeCycles {
  /** 自定义元素完成初始化。 */
  CREATED = 'created',
  /** 应用内容写入并执行前。 */
  BEFOREMOUNT = 'beforemount',
  /** 应用脚本及 UMD 挂载钩子完成后。 */
  MOUNTED = 'mounted',
  /** 沙箱停止后、容器清理前派发的卸载事件。 */
  UNMOUNT = 'unmount',
  /** 资源加载或渲染失败时。 */
  ERROR = 'error',
  /** keep-alive 应用恢复副作用前。 */
  BEFORESHOW = 'beforeshow',
  /** keep-alive 应用恢复并重新展示后。 */
  AFTERSHOW = 'aftershow',
  /** keep-alive 应用转移到临时容器并隐藏后。 */
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
  /** 实例副作用已恢复并展示在正式容器中。 */
  KEEP_ALIVE_SHOW = 'keep_alive_show',
  /** 实例 DOM 被转存且全局副作用已暂停。 */
  KEEP_ALIVE_HIDDEN = 'keep_alive_hidden',
}

/** 可由元素属性或手动渲染参数传入的配置键。 */
export enum MicroAppConfig {
  /** 卸载时彻底销毁实例及资源缓存。 */
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
 * 这些值在脚本进入 `with` 作用域时被缓存；子应用随后改写 `window.Promise` 等属性，裸变量仍解析为进入时的值。
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
