import style from './b.module.css'

/** 返回未被页面使用的 CSS Modules 类映射，供构建断言 b.module.css 可以被裁剪。 */
export function b() {
  return style
}
