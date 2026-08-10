import type { ObjectDirective } from '@vue/runtime-core'

/** 元素在 v-show 接管前/当前绑定 style 中的 display 值。 */
export const vShowOriginalDisplay: unique symbol = Symbol('_vod')
/** 当前是否被 v-show 强制隐藏；patchStyle 用它维持指令优先级。 */
export const vShowHidden: unique symbol = Symbol('_vsh')

/** 带 v-show 内部显示状态的 HTMLElement。 */
export interface VShowElement extends HTMLElement {
  // `_vod` = Vue Original Display。
  [vShowOriginalDisplay]: string
  [vShowHidden]: boolean
}

/**
 * `v-show` 运行时指令：不挂卸载子树，只通过 style.display 切换可见性。
 * 有 Transition 时，显示先执行 beforeEnter 再恢复 display，隐藏则等 leave 完成后置 none。
 */
export const vShow: ObjectDirective<VShowElement> & { name: 'show' } = {
  // 水合 style mismatch 检查用内部 name 识别 v-show 应产生 display:none。
  name: 'show',
  beforeMount(el, { value }, { transition }) {
    el[vShowOriginalDisplay] =
      el.style.display === 'none' ? '' : el.style.display
    if (transition && value) {
      transition.beforeEnter(el)
    } else {
      setDisplay(el, value)
    }
  },
  mounted(el, { value }, { transition }) {
    if (transition && value) {
      transition.enter(el)
    }
  },
  updated(el, { value, oldValue }, { transition }) {
    if (!value === !oldValue) return
    if (transition) {
      if (value) {
        transition.beforeEnter(el)
        setDisplay(el, true)
        transition.enter(el)
      } else {
        transition.leave(el, () => {
          setDisplay(el, false)
        })
      }
    } else {
      setDisplay(el, value)
    }
  },
  beforeUnmount(el, { value }) {
    setDisplay(el, value)
  },
}

/** 按布尔值恢复原 display 或强制 none，并同步给 patchStyle 的隐藏标记。 */
function setDisplay(el: VShowElement, value: unknown): void {
  el.style.display = value ? el[vShowOriginalDisplay] : 'none'
  el[vShowHidden] = !value
}

/**
 * 给 v-show 安装 SSR props 生成器。
 * 仅当用户在 SSR 中复用面向客户端的 render 函数时需要；编译 SSR 模板有独立转换。
 */
export function initVShowForSSR(): void {
  vShow.getSSRProps = ({ value }) => {
    if (!value) {
      return { style: { display: 'none' } }
    }
  }
}
