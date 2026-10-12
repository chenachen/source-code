# 本地源码学习示例

在 `yjs/` 目录，使用 Node ≥22（2026-10-12 实测 24.19.0）：

```sh
npm ci --ignore-scripts
node examples/state-vector-diff.mjs
node examples/known-overlap-boundary.mjs
```

锁文件固定依赖；示例直接导入当前 `src/`，无需 dist 或另装 npm 发行版。安装跳过生命周期脚本。

- `state-vector-diff.mjs`：首次同步后，接收方已有历史，再追加、删除、发差分和重复应用；断言内容和状态向量。
- `known-overlap-boundary.mjs`：用真实 V1 编码器构造同 client 的 GC `[0,2)`、`[1,5)`，经公开 merge/apply API 复现错误的 Skip `[2,4)`。逐包应用状态向量为 5；合并包应用为 2。

两例均在上述日期运行通过。但第二例的“通过”是**已知缺陷的特征断言通过**，不是正确性通过。本次不修库算法；未来修复必须将特征断言改为无 Skip、连续覆盖 `[0,5)`，并扩展 Item、V2 与实际编辑回归。此处没有运行完整测试套件或 provider。

[返回分享页](../../share/yjs/yjs-source-code-guide.html#walkthrough)
