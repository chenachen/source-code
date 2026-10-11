import 'vite/modulepreload-polyfill'
import cssUrl from '../styles/url.css?url'
import waterContainer from './water-container.svg'

/** 手工挂载 ?url 导出的 CSS 链接，模拟后端页面根据资产 URL 加载样式。 */
const cssLink = document.createElement('link')
cssLink.rel = 'stylesheet'
cssLink.href = cssUrl
document.querySelector('head').prepend(cssLink)

/** 用 meta 元素保存 SVG URL，让资源导入进入输出图并可由页面检查。 */
const dummyMeta = document.createElement('meta')
dummyMeta.name = 'dummy'
dummyMeta.content = waterContainer
document.querySelector('head').append(dummyMeta)

/** 标题使用的 Tailwind 类名，导出以覆盖入口模块的公开值。 */
export const colorClass = 'text-black'

/** 将导出的 Tailwind 类应用到页面标题，供后端入口样式测试检查。 */
export function colorHeading() {
  document.querySelector('h1').className = colorClass
}

colorHeading()

if (import.meta.hot) {
  import.meta.hot.accept()
}
