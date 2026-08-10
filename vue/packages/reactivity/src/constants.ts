/**
 * 依赖收集阶段的操作类型。
 *
 * 这里特意使用字符串而不是数字枚举：开发模式下 `onTrack` 收到调试事件时，
 * 可以直接看出本次访问是读取属性、检查属性是否存在，还是遍历对象。
 * 三种成员最终都进入 `track(target, type, key)`；`type` 主要服务调试事件，真正的
 * 订阅粒度由 target 与 key（包括遍历专用 Symbol）共同决定。
 */
export enum TrackOpTypes {
  /** 读取属性，例如 `state.count`。 */
  GET = 'get',
  /** 检查属性是否存在，例如 `'count' in state`。 */
  HAS = 'has',
  /** 遍历对象或集合，例如 `for...in`、`Map.keys()`。 */
  ITERATE = 'iterate',
}

/**
 * 触发依赖更新的操作类型。
 *
 * `trigger()` 会根据操作类型决定除当前属性外还需通知哪些“遍历依赖”；例如给
 * 数组新增索引还会影响 `length`，给 `Map` 新增键还会影响键遍历。
 * 因此该枚举不只是调试标签，也是 `trigger()` 分派依赖通知范围的控制条件。
 */
export enum TriggerOpTypes {
  /** 修改已有属性或已有 `Map` 键的值。 */
  SET = 'set',
  /** 新增对象属性、数组索引或集合成员。 */
  ADD = 'add',
  /** 删除对象属性或集合成员。 */
  DELETE = 'delete',
  /** 清空 `Map` 或 `Set`。 */
  CLEAR = 'clear',
}

/**
 * Vue 写在代理对象或特殊对象上的内部标记。
 *
 * 代理处理器通过这些键回答 `isReactive()`、`isReadonly()` 等查询；`RAW` 用于
 * 在满足安全条件时取回原始对象。它们属于内部协议，不应作为业务字段使用。
 * 除 `SKIP` 可由 `markRaw()` 真正定义在原对象上，其余标记通常由代理 get 陷阱
 * 虚拟返回，避免给用户数据写入额外字段。
 */
export enum ReactiveFlags {
  /** 跳过响应式转换；由 `markRaw()` 写入。 */
  SKIP = '__v_skip',
  /** 标记对象是深层或浅层的可变响应式代理。 */
  IS_REACTIVE = '__v_isReactive',
  /** 标记对象是深层或浅层的只读代理。 */
  IS_READONLY = '__v_isReadonly',
  /** 标记代理只转换根层属性。 */
  IS_SHALLOW = '__v_isShallow',
  /** 指向创建当前代理的原始对象。 */
  RAW = '__v_raw',
  /** 标记对象遵循 Ref 的 `.value` 协议。 */
  IS_REF = '__v_isRef',
}
