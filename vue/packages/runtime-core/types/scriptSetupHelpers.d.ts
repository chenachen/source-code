// 构建时自动拼接到打包后的 d.ts 末尾；编译宏的全局类型不代表浏览器上有同名运行时函数。
/** 保留 defineProps 的完整重载，供全局编译宏声明复用。 */
type _defineProps = typeof defineProps
/** 保留 defineEmits 的事件签名推导。 */
type _defineEmits = typeof defineEmits
/** 保留 defineExpose 的公开实例形态约束。 */
type _defineExpose = typeof defineExpose
/** 保留 defineOptions 的组件选项约束。 */
type _defineOptions = typeof defineOptions
/** 保留 defineSlots 的具名插槽类型推导。 */
type _defineSlots = typeof defineSlots
/** 保留 defineModel 的值、修饰符与读写转换重载。 */
type _defineModel = typeof defineModel
/** 保留 withDefaults 与可选 prop 默认值之间的类型对应。 */
type _withDefaults = typeof withDefaults

declare global {
  /** 编译宏：声明组件 props，正常 SFC 编译后调用被移除。 */
  const defineProps: _defineProps
  /** 编译宏：声明组件 emit 的事件签名。 */
  const defineEmits: _defineEmits
  /** 编译宏：选择父级模板 ref 可访问的公开实例字段。 */
  const defineExpose: _defineExpose
  /** 编译宏：合并 script setup 无法直接表达的组件选项。 */
  const defineOptions: _defineOptions
  /** 编译宏：声明具名插槽与其 props 的类型。 */
  const defineSlots: _defineSlots
  /** 编译宏：声明 v-model prop/update 事件及其运行时 useModel 连接。 */
  const defineModel: _defineModel
  /** 编译宏：为类型式 defineProps 合并默认值，并调整返回类型的可选性。 */
  const withDefaults: _withDefaults
}
