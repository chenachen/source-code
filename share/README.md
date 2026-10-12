# 源码学习分享页

所有可直接分享、离线打开的 HTML 集中放在 `share/<library>/`。库源码、测试、示例与官网页面仍留在各自源码目录。

## 入口

- [DOMPurify 源码机制指南](./dompurify/dompurify-source-guide.html)
- micro-app：[源码全景（主入口）](./micro-app/micro-app-src-guide.html) / [从 start 到清理（端到端附录）](./micro-app/micro-app-source-code-guide.html)
- React：[六包源码指南](./react/index.html) / [19.3.0 客户端渲染主线](./react/client-rendering-19.3.0/index.html)
- [Vite 源码解剖](./vite/index.html)
- [Vue 技术总结](./vue/index.html)
- [Yjs 源码深读](./yjs/yjs-source-code-guide.html)

## 目录约定

- 单页稿保留可辨识文件名；多页站入口统一为 `index.html`。
- 页面私有 CSS、JS 与覆盖率证据跟随所属库，保证离线打开不缺资源。
- 页面中的源码链接指向根目录下对应库；上游 demo、fixture、playground、官网 HTML 不迁入。
- Vite HTML 由 `vite/reading-guides/build-share-site.mjs` 直接生成到 `share/vite/`。

## 修订与可重复检查

- [2026-10-12 修订处置与验证范围](./revision-2026-10-12.md)逐项记录本轮解决、保留与验证限制；不代表全仓测试通过。
- 仓库根目录运行 `python3 share/scripts/check-local-links.py`，检查所有分享 HTML 的本地目标、页面锚点与重复 ID；不检查外网可达性或浏览器布局。
- 学习示例入口：[Yjs](../yjs/examples/README.md)、[DOMPurify](../dompurify/examples/README.md)、[React 本地源码](../react/fixtures/source-learning-demo/README.md)。其他模块的精确命令见各分享页。
