export default {
  plugins: [replacePinkWithBlue],
}

/** 创建 blue-app 专属 PostCSS 插件，将 pink 声明值改为 blue 以区分配置缓存。 */
function replacePinkWithBlue() {
  return {
    postcssPlugin: 'replace-pink-with-blue',
    /** 仅把完整等于 pink 的声明值改为 blue，不改其他声明内容。 */
    Declaration(decl) {
      if (decl.value === 'pink') {
        decl.value = 'blue'
      }
    },
  }
}
replacePinkWithBlue.postcss = true
