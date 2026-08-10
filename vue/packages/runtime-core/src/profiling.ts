/* eslint-disable no-restricted-globals */
import {
  type ComponentInternalInstance,
  formatComponentName,
} from './component'
import { devtoolsPerfEnd, devtoolsPerfStart } from './devtools'

/** 是否支持浏览器 Performance API；首次探测后缓存，避免热路径重复访问全局对象。 */
let supported: boolean
/** 浏览器原生 Performance 对象，仅在 `supported === true` 后读取。 */
let perf: Performance

/**
 * 记录某个组件运行阶段的开始时间。
 *
 * `app.config.performance` 控制是否写入浏览器 Performance 时间线；devtools 事件则有
 * 独立开关，即使浏览器 API 不可用也会用 `Date.now()` 提供降级时间戳。
 */
export function startMeasure(
  instance: ComponentInternalInstance,
  type: string,
): void {
  if (instance.appContext.config.performance && isSupported()) {
    perf.mark(`vue-${type}-${instance.uid}`)
  }

  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    devtoolsPerfStart(instance, type, isSupported() ? perf.now() : Date.now())
  }
}

/**
 * 结束组件阶段计时，并清理对应的 mark/measure。
 *
 * 清理很重要：组件频繁更新时若保留所有 PerformanceEntry，浏览器时间线会持续增长。
 * measure 名包含组件名便于性能面板阅读，mark 名包含 uid 以隔离同类型组件实例。
 */
export function endMeasure(
  instance: ComponentInternalInstance,
  type: string,
): void {
  if (instance.appContext.config.performance && isSupported()) {
    const startTag = `vue-${type}-${instance.uid}`
    const endTag = startTag + `:end`
    const measureName = `<${formatComponentName(instance, instance.type)}> ${type}`
    perf.mark(endTag)
    perf.measure(measureName, startTag, endTag)
    perf.clearMeasures(measureName)
    perf.clearMarks(startTag)
    perf.clearMarks(endTag)
  }

  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    devtoolsPerfEnd(instance, type, isSupported() ? perf.now() : Date.now())
  }
}

/** 延迟探测宿主环境是否提供 Performance API，并缓存探测结果。 */
function isSupported() {
  if (supported !== undefined) {
    return supported
  }
  if (typeof window !== 'undefined' && window.performance) {
    supported = true
    perf = window.performance
  } else {
    supported = false
  }
  return supported
}
