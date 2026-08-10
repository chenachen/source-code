import { registerRuntimeHelpers } from '@vue/compiler-core'

/** 单选框 v-model 的运行时指令 helper。 */
export const V_MODEL_RADIO: unique symbol = Symbol(__DEV__ ? `vModelRadio` : ``)
/** 复选框 v-model 的运行时指令 helper。 */
export const V_MODEL_CHECKBOX: unique symbol = Symbol(
  __DEV__ ? `vModelCheckbox` : ``,
)
/** 文本输入框及 textarea v-model 的运行时指令 helper。 */
export const V_MODEL_TEXT: unique symbol = Symbol(__DEV__ ? `vModelText` : ``)
/** select v-model 的运行时指令 helper。 */
export const V_MODEL_SELECT: unique symbol = Symbol(
  __DEV__ ? `vModelSelect` : ``,
)
/** `:type` 或动态键导致输入类型无法静态确定时使用的 v-model helper。 */
export const V_MODEL_DYNAMIC: unique symbol = Symbol(
  __DEV__ ? `vModelDynamic` : ``,
)

/** 为 stop/prevent/self/系统键等事件修饰符添加运行时守卫。 */
export const V_ON_WITH_MODIFIERS: unique symbol = Symbol(
  __DEV__ ? `vOnModifiersGuard` : ``,
)
/** 为键盘按键修饰符添加运行时守卫。 */
export const V_ON_WITH_KEYS: unique symbol = Symbol(
  __DEV__ ? `vOnKeysGuard` : ``,
)

/** 通过 display 样式控制可见性的 v-show 运行时指令。 */
export const V_SHOW: unique symbol = Symbol(__DEV__ ? `vShow` : ``)

/** DOM 内置 Transition 组件 helper。 */
export const TRANSITION: unique symbol = Symbol(__DEV__ ? `Transition` : ``)
/** DOM 内置 TransitionGroup 组件 helper。 */
export const TRANSITION_GROUP: unique symbol = Symbol(
  __DEV__ ? `TransitionGroup` : ``,
)

// 将 DOM 专用 symbol 注册到 core 的 helper 名称表，代码生成器据此生成 import/解构。
registerRuntimeHelpers({
  [V_MODEL_RADIO]: `vModelRadio`,
  [V_MODEL_CHECKBOX]: `vModelCheckbox`,
  [V_MODEL_TEXT]: `vModelText`,
  [V_MODEL_SELECT]: `vModelSelect`,
  [V_MODEL_DYNAMIC]: `vModelDynamic`,
  [V_ON_WITH_MODIFIERS]: `withModifiers`,
  [V_ON_WITH_KEYS]: `withKeys`,
  [V_SHOW]: `vShow`,
  [TRANSITION]: `Transition`,
  [TRANSITION_GROUP]: `TransitionGroup`,
})
