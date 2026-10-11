/** 模板动态导入的变量片段 main，用于从括号目录的 nest 回到上级 main.js。 */
const base = 'main'
import(`../${base}.js`).then((mod) => {
  document.querySelector(
    '.dynamic-import-with-vars-contains-parenthesis',
  ).textContent = mod.hello()
})
