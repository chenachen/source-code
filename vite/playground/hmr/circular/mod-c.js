import { value as _value } from './mod-a'

// 环回读取尚未初始化的绑定，浏览器 ESM 抛错并进入下方 catch。
let __value
try {
  __value = `${_value} (unexpected no error)`
} catch {
  __value = 'mod-a (expected error)'
}

/** 把捕获到的环回读结果拼入链式消息；浏览器预期 TDZ 进入 catch，runner 当前读到 undefined 而进入 try。 */
export const value = `mod-c -> ${__value}`
