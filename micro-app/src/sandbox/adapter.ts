import type {
  BaseSandboxType,
  AppInterface,
} from '@micro-app/types'
import globalEnv from '../libs/global_env'
import {
  defer,
  isNode,
  rawDefineProperties,
  isMicroAppBody,
  getPreventSetState,
  throttleDeferForIframeAppName,
  isAnchorElement,
} from '../libs/utils'
import {
  appInstanceMap,
  isIframeSandbox,
} from '../create_app'
import microApp from '../micro_app'
import { AppManager } from '../app_manager'

/**
 * 两种沙箱实现共享的状态基类，集中声明窗口属性的作用域、逃逸与清理边界。
 *
 * @remarks
 * 子类负责具体代理策略；本类只保存应用身份、初始化就绪信号和需要在卸载时回收的属性集合。
 */
export class BaseSandbox implements BaseSandboxType {
  /**
   * 初始化应用身份与资源基准地址，并按运行环境补入 React 热更新兼容属性。
   *
   * @param appName - 注册表和副作用登记共用的应用名；后续不随宿主容器迁移改变。
   * @param url - 应用入口地址，供请求补全及首次路由初始化使用。
   */
  constructor (appName: string, url: string) {
    this.appName = appName
    this.url = url
    this.injectReactHMRProperty()
  }

  /** 只能写入宿主 `window` 的属性；浏览器导航对象不能在代理窗口上被替换。 */
  public rawWindowScopeKeyList: PropertyKey[] = [
    'location',
  ]

  /** 宿主尚无同名键时，允许代理赋值同步到宿主的共享运行时属性。 */
  public staticEscapeProperties: PropertyKey[] = [
    'System',
    '__cjsWrapper',
  ]

  /** 必须隔离在微应用窗口内的静态属性，避免多个应用共享框架运行时与窗口事件状态。 */
  public staticScopeProperties: PropertyKey[] = [
    'webpackJsonp',
    'webpackHotUpdate',
    'Vue',
    // TODO：评估能否与 `constants/SCOPE_WINDOW_ON_EVENT` 合并，避免事件属性清单重复维护。
    'onpopstate',
    'onhashchange',
    'event',
  ]

  /** 当前沙箱所属的唯一微应用名称。 */
  public appName: string
  /** 微应用入口地址，也是相对资源与路由解析的基准。 */
  public url: string
  /** 仅在微应用窗口读写、不会逃逸到宿主窗口的动态属性集合。 */
  public scopeProperties: PropertyKey[] = Array.from(this.staticScopeProperties)
  /** 运行期允许逃逸到宿主窗口的动态属性集合。 */
  public escapeProperties: PropertyKey[] = []
  /** 运行期新增、从宿主复制或显式赋值的作用域键，用于默认卸载或销毁时定向清除。 */
  public injectedKeys = new Set<PropertyKey>()
  /** 逃逸赋值时宿主原先不存在的键；默认卸载或销毁时删除，宿主已有键的旧值不会在这里备份恢复。 */
  public escapeKeys = new Set<PropertyKey>()
  /** 沙箱初始化完成信号；就绪只表示代理可用，仍需上游 mount 调用 start 才进入 active。 */
  public sandboxReady!: Promise<void>
  /** 默认模式停止或销毁时清空 UMD 导出槽位；函数自身不删除导出访问器。 */
  public clearHijackUmdHooks!: () => void

  /**
   * 在开发环境向静态名单追加 React 错误覆盖层与热更新属性。
   *
   * @remarks
   * hook 进入 staticEscapeProperties，Proxy 只有在宿主尚无同名键时才把它写到宿主。
   * 宿主已有 hook 时还会追加 staticScopeProperties；但 scopeProperties 已在字段初始化时复制，
   * 此处追加不会自动进入实际用于 Proxy 判断的动态作用域名单。
   */
  private injectReactHMRProperty (): void {
    if (__DEV__) {
      // 非 React 宿主中的 React 子应用需要把错误覆盖层 hook 暴露给真实窗口。
      this.staticEscapeProperties.push('__REACT_ERROR_OVERLAY_GLOBAL_HOOK__')
      // React 宿主已声明 hook 时追加静态作用域候选；动态 scopeProperties 不随此赋值同步。
      if (globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__) {
        this.staticScopeProperties = this.staticScopeProperties.concat([
          '__REACT_ERROR_OVERLAY_GLOBAL_HOOK__',
          '__reactRefreshInjected',
        ])
      }
    }
  }
}

/**
 * with 沙箱窗口目标的空类；各实例拥有独立属性，原型上不预置浏览器 Window 成员。
 */
export class CustomWindow {}

/**
 * 清除宿主窗口的 Babel 6 polyfill 单例标记，允许微应用加载自己的 polyfill 实例。
 */
export function fixBabelPolyfill6 (): void {
  if (globalEnv.rawWindow._babelPolyfill) globalEnv.rawWindow._babelPolyfill = false
}

/**
 * 在开发环境临时切换 React 错误覆盖层 hook。
 *
 * @remarks
 * source/patch 在子应用追加 iframe 节点前调用；宿主与子应用都已有 hook 时，临时让宿主读取子应用 hook。
 * 下一微任务恢复原引用，因而这次替换只跨越当前同步执行片段。
 * 此函数只切换宿主 hook 引用，不创建热更新实例，也不等待 iframe 加载结束。
 *
 * @see https://github.com/jd-opensource/micro-app/issues/382
 */
export function fixReactHMRConflict (app: AppInterface): void {
  if (__DEV__) {
    const rawReactErrorHook = globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__
    const childReactErrorHook = app.sandBox?.proxyWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__
    if (rawReactErrorHook && childReactErrorHook) {
      globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ = childReactErrorHook
      defer(() => {
        globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ = rawReactErrorHook
      })
    }
  }
}

/**
 * 后序遍历目标 DOM 子树，为每个节点写入所属微应用及 iframe 兼容描述符。
 *
 * @param container - 需要修正元信息的子树根节点。
 * @param appName - 该子树所属的微应用名称。
 */
export function patchElementTree (
  container: Node,
  appName: string,
): void {
  const children = Array.from(container.childNodes)

  // 先取得静态子节点快照，再后序标记；updateElementInfo 自身只处理一个节点，不负责递归。
  children.length && children.forEach((child) => {
    patchElementTree(child, appName)
  })

  updateElementInfo(container, appName)
}

/**
 * 为目标节点标记微应用归属，并按节点类型覆写地址、文档与父节点视图。
 *
 * @remarks
 * 已正确标记、纯净节点或禁止写状态阶段直接跳过。iframe 节点插入宿主文档后可能改用宿主原型，
 * 因此把关键访问器定义在实例上，稳定返回子应用视角。
 *
 * @param node - 待更新的任意值；非 DOM 节点保持原样。
 * @param appName - 节点所属应用；为空时不写入沙箱元信息。
 * @returns 原目标引用。
 */
export function updateElementInfo <T> (node: T, appName: string | null): T {
  if (
    appName &&
    isNode(node) &&
    node.__MICRO_APP_NAME__ !== appName &&
    !node.__PURE_ELEMENT__ &&
    !getPreventSetState()
  ) {
    // 两种沙箱都标记应用归属；with 保留浏览器原有 ownerDocument，只有 iframe 分支覆写文档视图。
    const props: {[kye:string]:any} = {
      __MICRO_APP_NAME__: {
        configurable: true,
        enumerable: true,
        writable: true,
        value: appName,
      },
    }
    if (isAnchorElement(node)) {
      // 锚点的 `href` 通过属性读写，保留微应用模板中的原始相对值，导航时再由路由层处理。
      const microApp = AppManager.getInstance().get(appName)
      if (microApp) {
        props.href = {
          /** 返回节点属性中的原始地址，而非浏览器基于宿主页面计算后的绝对地址。 */
          get() {
            return this.getAttribute('href')
          },
          /** 通过 `setAttribute` 写回地址，使现有元素补丁与属性观察逻辑仍能生效。 */
          set(value: string) {
            if (value === undefined) {
              return
            }
            this.setAttribute('href', value)
          },
        }
      }
    }
    rawDefineProperties(node, props)

    /**
     * Firefox 中，iframe 节点插入宿主文档后，其原型会指向宿主原生 `Node.prototype`；Chrome 则
     * 仍指向 iframe 内的原型。故不能只补 iframe 原型，必须在节点实例上固定 `baseURI`、
     * `ownerDocument`、`parentNode` 与 `getRootNode`，保证跨浏览器都呈现子应用文档视角。
     *
     * 该差异还可能影响 `cloneNode`、`innerHTML` 与 `Image` 等沿原型解析的能力，修改此处时需联动
     * 检查这些 API。
     */
    if (isIframeSandbox(appName)) {
      const proxyWindow = appInstanceMap.get(appName)?.sandBox?.proxyWindow
      if (proxyWindow) {
        rawDefineProperties(node, {
          baseURI: {
            configurable: true,
            enumerable: true,
            /** 动态读取子应用 location，使路由变化后节点的相对地址基准也随之更新。 */
            get: () => proxyWindow.location.href,
          },
          ownerDocument: {
            configurable: true,
            enumerable: true,
            /** 业务节点暴露子应用文档；文档自身的 ownerDocument 按原生语义返回 null。 */
            get: () => node !== proxyWindow.document ? proxyWindow.document : null,
          },
          parentNode: getIframeParentNodeDesc(
            appName,
            globalEnv.rawParentNodeDesc,
          ),
          getRootNode: {
            configurable: true,
            enumerable: true,
            writable: true,
            /** 固定返回子应用文档，避免节点插入宿主树后暴露宿主根节点。 */
            value: function getRootNode (): Node {
              return proxyWindow.document
            }
          },
        })
      }
    }
  }

  return node
}

/**
 * 创建 iframe 节点的 `parentNode` 描述符，把沙箱内部根节点映射为对应用可见的父容器。
 *
 * @remarks
 * 读取前触发 iframe 应用名的节流延迟标记，随后调用传入的真实 getter。仅当真实父节点是
 * `<micro-app-body>` 且应用仍有容器时才映射；映射优先级为用户回调、自身 micro-app-body、宿主
 * `document.body`。这样兼容依赖 `parentNode === document.body` 的弹层库，同时保留自定义根容器能力。
 *
 * @param appName - 读取父节点的微应用名称。
 * @param parentNodeDesc - iframe 或宿主 `Node.prototype.parentNode` 的真实描述符。
 * @returns 可安装到微应用节点实例上的父节点描述符。
 */
export function getIframeParentNodeDesc (
  appName: string,
  parentNodeDesc: PropertyDescriptor,
): PropertyDescriptor {
  return {
    configurable: true,
    enumerable: true,
    /**
     * 读取真实父节点，并在命中微应用根节点时按配置映射其外部可见父节点。
     */
    get (this: Node) {
      throttleDeferForIframeAppName(appName)
      const result: ParentNode = parentNodeDesc.get?.call(this)
      /**
       * `<micro-app-body>` 对应用而言承担 `document.body` 角色。此映射用于兼容
       * `element-ui@2/lib/utils/vue-popper.js` 等以 `parentNode === document.body` 判断弹层归属的代码。
       * 边界：映射会改变 `target.parentNode.remove(target)` 一类链式操作的目标，因此只在应用根节点
       * 且容器仍存在时启用，并允许 `getRootElementParentNode` 覆盖默认结果。
       */
      if (isMicroAppBody(result) && appInstanceMap.get(appName)?.container) {
        const customParent = microApp.options.getRootElementParentNode?.(this, appName)
        if (customParent) {
          return customParent
        }
        if (microApp?.options?.inheritBaseBody !== true) {
          return appInstanceMap.get(appName)?.container?.querySelector('micro-app-body') || globalEnv.rawDocument.body
        }
        return globalEnv.rawDocument.body
      }
      return result
    }
  }
}
