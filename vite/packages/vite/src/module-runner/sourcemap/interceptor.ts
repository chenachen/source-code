import type { OriginalMapping } from '@jridgewell/trace-mapping'
import type { ModuleRunner } from '../runner'
import { decodeBase64, posixDirname, posixResolve } from '../utils'
import type { EvaluatedModules } from '../evaluatedModules'
import { slash } from '../../shared/utils'
import { DecodedMap, getOriginalPosition } from './decoder'

/** 从宿主或虚拟文件系统同步读取生成文件内容。 */
interface RetrieveFileHandler {
  /** 返回文件文本；空值表示当前 handler 无法处理。 */
  (path: string): string | null | undefined | false
}

/** 为生成文件直接提供 sourcemap URL 与内容。 */
interface RetrieveSourceMapHandler {
  /** 返回 map 描述；null 表示继续尝试其他 handler。 */
  (path: string): null | {
    /** sourcemap 内 sources 的解析基准 URL。 */
    url: string
    /** JSON 字符串或已解析的 sourcemap 对象。 */
    map: any
  }
}

/** 全局堆栈拦截器可插拔的文件与 sourcemap 读取能力。 */
export interface InterceptorOptions {
  /** 读取未被 Runner 缓存的源码，例如 externalized 模块。 */
  retrieveFile?: RetrieveFileHandler
  /** 直接为指定源码提供 sourcemap，优先于 `sourceMappingURL` 探测。 */
  retrieveSourceMap?: RetrieveSourceMapHandler
}

/** 全部 Runner 共享的外部 map 正/负缓存；内存模块图的 map 每次查询仍优先于它。 */
const sourceMapCache: Record<string, CachedMapEntry> = {}
/** 已读取文件或 sourcesContent 的进程级文本缓存。 */
const fileContentsCache: Record<string, string> = {}

/** 当前共享堆栈拦截器的所有 Runner 模块图。 */
const evaluatedModulesCache = new Set<EvaluatedModules>()
/** 按注册顺序查询生成文件的读取器集合。 */
const retrieveFileHandlers = new Set<RetrieveFileHandler>()
/** 按注册顺序查询外部 sourcemap 的读取器集合。 */
const retrieveSourceMapHandlers = new Set<RetrieveSourceMapHandler>()

/** 把多个 Runner 注册的读取函数串成“首个有效结果胜出”的查询链。 */
const createExecHandlers = <T extends (...args: any) => any>(
  handlers: Set<T>,
) => {
  return ((...args: Parameters<T>) => {
    for (const handler of handlers) {
      const result = handler(...args)
      if (result) return result
    }
    return null
  }) as T
}

/** 聚合后的生成文件读取函数。 */
const retrieveFileFromHandlers = createExecHandlers(retrieveFileHandlers)
/** 聚合后的 sourcemap 读取函数。 */
const retrieveSourceMapFromHandlers = createExecHandlers(
  retrieveSourceMapHandlers,
)

/** 标记本模块是否已接管 Error.prepareStackTrace，供首次安装和最后注销时切换。 */
let overridden = false
/** 本模块初始化时捕获的宿主堆栈格式化器，最后注销时恢复该值。 */
const originalPrepare = Error.prepareStackTrace

/** 按模块图和 handler 实例注销；模块图 Set 为空时恢复初始化时捕获的格式化器。 */
function resetInterceptor(runner: ModuleRunner, options: InterceptorOptions) {
  evaluatedModulesCache.delete(runner.evaluatedModules)
  if (options.retrieveFile) retrieveFileHandlers.delete(options.retrieveFile)
  if (options.retrieveSourceMap)
    retrieveSourceMapHandlers.delete(options.retrieveSourceMap)
  if (evaluatedModulesCache.size === 0) {
    Error.prepareStackTrace = originalPrepare
    overridden = false
  }
}

/**
 * 将 Runner 及其外部读取器加入全局堆栈拦截器，并返回对应的注销函数。
 * 多个 Runner 复用同一个 `Error.prepareStackTrace`；注册表按模块图/handler 身份去重，
 * 不记录引用次数，共享同一对象的集成需要协调注销时机。
 */
export function interceptStackTrace(
  runner: ModuleRunner,
  options: InterceptorOptions = {},
): () => void {
  if (!overridden) {
    Error.prepareStackTrace = prepareStackTrace
    overridden = true
  }
  evaluatedModulesCache.add(runner.evaluatedModules)
  if (options.retrieveFile) retrieveFileHandlers.add(options.retrieveFile)
  if (options.retrieveSourceMap)
    retrieveSourceMapHandlers.add(options.retrieveSourceMap)
  return () => resetInterceptor(runner, options)
}

/** 补齐旧版 Node 类型中缺少的 V8 CallSite 方法。 */
interface CallSite extends NodeJS.CallSite {
  /** 返回脚本文件名或 `sourceURL` 指定的显示地址。 */
  getScriptNameOrSourceURL(): string
}

/** 自底向上映射堆栈时相邻帧间传递的原始位置信息。 */
interface State {
  /** 下一帧映射位置，用于恢复当前帧函数名。 */
  nextPosition: null | OriginalMapping
  /** 当前帧刚得到的映射位置。 */
  curPosition: null | OriginalMapping
}

/** 单个生成文件的 sourcemap 查询缓存项。 */
interface CachedMapEntry {
  /** map 的解析基准 URL；null 表示已确认没有 map。 */
  url: string | null
  /** 解码后的 map；null 为负缓存。 */
  map: DecodedMap | null
  /** 是否来自 Vite Runner 内存模块图。 */
  vite?: boolean
}

/** 相对 map 文件解析 URL，同时保留协议前缀和 Windows file URL 盘符。 */
function supportRelativeURL(file: string, url: string) {
  if (!file) return url
  const dir = posixDirname(slash(file))
  const match = /^\w+:\/\/[^/]*/.exec(dir)
  let protocol = match ? match[0] : ''
  const startPath = dir.slice(protocol.length)
  if (protocol && /^\/\w:/.test(startPath)) {
    // file:///C:/... 需要额外保留协议后的斜杠。
    protocol += '/'
    return protocol + slash(posixResolve(startPath, url))
  }
  return protocol + posixResolve(startPath, url)
}

/** 先从所有 Runner 的求值缓存中查询 Vite 已生成的 sourcemap。 */
function getRunnerSourceMap(position: OriginalMapping): CachedMapEntry | null {
  for (const moduleGraph of evaluatedModulesCache) {
    const sourceMap = moduleGraph.getModuleSourceMapById(position.source!)
    if (sourceMap) {
      return {
        url: position.source,
        map: sourceMap,
        vite: true,
      }
    }
  }
  return null
}

/** 通过外部 handler 读取文件，并缓存成功结果。 */
function retrieveFile(path: string): string | null | undefined | false {
  if (path in fileContentsCache) return fileContentsCache[path]
  const content = retrieveFileFromHandlers(path)
  if (typeof content === 'string') {
    fileContentsCache[path] = content
    return content
  }
  return null
}

/**
 * 搜索源码中最后一个符合正则的行式 sourceMappingURL，并返回其地址。
 * 正则也匹配块式标记，但地址只由行式分支捕获；最后命中块式标记时返回 undefined。
 */
function retrieveSourceMapURL(source: string) {
  // 先读取生成代码，再搜索其中声明的 map 地址。
  const fileData = retrieveFile(source)
  if (!fileData) return null
  const re =
    /\/\/[@#]\s*sourceMappingURL=([^\s'"]+)\s*$|\/\*[@#]\s*sourceMappingURL=[^\s*'"]+\s*\*\/\s*$/gm
  // 使用最后一个匹配：Vite 最终 map 通常位于文件末尾，可覆盖此前字符串或旧 map 标记。
  // 此处只按正则搜索，不会解析 JavaScript 来识别字符串字面量。
  let lastMatch, match

  while ((match = re.exec(fileData))) lastMatch = match
  if (!lastMatch) return null
  return lastMatch[1]
}

/** 识别 base64 编码的内联 JSON sourcemap URL。 */
const reSourceMap = /^data:application\/json[^,]+base64,/

/** 按“用户 handler → 源码注释 → data/相对 URL”的顺序取得 sourcemap。 */
function retrieveSourceMap(source: string) {
  const urlAndMap = retrieveSourceMapFromHandlers(source)
  if (urlAndMap) return urlAndMap

  let sourceMappingURL = retrieveSourceMapURL(source)
  if (!sourceMappingURL) return null

  // 读取 sourcemap 内容。
  let sourceMapData
  if (reSourceMap.test(sourceMappingURL)) {
    // 内联 data URL 直接解码。
    const rawData = sourceMappingURL.slice(sourceMappingURL.indexOf(',') + 1)
    sourceMapData = decodeBase64(rawData)
    sourceMappingURL = source
  } else {
    // 外部 map URL 相对生成文件解析。
    sourceMappingURL = supportRelativeURL(source, sourceMappingURL)
    sourceMapData = retrieveFile(sourceMappingURL)
  }

  if (!sourceMapData) return null

  return {
    url: sourceMappingURL,
    map: sourceMapData,
  }
}

/**
 * 把一处生成代码位置映射回原始源码。
 *
 * Vite Runner 内存 map 优先；其次才查询全局缓存和外部文件。若找不到精确映射，
 * 保留生成文件位置，因为精确的生成位置比含糊的原始位置更有诊断价值。
 */
function mapSourcePosition(position: OriginalMapping) {
  if (!position.source) return position
  let sourceMap = getRunnerSourceMap(position)
  if (!sourceMap) sourceMap = sourceMapCache[position.source]
  if (!sourceMap) {
    // 调用可覆盖的 retrieveSourceMap 获取 map。
    const urlAndMap = retrieveSourceMap(position.source)
    if (urlAndMap && urlAndMap.map) {
      const url = urlAndMap.url
      sourceMap = sourceMapCache[position.source] = {
        url,
        map: new DecodedMap(
          typeof urlAndMap.map === 'string'
            ? JSON.parse(urlAndMap.map)
            : urlAndMap.map,
          url,
        ),
      }

      const contents = sourceMap.map?.map.sourcesContent
      // 把 sourcesContent 预填入文件缓存；这些虚拟源码可能根本不存在于磁盘。
      if (sourceMap.map && contents) {
        sourceMap.map.resolvedSources.forEach((source, i) => {
          const content = contents[i]
          if (content && source && url) {
            const contentUrl = supportRelativeURL(url, source)
            fileContentsCache[contentUrl] = content
          }
        })
      }
    } else {
      sourceMap = sourceMapCache[position.source] = {
        url: null,
        map: null,
      }
    }
  }

  // 原始 source URL 需要相对 sourcemap URL 解析。
  if (sourceMap.map && sourceMap.url) {
    const originalPosition = getOriginalPosition(sourceMap.map, position)

    // 只有找到精确行列才采用原始位置；否则继续显示生成文件的准确位置。
    if (originalPosition && originalPosition.source != null) {
      originalPosition.source = supportRelativeURL(
        sourceMap.url,
        originalPosition.source,
      )
      if (sourceMap.vite) {
        // @ts-expect-error `_vite` 是内部标记，不属于 trace-mapping 的公共类型
        originalPosition._vite = true
      }
      return originalPosition
    }
  }

  return position
}

/**
 * 递归映射 V8 `FormatEvalOrigin()` 生成的 eval 来源文本。
 * 参考：https://code.google.com/p/v8/source/browse/trunk/src/messages.js
 */
function mapEvalOrigin(origin: string): string {
  // 大多数 eval() 调用使用这一格式。
  let match = /^eval at ([^(]+) \((.+):(\d+):(\d+)\)$/.exec(origin)
  if (match) {
    const position = mapSourcePosition({
      name: null,
      source: match[2],
      line: +match[3],
      column: +match[4] - 1,
    })
    return `eval at ${match[1]} (${position.source}:${position.line}:${position.column + 1})`
  }

  // 嵌套 eval() 递归解析内部 origin。
  match = /^eval at ([^(]+) \((.+)\)$/.exec(origin)
  if (match) return `eval at ${match[1]} (${mapEvalOrigin(match[2])})`

  // 无法识别时保留原文，至少不丢失宿主提供的信息。
  return origin
}

/**
 * 以 V8 的展示规则把兼容 CallSite 格式化为单行堆栈帧。
 *
 * 该逻辑取自 V8 messages.js；原先转发 `CallSite.prototype.toString` 的 shim 会被
 * V8 原型链变化破坏，因此保留兼容实现。
 */
function CallSiteToString(this: CallSite) {
  let fileName
  let fileLocation = ''
  if (this.isNative()) {
    fileLocation = 'native'
  } else {
    fileName = this.getScriptNameOrSourceURL()
    if (!fileName && this.isEval()) {
      fileLocation = this.getEvalOrigin()!
      fileLocation += ', ' // 后面还会拼接源码位置。
    }

    if (fileName) {
      fileLocation += fileName
    } else {
      // 非文件、非原生代码仍可能在源码字符串（如 eval 字符串）中拥有位置。
      fileLocation += '<anonymous>'
    }
    const lineNumber = this.getLineNumber()
    if (lineNumber != null) {
      fileLocation += `:${lineNumber}`
      const columnNumber = this.getColumnNumber()
      if (columnNumber) fileLocation += `:${columnNumber}`
    }
  }

  let line = ''
  const functionName = this.getFunctionName()
  let addSuffix = true
  const isConstructor = this.isConstructor()
  const isMethodCall = !(this.isToplevel() || isConstructor)
  if (isMethodCall) {
    let typeName = this.getTypeName()
    // 兼容 Node v0 至 v4 的旧 CallSite 表现。
    if (typeName === '[object Object]') typeName = 'null'

    const methodName = this.getMethodName()
    if (functionName) {
      if (typeName && functionName.indexOf(typeName) !== 0)
        line += `${typeName}.`

      line += functionName
      if (
        methodName &&
        functionName.indexOf(`.${methodName}`) !==
          functionName.length - methodName.length - 1
      )
        line += ` [as ${methodName}]`
    } else {
      line += `${typeName}.${methodName || '<anonymous>'}`
    }
  } else if (isConstructor) {
    line += `new ${functionName || '<anonymous>'}`
  } else if (functionName) {
    line += functionName
  } else {
    line += fileLocation
    addSuffix = false
  }
  if (addSuffix) line += ` (${fileLocation})`

  return line
}

/** 克隆 V8 CallSite，使映射后的 getter 可以安全覆盖，而不修改原始帧。 */
function cloneCallSite(frame: CallSite) {
  // 使用 null 原型，避免用户冻结 Object.prototype 后给 constructor 赋值抛错。
  const object = Object.create(null) as CallSite
  Object.getOwnPropertyNames(Object.getPrototypeOf(frame)).forEach((name) => {
    const key = name as keyof CallSite
    // @ts-expect-error V8 CallSite 的动态 getter 难以逐项表达类型
    object[key] = /^(?:is|get)/.test(name)
      ? function () {
          return frame[key].call(frame)
        }
      : frame[key]
  })
  object.toString = CallSiteToString
  return object
}

/** 用映射后的位置包装单个堆栈帧，并在相邻帧间传递函数名信息。 */
function wrapCallSite(frame: CallSite, state: State) {
  // 保持对旧调用方式的接口兼容。
  if (state === undefined) state = { nextPosition: null, curPosition: null }

  if (frame.isNative()) {
    state.curPosition = null
    return frame
  }

  // 通常从 getFileName() 取源码；带 `//# sourceURL=...` 的 eval 代码则只能从
  // getScriptNameOrSourceURL() 取得。
  const source = frame.getFileName() || frame.getScriptNameOrSourceURL()
  if (source) {
    const line = frame.getLineNumber() ?? 0
    const column = (frame.getColumnNumber() ?? 1) - 1

    const position = mapSourcePosition({
      name: null,
      source,
      line,
      column,
    })
    state.curPosition = position
    frame = cloneCallSite(frame)
    const originalFunctionName = frame.getFunctionName
    /** 优先采用相邻映射段记录的名称，并隐藏 Vite 求值包装器产生的 eval 名称。 */
    frame.getFunctionName = function () {
      const name = (() => {
        if (state.nextPosition == null) return originalFunctionName()

        return state.nextPosition.name || originalFunctionName()
      })()
      return name === 'eval' && '_vite' in position ? null : name
    }
    /** 将生成文件名替换为 map 中恢复的源文件名。 */
    frame.getFileName = function () {
      return position.source ?? null
    }
    /** 返回原始源码的一基行号，保持 V8 CallSite 的行号约定。 */
    frame.getLineNumber = function () {
      return position.line
    }
    /** 把 sourcemap 的零基列转换回 V8 CallSite 的一基列。 */
    frame.getColumnNumber = function () {
      return position.column + 1
    }
    /** 让堆栈展示地址与映射后的源文件名一致。 */
    frame.getScriptNameOrSourceURL = function () {
      return position.source!
    }
    return frame
  }

  // eval() 帧没有普通文件位置，需要单独改写 origin 文本。
  let origin = frame.isEval() && frame.getEvalOrigin()
  if (origin) {
    origin = mapEvalOrigin(origin)
    frame = cloneCallSite(frame)
    /** 返回递归改写后的 eval 来源，无法保留来源时遵循 CallSite 的 undefined 约定。 */
    frame.getEvalOrigin = function () {
      return origin || undefined
    }
    return frame
  }

  // 无法映射时原样保留帧。
  return frame
}

/** V8 的全局堆栈格式化入口：逐帧映射后恢复标准 `Error: message\n at ...` 形状。 */
function prepareStackTrace(error: Error, stack: CallSite[]) {
  const name = error.name || 'Error'
  const message = error.message || ''
  const errorString = `${name}: ${message}`

  const state = { nextPosition: null, curPosition: null }
  const processedStack = []
  for (let i = stack.length - 1; i >= 0; i--) {
    processedStack.push(`\n    at ${wrapCallSite(stack[i], state)}`)
    state.nextPosition = state.curPosition
  }
  state.curPosition = state.nextPosition = null
  return errorString + processedStack.reverse().join('')
}
