import getMessage from 'external-entry/entry'

export default {
  /** 调用外部 entry 子路径的 getMessage；消费另一个模块设置的消息，暴露 external 子路径是否被重复加载。 */
  hello() {
    return getMessage()
  },
}
