// 插件通过 addWatchFile 把本文件登记为 main.css 的监听依赖。
/** 相邻 CSS 的间接颜色依赖；插件读值并 addWatchFile，此 JS 自接受避免自己引发页面刷新。 */
export const color = 'red'

// 本模块自接受，编辑它时不要求页面重载；
// 测试重点是 main.css 经监听依赖触发样式更新。
if (import.meta.hot) {
  import.meta.hot.accept()
}
