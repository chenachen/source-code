import './static.js'

/** 预先添加 dynamic.css 的 preload(style) 链接，让动态 CSS 加载路径复用已有 URL。 */
const link = document.head.appendChild(document.createElement('link'))
link.rel = 'preload'
link.as = 'style'
link.href = new URL('./dynamic.css', import.meta.url).href

import('./dynamic.js').then(async ({ lazyLoad }) => {
  await lazyLoad()
})
