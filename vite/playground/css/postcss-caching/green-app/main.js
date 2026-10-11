import './imported.css'
import css from './imported.css?inline'
text('.imported-css', css)

/** 显示 green-app 独立 PostCSS 配置处理后的 inline CSS，检测服务之间的配置缓存隔离。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
