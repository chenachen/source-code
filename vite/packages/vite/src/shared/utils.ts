import { NULL_BYTE_PLACEHOLDER, VALID_ID_PREFIX } from './constants'

/** 当前运行时是否使用 Windows 路径语义。 */
export const isWindows: boolean =
  typeof process !== 'undefined' && process.platform === 'win32'

/**
 * 给浏览器不能直接表达的 resolved id 添加 `/@id/`，并转义 null byte。
 * importAnalysis 用它把内部/虚拟模块 id 安全放进 import URL。
 */
export function wrapId(id: string): string {
  return id.startsWith(VALID_ID_PREFIX)
    ? id
    : VALID_ID_PREFIX + id.replace('\0', NULL_BYTE_PLACEHOLDER)
}

/**
 * 撤销 {@link wrapId} 添加的 `/@id/` 与 null byte 转义，再交回插件管线。
 */
export function unwrapId(id: string): string {
  return id.startsWith(VALID_ID_PREFIX)
    ? id.slice(VALID_ID_PREFIX.length).replace(NULL_BYTE_PLACEHOLDER, '\0')
    : id
}

/** Windows 路径分隔符的全局匹配器。 */
const windowsSlashRE = /\\/g
/** 把 Windows 分隔符统一成 Vite 内部使用的 POSIX 形式。 */
export function slash(p: string): string {
  return p.replace(windowsSlashRE, '/')
}

/** 从首个 query 或 fragment 起匹配 URL 后缀。 */
const postfixRE = /[?#].*$/
/** 去掉 URL 的 query/hash，取得用于文件系统操作的主体路径。 */
export function cleanUrl(url: string): string {
  return url.replace(postfixRE, '')
}

/** 把路径拆成文件主体与原样保留的 query/hash 后缀。 */
export function splitFileAndPostfix(path: string): {
  /** 去除 query/hash 后的文件主体。 */
  file: string
  /** 保留原顺序的 query/hash 后缀。 */
  postfix: string
} {
  const file = cleanUrl(path)
  return { file, postfix: path.slice(file.length) }
}

/** 判断值是否不能安全枚举为模块 namespace，包括 null/undefined。 */
export function isPrimitive(value: unknown): boolean {
  return !value || (typeof value !== 'object' && typeof value !== 'function')
}

/** 确保路径恰好保留现有内容并以 `/` 结尾。 */
export function withTrailingSlash(path: string): string {
  if (path[path.length - 1] !== '/') {
    return `${path}/`
  }
  return path
}

/** 当前 realm 的 AsyncFunction 构造器，由 evaluator 延迟实例化可执行函数。 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const AsyncFunction = async function () {}.constructor as typeof Function

// 不同 Node 版本把 AsyncFunction 声明序列化成不同的前置行数，不能硬编码：
// https://github.com/nodejs/node/issues/43047#issuecomment-1564068099
let asyncFunctionDeclarationPaddingLineCount: number | undefined

/**
 * 运行时探测 AsyncFunction 构造器在函数体前增加的行数，供旧 SSR 堆栈修正扣除。
 * 结果按进程缓存，因为同一 realm 的构造器格式不会变化。
 */
export function getAsyncFunctionDeclarationPaddingLineCount(): number {
  if (typeof asyncFunctionDeclarationPaddingLineCount === 'undefined') {
    const body = '/*code*/'
    const source = new AsyncFunction('a', 'b', body).toString()
    asyncFunctionDeclarationPaddingLineCount =
      source.slice(0, source.indexOf(body)).split('\n').length - 1
  }
  return asyncFunctionDeclarationPaddingLineCount
}

/** `Promise.withResolvers()` 的跨运行时兼容返回形状。 */
export interface PromiseWithResolvers<T> {
  /** 由外部 resolve/reject 控制的 Promise。 */
  promise: Promise<T>
  /** 兑现 Promise，可接收同类型 thenable。 */
  resolve: (value: T | PromiseLike<T>) => void
  /** 拒绝 Promise。 */
  reject: (reason?: any) => void
}

/** 在尚未普遍支持原生 API 的运行时创建外置 resolve/reject 的 Promise。 */
export function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve: any
  let reject: any
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
