import requireExternalCjs from '@vitejs/test-require-external-cjs'

/** 把 noExternal 父包 require 到的 external 子依赖结果写入段落，验证 SSR 转换父包后仍按 CommonJS require 条件解析外部包。 */
export async function render(url) {
  let html = ''

  html += `\n<p class="require-external-cjs">message from require-external-cjs: ${requireExternalCjs}</p>`

  return html + '\n'
}
