/* eslint-disable no-restricted-globals */
import type { App } from './apiCreateApp'
import { Comment, Fragment, Static, Text } from './vnode'
import type { ComponentInternalInstance } from './component'

/** Devtools 为每个 Vue App 保存的基础记录。 */
interface AppRecord {
  id: number
  app: App
  version: string
  types: Record<string, string | Symbol>
}

/** runtime-core 发给 Vue Devtools 全局 hook 的事件名。 */
enum DevtoolsHooks {
  /** 应用完成创建并接入 Devtools。 */
  APP_INIT = 'app:init',
  /** 应用卸载，Devtools 应释放对应记录。 */
  APP_UNMOUNT = 'app:unmount',
  /** 已登记组件完成一次响应式更新。 */
  COMPONENT_UPDATED = 'component:updated',
  /** 新组件实例挂载进组件树。 */
  COMPONENT_ADDED = 'component:added',
  /** 组件实例从组件树移除。 */
  COMPONENT_REMOVED = 'component:removed',
  /** 组件通过 emit 派发自定义事件。 */
  COMPONENT_EMIT = 'component:emit',
  /** 某个组件性能测量区间开始。 */
  PERFORMANCE_START = 'perf:start',
  /** 某个组件性能测量区间结束。 */
  PERFORMANCE_END = 'perf:end',
}

/** 浏览器扩展或独立 Devtools 注入的全局事件总线协议。 */
export interface DevtoolsHook {
  enabled?: boolean
  emit: (event: string, ...payload: any[]) => void
  on: (event: string, handler: Function) => void
  once: (event: string, handler: Function) => void
  off: (event: string, handler: Function) => void
  appRecords: AppRecord[]
  /**
   * 较新 Devtools 提供的缓冲清理能力；返回参数是否仍处于 Devtools 自身缓冲区。
   * 用于避免组件在“added 尚未处理”时又发 removed，产生幽灵记录。
   */
  cleanupBuffer?: (matchArg: unknown) => boolean
}

/** 当前已连接的 Devtools hook。 */
export let devtools: DevtoolsHook

/** Devtools 延迟注入前暂存的运行时事件。 */
let buffer: { event: string; args: any[] }[] = []

/** 已确认当前环境没有 Devtools 后停止继续缓冲，防止长期内存增长。 */
let devtoolsNotInstalled = false

/** 向 Devtools 发事件；hook 尚未注入时先缓冲。 */
function emit(event: string, ...args: any[]) {
  if (devtools) {
    devtools.emit(event, ...args)
  } else if (!devtoolsNotInstalled) {
    buffer.push({ event, args })
  }
}

/**
 * 安装 Devtools hook，并重放此前缓冲事件。
 * 浏览器扩展可能晚于 Vue 启动才注入，因此真实浏览器会登记 replay 回调并等待 3 秒；
 * 测试/SSR 环境立即认定未安装，避免定时器阻止进程退出（#4815）。
 */
export function setDevtoolsHook(hook: DevtoolsHook, target: any): void {
  devtools = hook
  if (devtools) {
    devtools.enabled = true
    buffer.forEach(({ event, args }) => devtools.emit(event, ...args))
    buffer = []
  } else if (
    // 只在真实浏览器等待扩展晚注入；#4815 中测试 runner 会被未结束定时器卡住。
    typeof window !== 'undefined' &&
    // 排除只模拟了部分 window 的环境。
    window.HTMLElement &&
    // jsdom 同样不可能安装浏览器扩展。
    // eslint-disable-next-line no-restricted-syntax
    !window.navigator?.userAgent?.includes('jsdom')
  ) {
    const replay = (target.__VUE_DEVTOOLS_HOOK_REPLAY__ =
      target.__VUE_DEVTOOLS_HOOK_REPLAY__ || [])
    replay.push((newHook: DevtoolsHook) => {
      setDevtoolsHook(newHook, target)
    })
    // 3 秒后仍无 hook，视为未安装并清空事件；#4738 中长期保留组件事件会造成泄漏。
    setTimeout(() => {
      if (!devtools) {
        target.__VUE_DEVTOOLS_HOOK_REPLAY__ = null
        devtoolsNotInstalled = true
        buffer = []
      }
    }, 3000)
  } else {
    // 非浏览器环境直接停止缓冲。
    devtoolsNotInstalled = true
    buffer = []
  }
}

/** 通知 Devtools 新 App 已启动，并告知四种内置 VNode 类型供其格式化组件树。 */
export function devtoolsInitApp(app: App, version: string): void {
  emit(DevtoolsHooks.APP_INIT, app, version, {
    Fragment,
    Text,
    Comment,
    Static,
  })
}

/** 通知 Devtools 移除整个 App 记录。 */
export function devtoolsUnmountApp(app: App): void {
  emit(DevtoolsHooks.APP_UNMOUNT, app)
}

/** 上报组件首次挂载/KeepAlive 激活。 */
export const devtoolsComponentAdded: DevtoolsComponentHook =
  /*@__PURE__*/ createDevtoolsComponentHook(DevtoolsHooks.COMPONENT_ADDED)

/** 上报组件完成更新。 */
export const devtoolsComponentUpdated: DevtoolsComponentHook =
  /*@__PURE__*/ createDevtoolsComponentHook(DevtoolsHooks.COMPONENT_UPDATED)

/** 内部的组件移除事件发送器。 */
const _devtoolsComponentRemoved = /*@__PURE__*/ createDevtoolsComponentHook(
  DevtoolsHooks.COMPONENT_REMOVED,
)

/**
 * 上报组件卸载。若 Devtools 仍缓冲该组件的 added 事件，cleanupBuffer 会直接消去
 * 成对事件；只有未被缓冲时才发送 removed。
 */
export const devtoolsComponentRemoved = (
  component: ComponentInternalInstance,
): void => {
  if (
    devtools &&
    typeof devtools.cleanupBuffer === 'function' &&
    // added 未缓冲时，Devtools 已经见过该组件，才需要显式 removed。
    !devtools.cleanupBuffer(component)
  ) {
    _devtoolsComponentRemoved(component)
  }
}

/** 组件生命周期事件发送器的统一签名。 */
type DevtoolsComponentHook = (component: ComponentInternalInstance) => void

/** 创建携带 App、组件 uid、父 uid 与实例的标准组件事件发送器。 */
/*@__NO_SIDE_EFFECTS__*/
function createDevtoolsComponentHook(
  hook: DevtoolsHooks,
): DevtoolsComponentHook {
  return (component: ComponentInternalInstance) => {
    emit(
      hook,
      component.appContext.app,
      component.uid,
      component.parent ? component.parent.uid : undefined,
      component,
    )
  }
}

/** 上报某项组件性能测量开始。 */
export const devtoolsPerfStart: DevtoolsPerformanceHook =
  /*@__PURE__*/ createDevtoolsPerformanceHook(DevtoolsHooks.PERFORMANCE_START)

/** 上报某项组件性能测量结束。 */
export const devtoolsPerfEnd: DevtoolsPerformanceHook =
  /*@__PURE__*/ createDevtoolsPerformanceHook(DevtoolsHooks.PERFORMANCE_END)

/** 性能事件发送器签名：type 区分 mount/render/patch 等阶段，time 为时间戳。 */
type DevtoolsPerformanceHook = (
  component: ComponentInternalInstance,
  type: string,
  time: number,
) => void
/** 构造标准性能事件发送器。 */
function createDevtoolsPerformanceHook(
  hook: DevtoolsHooks,
): DevtoolsPerformanceHook {
  return (component: ComponentInternalInstance, type: string, time: number) => {
    emit(hook, component.appContext.app, component.uid, component, type, time)
  }
}

/** 上报组件通过 `$emit`/setup emit 触发的事件和实参数组。 */
export function devtoolsComponentEmit(
  component: ComponentInternalInstance,
  event: string,
  params: any[],
): void {
  emit(
    DevtoolsHooks.COMPONENT_EMIT,
    component.appContext.app,
    component,
    event,
    params,
  )
}
