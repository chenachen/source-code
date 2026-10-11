import { registerRuntimeHelpers } from '@vue/compiler-dom'

/** 转义并序列化插值值。 */
export const SSR_INTERPOLATE: unique symbol = Symbol(`ssrInterpolate`)
/** 把客户端 VNode fallback 渲染到 SSR 输出。 */
export const SSR_RENDER_VNODE: unique symbol = Symbol(`ssrRenderVNode`)
/** 渲染组件并传递 props/slots/parent。 */
export const SSR_RENDER_COMPONENT: unique symbol = Symbol(`ssrRenderComponent`)
/** 渲染普通 SSR 插槽及 fallback。 */
export const SSR_RENDER_SLOT: unique symbol = Symbol(`ssrRenderSlot`)
/** 渲染指定名称的插槽内容，不添加普通 slot 的外围 Fragment；用于 Transition/TransitionGroup。 */
export const SSR_RENDER_SLOT_INNER: unique symbol = Symbol(`ssrRenderSlotInner`)
/** 将 class 数组/对象规范化并转义为属性值。 */
export const SSR_RENDER_CLASS: unique symbol = Symbol(`ssrRenderClass`)
/** 将 style 对象/数组规范化为 CSS 字符串。 */
export const SSR_RENDER_STYLE: unique symbol = Symbol(`ssrRenderStyle`)
/** 批量序列化完整 attrs 对象。 */
export const SSR_RENDER_ATTRS: unique symbol = Symbol(`ssrRenderAttrs`)
/** 序列化已知安全名称的单个静态属性。 */
export const SSR_RENDER_ATTR: unique symbol = Symbol(`ssrRenderAttr`)
/** 校验名称并序列化动态属性。 */
export const SSR_RENDER_DYNAMIC_ATTR: unique symbol =
  Symbol(`ssrRenderDynamicAttr`)
/** 遍历数组、数字、对象等 v-for 来源。 */
export const SSR_RENDER_LIST: unique symbol = Symbol(`ssrRenderList`)
/** 判断布尔属性值是否应被输出。 */
export const SSR_INCLUDE_BOOLEAN_ATTR: unique symbol = Symbol(
  `ssrIncludeBooleanAttr`,
)
/** v-model 对 option/radio 的宽松相等比较。 */
export const SSR_LOOSE_EQUAL: unique symbol = Symbol(`ssrLooseEqual`)
/** v-model checkbox/select 的宽松包含判断。 */
export const SSR_LOOSE_CONTAIN: unique symbol = Symbol(`ssrLooseContain`)
/** input type 动态时生成对应 v-model HTML。 */
export const SSR_RENDER_DYNAMIC_MODEL: unique symbol = Symbol(
  `ssrRenderDynamicModel`,
)
/** 根据 input 最终 type 与模型值生成需要合并的 value/checked props。 */
export const SSR_GET_DYNAMIC_MODEL_PROPS: unique symbol = Symbol(
  `ssrGetDynamicModelProps`,
)
/** 收集 Teleport 内容到目标缓冲区并输出锚点。 */
export const SSR_RENDER_TELEPORT: unique symbol = Symbol(`ssrRenderTeleport`)
/** 调用 Suspense default 插槽；没有 default 时输出空注释，不执行 fallback。 */
export const SSR_RENDER_SUSPENSE: unique symbol = Symbol(`ssrRenderSuspense`)
/** 取得自定义指令的 getSSRProps 返回值。 */
export const SSR_GET_DIRECTIVE_PROPS: unique symbol =
  Symbol(`ssrGetDirectiveProps`)

/** SSR helper symbol 到 `@vue/server-renderer` 导出名的映射。 */
export const ssrHelpers: Record<symbol, string> = {
  [SSR_INTERPOLATE]: `ssrInterpolate`,
  [SSR_RENDER_VNODE]: `ssrRenderVNode`,
  [SSR_RENDER_COMPONENT]: `ssrRenderComponent`,
  [SSR_RENDER_SLOT]: `ssrRenderSlot`,
  [SSR_RENDER_SLOT_INNER]: `ssrRenderSlotInner`,
  [SSR_RENDER_CLASS]: `ssrRenderClass`,
  [SSR_RENDER_STYLE]: `ssrRenderStyle`,
  [SSR_RENDER_ATTRS]: `ssrRenderAttrs`,
  [SSR_RENDER_ATTR]: `ssrRenderAttr`,
  [SSR_RENDER_DYNAMIC_ATTR]: `ssrRenderDynamicAttr`,
  [SSR_RENDER_LIST]: `ssrRenderList`,
  [SSR_INCLUDE_BOOLEAN_ATTR]: `ssrIncludeBooleanAttr`,
  [SSR_LOOSE_EQUAL]: `ssrLooseEqual`,
  [SSR_LOOSE_CONTAIN]: `ssrLooseContain`,
  [SSR_RENDER_DYNAMIC_MODEL]: `ssrRenderDynamicModel`,
  [SSR_GET_DYNAMIC_MODEL_PROPS]: `ssrGetDynamicModelProps`,
  [SSR_RENDER_TELEPORT]: `ssrRenderTeleport`,
  [SSR_RENDER_SUSPENSE]: `ssrRenderSuspense`,
  [SSR_GET_DIRECTIVE_PROPS]: `ssrGetDirectiveProps`,
}

// 这些名称会从 @vue/server-renderer 导入，必须与其真实导出严格一致。
registerRuntimeHelpers(ssrHelpers)
