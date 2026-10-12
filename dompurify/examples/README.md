# 最小清洗示例

在 `dompurify/` 目录：

```sh
npm ci --ignore-scripts
node examples/sanitize.cjs
```

本例使用本仓已跟踪的 `dist/purify.cjs.js` 和锁文件中的 jsdom 29.1.1。其 Node engines 为 `^20.19.0 || ^22.13.0 || >=24.0.0`，不是任意 Node 20+。

2026-10-12 在 Node 24.19.0 运行通过：精确断言输出为 `<form><a>go</a><svg><circle pointer-events="all"></circle></svg></form>`，且 `removed.length === 5`。无论断言成功失败都会关闭 jsdom window。这个计数只描述本输入，不是安全检测 API 的一般契约。

需要从 TypeScript 重新生成产物时，执行项目现有 `npm run build` 后重跑。本轮未重新构建；示例结果只证明当前 CJS 产物对这一输入的行为，不证明所有浏览器、攻击 fixture 或类型检查通过。库生产逻辑与产物未改。

[返回分享页](../../share/dompurify/dompurify-source-guide.html#example)
