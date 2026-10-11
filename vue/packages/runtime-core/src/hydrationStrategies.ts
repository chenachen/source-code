import { getGlobalThis, isString } from '@vue/shared'
import { DOMNodeTypes, isComment } from './hydration'

// Safari 等环境缺少 requestIdleCallback；用短延时任务降级，仍保持异步激活语义。
// 支持情况见 https://caniuse.com/requestidlecallback
const requestIdleCallback: Window['requestIdleCallback'] =
  getGlobalThis().requestIdleCallback || (cb => setTimeout(cb, 1))
/** 与上方 requestIdleCallback 配对的取消函数，降级实现使用 clearTimeout。 */
const cancelIdleCallback: Window['cancelIdleCallback'] =
  getGlobalThis().cancelIdleCallback || (id => clearTimeout(id))

/**
 * 异步组件的延迟水合策略。
 *
 * @param hydrate 条件满足后调用，认领内部组件的 SSR DOM 并建立客户端运行关系
 * @param forEachElement 遍历尚未水合的组件根元素，并正确跨越 Fragment 注释边界
 * @returns 可选清理函数；创建了监听器、observer 或空闲任务时，用它在 beforeUnmount 清理
 */
export type HydrationStrategy = (
  hydrate: () => void,
  forEachElement: (cb: (el: Element) => any) => void,
) => (() => void) | void

/** 接受用户配置并返回具体水合策略的工厂类型。 */
export type HydrationStrategyFactory<Options> = (
  options?: Options,
) => HydrationStrategy

/**
 * 在浏览器空闲时水合，最长等待 `timeout` 毫秒。
 * 适合首屏不可交互但希望尽快激活的低优先级组件。
 */
export const hydrateOnIdle: HydrationStrategyFactory<number> =
  (timeout = 10000) =>
  hydrate => {
    const id = requestIdleCallback(hydrate, { timeout })
    return () => cancelIdleCallback(id)
  }

/**
 * 同步判断元素当前是否与视口相交。
 * IntersectionObserver 的首次回调是异步的；先同步检查可避免已可见组件多等一轮任务。
 */
function elementIsVisibleInViewport(el: Element) {
  const { top, left, bottom, right } = el.getBoundingClientRect()
  // eslint-disable-next-line no-restricted-globals
  const { innerHeight, innerWidth } = window
  return (
    ((top > 0 && top < innerHeight) || (bottom > 0 && bottom < innerHeight)) &&
    ((left > 0 && left < innerWidth) || (right > 0 && right < innerWidth))
  )
}

/**
 * 任一组件根元素进入视口时水合。
 *
 * Fragment 可能有多个根元素，全部交给同一个 IntersectionObserver；命中一个便断开，
 * 因为整棵组件子树必须作为整体水合。
 */
export const hydrateOnVisible: HydrationStrategyFactory<
  IntersectionObserverInit
> = opts => (hydrate, forEach) => {
  const ob = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      ob.disconnect()
      hydrate()
      break
    }
  }, opts)
  forEach(el => {
    if (!(el instanceof Element)) return
    if (elementIsVisibleInViewport(el)) {
      hydrate()
      ob.disconnect()
      return false
    }
    ob.observe(el)
  })
  return () => ob.disconnect()
}

/**
 * 指定媒体查询匹配时水合，例如只在窄屏激活移动端交互组件。
 * 已匹配则立即执行，否则注册一次性 change 监听，并提供卸载清理函数。
 */
export const hydrateOnMediaQuery: HydrationStrategyFactory<string> =
  query => hydrate => {
    if (query) {
      const mql = matchMedia(query)
      if (mql.matches) {
        hydrate()
      } else {
        mql.addEventListener('change', hydrate, { once: true })
        return () => mql.removeEventListener('change', hydrate)
      }
    }
  }

/**
 * 用户首次触发指定事件时水合，并重放触发事件。
 *
 * 原事件发生时组件监听器尚未绑定；先移除激活监听、同步水合，再构造同类型事件分发到
 * 原 target，保证“第一次点击”不会被吃掉。`hasHydrated` 防止多个根元素同时触发。
 */
export const hydrateOnInteraction: HydrationStrategyFactory<
  keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap>
> =
  (interactions = []) =>
  (hydrate, forEach) => {
    if (isString(interactions)) interactions = [interactions]
    let hasHydrated = false
    /** 首次事件先撤监听再同步水合并重放；置位在水合前，防止重入再次激活。 */
    const doHydrate = (e: Event) => {
      if (!hasHydrated) {
        hasHydrated = true
        teardown()
        hydrate()
        // 水合已绑定真实处理器，重新分发首次交互事件。
        e.target!.dispatchEvent(new (e.constructor as any)(e.type, e))
      }
    }
    /** 移除所有根元素上登记的激活监听，供成功激活和组件提前卸载共用。 */
    const teardown = () => {
      forEach(el => {
        for (const i of interactions) {
          el.removeEventListener(i, doHydrate)
        }
      })
    }
    forEach(el => {
      for (const i of interactions) {
        el.addEventListener(i, doHydrate, { once: true })
      }
    })
    return teardown
  }

/**
 * 遍历未水合组件对应的所有根元素。
 *
 * 单根组件直接回调当前节点；Fragment 在 SSR DOM 中由 `[` / `]` 注释包围，需要维护
 * 嵌套深度，遍历最外层边界内所有元素。回调返回 `false` 可提前停止。
 */
export function forEachElement(
  node: Node,
  cb: (el: Element) => void | false,
): void {
  // Fragment 起始锚点；嵌套 Fragment 也使用相同标记，因此必须按深度配对。
  if (isComment(node) && node.data === '[') {
    let depth = 1
    let next = node.nextSibling
    while (next) {
      if (next.nodeType === DOMNodeTypes.ELEMENT) {
        const result = cb(next as Element)
        if (result === false) {
          break
        }
      } else if (isComment(next)) {
        if (next.data === ']') {
          if (--depth === 0) break
        } else if (next.data === '[') {
          depth++
        }
      }
      next = next.nextSibling
    }
  } else {
    cb(node as Element)
  }
}
