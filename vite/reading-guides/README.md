# Vite 源码阅读指南

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

[多页面分享版 HTML](../../share/vite/index.html) 提供总览与 22 个重点模块页；每页均可离线阅读，
并保留源码、测试证据、推导边界及前后篇导航。

本目录按“源码注释 → 测试场景注释 → 静态审计 → 原理总结”组织。源码目录结构只用于
定位文件，学习模块按运行链路划分，避免读完单个目录却无法串起完整流程。

## 注释约定

- 函数、类、类型和对外常量使用 JSDoc/TSDoc，说明职责、输入、输出及关键约束。
- 长逻辑块解释状态变化、分支原因和异常场景，不逐行翻译语法。
- 历史修复保留 `#编号` 或 `@see` 链接，并说明修复前的可复现场景。
- 测试注释明确“场景、触发动作、验证目标”，说明断言与源码机制的关系。
- 局部变量仅在语义或生命周期不直观时解释；不为自解释赋值制造注释噪声。

## 代码块证据约定

- “目标版本源码摘录”表示从 `v8.2.1` 原文件提取；必须同时注明文件与符号，删节会明确说明。
- “测试源码摘录”表示仓库中的真实测试；教程为了连贯而移动夹具位置时会明确标记，逻辑与断言不改写。
- “教程改写”保留机制但可能改名或省略工程样板，不可当作仓库原码逐字引用。
- “伪代码（不可执行）”和 `text` 流程块只解释控制流、状态或概念输出。
- 命令、配置、HTML 与 JSON 示例按其语言标记；没有标为源码摘录的代码块不作为源码证据。

## 阅读顺序

0. [系统全景与一条开发请求的完整链路](./00-system-map-and-end-to-end.md)
1. [CLI 与启动](./01-cli-and-startup.md)
2. 配置与环境变量
   - [02A：环境文件加载](./02a-env-loading.md)
   - [02B：配置合并、加载与解析](./02b-config-resolution.md)
   - [02C：Define、客户端配置注入与 JSON 模块](./02c-define-client-injection-and-json.md)
3. [插件体系与 PluginContainer](./03-plugin-system.md)
4. [Dev Server 生命周期](./04-dev-server-lifecycle.md)
5. [Environment API](./05-environment-api.md)
6. [中间件与请求入口](./06-middleware-request-pipeline.md)
7. [模块解析](./07-module-resolution.md)
8. [Transform 与模块图](./08-transform-and-module-graph.md)
9. [HTML 转换](./09-html-transform.md)
10. [Import Analysis](./10-import-analysis.md)
11. [依赖预构建](./11-dependency-pre-bundling.md)
12. [HMR](./12-hmr.md)
13. CSS、Asset 与 Worker
    - [13A：CSS 编译、HMR 与构建产物](./13a-css-pipeline.md)
    - [13B：Asset、Worker 与 Wasm](./13b-asset-worker-wasm.md)
14. 生产构建
    - [14A：生产构建编排与 Environment](./14a-build-orchestration.md)
    - [14B：动态导入预加载、压缩与构建清单](./14b-build-output-and-preload.md)
15. SSR 与 Module Runner
    - [15A：SSR 变换、加载与错误堆栈](./15a-ssr-transform-and-loading.md)
    - [15B：Module Runner 求值、缓存、HMR 与 Sourcemap](./15b-module-runner.md)
16. [公共 API、诊断与兼容类型边界](./16-public-api-diagnostics-and-types.md)

第 00 章使用同一个开发请求解释跨模块控制流、状态变化、异常与清理，并给出真实
PluginContainer 测试闭环。后续章节再分别展开各子系统，不把章节顺序误当成运行时顺序。

## 章节证据索引

| 章节 | 决定性源码 | 代表性测试证据 |
|---|---|---|
| 00 | `node/cli.ts`、`server/index.ts`、`server/middlewares/transform.ts`、`server/transformRequest.ts` | `server/__tests__/pluginContainer.spec.ts` |
| 01 | `node/cli.ts`、`node/server/index.ts` | `playground/cli/__tests__` |
| 02A | `node/env.ts::loadEnv` | `node/__tests__/env.spec.ts` |
| 02B | `node/config.ts::resolveConfig/loadConfigFromFile` | `node/__tests__/config.spec.ts` |
| 02C | `plugins/define.ts`、`clientInjections.ts`、`json.ts` | 对应 plugin tests 与 define/json playground |
| 03 | `node/plugin.ts`、`server/pluginContainer.ts` | `server/__tests__/pluginContainer.spec.ts`、`plugins/hooks.spec.ts` |
| 04 | `server/index.ts::_createServer/initServer/restart/close` | `node/__tests__/dev.spec.ts`、watcher tests |
| 05 | `environment.ts`、`baseEnvironment.ts`、`server/environment.ts` | `environment.spec.ts`、Module Runner runtime tests |
| 06 | `server/middlewares/*` | middleware tests、HTML/fs-serve playground |
| 07 | `plugins/resolve.ts`、`node/packages.ts` | `resolve.spec.ts`、optimizer resolve tests |
| 08 | `server/transformRequest.ts`、`moduleGraph.ts` | transformRequest 与 moduleGraph tests |
| 09 | `node/plugins/html.ts`、`middlewares/indexHtml.ts` | `html.spec.ts`、indexHtml middleware tests |
| 10 | `plugins/importAnalysis.ts`、`importMetaGlob.ts` | import/importGlob tests、dynamic-import playground |
| 11 | `optimizer/index.ts`、`scan.ts`、`rolldownDepPlugin.ts` | optimizer tests、scan tests |
| 12 | `server/hmr.ts`、`client/client.ts`、`shared/hmr.ts` | server HMR tests、HMR playground |
| 13A | `plugins/css.ts` | CSS plugin tests 与 CSS playground |
| 13B | `plugins/asset.ts`、`worker.ts`、`wasm.ts` | 对应 plugin tests 与 asset/worker playground |
| 14A | `node/build.ts::createBuilder/buildEnvironment` | `node/__tests__/build.spec.ts` |
| 14B | `importAnalysisBuild.ts`、manifest/report/minify plugins | 对应 plugin tests 与 build snapshots |
| 15A | `ssr/ssrTransform.ts`、`ssrModuleLoader.ts` | SSR transform/load/stacktrace tests |
| 15B | `module-runner/runner.ts`、`evaluatedModules.ts` | Module Runner runtime/HMR/sourcemap tests |
| 16 | `node/index.ts`、`logger.ts`、公共 `.d.ts` | logger、公开类型与 DTS tests |

`preview`、日志、快捷键、Source Map 等横切能力放入最相关主模块；最后一章再解释
公共出口与内联依赖声明的维护边界，避免为了工具函数打断主调用链。

## 每个模块的完成标准

1. 主入口、关键函数、重要类型/常量已有中文注释。
2. 原有英文原理注释已翻译并补充背景；普通协议文本和用户界面字符串不翻译。
3. 对应单元测试或 playground 用例已说明测试场景与验证目标。
4. 阅读指南包含调用链、核心状态、历史问题、断点和复盘题。
5. 格式化、AST 注释审计与 `git diff --check` 通过；纯注释任务不重复运行测试。
