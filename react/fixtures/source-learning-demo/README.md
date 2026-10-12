# React 源码教程的可运行闭环

这个独立 harness 直接执行 `share/react/client-rendering-19.3.0/index.html#demo` 当前展示的完整代码，并补一个 Context 对照例。React、ReactDOM、reconciler、Scheduler 均来自本仓 `react/packages/`，不安装或执行 npm React。它不是正式发布构建，也不是浏览器端打包产物。

## 固定基线与范围

- 仓库基线：`87d515d9dfc8a31b9496b36556dbd2409a6c781d`（本仓 main 的 React 19.3.0 源码快照）。运行时实际加载本工作树的源码，修改源码后结果相应变化。
- 已验证环境：Node `v24.19.0`、npm `11.9.0`、Linux。推荐复跑使用相同 Node/npm；其他版本未验证。
- 直接依赖精确锁在 `package.json`，全部传递依赖锁在 `package-lock.json`。
- Hermes parser `0.32.1` 解析本次实际加载的 Flow/JSX；Babel `7.28.5` 去 Flow、转换 automatic JSX runtime 和 ES module → CommonJS。
- jsdom `26.1.0` 提供 DOM、MutationObserver 与冒泡 MouseEvent。事件循环使用 Node 的真实定时器；Scheduler 使用相邻源码，未替换为测试 mock。
- 渠道固定为 stable development：`__DEV__=true`、`__EXPERIMENTAL__=false`、`__PROFILE__=false`、`__VARIANT__=false`、`__NEXT_MAJOR__=false`。使用 `shared/ReactFeatureFlags.js` 默认开关，未启用 WWW/Native fork。

## 从仓库根目录运行

```sh
cd react/fixtures/source-learning-demo
npm ci --ignore-scripts --workspaces=false --no-audit --no-fund --cache /tmp/react-source-demo-npm-cache
npm test
```

`--workspaces=false` 保持此目录的依赖独立；`--ignore-scripts` 禁止第三方安装生命周期脚本。缓存放在 `/tmp`，避免当前环境默认 npm 缓存目录不可写。首次安装需要 npm registry 网络；安装后 `npm test` 不联网。

安装前已审阅 `react/package.json` 中的 prebuild/postinstall/test/build 命令，以及 `scripts/jest/config.base.js`、`config.source.js`、`preprocessor.js`、`setupHostConfigs.js`、`babel.config.js` 和 `scripts/rollup/forks.js`。本 harness 不调用仓库安装、构建或 Jest 生命周期脚本，仅使用已检查的 fork 规则：

| 请求 | 本地源码目标 |
| --- | --- |
| `react` | `packages/react/index.stable.development.js` |
| `react-dom/client` | `packages/react-dom/client.js` |
| `shared/ReactSharedInternals` | `packages/react/src/ReactSharedInternalsClient.js` |
| `shared/ReactDOMSharedInternals` | `packages/react-dom/src/ReactDOMSharedInternals.js` |
| `react-reconciler/src/ReactFiberConfig`（含相对导入） | `packages/react-reconciler/src/forks/ReactFiberConfig.dom.js` |
| `scheduler` | `packages/scheduler/index.js` |

其余 React workspace 包直接解析到相邻 `packages/`，然后仅转换该目录中的 JS。没有模块名对应 npm React 的回退。

## 执行入口、断言与清理

`run.cjs` 从 HTML 的 `#demo pre code` 读取文本，避免教程与可执行副本漂移。唯一模块包装适配是把结尾 `await main();` 改为 `module.exports = main;`，由 runner 执行 `await example.exports()`；组件、click、等待逻辑、断言与 finally 都保持教程原文。JSX 由 automatic runtime 转换到本地 `react/jsx-runtime`。

主例没有使用 `act`、`flushSync` 或 fake timers，断言包括：

1. 首次 commit 后 count 为 0，列表为 A/B/C。
2. 真实冒泡 click 后 count 为 1，列表为 C/A/B。
3. button 身份不变，按 key 找到的 A/B/C DOM 节点与更新前是同一个对象。
4. finally 中 root 同步卸载为空，随后容器被移除。runner 额外断言 body 为空。

`context-example.cjs` 是单独的源码 Context 对照：`createContext({label:'default'})`、`memo` consumer、稳定 child/props、无内部 state；冻结对象 A 首次 renders=1，重渲染同一 A 仍为 1，新引用 B 与 A 字段相同但 renders=2，DOM 始终为 A。只在这个独立例子中使用 `await act`，finally 中卸载并移除容器、恢复 act 环境标记。

runner 最后断言已加载关键本地源码、且 require cache 中没有 npm React/ReactDOM/reconciler/Scheduler；结束时关闭 jsdom window 并恢复进程内模块加载器，错误退出码为 1。无需服务器，无持久监听器。若要删除安装的依赖，删除本目录的 `node_modules/` 即可，lockfile 与示例应保留。

## 已观察结果与边界

2026-10-12 UTC 的真实运行结果见 `verification.txt`，退出码为 0。本次加载 197 个本地源码模块，所有上述断言通过。

这些断言证明这份源码在指定 harness 下的 DOM、事件更新、key 身份复用与 Context 引用比较行为。它们没有直接读取内部 lane/flags；不把通过断言当作 Default/Sync lane 数值、render 调度次数或所有浏览器行为的独立实验证明。lane/flags 的论证仍来自正文指定的真实源码分支。jsdom 不提供浏览器布局、绘制、真实用户事件可信度或完整浏览器事件循环，未做 Chromium/Firefox/WebKit 端到端验证。
