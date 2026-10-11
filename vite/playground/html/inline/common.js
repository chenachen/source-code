import './dep1'
import './dep2'

/** 追加模块求值名称到页面输出，用依赖之间的循环和共享关系检查 HTML 入口内联后的执行顺序。 */
export function log(name) {
  document.getElementById('output').innerHTML += name + ' '
}

log('common')
