/** 通过 require-polyfill 获取的 Vue 版本，验证外部 CJS 依赖请求与 ESM 导入一致。 */
const { version } = require('vue')
// require('slash5') // 该包为 ESM，夹具不从此 CJS 路径 require。
/** 通过 require 获取的 slash 3 函数；CJS 依赖用它写 DOM 证明外部依赖可调用。 */
const slash3 = require('slash3')

document.querySelector('#required-vue-version').textContent = version
document.querySelector('#required-slash3-exists').textContent =
  !!slash3('foo/bar')
