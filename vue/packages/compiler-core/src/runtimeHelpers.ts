/** Fragment 内置组件标识；多根模板及列表会生成它。 */
export const FRAGMENT: unique symbol = Symbol(__DEV__ ? `Fragment` : ``)
/** Teleport 内置组件标识。 */
export const TELEPORT: unique symbol = Symbol(__DEV__ ? `Teleport` : ``)
/** Suspense 内置组件标识。 */
export const SUSPENSE: unique symbol = Symbol(__DEV__ ? `Suspense` : ``)
/** KeepAlive 内置组件标识。 */
export const KEEP_ALIVE: unique symbol = Symbol(__DEV__ ? `KeepAlive` : ``)
/** 平台无关的过渡组件标识，DOM 编译器会把 `<transition>` 映射到它。 */
export const BASE_TRANSITION: unique symbol = Symbol(
  __DEV__ ? `BaseTransition` : ``,
)
/** 开启 VNode block 收集的运行时 helper 标识。 */
export const OPEN_BLOCK: unique symbol = Symbol(__DEV__ ? `openBlock` : ``)
/** 创建组件或动态类型 block 的运行时 helper 标识。 */
export const CREATE_BLOCK: unique symbol = Symbol(__DEV__ ? `createBlock` : ``)
/** 创建原生元素 block 的运行时 helper 标识。 */
export const CREATE_ELEMENT_BLOCK: unique symbol = Symbol(
  __DEV__ ? `createElementBlock` : ``,
)
/** 创建普通组件或动态类型 VNode 的运行时 helper 标识。 */
export const CREATE_VNODE: unique symbol = Symbol(__DEV__ ? `createVNode` : ``)
/** 创建原生元素 VNode 的运行时 helper 标识。 */
export const CREATE_ELEMENT_VNODE: unique symbol = Symbol(
  __DEV__ ? `createElementVNode` : ``,
)
/** 创建注释 VNode 的运行时 helper 标识；条件分支占位也会使用它。 */
export const CREATE_COMMENT: unique symbol = Symbol(
  __DEV__ ? `createCommentVNode` : ``,
)
/** 创建文本 VNode 的运行时 helper 标识。 */
export const CREATE_TEXT: unique symbol = Symbol(
  __DEV__ ? `createTextVNode` : ``,
)
/** 创建由静态提升生成的静态 VNode 的运行时 helper 标识。 */
export const CREATE_STATIC: unique symbol = Symbol(
  __DEV__ ? `createStaticVNode` : ``,
)
/** 按名称解析组件的运行时 helper 标识。 */
export const RESOLVE_COMPONENT: unique symbol = Symbol(
  __DEV__ ? `resolveComponent` : ``,
)
/** 解析 `<component :is="...">` 动态组件的运行时 helper 标识。 */
export const RESOLVE_DYNAMIC_COMPONENT: unique symbol = Symbol(
  __DEV__ ? `resolveDynamicComponent` : ``,
)
/** 按名称解析自定义指令的运行时 helper 标识。 */
export const RESOLVE_DIRECTIVE: unique symbol = Symbol(
  __DEV__ ? `resolveDirective` : ``,
)
/** Vue 2 兼容模式下解析过滤器的运行时 helper 标识。 */
export const RESOLVE_FILTER: unique symbol = Symbol(
  __DEV__ ? `resolveFilter` : ``,
)
/** 给 VNode 附加运行时指令数组的 helper 标识。 */
export const WITH_DIRECTIVES: unique symbol = Symbol(
  __DEV__ ? `withDirectives` : ``,
)
/** 把数组、对象、数字等 `v-for` 数据源渲染为列表的 helper 标识。 */
export const RENDER_LIST: unique symbol = Symbol(__DEV__ ? `renderList` : ``)
/** 调用插槽并生成 Fragment 的运行时 helper 标识。 */
export const RENDER_SLOT: unique symbol = Symbol(__DEV__ ? `renderSlot` : ``)
/** 合并静态插槽与 `v-if` / `v-for` 动态插槽的 helper 标识。 */
export const CREATE_SLOTS: unique symbol = Symbol(__DEV__ ? `createSlots` : ``)
/** 把插值结果转换为展示字符串的运行时 helper 标识。 */
export const TO_DISPLAY_STRING: unique symbol = Symbol(
  __DEV__ ? `toDisplayString` : ``,
)
/** 合并多个 props 对象的运行时 helper 标识。 */
export const MERGE_PROPS: unique symbol = Symbol(__DEV__ ? `mergeProps` : ``)
/** 把数组/对象形式的 class 归一化为字符串的 helper 标识。 */
export const NORMALIZE_CLASS: unique symbol = Symbol(
  __DEV__ ? `normalizeClass` : ``,
)
/** 把数组/对象/字符串形式的 style 归一化的 helper 标识。 */
export const NORMALIZE_STYLE: unique symbol = Symbol(
  __DEV__ ? `normalizeStyle` : ``,
)
/** 归一化 props 键和值的运行时 helper 标识。 */
export const NORMALIZE_PROPS: unique symbol = Symbol(
  __DEV__ ? `normalizeProps` : ``,
)
/** 复制响应式 props，避免运行时归一化操作直接修改原对象。 */
export const GUARD_REACTIVE_PROPS: unique symbol = Symbol(
  __DEV__ ? `guardReactiveProps` : ``,
)
/** 把对象中的事件名转换为 `onXxx` 监听器 props 的 helper 标识。 */
export const TO_HANDLERS: unique symbol = Symbol(__DEV__ ? `toHandlers` : ``)
/** 将连字符命名转成驼峰命名的运行时 helper 标识。 */
export const CAMELIZE: unique symbol = Symbol(__DEV__ ? `camelize` : ``)
/** 首字母大写的运行时 helper 标识。 */
export const CAPITALIZE: unique symbol = Symbol(__DEV__ ? `capitalize` : ``)
/** 把事件名转换为 `onXxx` props 键的运行时 helper 标识。 */
export const TO_HANDLER_KEY: unique symbol = Symbol(
  __DEV__ ? `toHandlerKey` : ``,
)
/** 暂停或恢复 block 动态子节点追踪的运行时 helper 标识。 */
export const SET_BLOCK_TRACKING: unique symbol = Symbol(
  __DEV__ ? `setBlockTracking` : ``,
)
/**
 * 压入 scoped CSS scopeId 的旧 helper 标识。
 * @deprecated Vue 3.5+ 不再提升元素节点，已无需此 helper；仅为向后兼容保留。
 */
export const PUSH_SCOPE_ID: unique symbol = Symbol(__DEV__ ? `pushScopeId` : ``)
/**
 * 弹出 scoped CSS scopeId 的旧 helper 标识。
 * @deprecated 仅为向后兼容保留。
 */
export const POP_SCOPE_ID: unique symbol = Symbol(__DEV__ ? `popScopeId` : ``)
/** 包装插槽函数并恢复正确渲染上下文的 helper 标识。 */
export const WITH_CTX: unique symbol = Symbol(__DEV__ ? `withCtx` : ``)
/** 读取普通值或 ref 值的运行时 helper 标识。 */
export const UNREF: unique symbol = Symbol(__DEV__ ? `unref` : ``)
/** 判断值是否为 ref 的运行时 helper 标识。 */
export const IS_REF: unique symbol = Symbol(__DEV__ ? `isRef` : ``)
/** 执行并缓存 `v-memo` 子树的运行时 helper 标识。 */
export const WITH_MEMO: unique symbol = Symbol(__DEV__ ? `withMemo` : ``)
/** 比较本轮和上轮 `v-memo` 依赖数组的 helper 标识。 */
export const IS_MEMO_SAME: unique symbol = Symbol(__DEV__ ? `isMemoSame` : ``)

/**
 * 编译期 helper Symbol 到运行时导出名的映射。
 *
 * 代码生成器据此从 `vue` 导入用到的 helper。新增条目时，运行时必须同步导出同名函数，
 * 否则生成代码会在加载阶段出现缺失导出。
 */
export const helperNameMap: Record<symbol, string> = {
  [FRAGMENT]: `Fragment`,
  [TELEPORT]: `Teleport`,
  [SUSPENSE]: `Suspense`,
  [KEEP_ALIVE]: `KeepAlive`,
  [BASE_TRANSITION]: `BaseTransition`,
  [OPEN_BLOCK]: `openBlock`,
  [CREATE_BLOCK]: `createBlock`,
  [CREATE_ELEMENT_BLOCK]: `createElementBlock`,
  [CREATE_VNODE]: `createVNode`,
  [CREATE_ELEMENT_VNODE]: `createElementVNode`,
  [CREATE_COMMENT]: `createCommentVNode`,
  [CREATE_TEXT]: `createTextVNode`,
  [CREATE_STATIC]: `createStaticVNode`,
  [RESOLVE_COMPONENT]: `resolveComponent`,
  [RESOLVE_DYNAMIC_COMPONENT]: `resolveDynamicComponent`,
  [RESOLVE_DIRECTIVE]: `resolveDirective`,
  [RESOLVE_FILTER]: `resolveFilter`,
  [WITH_DIRECTIVES]: `withDirectives`,
  [RENDER_LIST]: `renderList`,
  [RENDER_SLOT]: `renderSlot`,
  [CREATE_SLOTS]: `createSlots`,
  [TO_DISPLAY_STRING]: `toDisplayString`,
  [MERGE_PROPS]: `mergeProps`,
  [NORMALIZE_CLASS]: `normalizeClass`,
  [NORMALIZE_STYLE]: `normalizeStyle`,
  [NORMALIZE_PROPS]: `normalizeProps`,
  [GUARD_REACTIVE_PROPS]: `guardReactiveProps`,
  [TO_HANDLERS]: `toHandlers`,
  [CAMELIZE]: `camelize`,
  [CAPITALIZE]: `capitalize`,
  [TO_HANDLER_KEY]: `toHandlerKey`,
  [SET_BLOCK_TRACKING]: `setBlockTracking`,
  [PUSH_SCOPE_ID]: `pushScopeId`,
  [POP_SCOPE_ID]: `popScopeId`,
  [WITH_CTX]: `withCtx`,
  [UNREF]: `unref`,
  [IS_REF]: `isRef`,
  [WITH_MEMO]: `withMemo`,
  [IS_MEMO_SAME]: `isMemoSame`,
}

/**
 * 注册平台编译器自有的运行时 helper。
 * compiler-dom / compiler-ssr 借此把各自 Symbol 合并到统一名字表中。
 */
export function registerRuntimeHelpers(helpers: Record<symbol, string>): void {
  Object.getOwnPropertySymbols(helpers).forEach(s => {
    helperNameMap[s] = helpers[s]
  })
}
