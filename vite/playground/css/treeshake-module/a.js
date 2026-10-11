import style from './a.module.css'

/** 返回实际使用的 CSS Modules 类映射，使 a.module.css 样式在构建中保留。 */
export function a() {
  return style
}
