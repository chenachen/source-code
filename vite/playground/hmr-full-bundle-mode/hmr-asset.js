// 此自接受模块初始没有资产导入；测试通过编辑源文件加入一个导入。
/** 放置图片的 DOM 容器；模块重执行时替换旧内容。 */
const slot = document.querySelector('.hmr-asset')
/** 尚未设置 src 的新图片，测试编辑插入资源导入后检查解码与HTTP响应。 */
const img = document.createElement('img')
img.id = 'hmr-asset-image'
img.alt = 'hmr-asset'
slot.replaceChildren(img)
/* @asset-src */

import.meta.hot?.accept()
