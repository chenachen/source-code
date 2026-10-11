/** 包入口中的根绝对 glob 表，页面只展示 pkg-pages 文件键以验证按项目 root 展开。 */
export const g = import.meta.glob('/pkg-pages/*.js')
document.querySelector('.in-package').textContent = JSON.stringify(
  Object.keys(g).sort(),
)
