/** 循环图根模块的基础文本，另一个环节点在其求值阶段读它以观察初始化顺序。 */
export const value = 'mod-a'

import { value as _value } from './mod-b'

/** 把环中下一模块的值拼入链式消息，入口显示完整循环求值结果。 */
export const msg = `mod-a -> ${_value}`
