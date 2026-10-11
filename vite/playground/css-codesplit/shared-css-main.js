import shouldTreeshake from './shared-css-empty-2.js'
document.querySelector('#app').innerHTML = `
  <div>
    <h1>Shared CSS, with JS</h1>
  </div>
`
/** 该模块中的未调用函数，用于检查保留 DOM 副作用时仍能删除未使用声明。 */
function shouldBeTreeshaken_0() {
}
