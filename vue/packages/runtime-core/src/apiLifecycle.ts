import {
  type ComponentInternalInstance,
  currentInstance,
  isInSSRComponentSetup,
  setCurrentInstance,
} from './component'
import type { ComponentPublicInstance } from './componentPublicInstance'
import { ErrorTypeStrings, callWithAsyncErrorHandling } from './errorHandling'
import { warn } from './warning'
import { toHandlerKey } from '@vue/shared'
import {
  type DebuggerEvent,
  pauseTracking,
  resetTracking,
} from '@vue/reactivity'
import { LifecycleHooks } from './enums'

export { onActivated, onDeactivated } from './components/KeepAlive'

/**
 * 把生命周期回调注册到目标组件实例。
 *
 * 真正入队的不是用户回调本身，而是可复用的错误处理包装器：它会在调用期间暂停
 * 响应式依赖收集、设置正确的当前组件实例，并把同步/异步错误交给 Vue 的统一错误
 * 管道。包装器缓存在 `hook.__weh` 上，让调度器能按引用去重同一个回调。
 *
 * @param type 生命周期阶段对应的内部短键
 * @param hook 用户注册的回调；`__weh` 保存 with-error-handling 包装器
 * @param target 接收回调的组件，默认使用当前 `setup()` 实例
 * @param prepend 是否插入队首；内部能力需要先于普通用户钩子执行时使用
 */
export function injectHook(
  type: LifecycleHooks,
  hook: Function & {
    /** 用户 hook 上缓存的生命周期包装函数，使再次登记时复用同一包装身份。 */
    __weh?: Function
  },
  target: ComponentInternalInstance | null = currentInstance,
  prepend: boolean = false,
): Function | undefined {
  if (target) {
    const hooks = target[type] || (target[type] = [])
    // 缓存包装器，确保同一用户回调多次进入调度队列时仍可按函数引用去重。
    // `__weh` 是 “with error handling” 的缩写。
    /** 缓存生命周期错误包装器：暂停响应式追踪，临时激活 target 的实例/scope，再通过同步/异步错误管道调用 hook；正常返回时恢复上下文和追踪状态。 */
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        // 生命周期钩子可能在组件渲染 effect 内触发。暂停依赖收集，避免钩子读取的
        // 响应式状态被错误登记为渲染依赖，进而造成无关的组件更新。
        pauseTracking()
        // 调用期间临时恢复注册该钩子的实例，让钩子内部的组合式 API 找到正确上下文。
        // 返回的 reset 函数按栈恢复旧实例，也能覆盖少见的同步嵌套调用场景。
        const reset = setCurrentInstance(target)
        const res = callWithAsyncErrorHandling(hook, target, type, args)
        reset()
        resetTracking()
        return res
      })
    if (prepend) {
      hooks.unshift(wrappedHook)
    } else {
      hooks.push(wrappedHook)
    }
    return wrappedHook
  } else if (__DEV__) {
    const apiName = toHandlerKey(ErrorTypeStrings[type].replace(/ hook$/, ''))
    warn(
      `${apiName} is called when there is no active component instance to be ` +
        `associated with. ` +
        `Lifecycle injection APIs can only be used during execution of setup().` +
        (__FEATURE_SUSPENSE__
          ? ` If you are using async setup(), make sure to register lifecycle ` +
            `hooks before the first await statement.`
          : ``),
    )
  }
}

/**
 * 为某个生命周期阶段创建公开注册函数。
 *
 * SSR 只执行 `serverPrefetch`：其余挂载/更新/卸载阶段都依赖真实宿主节点，在服务端
 * 注册既不会被消费，还会无谓保留闭包。
 */
const createHook =
  <T extends Function = () => any>(lifecycle: LifecycleHooks) =>
  (
    hook: T,
    target: ComponentInternalInstance | null = currentInstance,
  ): void => {
    // SSR 中除 `serverPrefetch` 外的创建后生命周期均无实际执行时机，直接忽略。
    if (
      !isInSSRComponentSetup ||
      lifecycle === LifecycleHooks.SERVER_PREFETCH
    ) {
      injectHook(lifecycle, (...args: unknown[]) => hook(...args), target)
    }
  }
/** 生命周期注册函数的统一签名，`T` 表示该阶段回调接收的参数类型。 */
type CreateHook<T = any> = (
  hook: T,
  target?: ComponentInternalInstance | null,
) => void

/** 注册首次渲染前执行的挂载钩子；初始化已完成，尚未执行 render 或创建宿主子树。 */
export const onBeforeMount: CreateHook = createHook(LifecycleHooks.BEFORE_MOUNT)
/** 注册组件挂载完成钩子。宿主节点已插入，模板引用也已赋值。 */
export const onMounted: CreateHook = createHook(LifecycleHooks.MOUNTED)
/** 注册组件因响应式依赖变化而更新前的钩子。 */
export const onBeforeUpdate: CreateHook = createHook(
  LifecycleHooks.BEFORE_UPDATE,
)
/** 注册组件 DOM 更新完成后的钩子。 */
export const onUpdated: CreateHook = createHook(LifecycleHooks.UPDATED)
/** 注册组件卸载前钩子；此时实例、子树和响应式副作用仍然有效。 */
export const onBeforeUnmount: CreateHook = createHook(
  LifecycleHooks.BEFORE_UNMOUNT,
)
/** 注册组件卸载完成钩子；相关响应式副作用已停止。 */
export const onUnmounted: CreateHook = createHook(LifecycleHooks.UNMOUNTED)
/** 注册仅在服务端渲染阶段等待执行的数据预取钩子。 */
export const onServerPrefetch: CreateHook = createHook(
  LifecycleHooks.SERVER_PREFETCH,
)

/** 渲染依赖调试钩子的参数类型，描述被追踪或触发的响应式操作。 */
export type DebuggerHook = (e: DebuggerEvent) => void
/** 注册“渲染 effect 被某项响应式操作触发”调试钩子，仅用于开发诊断。 */
export const onRenderTriggered: CreateHook<DebuggerHook> =
  createHook<DebuggerHook>(LifecycleHooks.RENDER_TRIGGERED)
/** 注册“渲染期间追踪到响应式依赖”调试钩子，仅用于开发诊断。 */
export const onRenderTracked: CreateHook<DebuggerHook> =
  createHook<DebuggerHook>(LifecycleHooks.RENDER_TRACKED)

/** 错误捕获钩子签名；返回 `false` 可阻止错误继续向祖先和应用处理器传播。 */
export type ErrorCapturedHook<TError = unknown> = (
  err: TError,
  instance: ComponentPublicInstance | null,
  info: string,
) => boolean | void

/**
 * 注册后代组件错误捕获钩子。
 *
 * 钩子接收原始错误、错误来源组件的公开实例和错误阶段说明。它本身若抛错，仍会进入
 * Vue 的统一错误处理流程，避免一次错误吞掉后续诊断信息。
 */
export function onErrorCaptured<TError = Error>(
  hook: ErrorCapturedHook<TError>,
  target: ComponentInternalInstance | null = currentInstance,
): void {
  injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
