/** 创建并追加成功段落，证明 Pug 页面动态插入的外部模块脚本已经执行。 */
const p = document.createElement('p')
p.innerHTML = '✅ Dynamically injected script from file'
document.body.appendChild(p)
