import './imported.css'
import css from './imported.css?inline'
text('.imported-css', css)

/** 显示 blue-app 独立 PostCSS 配置处理后的 inline CSS，检测另一服务的配置缓存是否串用。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
