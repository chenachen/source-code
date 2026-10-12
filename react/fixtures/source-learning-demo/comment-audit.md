# 新增示例的注释复核

2026-10-12，对两个 `.cjs` 文件运行仓库声明级脚本（借用本仓 `yjs/node_modules/typescript/lib/typescript.js` 解析，不是此示例运行依赖）：

```sh
node .agents/skills/read-source-code/scripts/audit-comment-coverage.mjs \
  --root . --path react/fixtures/source-learning-demo \
  --typescript yjs/node_modules/typescript/lib/typescript.js \
  --format json --fail-on-missing
```

补注释前：19 项声明，1 已有普通说明，18 缺失。
补注释后：19 项（17 顶层常量、2 函数）均有说明，0 缺失、0 豁免；无解析诊断。逐项结果见 `comment-audit.json`。

状态分类：`run.cjs` 的 `fs` 是“已翻译扩写”（将文件头用途具体落实为读取职责 TSDoc）；其余 18 项为“新补充”。没有未归类项。

人工补充检查脚本未单列的函数表达式：

| 文件/符号 | 状态 | 人工检查 |
| --- | --- | --- |
| run.cjs / Module._resolveFilename | 新补充 | 函数值赋值前 TSDoc 说明 bare 与 relative 两种 fork |
| run.cjs / Module._extensions['.js'] | 新补充 | TSDoc 说明仅转换本地 packages、记录执行来源 |
| context-example.cjs / contextExample | 新补充 | TSDoc 说明 Given/When/Then 与 act/清理边界 |
| context-example.cjs / Consumer | 新补充 | TSDoc 说明 Context 读取、render 次数与干扰排除 |

人工复核：transform/run 的 TSDoc 解释转换边界与断言；关键配置覆盖源码根、alias、globals、loadedSources、原始 loader 保存、DOM 所有权。上下文内 A/B、child 与计数器由例子头及相邻 Consumer 说明覆盖，不为明显局部赋值逐行加噪音。错误退出和 finally 关闭窗口/恢复 hook 的行为可直接复核；不改变生产实现。
