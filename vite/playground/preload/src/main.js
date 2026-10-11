import chunkMsg from './chunk'

document.querySelector('.chunk').textContent = chunkMsg

/** 按钮 ID 到异步 loader 的表；点击等待 loader 后追加 loaded 标记。 */
const ids = {
  /** 加载带内联注释的 hello 动态 import，验证构建分析跳过注释后仍找到 JS/CSS 依赖。 */
  hello: async () => {
    await import(/* 导入参数前的普通注释 */ './hello.js')
  },
  /** 按点击加载 about 及其包依赖，loader 完成后页面追加 loaded 标记。 */
  about: async () => {
    await import('./about.js') // 点击后加载。
  },
}

for (const [id, loader] of Object.entries(ids)) {
  const loadButton = document.querySelector(`#${id} .load`)
  loadButton.addEventListener('click', async () => {
    await loader()
    loadButton.insertAdjacentHTML('afterend', '<output>loaded</output>')
  })
}
