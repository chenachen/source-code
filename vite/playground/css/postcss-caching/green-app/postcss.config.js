export default {
  plugins: [replacePinkWithGreen],
}

/** 创建 green-app 专属 PostCSS 插件，将 pink 声明值改为 green 以区分配置缓存。 */
function replacePinkWithGreen() {
  return {
    postcssPlugin: 'replace-pink-with-green',
    /** 仅把完整等于 pink 的声明值改为 green，作为该 root 配置生效的标记。 */
    Declaration(decl) {
      if (decl.value === 'pink') {
        decl.value = 'green'
      }
    },
  }
}
replacePinkWithGreen.postcss = true
