import { add } from './add.wasm'

/** 调用直接导入的 Wasm add(1, 2) 并输出结果，检查 SSR 对 Wasm 命名导出的加载和调用。 */
export async function render() {
  return `<div class="direct-add">${add(1, 2)}</div>`
}
