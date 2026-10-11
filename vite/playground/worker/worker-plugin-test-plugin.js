export default () => ({
  name: 'plugin-for-worker',
  /** 仅命中测试标记模块时做等长文本替换并返回map=null，使现有位置映射继续适用。
   * @param code 模块文本。
   * @param id 已解析ID。
   * @returns 目标模块的替换文本与空map，其他请求不处理。 */
  transform(code, id) {
    if (id.includes('worker/modules/test-plugin.js')) {
      return {
        // 替换文本保持原长度，使未额外提供 map 时后续列偏移不变。
        code: code.replace('plugin fail.   ', 'plugin success!'),
        map: null,
      }
    }
  },
})
