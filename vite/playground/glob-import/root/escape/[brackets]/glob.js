/** 位于方括号目录中的相对 eager glob；目录部分按字面路径处理，用户的递归 JS 匹配后缀仍参与匹配。 */
const relative = import.meta.glob('./**/*.js', { eager: true })
/** 指向方括号目录的别名 eager glob；用于对照相对模式的匹配文件集合。 */
const alias = import.meta.glob('@escape_[brackets]_mod/**/*.js', {
  eager: true,
})
export { relative, alias }
