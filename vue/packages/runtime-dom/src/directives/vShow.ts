import type { ObjectDirective } from '@vue/runtime-core'

/** 元素在 v-show 接管前/当前绑定 style 中的 display 值。 */
export const vShowOriginalDisplay: unique symbol = Symbol('_vod')
/** 当前是否被 v-show 强制隐藏；patchStyle 用它维持指令优先级。 */
export const vShowHidden: unique symbol = Symbol('_vsh')

/** 带 v-show 内部显示状态的 HTMLElement。 */
export interface VShowElement extends HTMLElement {
  // `_vod` = Vue Original Display。
  /** 显示态应恢复的 display，由指令初始采集并由 patchStyle 随绑定更新。 */
  [vShowOriginalDisplay]: string
  /** v-show 当前是否隐藏；patchStyle 读取它，在绑定 style 更新后继续强制 none。 */
  [vShowHidden]: boolean
}

/**
 * `v-show` 运行时指令：不挂卸载子树，只通过 style.display 切换可见性。
 * 有 Transition 时，显示先执行 beforeEnter 再恢复 display，隐藏则等 leave 完成后置 none。
 */
export const vShow: ObjectDirective<VShowElement> & {
  /** 水合诊断识别 v-show 的内部字面量标记。 */
  name: 'show'
} = {
  // 水合 style mismatch 检查用内部 name 识别 v-show 应产生 display:none。
  name: 'show',
  /** 保存非 none 的原 display；有显示入场过渡时先 beforeEnter，否则直接设置显示/隐藏。 */
  beforeMount(el, { value }, { transition }) {
    el[vShowOriginalDisplay] =
      el.style.display === 'none' ? '' : el.style.display
    if (transition && value) {
      transition.beforeEnter(el)
    } else {
      setDisplay(el, value)
    }
  },
  /** 首次 value 为真且有 transition 时启动 enter；显示状态已在 beforeMount 准备。 */
  mounted(el, { value }, { transition }) {
    if (transition && value) {
      transition.enter(el)
    }
  },
  /** 只处理布尔可见性变化；显示先恢复 display 再 enter，隐藏在 leave 完成回调才置 none。 */
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
  /** 卸载前按当前 value 恢复 display 与隐藏标记，不等待新过渡。 */
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
  /** SSR 复用客户端 render 时，假值输出 display:none，真值不额外添加样式。 */
  vShow.getSSRProps = ({ value }) => {
    if (!value) {
      return { style: { display: 'none' } }
    }
  }
}
