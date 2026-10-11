import noExternalReactServerMessage from '@vitejs/test-ssr-conditions-no-external/server'
import externalReactServerMessage from '@vitejs/test-ssr-conditions-external/server'

/** 把 noExternal 与 external 两种 SSR 条件导出结果分别写入段落，并留下浏览器段落供客户端填写；返回 HTML，url 参数在本样例中不参与分支。 */
export async function render(url) {
  let html = ''

  html += `\n<p class="no-external-react-server">${noExternalReactServerMessage}</p>`

  html += `\n<p class="browser-no-external-react-server"></p>`

  html += `\n<p class="external-react-server">${externalReactServerMessage}</p>`

  html += `\n<p class="browser-external-react-server"></p>`

  return html + '\n'
}
