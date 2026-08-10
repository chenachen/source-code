import { isPlainObject } from '@vue/shared'
import { DeprecationTypes, warnDeprecation } from './compatConfig'

/**
 * 复现 Vue 2 的 data 深合并：双方同名值都是普通对象时递归，否则后者覆盖前者。
 * Vue 3 默认采用浅合并；每次真正发生深合并都提示迁移，提醒用户显式组合 data。
 */
export function deepMergeData(to: any, from: any): any {
  for (const key in from) {
    const toVal = to[key]
    const fromVal = from[key]
    if (key in to && isPlainObject(toVal) && isPlainObject(fromVal)) {
      __DEV__ && warnDeprecation(DeprecationTypes.OPTIONS_DATA_MERGE, null, key)
      deepMergeData(toVal, fromVal)
    } else {
      to[key] = fromVal
    }
  }
  return to
}
