# Vue 技术总结

三套 Vue 3.5 源码总结统一存放于此。浏览入口为 [`index.html`](./index.html)。

```text
share/vue/
├── index.html          # 统一入口、系统关系、阅读路线
├── reactivity/         # 响应式系统
│   └── index.html
├── runtime/            # runtime-core 与 runtime-dom
│   ├── index.html
│   ├── primer.html
│   ├── architecture.html
│   ├── component.html
│   ├── renderer.html
│   ├── diff.html
│   ├── scheduler.html
│   ├── hydration.html
│   ├── builtins.html
│   ├── runtime-dom.html
│   ├── integration.html
│   ├── evolution.html
│   ├── testing.html
│   └── assets/
└── compiler/           # compiler-core/dom/sfc/ssr
    ├── index.html
    ├── core.html
    ├── dom.html
    ├── sfc.html
    ├── ssr.html
    ├── integration.html
    ├── evolution.html
    ├── lab.html
    └── assets/
```

维护约定：

- 每套总结独占一个子目录，入口统一命名为 `index.html`。
- 专题私有 CSS、JS、图片放在各自 `assets/` 内。
- 专题页的全局导航先返根目录 `index.html`；根目录的阅读路线可直达具体章节。
- 指向 Vue 源码的链接从专题目录使用 `../../../vue/packages/`。
- 新增专题时，同步更新根目录首页与本文件目录树。
