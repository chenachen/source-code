import { value as _value } from './mod-a'

// 浏览器 ESM 在环回读取未初始化绑定时抛错；runner 此 fixture 当前读取为 undefined。
let __value
try {
  __value = `${_value} (expected no error)`
} catch {
  __value = 'mod-a (unexpected error)'
}

/** 把捕获到的环回读结果拼入链式消息；浏览器预期 TDZ 进入 catch，runner 当前读到 undefined 而进入 try。 */
export const value = `mod-c -> ${__value}`
