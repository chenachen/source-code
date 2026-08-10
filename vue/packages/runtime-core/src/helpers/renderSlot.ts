import type { Data } from '../component'
import type { RawSlots, Slots } from '../componentSlots'
import {
  type ContextualRenderFn,
  currentRenderingInstance,
} from '../componentRenderContext'
import {
  Comment,
  Fragment,
  type VNode,
  type VNodeArrayChildren,
  blockStack,
  closeBlock,
  createBlock,
  createVNode,
  isVNode,
  openBlock,
} from '../vnode'
import { PatchFlags, SlotFlags, extend, isSymbol } from '@vue/shared'
import { warn } from '../warning'
import { isAsyncWrapper } from '../apiAsyncComponent'

/**
 * 编译器渲染 `<slot/>` 的运行时辅助函数。
 *
 * 它负责执行具名插槽、判空后回退到 fallback、建立稳定 Fragment/block、合成分支 key
 * 与 scoped CSS 标记。自定义元素模式会保留真实 `<slot>`，交给浏览器原生插槽分发。
 *
 * @private
 */
export function renderSlot(
  slots: Slots,
  name: string,
  // `<slot v-bind="exp">` 会编译为 normalizeProps(guardReactiveProps(exp))；两者有意
  // 保留 null/undefined，因此运行时签名允许空值。
  props?: Data | null,
  // 此函数不对用户直接开放，fallback 必由编译器生成，保证是返回 VNode 数组的函数。
  fallback?: () => VNodeArrayChildren,
  noSlotted?: boolean,
  branchKey?: PropertyKey,
): VNode {
  // 统一成对象，让 key 查找和 slot 调用无需反复判空。不能用冻结/共享 EMPTY_OBJ，
  // 因为自定义元素分支会写入 name。
  if (props == null) props = {}
  if (
    currentRenderingInstance!.ce ||
    (currentRenderingInstance!.parent &&
      isAsyncWrapper(currentRenderingInstance!.parent) &&
      currentRenderingInstance!.parent.ce)
  ) {
    const slotProps =
      branchKey != null && props.key == null
        ? extend({}, props, { key: branchKey })
        : props
    const hasProps = Object.keys(slotProps).length > 0
    // 自定义元素应输出浏览器真实 `<slot>` 出口。外包 Fragment 是因为 shadowRoot:false
    // 模式会用注入内容替换 slot 元素，父 renderer 仍需要稳定边界跟踪替换后的多节点。
    if (name !== 'default') slotProps.name = name
    return (
      openBlock(),
      createBlock(
        Fragment,
        null,
        [createVNode('slot', slotProps, fallback && fallback())],
        hasProps ? PatchFlags.BAIL : PatchFlags.STABLE_FRAGMENT,
      )
    )
  }

  let slot = slots[name]

  if (__DEV__ && slot && slot.length > 1) {
    // SSR 优化 slot 的参数签名与客户端执行协议不同；若父模板未标记 dynamic-slots，
    // 客户端直接调用会产生错误内容，因此开发态提示并退化为空插槽。
    warn(
      `SSR-optimized slot function detected in a non-SSR-optimized render ` +
        `function. You need to mark this component with $dynamic-slots in the ` +
        `parent template.`,
    )
    slot = () => []
  }

  // 编译插槽默认关闭 block tracking，避免用户手动调用污染外部块树；renderSlot 明确
  // 来自模板，可临时恢复 tracking，让插槽内部动态节点进入当前 Fragment 快路径。
  if (slot && (slot as ContextualRenderFn)._c) {
    ;(slot as ContextualRenderFn)._d = false
  }
  const prevStackSize = blockStack.length
  openBlock()
  let rendered: VNode
  try {
    const validSlotContent = slot && ensureValidVNode(slot(props))
    const slotKey =
      props.key ||
      branchKey ||
      // 动态条件插槽的内容数组可能由 createSlots 附带分支 key，必须保留以区分分支。
      (validSlotContent && (validSlotContent as any).key)
    rendered = createBlock(
      Fragment,
      {
        key:
          (slotKey && !isSymbol(slotKey) ? slotKey : `_${name}`) +
          // #7256：fallback 与真实 slot 即使根类型相同也不能复用；追加 `_fb` 强制
          // renderer 识别为不同分支，避免 fallback DOM/组件状态泄漏到真实内容。
          (!validSlotContent && fallback ? '_fb' : ''),
      },
      validSlotContent || (fallback ? fallback() : []),
      validSlotContent && (slots as RawSlots)._ === SlotFlags.STABLE
        ? PatchFlags.STABLE_FRAGMENT
        : PatchFlags.BAIL,
    )
  } catch (err) {
    // #15070：slot 在 block 中途抛错会留下未 close 的 block；它将持续收集之后创建的
    // 所有 VNode，造成错误 patch 与内存增长。回滚到调用前栈深再继续抛出原异常。
    for (let i = blockStack.length; i > prevStackSize; i--) closeBlock()
    throw err
  } finally {
    if (slot && (slot as ContextualRenderFn)._c) {
      ;(slot as ContextualRenderFn)._d = true
    }
  }
  if (!noSlotted && rendered.scopeId) {
    rendered.slotScopeIds = [rendered.scopeId + '-s']
  }
  return rendered
}

/**
 * 判断插槽是否含可渲染内容。
 * 纯注释或只包含此类内容的 Fragment 视为空，以便 `<slot>` 使用 fallback；文本、元素
 * 以及任意非 VNode 值均视为有效。递归检查可覆盖 v-if 生成的嵌套 Fragment。
 */
export function ensureValidVNode(
  vnodes: VNodeArrayChildren,
): VNodeArrayChildren | null {
  return vnodes.some(child => {
    if (!isVNode(child)) return true
    if (child.type === Comment) return false
    if (
      child.type === Fragment &&
      !ensureValidVNode(child.children as VNodeArrayChildren)
    )
      return false
    return true
  })
    ? vnodes
    : null
}
