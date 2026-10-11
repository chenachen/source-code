import { value as _value } from './mod-c'

/** 从环中下一模块读取值并拼接当前节点标签，测试编辑标签后观察重新求值链。 */
export const value = `mod-b -> ${_value}`
