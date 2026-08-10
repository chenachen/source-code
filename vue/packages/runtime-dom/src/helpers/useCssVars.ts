import {
  Fragment,
  Static,
  type VNode,
  getCurrentInstance,
  onBeforeUpdate,
  onMounted,
  onUnmounted,
  queuePostFlushCb,
  warn,
  watch,
} from '@vue/runtime-core'
import { NOOP, ShapeFlags, normalizeCssVarValue } from '@vue/shared'

/**
 * CSSStyleDeclaration 上保存由 useCssVars 写入的 cssText 片段。
 * patchStyle 整体替换 style.cssText 时会追加它，避免 CSS 变量被普通 `:style` 覆盖。
 */
export const CSS_VAR_TEXT: unique symbol = Symbol(__DEV__ ? 'CSS_VAR_TEXT' : '')
/**
 * SFC `v-bind()` CSS 变量注入的运行时辅助函数。
 *
 * getter 根据组件公开上下文生成变量；变量写到组件所有真实根元素、Teleport 目标和
 * Static/Fragment 范围。更新使用 post watcher，确保组件根替换后写入新 DOM。
 * @private 编译器生成代码调用。
 */
export function useCssVars(
  getter: (ctx: any) => Record<string, unknown>,
): void {
  if (!__BROWSER__ && !__TEST__) return

  const instance = getCurrentInstance()
  /* v8 ignore start */
  if (!instance) {
    __DEV__ &&
      warn(`useCssVars is called without current active component instance.`)
    return
  }
  /* v8 ignore stop */

  const updateTeleports = (instance.ut = (vars = getter(instance.proxy)) => {
    // SSR/渲染器给传送内容标记 data-v-owner，通过 uid 找到不在组件 DOM 子树下的节点。
    Array.from(
      document.querySelectorAll(`[data-v-owner="${instance.uid}"]`),
    ).forEach(node => setVarsOnNode(node, vars))
  })

  if (__DEV__) {
    instance.getCssVars = () => getter(instance.proxy)
  }

  const setVars = () => {
    const vars = getter(instance.proxy)
    if (instance.ce) {
      setVarsOnNode(instance.ce as any, vars)
    } else {
      setVarsOnVNode(instance.subTree, vars)
    }
    updateTeleports(vars)
  }

  // 子组件根可能受父组件 CSS vars 影响，组件更新后根节点才确定；排到 post 队列写入。
  onBeforeUpdate(() => {
    queuePostFlushCb(setVars)
  })

  onMounted(() => {
    // 首次 mounted 同步建立；后续 getter 依赖变化在 DOM patch 后更新。
    watch(setVars, NOOP, { flush: 'post' })
    const ob = new MutationObserver(setVars)
    ob.observe(instance.subTree.el!.parentNode, { childList: true })
    onUnmounted(() => ob.disconnect())
  })
}

/** 沿逻辑 VNode/HOC/Suspense 结构找到所有真实根宿主节点并写变量。 */
function setVarsOnVNode(vnode: VNode, vars: Record<string, unknown>) {
  if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    const suspense = vnode.suspense!
    vnode = suspense.activeBranch!
    if (suspense.pendingBranch && !suspense.isHydrating) {
      suspense.effects.push(() => {
        setVarsOnVNode(suspense.activeBranch!, vars)
      })
    }
  }

  // 高阶组件单根链不产生额外 DOM，继续下钻到非组件 VNode。
  while (vnode.component) {
    vnode = vnode.component.subTree
  }

  if (vnode.shapeFlag & ShapeFlags.ELEMENT && vnode.el) {
    setVarsOnNode(vnode.el as Node, vars)
  } else if (vnode.type === Fragment) {
    ;(vnode.children as VNode[]).forEach(c => setVarsOnVNode(c, vars))
  } else if (vnode.type === Static) {
    let { el, anchor } = vnode
    while (el) {
      setVarsOnNode(el as Node, vars)
      if (el === anchor) break
      el = el.nextSibling
    }
  }
}

/** 向元素 style 写规范化 CSS 自定义属性，并保存可供 patchStyle 恢复的文本。 */
function setVarsOnNode(el: Node, vars: Record<string, unknown>) {
  if (el.nodeType === 1) {
    const style = (el as HTMLElement).style
    let cssText = ''
    for (const key in vars) {
      const value = normalizeCssVarValue(vars[key])
      style.setProperty(`--${key}`, value)
      cssText += `--${key}: ${value};`
    }
    ;(style as any)[CSS_VAR_TEXT] = cssText
  }
}
