'use strict'

// 为 fixture 提供数组/对象递归复制的最小实现。
/** 递归复制数组和对象自有可枚举字段；原始值直接返回，这是 fixture 的最小 cloneDeep，不处理循环或特殊对象。 */
function cloneDeep(value) {
  if (value == null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(cloneDeep)
  }

  const cloned = {}
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      cloned[key] = cloneDeep(value[key])
    }
  }
  return cloned
}

module.exports = cloneDeep
