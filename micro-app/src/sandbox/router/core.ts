import type {
  MicroLocation,
  MicroState,
  MicroRouterInfoState,
  LocationQuery,
  HandleMicroPathResult,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import {
  assign,
  parseQuery,
  stringifyQuery,
  isString,
  isUndefined,
  isPlainObject,
  createURL,
  isEmptyObject,
} from '../../libs/utils'
import {
  appInstanceMap,
} from '../../create_app'
import {
  ROUTER_MODE_LIST,
  DEFAULT_ROUTER_MODE,
  ROUTER_MODE_STATE,
  ROUTER_MODE_NATIVE,
  ROUTER_MODE_NATIVE_SCOPE,
  ROUTER_MODE_PURE,
} from '../../constants'
import microApp from '../../micro_app'

/**
 * 把指定微应用的路径、业务 state 与路由模式合并进宿主 `history.state`。
 *
 * @remarks
 * 应用状态统一收纳在 `__MICRO_APP_STATE__` 下并按应用名隔离；外层与其他应用条目均保留。路径取自
 * 传入 location 的当前快照，未传时记为 `null`。该函数只构造新对象，不负责提交浏览器历史记录。
 *
 * @param appName - 状态所属的微应用名称。
 * @param microState - 本次导航携带的应用业务状态，空值规范化为 `null`。
 * @param targetLocation - 用于生成 `fullPath` 的微应用 location。
 * @returns 合并后的宿主 history state。
 */
export function setMicroState (
  appName: string,
  microState?: MicroState,
  targetLocation?: MicroLocation,
): MicroState {
  // 基座 state 与应用命名空间分别做浅合并；业务 state 不替代宿主其他字段。
  const rawState = globalEnv.rawWindow.history.state
  const additionalState: Record<'__MICRO_APP_STATE__', Record<string, MicroRouterInfoState>> = {
    __MICRO_APP_STATE__: assign({}, rawState?.__MICRO_APP_STATE__, {
      [appName]: {
        fullPath: targetLocation ? targetLocation.pathname + targetLocation.search + targetLocation.hash : null,
        state: microState ?? null,
        mode: getRouterMode(appName),
      }
    }),
  }

  // 返回新外层对象，避免调用方直接复用宿主当前 state 引用。
  return assign({}, rawState, additionalState)
}

/**
 * 从给定宿主 state 中删除指定微应用的路由条目，并在最后一项移除后清掉命名空间。
 *
 * @remarks
 * 当前实现会删除传入对象内部的应用条目，再为非空结果创建浅拷贝；调用方应把参数视为待提交的
 * history state。清理后的对象为空时返回 `null`，与浏览器无自定义 state 的表示保持一致。
 */
export function removeMicroState (appName: string, rawState: MicroState): MicroState {
  if (isPlainObject(rawState?.__MICRO_APP_STATE__)) {
    if (!isUndefined(rawState.__MICRO_APP_STATE__[appName])) {
      delete rawState.__MICRO_APP_STATE__[appName]
    }
    if (!Object.keys(rawState.__MICRO_APP_STATE__).length) {
      delete rawState.__MICRO_APP_STATE__
    }
  }

  return !isEmptyObject(rawState) ? assign({}, rawState) : null
}

/**
 * 从宿主当前 history.state 读取应用条目内的业务 state；条目缺失或读取值为假值时返回 null。
 */
export function getMicroState (appName: string): MicroState {
  const rawState = globalEnv.rawWindow.history.state
  return rawState?.__MICRO_APP_STATE__?.[appName]?.state || null
}

/**
 * 从宿主当前 `history.state` 读取指定应用完整的路由快照。
 */
export function getMicroRouterInfoState (appName: string): MicroRouterInfoState | null {
  const rawState = globalEnv.rawWindow.history.state
  return rawState?.__MICRO_APP_STATE__?.[appName] || null
}

/** 编码前匹配路径中的 `&`，替换为不会被查询参数解析器拆分的 `%M1` 标记。 */
const ENC_AD_RE = /&/g // 对应内部标记 `%M1`
/** 编码前匹配路径中的 `=`，替换为不会被查询参数解析器误判的 `%M2` 标记。 */
const ENC_EQ_RE = /=/g // 对应内部标记 `%M2`
/** 解码后匹配内部 `%M1` 标记，以恢复原始 `&`。 */
const DEC_AD_RE = /%M1/g // 恢复为 `&`
/** 解码后匹配内部 `%M2` 标记，以恢复原始 `=`。 */
const DEC_EQ_RE = /%M2/g // 恢复为 `=`

/**
 * 把微应用完整路径编码为单个查询参数值，并保护路径内部的 `&`、`=` 分隔符。
 */
export function encodeMicroPath (path: string): string {
  return encodeURIComponent(commonDecode(path).replace(ENC_AD_RE, '%M1').replace(ENC_EQ_RE, '%M2'))
}

/**
 * 递归解除 URI 编码并还原 micro-app 自定义的 `&`、`=` 占位标记。
 */
export function decodeMicroPath (path: string): string {
  return commonDecode(path).replace(DEC_AD_RE, '&').replace(DEC_EQ_RE, '=')
}

/**
 * 递归解码可能被多次 `encodeURIComponent` 处理的地址，直到结果稳定或遇到内部占位标记。
 *
 * @remarks
 * 非法百分号序列由 `decodeURIComponent` 抛错；此处捕获后保留最近的原值，使路由读取不会因畸形
 * 外部 URL 中断整个应用。
 */
function commonDecode (path: string): string {
  try {
    const decPath = decodeURIComponent(path)
    if (path === decPath || DEC_AD_RE.test(decPath) || DEC_EQ_RE.test(decPath)) return decPath
    return commonDecode(decPath)
  } catch {
    return path
  }
}

/**
 * 生成微应用在宿主查询参数中的路由键。
 *
 * @remarks
 * 当前直接使用应用名，读、写、删除查询参数都经过同一函数。
 */
function formatQueryAppName (appName: string) {
  // 查询键就是应用名，不额外添加前缀。
  return appName
}

/**
 * 按应用路由模式从宿主 URL 或 `history.state` 还原微应用完整路径。
 *
 * @remarks
 * `search` 模式从 search/hash 查询参数解码；其他模式优先使用 `__MICRO_APP_STATE__` 的快照，原生
 * 模式缺少快照时才回退到宿主地址。WHY：部分路由器在 push 前会用旧 `history.state.current` 调用
 * `replaceState`，宿主切页可能因此把子应用新路径覆盖为旧路径；micro-app 自己记录的 `fullPath`
 * 才是可靠恢复源。`pure` 模式也可消费由 location 导航留下的一次性 state。
 * search 同时含 hash/query 两处同名键时优先取 hash；解析成数组等非字符串值时不作为有效路径返回。
 *
 * @param appName - 待读取路由的微应用名称。
 * @returns 已恢复的完整路径；浏览器没有该应用记录时返回 `null`。
 */
export function getMicroPathFromURL (appName: string): string | null {
  const rawLocation = globalEnv.rawWindow.location
  const rawState = globalEnv.rawWindow.history.state
  if (isRouterModeSearch(appName)) {
    const queryObject = getQueryObjectFromURL(rawLocation.search, rawLocation.hash)
    const microPath = queryObject.hashQuery?.[formatQueryAppName(appName)] || queryObject.searchQuery?.[formatQueryAppName(appName)]
    return isString(microPath) ? decodeMicroPath(microPath) : null
  }
  // `state` 完全依赖该快照；`pure` 可读取一次性快照；原生模式用它抵御第三方路由器回写旧地址。
  // 限制：原生模式不支持同页多个微应用共同占用浏览器路径，此场景应选用 `search` 或 `state`。
  return rawState?.__MICRO_APP_STATE__?.[appName]?.fullPath || (isRouterModeCustom(appName) ? rawLocation.pathname + rawLocation.search + rawLocation.hash : null)
}

/**
 * 按路由模式把微应用完整路径合成到待提交的宿主 URL。
 *
 * @remarks
 * `search` 模式把编码路径写入 search；当宿主已有 hash 且没有 search 时，视其为 hash 路由并写入
 * hash 查询段。`state` 与 `pure` 不改变宿主可见路径，仅返回当前宿主地址；原生模式直接采用微应用
 * 地址。函数只计算结果，不调用 History API。
 *
 * @param appName - 待附加路径的微应用名称。
 * @param targetLocation - 微应用当前 location 或待提交的目标 location。
 * @returns 新宿主完整路径，以及参数是否附加在 hash 中的标记。
 */
export function setMicroPathToURL (appName: string, targetLocation: MicroLocation): HandleMicroPathResult {
  const rawLocation = globalEnv.rawWindow.location
  let targetFullPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
  let isAttach2Hash = false
  if (isRouterModeSearch(appName)) {
    let { pathname, search, hash } = rawLocation
    const queryObject = getQueryObjectFromURL(search, hash)
    const encodedMicroPath = encodeMicroPath(targetFullPath)

    // 已有 hash 且没有 search 时，把应用参数写入 hash 的查询段；其他情况写入标准 search。
    if (hash && !search) {
      isAttach2Hash = true
      if (queryObject.hashQuery) {
        queryObject.hashQuery[formatQueryAppName(appName)] = encodedMicroPath
      } else {
        queryObject.hashQuery = {
          [formatQueryAppName(appName)]: encodedMicroPath
        }
      }
      const baseHash = hash.includes('?') ? hash.slice(0, hash.indexOf('?') + 1) : hash + '?'
      hash = baseHash + stringifyQuery(queryObject.hashQuery)
    } else {
      if (queryObject.searchQuery) {
        queryObject.searchQuery[formatQueryAppName(appName)] = encodedMicroPath
      } else {
        queryObject.searchQuery = {
          [formatQueryAppName(appName)]: encodedMicroPath
        }
      }
      search = '?' + stringifyQuery(queryObject.searchQuery)
    }

    return {
      fullPath: pathname + search + hash,
      isAttach2Hash,
    }
  }

  if (isRouterModeState(appName) || isRouterModePure(appName)) {
    targetFullPath = rawLocation.pathname + rawLocation.search + rawLocation.hash
  }

  return {
    fullPath: targetFullPath,
    isAttach2Hash,
  }
}

/**
 * 从宿主 URL 的 search 或 hash 查询段删除指定微应用路径。
 *
 * @remarks
 * 只处理 `search` 模式；其他模式的可见 URL 没有应用专属查询参数。删除最后一个参数时同步移除多余
 * `?`，并返回参数原先是否位于 hash 中，供提交层决定事件行为。
 *
 * @param appName - 待删除路径的微应用名称。
 * @returns 清理后的宿主完整路径与 hash 附加标记。
 */
export function removeMicroPathFromURL (appName: string): HandleMicroPathResult {
  let { pathname, search, hash } = globalEnv.rawWindow.location
  let isAttach2Hash = false

  if (isRouterModeSearch(appName)) {
    const queryObject = getQueryObjectFromURL(search, hash)
    if (queryObject.hashQuery?.[formatQueryAppName(appName)]) {
      isAttach2Hash = true
      delete queryObject.hashQuery?.[formatQueryAppName(appName)]
      const hashQueryStr = stringifyQuery(queryObject.hashQuery)
      hash = hash.slice(0, hash.indexOf('?') + Number(Boolean(hashQueryStr))) + hashQueryStr
    } else if (queryObject.searchQuery?.[formatQueryAppName(appName)]) {
      delete queryObject.searchQuery?.[formatQueryAppName(appName)]
      const searchQueryStr = stringifyQuery(queryObject.searchQuery)
      search = searchQueryStr ? '?' + searchQueryStr : ''
    }
  }

  return {
    fullPath: pathname + search + hash,
    isAttach2Hash,
  }
}

/**
 * 把宿主 search 与 hash 中的查询段分别解析为可独立修改的对象。
 *
 * @remarks
 * hash 仅在包含 `?` 时解析其后半段；hash 路径本体由调用方原样保留。
 */
function getQueryObjectFromURL (search: string, hash: string): LocationQuery {
  const queryObject: LocationQuery = {}

  if (search !== '' && search !== '?') {
    queryObject.searchQuery = parseQuery(search.slice(1))
  }

  if (hash.includes('?')) {
    queryObject.hashQuery = parseQuery(hash.slice(hash.indexOf('?') + 1))
  }

  return queryObject
}

/**
 * 读取微应用路径并移除 hash，返回带 origin 的资源定位地址。
 *
 * @param appName - 目标微应用名称。
 * @param baseUrl - 相对微应用路径的解析基准。
 * @returns 不含 hash 的绝对地址；没有路由记录时返回空字符串。
 */
export function getNoHashMicroPathFromURL (appName: string, baseUrl: string): string {
  const microPath = getMicroPathFromURL(appName)
  if (!microPath) return ''
  const formatLocation = createURL(microPath, baseUrl)
  return formatLocation.origin + formatLocation.pathname + formatLocation.search
}

/**
 * 判断应用是否仍可参与路由导航与状态同步。
 *
 * @remarks
 * 此处只要求实例存在且 isPrefetch 为 false，未检查卸载或隐藏状态。隐藏的 keep-alive 应用仍须通过：
 * 隐藏流程先改变应用状态，再移除浏览器路由；若在这里排除隐藏状态，清理写入就会被阻断。
 *
 * @param appName - 待检查的微应用名称。
 */
export function isEffectiveApp (appName: string): boolean {
  const app = appInstanceMap.get(appName)
  // 公共 router API 与宿主事件监听器另外使用 getActiveApps 过滤；不要把该条件等同于可见/已挂载。
  return !!(app && !app.isPrefetch)
}

/**
 * 读取应用实例已解析的路由模式；应用尚未注册时返回 `undefined`。
 */
function getRouterMode (appName: string): string | undefined {
  return appInstanceMap.get(appName)?.routerMode
}

/** 判断应用是否使用默认 `search` 模式，把编码路径放入宿主 URL 查询段。 */
export function isRouterModeSearch (appName: string): boolean {
  return getRouterMode(appName) === DEFAULT_ROUTER_MODE
}

/** 判断应用是否使用 `state` 模式，只在 `history.state` 保存路径而不改宿主地址。 */
export function isRouterModeState (appName: string): boolean {
  return getRouterMode(appName) === ROUTER_MODE_STATE
}

/** 判断应用是否使用 `native` 模式，与宿主共享可见路径和 origin。 */
export function isRouterModeNative (appName: string): boolean {
  return getRouterMode(appName) === ROUTER_MODE_NATIVE
}

/** 判断应用是否使用 `native-scope` 模式，共享宿主路径但保留子应用 origin 视角。 */
export function isRouterModeNativeScope (appName: string): boolean {
  return getRouterMode(appName) === ROUTER_MODE_NATIVE_SCOPE
}

/** 判断应用是否使用 `pure` 模式，仅维护沙箱内存地址，不长期同步到宿主 URL。 */
export function isRouterModePure (appName: string): boolean {
  return getRouterMode(appName) === ROUTER_MODE_PURE
}

/**
 * 判断应用是否使用两种直接占用宿主路径的自定义原生模式。
 */
export function isRouterModeCustom (appName: string): boolean {
  return isRouterModeNative(appName) || isRouterModeNativeScope(appName)
}

/**
 * 按内联配置与全局配置的优先级解析微应用最终路由模式。
 *
 * @remarks
 * 兼容旧版 `disable-memory-router`：值为真时映射为 `native`。优先级依次为内联旧配置、内联
 * `router-mode`、全局旧配置、全局 `router-mode`、默认 `search`。不在允许清单中的结果回退默认值。
 * 有 micro-app 元素时 `mode` 来自元素配置；无元素时通常表示预渲染应用的配置结果。
 *
 * @param mode - 元素或预渲染流程传入的路由模式。
 * @param inlineDisableMemoryRouter - 元素或预渲染流程传入的旧版禁用内存路由标记。
 * @returns 校验后的路由模式。
 */
export function initRouterMode (
  mode: string | null | void,
  inlineDisableMemoryRouter?: boolean,
): string {
  // 旧配置只负责映射模式；统一在末尾经过允许清单校验，避免未知字符串进入路由分派。
  const routerMode = (
    (inlineDisableMemoryRouter && ROUTER_MODE_NATIVE) ||
    mode ||
    (microApp.options['disable-memory-router'] && ROUTER_MODE_NATIVE) ||
    microApp.options['router-mode'] ||
    DEFAULT_ROUTER_MODE
  )
  return ROUTER_MODE_LIST.includes(routerMode) ? routerMode : DEFAULT_ROUTER_MODE
}
