import {
  type Component,
  type ComponentInternalInstance,
  type ComponentOptions,
  type ConcreteComponent,
  currentInstance,
  getComponentName,
  isInSSRComponentSetup,
} from './component'
import { isFunction, isObject } from '@vue/shared'
import type { ComponentPublicInstance } from './componentPublicInstance'
import { type VNode, createVNode } from './vnode'
import { defineComponent } from './apiDefineComponent'
import { onUnmounted } from './apiLifecycle'
import { warn } from './warning'
import { ref } from '@vue/reactivity'
import { ErrorCodes, handleError } from './errorHandling'
import { isKeepAlive } from './components/KeepAlive'
import { markAsyncBoundary } from './helpers/useId'
import { type HydrationStrategy, forEachElement } from './hydrationStrategies'

/** 异步加载器既可直接返回组件，也可返回以 `default` 导出的 ES module 命名空间。 */
export type AsyncComponentResolveResult<T = Component> = T | { default: T }

/** 异步组件加载函数；每次重试都应返回一个新的 Promise。 */
export type AsyncComponentLoader<T = any> = () => Promise<
  AsyncComponentResolveResult<T>
>

/** `defineAsyncComponent()` 的完整配置。 */
export interface AsyncComponentOptions<T = any> {
  /** 实际获取组件定义的异步函数。 */
  loader: AsyncComponentLoader<T>
  /** 加载期间显示的占位组件；在 Suspense 控制模式下由 Suspense fallback 取代。 */
  loadingComponent?: Component
  /** 加载失败或超时后显示的组件，会收到 `error` prop。 */
  errorComponent?: Component
  /** 显示 loadingComponent 前的延迟，默认 200ms，用于避免快速请求产生闪烁。 */
  delay?: number
  /** 加载超时时间；未设置表示永不由运行时主动超时。 */
  timeout?: number
  /** 是否让最近的 Suspense 边界接管异步依赖，默认开启。 */
  suspensible?: boolean
  /** SSR 水合时的延迟激活策略，如可见、空闲或交互后再加载并水合。 */
  hydrate?: HydrationStrategy
  /** 自定义失败策略，可按尝试次数选择重试或最终失败。 */
  onError?: (
    error: Error,
    retry: () => void,
    fail: () => void,
    attempts: number,
  ) => any
}

/** 判断实例/VNode 是否为 `defineAsyncComponent()` 创建的包装组件。 */
export const isAsyncWrapper = (i: ComponentInternalInstance | VNode): boolean =>
  !!(i.type as ComponentOptions).__asyncLoader

/*@__NO_SIDE_EFFECTS__*/
/**
 * 定义一个按需加载的组件包装器。
 *
 * 包装器会在所有实例之间缓存“进行中的请求”和“已解析组件”，避免同一组件并发加载。
 * 在 Suspense/SSR 中直接返回 Promise，让上层边界控制 fallback；普通客户端模式则用
 * ref 驱动 loading/error/loaded 三态。可选水合策略还能让服务端 HTML 先保持静态，
 * 直到空闲、可见或发生交互时才下载组件并绑定事件。
 */
export function defineAsyncComponent<
  T extends Component = { new (): ComponentPublicInstance },
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  if (isFunction(source)) {
    source = { loader: source }
  }

  const {
    loader,
    loadingComponent,
    errorComponent,
    delay = 200,
    hydrate: hydrateStrategy,
    timeout, // `undefined` 表示不启用运行时超时。
    suspensible = true,
    onError: userOnError,
  } = source

  /** 当前共享加载请求；并发挂载直接复用，重试时清空。 */
  let pendingRequest: Promise<ConcreteComponent> | null = null
  /** 成功解析后的组件定义；后续实例可同步渲染。 */
  let resolvedComp: ConcreteComponent | undefined

  /** 已发起的重试次数，传给用户 onError 决定退避或终止。 */
  let retries = 0
  /** 废弃当前失败请求并重新调用 loader。 */
  const retry = () => {
    retries++
    pendingRequest = null
    return load()
  }

  /**
   * 获取共享加载 Promise，并标准化错误、重试竞态与 ESM default 导出。
   *
   * `thisRequest !== pendingRequest` 表示等待期间发生了 retry；旧请求即使稍后成功也
   * 不能覆盖新请求结果，应跟随最新 pendingRequest，避免慢旧请求赢得竞态。
   */
  const load = (): Promise<ConcreteComponent> => {
    let thisRequest: Promise<ConcreteComponent>
    return (
      pendingRequest ||
      (thisRequest = pendingRequest =
        loader()
          .catch(err => {
            err = err instanceof Error ? err : new Error(String(err))
            if (userOnError) {
              return new Promise((resolve, reject) => {
                const userRetry = () => resolve(retry())
                const userFail = () => reject(err)
                userOnError(err, userRetry, userFail, retries + 1)
              })
            } else {
              throw err
            }
          })
          .then((comp: any) => {
            if (thisRequest !== pendingRequest && pendingRequest) {
              return pendingRequest
            }
            if (__DEV__ && !comp) {
              warn(
                `Async component loader resolved to undefined. ` +
                  `If you are using retry(), make sure to return its return value.`,
              )
            }
            // 兼容原生 ESM 与打包器生成的 module namespace，取其 default 组件。
            if (
              comp &&
              (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
            ) {
              comp = comp.default
            }
            if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
              throw new Error(`Invalid async component load result: ${comp}`)
            }
            resolvedComp = comp
            return comp
          }))
    )
  }

  return defineComponent({
    name: 'AsyncComponentWrapper',

    __asyncLoader: load,

    __asyncHydrate(el, instance, hydrate) {
      // 延迟水合等待期间组件可能已被父级 patch 或节点已被移除。两种情况下都不能再
      // 用旧 SSR DOM 执行 hydrate，否则会覆盖新状态或操作脱离文档的节点。
      const wasConnected = el.isConnected
      let patched = false
      ;(instance.bu || (instance.bu = [])).push(() => (patched = true))
      const performHydrate = () => {
        // 组件已在延迟期间更新，说明客户端渲染已接管，跳过过期水合。
        if (patched) {
          if (__DEV__) {
            warn(
              `Skipping lazy hydration for component '${getComponentName(resolvedComp!) || resolvedComp!.__file}': ` +
                `it was updated before lazy hydration performed.`,
            )
          }
          return
        }
        if (!el.parentNode || (wasConnected && !el.isConnected)) return
        hydrate()
      }
      const doHydrate = hydrateStrategy
        ? () => {
            // 策略返回的 teardown（如事件监听器/IntersectionObserver）挂到
            // beforeUnmount，组件未等到激活便卸载时也能释放外部资源。
            const teardown = hydrateStrategy(performHydrate, cb =>
              forEachElement(el, cb),
            )
            if (teardown) {
              ;(instance.bum || (instance.bum = [])).push(teardown)
            }
          }
        : performHydrate
      if (resolvedComp) {
        doHydrate()
      } else {
        load().then(() => !instance.isUnmounted && doHydrate())
      }
    },

    get __asyncResolved() {
      return resolvedComp
    },

    setup() {
      const instance = currentInstance!
      // 异步恢复顺序可能在 SSR 与客户端不同，为 `useId()` 切换独立编号命名空间。
      markAsyncBoundary(instance)

      // 其他实例已经完成加载时，直接渲染内部组件，不再创建响应式加载状态。
      if (resolvedComp) {
        return () => createInnerComp(resolvedComp!, instance)
      }

      const onError = (err: Error) => {
        pendingRequest = null
        handleError(
          err,
          instance,
          ErrorCodes.ASYNC_COMPONENT_LOADER,
          // 提供 errorComponent 表示应用准备展示降级 UI，开发环境不再重新抛出中断。
          !errorComponent,
        )
      }

      // Suspense/SSR 需要拿到 Promise：Suspense 负责依赖计数与 fallback，SSR 则必须
      // 等真实组件解析后才能输出确定 HTML。
      if (
        (__FEATURE_SUSPENSE__ && suspensible && instance.suspense) ||
        (__SSR__ && isInSSRComponentSetup)
      ) {
        return load()
          .then(comp => {
            return () => createInnerComp(comp, instance)
          })
          .catch(err => {
            onError(err)
            return () =>
              errorComponent
                ? createVNode(errorComponent as ConcreteComponent, {
                    error: err,
                  })
                : null
          })
      }

      const loaded = ref(false)
      const error = ref()
      // delay 为 0 时立即允许显示 loading；否则先保持空占位，避免短加载闪烁。
      const delayed = ref(!!delay)

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      let delayTimer: ReturnType<typeof setTimeout> | undefined

      onUnmounted(() => {
        if (timeoutTimer != null) clearTimeout(timeoutTimer)
        if (delayTimer != null) clearTimeout(delayTimer)
      })

      if (delay) {
        delayTimer = setTimeout(() => {
          if (instance.isUnmounted) return
          delayed.value = false
        }, delay)
      }

      if (timeout != null) {
        timeoutTimer = setTimeout(() => {
          if (instance.isUnmounted) return
          if (!loaded.value && !error.value) {
            const err = new Error(
              `Async component timed out after ${timeout}ms.`,
            )
            onError(err)
            error.value = err
          }
        }, timeout)
      }

      load()
        .then(() => {
          if (instance.isUnmounted) return
          loaded.value = true
          if (instance.parent && isKeepAlive(instance.parent.vnode)) {
            // KeepAlive 的 include/exclude 依赖真实组件名。加载前只有包装器名，必须
            // 强制父级更新，让缓存规则基于已解析组件名重新判断。
            instance.parent.update()
          }
        })
        .catch(err => {
          if (instance.isUnmounted) {
            pendingRequest = null
            return
          }
          onError(err)
          error.value = err
        })

      return () => {
        if (loaded.value && resolvedComp) {
          return createInnerComp(resolvedComp, instance)
        } else if (error.value && errorComponent) {
          return createVNode(errorComponent, {
            error: error.value,
          })
        } else if (loadingComponent && !delayed.value) {
          return createInnerComp(
            loadingComponent as ConcreteComponent,
            instance,
          )
        }
      }
    },
  }) as T
}

/**
 * 用异步包装器原始调用信息创建真正组件 VNode。
 *
 * props/children 原样透传；ref 归属必须保持在调用包装器的父组件，否则 `$refs` 会指向
 * 临时包装器。自定义元素初始化回调也转交内部组件，并从包装 VNode 删除以免执行两次。
 */
function createInnerComp(
  comp: ConcreteComponent,
  parent: ComponentInternalInstance,
) {
  const { ref, props, children, ce } = parent.vnode
  const vnode = createVNode(comp, props, children)
  // 模板 ref 应最终指向真实组件，同时保留原 ref owner。
  vnode.ref = ref
  // 把自定义元素回调转交真实组件，并从包装器移除以保证只消费一次。
  vnode.ce = ce
  delete parent.vnode.ce

  return vnode
}
