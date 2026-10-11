import './parent'

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot.invalidate()
  })
}

/** 子模块被消费的初始文本；自身接受回调主动失效，让更新继续传播到父模块边界。 */
export const value = 'child'
