/** 可独立自接受 HMR 的组件 HTML；更新后替换全部 data-id 匹配节点，供 Tailwind 内容扫描与模块图共享文件测试。 */
export const component1 = /* html */ `
  <div id="component1" data-id="component1" class="text-red-600">component1</div>
`

import.meta.hot?.accept((mod) => {
  document.querySelectorAll('[data-id="component1"]').forEach((d) => {
    d.outerHTML = mod.component1
  })
})
