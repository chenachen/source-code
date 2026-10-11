// 两个动态 chunk 共享此无 JS 导出的 CSS 模块；分包后其纯 CSS JS chunk 会被移除，
// import map 与依赖重写仍须保留共享样式并清掉失效 JS 引用。
// https://github.com/vitejs/vite/issues/22740
import './shared-styles.css'
