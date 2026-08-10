import { pauseTracking, resetTracking } from '@vue/reactivity'
import type { VNode } from './vnode'
import type { ComponentInternalInstance } from './component'
import { popWarningContext, pushWarningContext, warn } from './warning'
import { EMPTY_OBJ, isArray, isFunction, isPromise } from '@vue/shared'
import { LifecycleHooks } from './enums'
import { WatchErrorCodes } from '@vue/reactivity'

/**
 * 除生命周期钩子外，Vue 可能执行用户函数的上下文编号。
 *
 * 生产构建用编号生成精简的错误文档链接，开发构建则通过 `ErrorTypeStrings` 输出可读
 * 阶段名。编号一旦发布便不能随意调整，否则同一生产错误码会指向错误的解释。
 */
export enum ErrorCodes {
  /** 执行组件 `setup()`。 */
  SETUP_FUNCTION,
  /** 执行组件渲染函数。 */
  RENDER_FUNCTION,
  // watch 错误码随 `baseWatch` 移到了 reactivity 包。下面三个历史位置必须保留，
  // 以维持生产错误码兼容；因此后续枚举显式从 5 开始。
  // WATCH_GETTER,
  // WATCH_CALLBACK,
  // WATCH_CLEANUP,
  /** 原生 DOM 事件处理器。 */
  NATIVE_EVENT_HANDLER = 5,
  /** 组件自定义事件处理器。 */
  COMPONENT_EVENT_HANDLER,
  /** VNode 生命周期钩子。 */
  VNODE_HOOK,
  /** 自定义指令钩子。 */
  DIRECTIVE_HOOK,
  /** 过渡钩子。 */
  TRANSITION_HOOK,
  /** 应用级 `errorHandler`。 */
  APP_ERROR_HANDLER,
  /** 应用级 `warnHandler`。 */
  APP_WARN_HANDLER,
  /** 函数形式的模板 ref。 */
  FUNCTION_REF,
  /** 异步组件加载器。 */
  ASYNC_COMPONENT_LOADER,
  /** 调度队列刷新。 */
  SCHEDULER,
  /** 组件响应式更新。 */
  COMPONENT_UPDATE,
  /** `app.onUnmount()` 注册的清理函数。 */
  APP_UNMOUNT_CLEANUP,
}

/** 错误上下文编号到开发环境可读说明的映射。 */
export const ErrorTypeStrings: Record<ErrorTypes, string> = {
  [LifecycleHooks.SERVER_PREFETCH]: 'serverPrefetch hook',
  [LifecycleHooks.BEFORE_CREATE]: 'beforeCreate hook',
  [LifecycleHooks.CREATED]: 'created hook',
  [LifecycleHooks.BEFORE_MOUNT]: 'beforeMount hook',
  [LifecycleHooks.MOUNTED]: 'mounted hook',
  [LifecycleHooks.BEFORE_UPDATE]: 'beforeUpdate hook',
  [LifecycleHooks.UPDATED]: 'updated',
  [LifecycleHooks.BEFORE_UNMOUNT]: 'beforeUnmount hook',
  [LifecycleHooks.UNMOUNTED]: 'unmounted hook',
  [LifecycleHooks.ACTIVATED]: 'activated hook',
  [LifecycleHooks.DEACTIVATED]: 'deactivated hook',
  [LifecycleHooks.ERROR_CAPTURED]: 'errorCaptured hook',
  [LifecycleHooks.RENDER_TRACKED]: 'renderTracked hook',
  [LifecycleHooks.RENDER_TRIGGERED]: 'renderTriggered hook',
  [ErrorCodes.SETUP_FUNCTION]: 'setup function',
  [ErrorCodes.RENDER_FUNCTION]: 'render function',
  [WatchErrorCodes.WATCH_GETTER]: 'watcher getter',
  [WatchErrorCodes.WATCH_CALLBACK]: 'watcher callback',
  [WatchErrorCodes.WATCH_CLEANUP]: 'watcher cleanup function',
  [ErrorCodes.NATIVE_EVENT_HANDLER]: 'native event handler',
  [ErrorCodes.COMPONENT_EVENT_HANDLER]: 'component event handler',
  [ErrorCodes.VNODE_HOOK]: 'vnode hook',
  [ErrorCodes.DIRECTIVE_HOOK]: 'directive hook',
  [ErrorCodes.TRANSITION_HOOK]: 'transition hook',
  [ErrorCodes.APP_ERROR_HANDLER]: 'app errorHandler',
  [ErrorCodes.APP_WARN_HANDLER]: 'app warnHandler',
  [ErrorCodes.FUNCTION_REF]: 'ref function',
  [ErrorCodes.ASYNC_COMPONENT_LOADER]: 'async component loader',
  [ErrorCodes.SCHEDULER]: 'scheduler flush',
  [ErrorCodes.COMPONENT_UPDATE]: 'component update',
  [ErrorCodes.APP_UNMOUNT_CLEANUP]: 'app unmount cleanup function',
}

/** 统一错误管道可接收的上下文类型，包括生命周期、运行时和 watch 阶段。 */
export type ErrorTypes = LifecycleHooks | ErrorCodes | WatchErrorCodes

/**
 * 在统一错误边界内同步调用用户函数。
 *
 * Vue 内部凡是执行用户提供的代码，都应尽量经过该入口，使错误能被组件祖先的
 * `errorCaptured` 或应用的 `errorHandler` 接管。这里不吞掉返回值，调用方仍可维持
 * 原有控制流。
 */
export function callWithErrorHandling(
  fn: Function,
  instance: ComponentInternalInstance | null | undefined,
  type: ErrorTypes,
  args?: unknown[],
): any {
  try {
    return args ? fn(...args) : fn()
  } catch (err) {
    handleError(err, instance, type)
  }
}

/**
 * 调用一个或一组用户函数，并同时捕获同步抛错与 Promise rejection。
 *
 * 事件和生命周期允许注册多个回调，所以这里接受数组并保留逐项返回值。Promise
 * 通过附加 `catch` 进入同一错误管道，但原 Promise 仍返回给调用方，不改变异步语义。
 */
export function callWithAsyncErrorHandling(
  fn: Function | Function[],
  instance: ComponentInternalInstance | null,
  type: ErrorTypes,
  args?: unknown[],
): any {
  if (isFunction(fn)) {
    const res = callWithErrorHandling(fn, instance, type, args)
    if (res && isPromise(res)) {
      res.catch(err => {
        handleError(err, instance, type)
      })
    }
    return res
  }

  if (isArray(fn)) {
    const values = []
    for (let i = 0; i < fn.length; i++) {
      values.push(callWithAsyncErrorHandling(fn[i], instance, type, args))
    }
    return values
  } else if (__DEV__) {
    warn(
      `Invalid value type passed to callWithAsyncErrorHandling(): ${typeof fn}`,
    )
  }
}

/**
 * 沿组件树传播并最终记录一个未处理错误。
 *
 * 传播从出错组件的父级开始，依次调用 `errorCaptured`；任一钩子返回 `false` 即表示
 * 已处理。否则交给应用 `errorHandler`，仍未接管才进入默认日志策略。生产环境默认
 * 记录后继续运行，可用 `throwUnhandledErrorInProduction` 改为重新抛出。
 */
export function handleError(
  err: unknown,
  instance: ComponentInternalInstance | null | undefined,
  type: ErrorTypes,
  throwInDev = true,
): void {
  const contextVNode = instance ? instance.vnode : null
  const { errorHandler, throwUnhandledErrorInProduction } =
    (instance && instance.appContext.config) || EMPTY_OBJ
  if (instance) {
    let cur = instance.parent
    // 暴露渲染代理而非内部实例，与 Vue 2 及公开 API 的实例形态保持一致。
    const exposedInstance = instance.proxy
    // 生产包不携带完整说明字符串，只提供可查询错误码的文档链接以减小体积。
    const errorInfo = __DEV__
      ? ErrorTypeStrings[type]
      : `https://vuejs.org/error-reference/#runtime-${type}`
    while (cur) {
      const errorCapturedHooks = cur.ec
      if (errorCapturedHooks) {
        for (let i = 0; i < errorCapturedHooks.length; i++) {
          if (
            errorCapturedHooks[i](err, exposedInstance, errorInfo) === false
          ) {
            return
          }
        }
      }
      cur = cur.parent
    }
    // 祖先都未截断传播时，再交给应用级处理器。暂停追踪，避免处理器读取的状态
    // 意外成为当前渲染 effect 的依赖。
    if (errorHandler) {
      pauseTracking()
      callWithErrorHandling(errorHandler, null, ErrorCodes.APP_ERROR_HANDLER, [
        err,
        exposedInstance,
        errorInfo,
      ])
      resetTracking()
      return
    }
  }
  logError(err, type, contextVNode, throwInDev, throwUnhandledErrorInProduction)
}

/** 根据构建环境决定抛出、打印或容错继续，是错误传播链的最终兜底。 */
function logError(
  err: unknown,
  type: ErrorTypes,
  contextVNode: VNode | null,
  throwInDev = true,
  throwInProd = false,
) {
  if (__DEV__) {
    const info = ErrorTypeStrings[type]
    if (contextVNode) {
      pushWarningContext(contextVNode)
    }
    warn(`Unhandled error${info ? ` during execution of ${info}` : ``}`)
    if (contextVNode) {
      popWarningContext()
    }
    // 开发环境默认重新抛出，让测试、调试器和错误覆盖层立即暴露问题。
    if (throwInDev) {
      throw err
    } else if (!__TEST__) {
      console.error(err)
    }
  } else if (throwInProd) {
    throw err
  } else {
    // 生产环境默认只记录，尽量降低单个组件错误对最终用户的影响。
    console.error(err)
  }
}
