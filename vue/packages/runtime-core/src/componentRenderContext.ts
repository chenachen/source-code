import type { ComponentInternalInstance } from './component'
import { devtoolsComponentUpdated } from './devtools'
import { blockStack, closeBlock, setBlockTracking } from './vnode'

/**
 * 当前正在执行渲染函数的组件实例。
 *
 * `resolveComponent()`、`resolveDirective()`、插槽上下文和作用域 CSS 都依赖它确定资源
 * 归属。它不同于执行 `setup()` 时的 `currentInstance`，因为父组件执行子组件插槽时，
 * “正在渲染的归属组件”可能不是当前组件更新 effect 的实例。
 */
export let currentRenderingInstance: ComponentInternalInstance | null = null
/** 当前渲染内容应携带的 SFC 作用域属性，如 `data-v-xxxx`。 */
export let currentScopeId: string | null = null

/**
 * 切换当前渲染实例，并返回之前的实例供调用方恢复。
 *
 * 渲染调用可能嵌套，例如父组件执行由子组件传回的插槽。调用方必须使用返回值恢复
 * 上下文：
 *
 * ```js
 * const prev = setCurrentRenderingInstance(i)
 * // ...执行渲染
 * setCurrentRenderingInstance(prev)
 * ```
 */
export function setCurrentRenderingInstance(
  instance: ComponentInternalInstance | null,
): ComponentInternalInstance | null {
  const prev = currentRenderingInstance
  currentRenderingInstance = instance
  currentScopeId = (instance && instance.type.__scopeId) || null
  // Vue 2 预编译组件使用 `_scopeId`；compat 构建继续识别该旧字段。
  if (__COMPAT__ && !currentScopeId) {
    currentScopeId = (instance && (instance.type as any)._scopeId) || null
  }
  return prev
}

/**
 * 创建静态提升 VNode 前显式设置作用域 ID。
 *
 * 提升表达式在组件渲染函数外执行，无法从当前实例读取 scopeId，因此编译器生成
 * `pushScopeId()` / `popScopeId()` 包裹代码。
 *
 * @private 编译器辅助函数。
 */
export function pushScopeId(id: string | null): void {
  currentScopeId = id
}

/**
 * 清除静态提升 VNode 的作用域 ID。
 *
 * Vue 3.0.8 后新编译产物已不依赖旧实现细节，但历史编译器生成的代码仍会调用该 API，
 * 所以必须保留以支持“旧模板产物 + 新运行时”的组合。
 *
 * @private
 */
export function popScopeId(): void {
  currentScopeId = null
}

/**
 * 旧编译产物使用的作用域包装器别名；现代代码统一走 `withCtx()`。
 * @private 仅用于向后兼容。
 */
export const withScopeId = (_id: string): typeof withCtx => withCtx

/**
 * 已绑定组件渲染上下文的插槽函数。
 *
 * 四个短字段由编译器和运行时共同读取，使用属性而非额外包装对象可减少热路径分配。
 */
export type ContextualRenderFn = {
  /**
   * 上下文绑定插槽的调用签名，透传 slot props 参数并返回原函数结果；_n/_c/_d 字段由包装器附加。
   */
  (...args: any[]): any
  /** 已完成上下文包装，避免重复包装。 */
  _n: boolean
  /** 编译插槽函数标记，受控调用据此管理 block tracking。 */
  _c: boolean
  /** 调用时是否暂时关闭 block tracking。 */
  _d: boolean
  /** compat 构建中标记 Vue 2 非作用域插槽。 */
  _ns: boolean
}

/**
 * 给插槽函数绑定其声明组件的渲染上下文。
 *
 * 插槽通常在子组件渲染时执行，但资源解析、作用域 CSS 和警告归属必须回到声明插槽的
 * 父组件。包装器负责切换并在 `finally` 中恢复上下文；即使插槽抛错，也会关闭遗留的
 * block，避免污染后续渲染。
 *
 * @private 编译器辅助函数。
 */
export function withCtx(
  fn: Function,
  ctx: ComponentInternalInstance | null = currentRenderingInstance,
  isNonScopedSlot?: boolean, // __COMPAT__ only
): Function {
  if (!ctx) return fn

  // 已包装的插槽直接复用，避免叠加上下文切换和 devtools 通知。
  if ((fn as ContextualRenderFn)._n) {
    return fn
  }

  /**
   * 调用 slot 前按 _d 暂停 block tracking 并切到声明实例；finally 关闭本次遗留 block、恢复实例与追踪开关。成功后通知 devtools，并返回原 slot 结果。
   */
  const renderFnWithContext: ContextualRenderFn = (...args: any[]) => {
    // #1745：用户可能在普通模板表达式中手动调用已编译插槽。此时插槽内部动态节点
    // 会被错误收集进调用方 block，破坏动态子节点索引。默认通过 `_d` 暂停追踪并让
    // diff 走安全路径；`renderSlot` 或元素/Teleport 的默认插槽展开会临时关闭 `_d`。
    if (renderFnWithContext._d) {
      setBlockTracking(-1)
    }
    const prevInstance = setCurrentRenderingInstance(ctx)
    const prevStackSize = blockStack.length
    let res
    try {
      res = fn(...args)
    } finally {
      // #15070：插槽可能在打开内联 block（如 `v-if`）后抛错，这类 block 没有独立
      // helper 自动退栈。恢复到调用前深度，防止残留 block 捕获后续无关 VNode。
      for (let i = blockStack.length; i > prevStackSize; i--) closeBlock()
      setCurrentRenderingInstance(prevInstance)
      if (renderFnWithContext._d) {
        setBlockTracking(1)
      }
    }

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      devtoolsComponentUpdated(ctx)
    }

    return res
  }

  // 标记已标准化，防止同一插槽被重复包装。
  renderFnWithContext._n = true
  // 标记编译插槽函数，供调用方控制 `_d`；slots 对象的稳定性另由 `_`/SlotFlags 表示。
  renderFnWithContext._c = true
  // 默认暂停 block tracking；renderSlot 和元素/Teleport 默认插槽的受控展开会临时开启。
  renderFnWithContext._d = true
  // compat 构建需额外区分 Vue 2 的作用域插槽与非作用域插槽。
  if (__COMPAT__ && isNonScopedSlot) {
    renderFnWithContext._ns = true
  }
  return renderFnWithContext
}
