/**
 * Vue 内部标准化对象共用的原型标记。
 *
 * VNode 的 props/slots 标准化需要区分“用户传入对象”和“Vue 已处理的内部对象”。
 * 这里不在每个对象上定义不可枚举标记，而是让内部对象共享一个专用原型，再通过
 * `Object.getPrototypeOf()` 判定。这样能减少属性定义开销，是 SSR benchmark 中引入
 * 的热路径优化。
 */
const internalObjectProto = {}

/** 创建一个可被 `isInternalObject()` 快速识别的无自有属性内部对象。 */
export const createInternalObject = (): any =>
  Object.create(internalObjectProto)

/** 判断对象是否由 `createInternalObject()` 创建，而不是普通用户对象。 */
export const isInternalObject = (obj: object): boolean =>
  Object.getPrototypeOf(obj) === internalObjectProto
