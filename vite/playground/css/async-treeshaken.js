import './async-treeshaken.css'

/** 异步模块求值时生成的紫色节点；构建测试验证被裁剪的导入不会创建它。 */
const div = document.createElement('div')
div.className = 'async-treeshaken'
div.textContent =
  'async treeshaken chunk (this should be plum and should not show up in prod)'
document.body.appendChild(div)
