import './index.css'

/** 等待消息 chunk 与纯 CSS 动态依赖后写 DOM，验证库模式无 preload helper 且 CSS-only JS 引用被移除。 */
export default async function message(sel) {
  const message = await import('./message.js')

  await import('./dynamic.css')

  document.querySelector(sel).textContent = message.default
}
