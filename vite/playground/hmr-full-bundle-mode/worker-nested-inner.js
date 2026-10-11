/** 收到外层消息后回传内层标记，测试改该字面量验证内外子构建资源均可访问。 */
self.onmessage = () => {
  self.postMessage('nested-inner')
}
