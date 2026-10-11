import './parent.js'

if (import.meta.hot) {
  // 先注册接受回调，以便主动发起失效。
  import.meta.hot.accept(() => {
    // 入口没有导入者可继续传播，失效最终触发整页重载。
    import.meta.hot.invalidate()
  })
}

/** 入口显示节点；只在文本为空时初始化，主动失效后的整页刷新才重新创建并显示新文本。 */
const root = document.querySelector('.invalidation-root')

// DOM 初始化只执行一次，单次模块重执行不会更新已有内容。
if (!root.innerHTML) {
  root.innerHTML = 'Init'
}
