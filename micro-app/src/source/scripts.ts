/* eslint-disable node/no-callback-literal, no-void */
import type {
  AppInterface,
  ScriptSourceInfo,
  plugins,
  Func,
  fiberTasks,
  AttrsType,
  microAppWindowType,
} from '@micro-app/types'
import { fetchSource } from './fetch'
import {
  CompletionPath,
  promiseStream,
  createNonceSrc,
  pureCreateElement,
  defer,
  logError,
  isUndefined,
  isPlainObject,
  isArray,
  isFunction,
  getAttributes,
  injectFiberTask,
  serialExecFiberTasks,
  isInlineScript,
  isString,
} from '../libs/utils'
import {
  dispatchOnLoadEvent,
  dispatchOnErrorEvent,
} from './load_event'
import microApp from '../micro_app'
import globalEnv from '../libs/global_env'
import { GLOBAL_CACHED_KEY } from '../constants'
import sourceCenter from './source_center'

/** 脚本执行进度回调；原生 module 数量与延迟批次失败数附在同一函数对象上。 */
export type moduleCallBack = Func & {
  /** 尚未结算的原生 module 数量；外链等 load，内联由微任务结算。 */
  moduleCount?: number,
  /** defer/async 资源批次中抓取失败的脚本数量。 */
  errorCount?: number
}

/** micro-app 会提取并执行的 JavaScript MIME/type 白名单。 */
const scriptTypes = ['text/javascript', 'text/ecmascript', 'application/javascript', 'application/ecmascript', 'module', 'systemjs-module', 'systemjs-importmap']

/** 判断脚本是否必须保留浏览器原生 `type="module"` 执行语义。 */
function isTypeModule (app: AppInterface, scriptInfo: ScriptSourceInfo): boolean {
  return scriptInfo.appSpace[app.name].module && (!app.useSandbox || app.iframe)
}

/** 判断脚本是否带有需保留真实 DOM 身份的特殊属性；当前以 `id` 为判据。 */
function isSpecialScript (app: AppInterface, scriptInfo: ScriptSourceInfo): boolean {
  const attrs = scriptInfo.appSpace[app.name].attrs
  return attrs.has('id')
}

/**
 * 判断脚本是否应通过真实 script 元素执行。
 *
 * 应用级 inline 配置、元素 `inline` 属性、需原生执行的 module 脚本，以及带 `id` 的特殊
 * 脚本都会进入该模式；其余脚本可编译为 Function 并在沙箱有效 window 上调用。
 */
function isInlineMode (app: AppInterface, scriptInfo: ScriptSourceInfo): boolean {
  return (
    app.inline ||
    scriptInfo.appSpace[app.name].inline ||
    isTypeModule(app, scriptInfo) ||
    isSpecialScript(app, scriptInfo)
  )
}

/**
 * 返回 Function 构造和调用应绑定的有效 window。
 *
 * iframe 应用使用当前 iframe window，其他模式使用宿主原始 window。这里决定新函数的
 * 构造器和执行时的 `this`；从其他应用借用的缓存函数仍属于它创建时的 realm。
 */
function getEffectWindow (app: AppInterface): microAppWindowType {
  return app.iframe ? app.sandBox.microAppWindow : globalEnv.rawWindow
}

/** 使用应用有效 window 的 `Function` 构造器把已绑定作用域的代码编译为函数。 */
function code2Function (app: AppInterface, code: string): Function {
  const targetWindow = getEffectWindow(app)
  return new targetWindow.Function(code)
}

/**
 * 在同一脚本地址的其他应用空间中查找代码相同的已编译函数。
 *
 * 当前实现只比较 `parsedCode` 并排除当前应用空间，不单独检查函数所属 realm。正常
 * CreateApp 的 iframe 模式强制 inline，不进入此 Function 缓存路径；可达的复用场景主要是
 * with 沙箱或关闭沙箱的非 inline 脚本，它们都使用宿主 Function 构造器。
 *
 * @param app - 当前应用，用于排除自身空间。
 * @param scriptInfo - 当前脚本地址的全局及应用级缓存。
 * @param currentCode - 当前应用已经完成插件和沙箱包装的代码。
 * @returns 匹配的编译函数；不存在时返回 `undefined`。
 */
function getExistParseResult (
  app: AppInterface,
  scriptInfo: ScriptSourceInfo,
  currentCode: string,
): Function | void {
  const appSpace = scriptInfo.appSpace
  for (const item in appSpace) {
    if (item !== app.name) {
      const appSpaceData = appSpace[item]
      if (appSpaceData.parsedCode === currentCode && appSpaceData.parsedFunction) {
        return appSpaceData.parsedFunction
      }
    }
  }
}

/**
 * 取得可执行函数：优先复用代码完全一致的缓存，否则在当前有效 window 中重新编译。
 *
 * @returns 与当前 `parsedCode` 对应的可执行函数。
 */
function getParsedFunction (
  app: AppInterface,
  scriptInfo: ScriptSourceInfo,
  parsedCode: string,
): Function {
  return getExistParseResult(app, scriptInfo, parsedCode) || code2Function(app, parsedCode)
}

/** 递归生成未被资源中心占用的内联脚本 nonce，防止随机键覆盖已有脚本。 */
function getUniqueNonceSrc (): string {
  const nonceStr: string = createNonceSrc()
  if (sourceCenter.script.hasInfo(nonceStr)) {
    return getUniqueNonceSrc()
  }
  return nonceStr
}

/**
 * 把原脚本属性迁移到替代 script 元素。
 *
 * `type=module`、defer、async 由执行调度器控制而不直接复制；`src` 保存为
 * `data-origin-src`，避免替代元素再次发起网络请求。
 */
function setConvertScriptAttr (convertScript: HTMLScriptElement, attrs: AttrsType): void {
  attrs.forEach((value, key) => {
    if ((key === 'type' && value === 'module') || key === 'defer' || key === 'async') return
    if (key === 'src') key = 'data-origin-src'
    globalEnv.rawSetAttribute.call(convertScript, key, value)
  })
}

/** 判断当前脚本是否需要注入 with/iframe 沙箱作用域包装。 */
function isWrapInSandBox (app: AppInterface, scriptInfo: ScriptSourceInfo): boolean {
  return app.useSandbox && !isTypeModule(app, scriptInfo)
}

/** 返回影响脚本包装与函数缓存有效性的沙箱类别。 */
function getSandboxType (app: AppInterface, scriptInfo: ScriptSourceInfo): 'with' | 'iframe' | 'disable' {
  return isWrapInSandBox(app, scriptInfo) ? app.iframe ? 'iframe' : 'with' : 'disable'
}

/**
 * 提取一个脚本元素，并按执行策略登记资源或返回动态执行信息。
 *
 * exclude/不受支持的 module 分支用注释占位；ignore 和非脚本 MIME 保留节点、跳过执行管线；远程脚本
 * 按完整地址全局缓存，静态内联脚本以唯一 nonce 缓存。DOMParser 生成的 ignore 脚本仍是
 * 惰性节点，不由框架执行。静态提取只登记资源，真正执行发生
 * 在挂载阶段；动态提取把地址和资源信息交给 DOM 补丁立即调度。
 *
 * @param script - 待提取的原始脚本元素。
 * @param parent - 静态入口中用于替换脚本的父节点。
 * @param app - 当前应用实例。
 * @param isDynamic - 是否来自运行期 DOM 插入。
 * @returns 动态模式的执行信息/替代注释，静态模式的 DOM 替换结果，或忽略分支的 `null`。
 */
export function extractScriptElement (
  script: HTMLScriptElement,
  parent: Node | null,
  app: AppInterface,
  isDynamic = false,
): any {
  let replaceComment: Comment | null = null
  let src: string | null = script.getAttribute('src')
  if (src) src = CompletionPath(src, app.url)
  if (script.hasAttribute('exclude') || checkExcludeUrl(src, app.name)) {
    replaceComment = document.createComment('script element with exclude attribute removed by micro-app')
  } else if (
    (
      script.type &&
      !scriptTypes.includes(script.type)
    ) ||
    script.hasAttribute('ignore') ||
    checkIgnoreUrl(src, app.name)
  ) {
    // 配置为忽略的脚本，清空 rawDocument.currentScript，避免被忽略的脚本内获取 currentScript 出错
    if (globalEnv.rawDocument?.currentScript) {
      delete globalEnv.rawDocument.currentScript
    }
    return null
  } else if (
    (globalEnv.supportModuleScript && script.noModule) ||
    (!globalEnv.supportModuleScript && script.type === 'module')
  ) {
    replaceComment = document.createComment(`${script.noModule ? 'noModule' : 'module'} script ignored by micro-app`)
  } else if (src) { // 远程脚本按完整地址登记到共享资源中心。
    let scriptInfo = sourceCenter.script.getInfo(src)
    const appSpaceData = {
      async: script.hasAttribute('async'),
      defer: script.defer || script.type === 'module',
      module: script.type === 'module',
      inline: script.hasAttribute('inline'),
      pure: script.hasAttribute('pure'),
      attrs: getAttributes(script),
    }
    if (!scriptInfo) {
      scriptInfo = {
        code: '',
        isExternal: true,
        appSpace: {
          [app.name]: appSpaceData,
        }
      }
    } else {
      /**
       * 同一地址再次出现时复用已存在的应用空间。静态脚本通常属性相同，但应用 URL 或动态
       * 重复插入可能带来属性差异；当前实现以第一次登记的数据为准，后续调度必须遵守该缓存
       * 不变量。
       */
      scriptInfo.appSpace[app.name] = scriptInfo.appSpace[app.name] || appSpaceData
    }

    sourceCenter.script.setInfo(src, scriptInfo)

    if (!isDynamic) {
      app.source.scripts.add(src)
      replaceComment = document.createComment(`script with src='${src}' extract by micro-app`)
    } else {
      return { address: src, scriptInfo }
    }
  } else if (script.textContent) { // 有内容的内联脚本以 nonce 作为资源地址。
    /**
     * 每个内联脚本都视为独立资源，动态创建时每次重新执行。动态脚本信息只在当前调用链中
     * 存活，不进入资源中心；静态脚本随应用登记，并在彻底销毁时按 nonce 清理。
     */
    const nonceStr: string = getUniqueNonceSrc()
    const scriptInfo = {
      code: script.textContent,
      isExternal: false,
      appSpace: {
        [app.name]: {
          async: false,
          defer: script.type === 'module',
          module: script.type === 'module',
          inline: script.hasAttribute('inline'),
          pure: script.hasAttribute('pure'),
          attrs: getAttributes(script),
        }
      }
    }
    if (!isDynamic) {
      app.source.scripts.add(nonceStr)
      sourceCenter.script.setInfo(nonceStr, scriptInfo)
      replaceComment = document.createComment('inline script extract by micro-app')
    } else {
      // 动态内联脚本不可复用；不写全局资源中心可避免短生命周期代码持续占用缓存。
      return { address: nonceStr, scriptInfo }
    }
  } else if (!isDynamic) {
    /**
     * 静态入口中的空 src/空内容脚本没有可执行资源，用注释移除；动态创建的空脚本保留，
     * 允许调用方稍后设置属性或文本。
     */
    replaceComment = document.createComment('script element removed by micro-app')
  }

  if (isDynamic) {
    return { replaceComment }
  } else {
    return parent?.replaceChild(replaceComment!, script)
  }
}

/**
 * 合并全局资源插件与当前应用插件，保持全局配置先执行的顺序。
 *
 * @param appName - 已规范化的应用名。
 * @returns 当前资源应依次经过的插件列表。
 */
export function getAssetsPlugins (appName: string): plugins['global'] {
  const globalPlugins = microApp.options.plugins?.global || []
  const modulePlugins = microApp.options.plugins?.modules?.[appName] || []

  return [...globalPlugins, ...modulePlugins]
}

/**
 * 判断资源地址是否被任一全局或应用级插件标记为排除。
 *
 * 排除意味着 micro-app 不加载也不执行该资源；空地址不会进入插件检查。
 *
 * @param address - CSS 或 JavaScript 地址。
 * @param appName - 用于选择应用级插件的应用名。
 */
export function checkExcludeUrl (address: string | null, appName: string): boolean {
  if (!address) return false
  const plugins = getAssetsPlugins(appName) || []
  return plugins.some(plugin => {
    if (!plugin.excludeChecker) return false
    return plugin.excludeChecker(address)
  })
}

/**
 * 判断资源地址是否被任一插件标记为忽略。
 *
 * ignore 与 exclude 不同：元素脱离 micro-app 资源管线并保留浏览器原生行为。
 *
 * @param address - CSS 或 JavaScript 地址。
 * @param appName - 用于选择应用级插件的应用名。
 */
export function checkIgnoreUrl (address: string | null, appName: string): boolean {
  if (!address) return false
  const plugins = getAssetsPlugins(appName) || []
  return plugins.some(plugin => {
    if (!plugin.ignoreChecker) return false
    return plugin.ignoreChecker(address)
  })
}

/**
 * 并行抓取挂载前必须就绪的脚本资源，并发出脚本下载链完成信号。
 *
 * 普通挂载只预取同步脚本；defer/async 留到执行阶段。非预渲染的 prefetch 会提前抓取全部
 * 脚本。每个成功结果可进入 fiber 空闲任务，所有请求结算后调用一次 `app.onLoad()`；单个
 * 失败只记录错误，不能阻塞加载状态机结算。
 *
 * @param wrapElement - 两条资源链完成后交给应用的解析 DOM。
 * @param app - 当前应用及其脚本资源集合。
 */
export function fetchScriptsFromHtml (
  wrapElement: HTMLElement,
  app: AppInterface,
): void {
  const scriptList: Array<string> = Array.from(app.source.scripts)
  const fetchScriptPromise: Array<Promise<string> | string> = []
  const fetchScriptPromiseInfo: Array<[string, ScriptSourceInfo]> = []
  for (const address of scriptList) {
    const scriptInfo = sourceCenter.script.getInfo(address)!
    const appSpaceData = scriptInfo.appSpace[app.name]
    if ((!appSpaceData.defer && !appSpaceData.async) || (app.isPrefetch && !app.isPrerender)) {
      fetchScriptPromise.push(scriptInfo.code ? scriptInfo.code : fetchSource(address, app.name))
      fetchScriptPromiseInfo.push([address, scriptInfo])
    }
  }

  const fiberScriptTasks: fiberTasks = app.isPrefetch || app.fiber ? [] : null

  if (fetchScriptPromise.length) {
    promiseStream<string>(fetchScriptPromise, (res: {
      /** 当前脚本资源文本。 */
      data: string,
      /** 与 `fetchScriptPromiseInfo` 对齐的稳定索引。 */
      index: number
    }) => {
      injectFiberTask(fiberScriptTasks, () => fetchScriptSuccess(
        fetchScriptPromiseInfo[res.index][0],
        fetchScriptPromiseInfo[res.index][1],
        res.data,
        app,
      ))
    }, (err: {
      /** 单个脚本请求的失败原因。 */
      error: Error,
      /** 失败请求在抓取批次中的索引。 */
      index: number
    }) => {
      logError(err, app.name)
    }, () => {
      if (fiberScriptTasks) {
        fiberScriptTasks.push(() => Promise.resolve(app.onLoad({ html: wrapElement })))
        serialExecFiberTasks(fiberScriptTasks)
      } else {
        app.onLoad({ html: wrapElement })
      }
    })
  } else {
    app.onLoad({ html: wrapElement })
  }
}

/**
 * 记录脚本抓取结果，并在二级预加载中提前完成作用域绑定与可选编译。
 *
 * 预解析缓存按应用空间保存；inline 模式不编译为 Function。Function 构造失败只记录，
 * 挂载时再尝试构造；插件转换与作用域绑定位于该 try 之外，由调用链处理其异常。
 *
 * @param address - 脚本地址或内联 nonce。
 * @param scriptInfo - 接收原始代码及应用级解析缓存的资源信息。
 * @param code - 已抓取的原始脚本文本。
 * @param app - 决定预加载级别与沙箱策略的应用实例。
 */
export function fetchScriptSuccess (
  address: string,
  scriptInfo: ScriptSourceInfo,
  code: string,
  app: AppInterface,
): void {
  // 下载结果和缓存命中都经此入口，统一写入共享原始代码。
  scriptInfo.code = code

  /**
   * 二级预加载把插件处理、沙箱包装和 Function 构造前移到空闲期。已有应用级解析结果时
   * 跳过；inline 或原生 module 只缓存代码，不创建 Function。首次结果会成为后续同代码
   * 应用空间的复用候选。
   */
  if (app.isPrefetch && app.prefetchLevel === 2) {
    const appSpaceData = scriptInfo.appSpace[app.name]
    /**
     * 同名正式实例可能在预加载处理中替换预加载实例，并通过共享 scriptInfo 先写入
     * `parsedCode`。预加载 URL 或参数与最终 `<micro-app>` 配置不同时尤其容易触发；已有值
     * 必须视为已处理，避免旧预加载结果覆盖正式实例。
     */
    if (!appSpaceData.parsedCode) {
      appSpaceData.parsedCode = bindScope(address, app, code, scriptInfo)
      appSpaceData.sandboxType = getSandboxType(app, scriptInfo)
      if (!isInlineMode(app, scriptInfo)) {
        try {
          appSpaceData.parsedFunction = getParsedFunction(app, scriptInfo, appSpaceData.parsedCode)
        } catch (err) {
          logError('Something went wrong while handling preloaded resources', app.name, '\n', err)
        }
      }
    }
  }
}

/**
 * 在挂载生命周期中按脚本调度属性执行应用脚本。
 *
 * 同步脚本按资源集合顺序立即或经 fiber 串行执行；defer/async 共用延迟批次，先并行补齐代码，
 * 待整批结算后按登记顺序执行，而不是浏览器 async 的下载即执行。原生外链 module 只设置
 * src，由浏览器加载与求值，计数在 load 后递减；内联 module 用微任务近似结算。
 * 每个普通脚本后调用 `initHook(false)`，批次末尾无原生 module 或失败数等于整批长度时传 true。
 * 下载失败项的 code 初值仍为字符串 `''`，会进入空代码执行分支；原生 module 的 error 没有
 * 配对计数处理，失败时不能让剩余 moduleCount 归零。
 * 扫描 Set 时遇到缺代码的 defer/async 就立即开请求，仍继续处理后面的同步脚本；fiber 只把
 * 执行动作入队，有延迟批次时连前面已入队的同步脚本也要等整批下载结算后才启动。
 * 没有延迟批次且未开启 fiber 时，最终 initHook(true) 在当前调用栈完成；全是缓存字符串的
 * 延迟批次也会经 promiseStream 的普通值分支同步结算，而非固定另起微任务。
 *
 * @param app - 当前挂载应用。
 * @param initHook - `CreateApp` 用于在非 UMD 模式收到 true 时完成挂载的回调。
 */
export function execScripts (
  app: AppInterface,
  initHook: moduleCallBack,
): void {
  const fiberScriptTasks: fiberTasks = app.fiber ? [] : null
  const scriptList: Array<string> = Array.from(app.source.scripts)
  const deferScriptPromise: Array<Promise<string>|string> = []
  const deferScriptInfo: Array<[string, ScriptSourceInfo]> = []
  for (const address of scriptList) {
    const scriptInfo = sourceCenter.script.getInfo(address)!
    const appSpaceData = scriptInfo.appSpace[app.name]
    // 重挂载可能直接复用已有代码；defer/async 仍需进入统一的批次顺序。
    if (appSpaceData.defer || appSpaceData.async) {
      // TODO：将 defer 与 module 调度彻底分开，避免共享分支混淆完成条件。
      if (scriptInfo.isExternal && !scriptInfo.code && !isTypeModule(app, scriptInfo)) {
        deferScriptPromise.push(fetchSource(address, app.name))
      } else {
        deferScriptPromise.push(scriptInfo.code)
      }
      deferScriptInfo.push([address, scriptInfo])

      isTypeModule(app, scriptInfo) && (initHook.moduleCount = initHook.moduleCount ? ++initHook.moduleCount : 1)
    } else {
      injectFiberTask(fiberScriptTasks, () => {
        runScript(address, app, scriptInfo)
        initHook(false)
      })
    }
  }

  if (deferScriptPromise.length) {
    promiseStream<string>(deferScriptPromise, (res: {
      /** 当前 defer/async 脚本的文本或缓存值。 */
      data: string,
      /** 与 `deferScriptInfo` 对齐的稳定索引。 */
      index: number
    }) => {
      const scriptInfo = deferScriptInfo[res.index][1]
      scriptInfo.code = scriptInfo.code || res.data
    }, (err: {
      /** 单个 defer/async 请求的失败原因。 */
      error: Error,
      /** 失败请求在本批次中的索引。 */
      index: number
    }) => {
      initHook.errorCount = initHook.errorCount ? ++initHook.errorCount : 1
      logError(err, app.name)
    }, () => {
      deferScriptInfo.forEach(([address, scriptInfo]) => {
        if (isString(scriptInfo.code)) {
          injectFiberTask(fiberScriptTasks, () => {
            runScript(address, app, scriptInfo, initHook)
            !isTypeModule(app, scriptInfo) && initHook(false)
          })
        }
      })

      /**
       * fiber 通过 `requestIdleCallback` 包装任务。同步项已入队，整批结算后才追加延迟项并启动，才能
       * 保持静态脚本顺序。已知边界：脚本执行中创建动态脚本时，后续静态脚本仍等待下一次
       * 空闲回调，动态脚本可能先执行；把动态脚本也放进空闲回调不能建立同一队列顺序。
       */
      if (fiberScriptTasks) {
        fiberScriptTasks.push(() => Promise.resolve(initHook(
          isUndefined(initHook.moduleCount) ||
          initHook.errorCount === deferScriptPromise.length
        )))
        serialExecFiberTasks(fiberScriptTasks)
      } else {
        initHook(
          isUndefined(initHook.moduleCount) ||
          initHook.errorCount === deferScriptPromise.length
        )
      }
    })
  } else {
    if (fiberScriptTasks) {
      fiberScriptTasks.push(() => Promise.resolve(initHook(true)))
      serialExecFiberTasks(fiberScriptTasks)
    } else {
      initHook(true)
    }
  }
}

/**
 * 在当前应用沙箱中执行单个脚本，并维护应用级包装与函数缓存。
 *
 * 执行前切换活跃代理 window；沙箱类别变化会使旧 `parsedCode/parsedFunction` 失效。inline
 * 模式配置真实 script 元素，随后由插入 DOM 触发浏览器执行；其他模式调用缓存 Function。
 * 本函数内捕获的同步异常默认重新抛出，仅当 `excludeRunScriptFilter` 返回 `true` 时抑制；
 * 真实 script 由浏览器报告的求值错误不属于这段 try 的同步异常。
 *
 * @param address - 脚本地址或内联 nonce，用于插件、sourceURL 与缓存定位。
 * @param app - 当前执行应用。
 * @param scriptInfo - 原始代码和当前应用解析缓存。
 * @param callback - 原生 module load 后更新挂载进度的回调。
 * @param replaceElement - 动态脚本已放入 DOM 的替代元素；缺省表示首次静态执行。
 */
export function runScript (
  address: string,
  app: AppInterface,
  scriptInfo: ScriptSourceInfo,
  callback?: moduleCallBack,
  replaceElement?: HTMLScriptElement,
): void {
  try {
    actionsBeforeRunScript(app)
    const appSpaceData = scriptInfo.appSpace[app.name]
    const sandboxType = getSandboxType(app, scriptInfo)
    /**
     * 插件转换与沙箱包装对同一沙箱类别只执行一次。没有 `parsedCode` 时不可能有
     * `parsedFunction`；有代码时仍可能因 inline/module 模式或预编译失败而没有函数。
     */
    if (!appSpaceData.parsedCode || appSpaceData.sandboxType !== sandboxType) {
      appSpaceData.parsedCode = bindScope(address, app, scriptInfo.code, scriptInfo)
      appSpaceData.sandboxType = sandboxType
      appSpaceData.parsedFunction = null
    }

    // inline 模式写入真实元素；Function 模式直接求值。
    if (isInlineMode(app, scriptInfo)) {
      const scriptElement = replaceElement || pureCreateElement('script')
      runCode2InlineScript(
        address,
        appSpaceData.parsedCode,
        isTypeModule(app, scriptInfo),
        scriptElement,
        appSpaceData.attrs,
        callback,
      )

      // 静态执行没有替代元素，由此处插入；动态路径把返回节点交给 DOM 补丁负责插入。
      if (!replaceElement) {
        // TEST IGNORE
        const parent = app.iframe ? app.sandBox?.microBody : app.querySelector('micro-app-body')
        parent?.appendChild(scriptElement)
      }
    } else {
      runParsedFunction(app, scriptInfo)
    }
  } catch (e) {
    console.warn(`[micro-app from ${replaceElement ? 'runDynamicScript' : 'runScript'}] app ${app.name}: `, e, address)
    // 此 try 中捕获的同步错误默认重新抛出；过滤器可按地址和错误显式选择忽略。
    const error = e as Error
    let throwError = true
    if (typeof microApp?.options?.excludeRunScriptFilter === 'function') {
      throwError = microApp.options.excludeRunScriptFilter(address, error, app.name, app.url) !== true
    }
    if (throwError) {
      throw e
    }
  }
}

/**
 * 调度运行期创建的远程脚本，并返回应插入 DOM 的替代节点。
 *
 * inline/module 场景返回真实 script，Function 场景返回注释。执行前尽量把原元素暴露为
 * `document.currentScript`；普通脚本执行后人工发送 load，原生外链 module 等待浏览器 onload。
 * 非空缓存命中或原生 module 在微任务中调度，普通远程脚本未命中时先抓取。未命中分支的
 * Promise catch 同时接收下载和同步执行异常，向原元素发送 error；缓存命中的 defer 分支
 * 没有对应 catch。原生外链 module 的通知只绑定 load，浏览器 error 不在此转发。
 *
 * @param address - 已补全的远程脚本地址。
 * @param app - 当前应用实例。
 * @param scriptInfo - 共享原始代码与应用级执行配置。
 * @param originScript - 接收 currentScript 身份和 load/error 通知的原元素。
 * @returns 替换原脚本后用于承载执行或占位的节点。
 */
export function runDynamicRemoteScript (
  address: string,
  app: AppInterface,
  scriptInfo: ScriptSourceInfo,
  originScript: HTMLScriptElement,
): HTMLScriptElement | Comment {
  const replaceElement = isInlineMode(app, scriptInfo) ? pureCreateElement('script') : document.createComment(`dynamic script with src='${address}' extract by micro-app`)

  /** 向原始动态脚本发送一次加载成功通知。 */
  const dispatchScriptOnLoadEvent = () => dispatchOnLoadEvent(originScript)

  /** 设置 currentScript 后执行脚本，并为非 module 脚本结算 load。 */
  const runDynamicScript = () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalEnv.rawDocument, 'currentScript')
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(globalEnv.rawDocument, 'currentScript', {
        value: originScript,
        configurable: true,
      })
    }

    runScript(address, app, scriptInfo, dispatchScriptOnLoadEvent, replaceElement as HTMLScriptElement)

    !isTypeModule(app, scriptInfo) && dispatchScriptOnLoadEvent()
  }

  if (scriptInfo.code || isTypeModule(app, scriptInfo)) {
    defer(runDynamicScript)
  } else {
    fetchSource(address, app.name).then((code: string) => {
      scriptInfo.code = code
      runDynamicScript()
    }).catch((err) => {
      logError(err, app.name)
      dispatchOnErrorEvent(originScript)
    })
  }

  return replaceElement
}

/**
 * 处理运行期创建的内联脚本，并返回真实 script 或注释占位。
 *
 * 动态内联脚本不进入资源中心，每次调用重新绑定当前沙箱。Function 模式在此同步执行，
 * inline 模式先配置真实 script，随后由调用方插入 DOM 触发浏览器执行。
 *
 * @param address - 本次动态内联脚本的唯一 nonce。
 * @param app - 当前应用实例。
 * @param scriptInfo - 仅在本次调用链存活的脚本信息。
 * @returns inline 模式的真实 script，或 Function 模式的注释节点。
 */
export function runDynamicInlineScript (
  address: string,
  app: AppInterface,
  scriptInfo: ScriptSourceInfo,
): HTMLScriptElement | Comment {
  const replaceElement = isInlineMode(app, scriptInfo) ? pureCreateElement('script') : document.createComment('dynamic inline script extract by micro-app')

  runScript(address, app, scriptInfo, void 0, replaceElement as HTMLScriptElement)

  return replaceElement
}

/**
 * 把已绑定代码配置到真实 script 元素，并处理 module 完成通知。
 *
 * 外部 module 保留 `src` 让浏览器原生加载；内联 module 直接写文本。普通脚本统一写入
 * `textContent`。最后迁移不会破坏调度语义的原始属性。
 *
 * @param address - 远程地址或内联 nonce。
 * @param code - 已经插件处理和沙箱绑定的代码。
 * @param module - 是否交由浏览器 module 机制执行。
 * @param scriptElement - 接收代码、地址与属性的目标元素。
 * @param attrs - 提取阶段保存的原始脚本属性。
 * @param callback - module load 完成时更新剩余计数的回调。
 */
function runCode2InlineScript (
  address: string,
  code: string,
  module: boolean,
  scriptElement: HTMLScriptElement,
  attrs: AttrsType,
  callback?: moduleCallBack,
): void {
  if (module) {
    globalEnv.rawSetAttribute.call(scriptElement, 'type', 'module')
    if (isInlineScript(address)) {
      /**
       * 内联 module 不能转换成 blob 地址，否则会改变其模块解析与执行环境。
       * 证据：https://github.com/jd-opensource/micro-app/issues/805
       */
      scriptElement.textContent = code
    } else {
      scriptElement.src = address
    }
    if (callback) {
      /** 结算一个 module，并仅在全部 module 完成时向挂载流程报告完成。 */
      const onloadHandler = () => {
        callback.moduleCount && callback.moduleCount--
        callback(callback.moduleCount === 0)
      }
      /**
       * 远程 module 插入 document/iframe 后由浏览器触发 onload；这里未绑定 onerror，失败时
       * 不会递减 moduleCount。内联 module 直接在微任务中结算，可能早于模块实际求值完成。
       */
      if (isInlineScript(address)) {
        defer(onloadHandler)
      } else {
        scriptElement.onload = onloadHandler
      }
    }
  } else {
    scriptElement.textContent = code
  }

  setConvertScriptAttr(scriptElement, attrs)
}

/** 延迟创建并缓存 Function，然后以应用有效 window 为 `this` 执行。 */
function runParsedFunction (app: AppInterface, scriptInfo: ScriptSourceInfo) {
  const appSpaceData = scriptInfo.appSpace[app.name]
  if (!appSpaceData.parsedFunction) {
    appSpaceData.parsedFunction = getParsedFunction(app, scriptInfo, appSpaceData.parsedCode!)
  }
  appSpaceData.parsedFunction.call(getEffectWindow(app))
}

/**
 * 依次应用资源插件，并按当前沙箱实现把代码绑定到子应用全局作用域。
 *
 * with 沙箱的 with 目标是 `proxyWindow.__MICRO_APP_WINDOW__` 指向的独立 microAppWindow，
 * 并非 Proxy 本身。GLOBAL_CACHED_KEY 在该作用域中取值后传给内层函数作为参数；其他裸标识符
 * 再沿 with 目标和外层作用域查找。iframe 沙箱显式注入 window/self/global/location。
 * 启用作用域包装时，远程脚本追加 sourceURL 便于调试，内联 nonce 不作为真实 URL 输出；
 * 原生 module 与关闭沙箱的代码只经过插件，不添加这段包装或 sourceURL。
 *
 * @param address - 供插件识别及生成 sourceURL 的资源地址。
 * @param app - 决定插件模块与沙箱类型的应用。
 * @param code - 原始脚本文本。
 * @param scriptInfo - 当前脚本的执行属性。
 * @returns 完成插件转换和可选沙箱包装的代码。
 */
function bindScope (
  address: string,
  app: AppInterface,
  code: string,
  scriptInfo: ScriptSourceInfo,
): string {
  // TODO：评估跨应用包装缓存；同时处理 ESM 原始代码可能为空的边界。
  if (isPlainObject(microApp.options.plugins)) {
    code = usePlugins(address, code, app.name, microApp.options.plugins)
  }

  if (isWrapInSandBox(app, scriptInfo)) {
    return app.iframe ? `(function(window,self,global,location){;${code}\n${isInlineScript(address) ? '' : `//# sourceURL=${address}\n`}}).call(window.__MICRO_APP_SANDBOX__.proxyWindow,window.__MICRO_APP_SANDBOX__.proxyWindow,window.__MICRO_APP_SANDBOX__.proxyWindow,window.__MICRO_APP_SANDBOX__.proxyWindow,window.__MICRO_APP_SANDBOX__.proxyLocation);` : `;(function(proxyWindow){with(proxyWindow.__MICRO_APP_WINDOW__){(function(${GLOBAL_CACHED_KEY}){;${code}\n${isInlineScript(address) ? '' : `//# sourceURL=${address}\n`}}).call(proxyWindow,${GLOBAL_CACHED_KEY})}})(window.__MICRO_APP_PROXY_WINDOW__);`
  }

  return code
}

/**
 * 执行脚本前切换 with 沙箱使用的全局活跃代理。
 */
function actionsBeforeRunScript (app: AppInterface): void {
  setActiveProxyWindow(app)
}

/**
 * 把当前应用代理 window 写入全局桥接槽，供包装代码定位正确沙箱。
 */
function setActiveProxyWindow (app: AppInterface): void {
  if (app.sandBox) {
    globalEnv.rawWindow.__MICRO_APP_PROXY_WINDOW__ = app.sandBox.proxyWindow
  }
}

/**
 * 按“全局插件 → 当前应用插件”的顺序转换脚本文本。
 *
 * @param address - 传给 loader 的脚本地址。
 * @param code - 原始或上一步转换后的代码。
 * @param appName - 用于选择应用级插件的应用名。
 * @param plugins - 全局及分应用插件配置。
 * @returns 完成全部有效 loader 转换的代码。
 */
function usePlugins (address: string, code: string, appName: string, plugins: plugins): string {
  const newCode = processCode(plugins.global, code, address)

  return processCode(plugins.modules?.[appName], newCode, address)
}

/**
 * 串行执行一组 loader；无有效数组或无 loader 的项保持上一步代码不变。
 */
function processCode (configs: plugins['global'], code: string, address: string) {
  if (!isArray(configs)) {
    return code
  }

  return configs.reduce((preCode, config) => {
    if (isPlainObject(config) && isFunction(config.loader)) {
      return config.loader(preCode, address)
    }

    return preCode
  }, code)
}
