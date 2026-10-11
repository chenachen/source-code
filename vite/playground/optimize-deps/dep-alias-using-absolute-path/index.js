// 引用其他模块也使用的依赖，让优化器生成公共 chunk。
// 绝对 alias 构造首轮扫描遗漏依赖的场景，用来回归其曾导致额外整页刷新和模块图失效的问题。
/** 通过深层 require 导入共享 cloneDeep，构造扫描首轮无法发现的绝对 alias 依赖与公共 chunk。 */
const cloneDeep = require('@vitejs/test-dep-lodash/cloneDeep')

// 实际调用共享依赖并导出消息，使该依赖保留在执行链中。
module.exports = cloneDeep({
  message: 'From dep-alias-using-absolute-path',
}).message
