import { exported_func } from './light-with-imports.wasm'
import { getResult } from './imports.js'

/** 调用直接导入的 Wasm exported_func，使其回调 JS 导入函数，再读取并输出该回调保存的结果。 */
export async function render() {
  exported_func()
  return `<div class="direct-light">${getResult()}</div>`
}
