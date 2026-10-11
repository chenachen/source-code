if (import.meta.hot) {
  // 注册接受回调，才会在该模块收到更新时执行回调。
  import.meta.hot.accept(() => {
    // 主动失效，使更新继续向导入者传播。
    import.meta.hot.invalidate()
  })
}

/** 子模块被消费的初始文本；自身接受回调主动失效，让更新继续传播到父模块边界。 */
export const value = 'child'
