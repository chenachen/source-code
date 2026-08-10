import type { PluginCreator } from 'postcss'

/**
 * 规范化规则/at-rule 前后的原始空白为单个换行。
 * 仅改变 PostCSS 的格式化 raws，不改变选择器与声明语义，用于压平 SFC block 缩进。
 */
const trimPlugin: PluginCreator<{}> = () => {
  return {
    postcssPlugin: 'vue-sfc-trim',
    /** 单次遍历根节点，规范化所有规则/at-rule 的前后格式化空白。 */
    Once(root) {
      root.walk(({ type, raws }) => {
        if (type === 'rule' || type === 'atrule') {
          if (raws.before) raws.before = '\n'
          if ('after' in raws && raws.after) raws.after = '\n'
        }
      })
    },
  }
}

trimPlugin.postcss = true
export default trimPlugin
