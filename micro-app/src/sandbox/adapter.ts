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

  /** 允许从微应用代理窗口静态逃逸到宿主窗口的共享运行时属性。 */
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
  /** 本轮运行中新写入代理窗口的键，用于停止或卸载时定向清除。 */
  public injectedKeys = new Set<PropertyKey>()
  /** 已实际逃逸到宿主窗口的键；卸载时必须清除以免污染后续应用。 */
  public escapeKeys = new Set<PropertyKey>()
  /** 沙箱初始化完成信号，供依赖代理环境的后续阶段等待。 */
  public sandboxReady!: Promise<void>
  /** 默认模式停止时移除并重置 UMD 挂载/卸载钩子的清理函数。 */
  public clearHijackUmdHooks!: () => void

  /**
   * 在开发环境按宿主/子应用组合调整 React 错误覆盖层与热更新属性的隔离策略。
   *
   * @remarks
   * 非 React 宿主需要允许子应用 hook 逃逸；React 宿主已有 hook 时则改为子应用内隔离，避免双方
   * 复用同一全局热更新状态。
   */
  private injectReactHMRProperty (): void {
    if (__DEV__) {
      // 非 React 宿主中的 React 子应用需要把错误覆盖层 hook 暴露给真实窗口。
      this.staticEscapeProperties.push('__REACT_ERROR_OVERLAY_GLOBAL_HOOK__')
      // React 宿主已声明 hook 时，子应用必须在自己的代理窗口内维护 hook 与注入标记。
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
 * 为沙箱自定义窗口保留独立原型锚点，供具体实现承载隔离后的窗口成员。
 *
 * TODO：
 *  1、将class Adapter去掉，改为CustomWindow，或者让CustomWindow继承Adapter
 *  2、with沙箱中的常量放入CustomWindow，虽然和iframe沙箱不一致，但更合理
 * 修改时机：在iframe沙箱支持插件后再修改
 */
export class CustomWindow {}

/**
 * 清除宿主窗口的 Babel 6 polyfill 单例标记，允许微应用加载自己的 polyfill 实例。
 */
export function fixBabelPolyfill6 (): void {
  if (globalEnv.rawWindow._babelPolyfill) globalEnv.rawWindow._babelPolyfill = false
}

/**
 * 在开发环境临时切换 React 错误覆盖层 hook，修复基座与子应用均由 CRA 创建时的热更新冲突。
 *
 * @remarks
 * 子应用执行期间把宿主 hook 替换为子应用 hook，并在微任务中恢复。WHY：覆盖层只需跨越当前同步
 * 执行边界；延迟恢复既让本轮热更新命中正确实例，又不让子应用 hook 长期污染宿主。
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
    /**
     * TODO：
     *  1. 测试baseURI和ownerDocument在with沙箱中是否正确
     *    经过验证with沙箱不能重写ownerDocument，否则react点击事件会触发两次
    */
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
            get: () => proxyWindow.location.href,
          },
          ownerDocument: {
            configurable: true,
            enumerable: true,
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
