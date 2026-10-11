import test from '@vitejs/longfilename-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index'

/** 展示超长依赖名称导入结果的 DOM 节点，供 flattenId 长度限制测试观测。 */
const main = document.querySelector('.long-file-name')
main.innerHTML = test ?? 'failed to import'
