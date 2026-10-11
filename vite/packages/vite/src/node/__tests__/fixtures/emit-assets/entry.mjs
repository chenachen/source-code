import './css-normal.css'
import cssModule from './css-module.module.css'

/** 引用普通 CSS 与 CSS Modules 后打印样式映射，使 SSR/custom 环境的资产输出测试保留 CSS 依赖。 */
export default function Page() {
  console.log(cssModule)
}
