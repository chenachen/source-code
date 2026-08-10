# 16. 公共 API、诊断与兼容类型边界

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

这一章不引入新的运行主链，而是回答源码读到最后常见的三个疑问：

1. `src/node/index.ts` 为什么几乎只有 export，却仍值得读？
2. constants、logger、deprecations 这类横切模块怎样影响全部主流程？
3. `src/types` 与 `types` 中哪些是 Vite 设计，哪些只是内联的上游类型快照？

## 从公共出口反查实现

`src/node/index.ts` 是 `vite` Node API 的稳定边界。推荐按导出分组反向跳转：

```text
createServer / preview / build
→ 三条顶层运行链

defineConfig / resolveConfig / loadEnv
→ 配置链

Plugin / Environment / ModuleGraph / HotChannel
→ 扩展协议与状态模型

parse / minify / transformWithOxc / preprocessCSS
→ 可独立调用的工具能力

Rollup* aliases / esbuildVersion / mixed ModuleGraph
→ 历史兼容层
```

出口文件不应复制实现注释；它的职责是标出承诺。`internalIndex.ts` 则相反，只供仓库内部包使用，不应
因为能 import 就被当成稳定公共 API。阅读时把“实现存在”和“用户可依赖”分开。

## 常量不是杂物箱

`constants.ts` 集中维护跨模块必须一致的协议值：

- `ROLLUP_HOOKS` 定义 Vite 插件容器主动调度的底层钩子；类型用例确保没有漏项。
- client/server mainFields 与 conditions 分开，防止 SSR 误选 browser 入口。
- `DEV_PROD_CONDITION` 延迟到解析期替换成 development/production。
- `/@fs/`、`/@vite/client`、`/@vite/env` 是浏览器 URL 与内部文件/运行时之间的协议。
- `KNOWN_ASSET_TYPES` 必须同步 client.d.ts 和 MIME 注册，否则运行时、TS 与响应头会分裂。
- `defaultAllowedOrigins` 只允许标准回环来源，不是“开发环境全部 CORS 放开”。
- optimizer 错误码让请求层区分构建失败与缓存文件缺失，选择不同恢复路径。

默认 esbuild 目标取主版本发布时的 Baseline Widely Available 快照。它只在主版本提升，避免普通升级突然
缩小浏览器兼容范围；iOS 与 Safari 是 esbuild 的独立目标，必须同时维护（#21193、#21342）。

## 诊断系统的两层去重

`createLogger()` 先按 LogLevel 过滤，再按终端能力选择输出模式：

```text
CI / 非 TTY / 禁止清屏 → 每条追加，机器日志完整
可交互 TTY            → 相同 type + msg 清屏更新为 (xN)
```

`warnOnce` 按完整文本去重；`loggedErrors` 用 WeakSet 按错误对象身份去重。前者解决同一提示在热路径重复，
后者解决同一个 Error 穿过多层边界被打印多次。WeakSet 不延长 Error 生命周期。

future deprecation 再包一层策略：只有 `future.<key> = 'warn'` 才输出，消息包含替代 API、迁移文档和过滤
Vite dist 后的调用栈。`ignoreDeprecationWarnings()` 只是同步作用域门闩，不能跨 Promise 使用。

## 类型目录的三类文件

### 1. Vite 自有协议类型

- `types/importMeta.d.ts`：通过全局声明合并加入 `hot/env/glob`，所以不能有顶层 import。
- `types/importGlob.d.ts`：重载把 eager/lazy 与 raw/url/worker query 映射到不同返回类型。
- `types/customEvent.d.ts`：内置 HMR、forward-console 与 bundled-dev 事件名/payload 映射。
- `types/metadata.d.ts`：模块增强 Rolldown 输出，为 chunk/asset 附加 Vite 资源依赖元数据。

`ViteTypeOptions.strictImportMetaEnv` 采用“键是否存在”判断，而不是读取布尔值。用户声明合并该键后，
ImportMetaEnv 的任意 string 索引消失，只保留内置字段和用户显式声明。

### 2. 可选依赖的隔离类型

Sass、Less、Stylus、esbuild、Lightning CSS 与 Terser 可能未安装。internal 声明通过 type-only import 和
`@ts-ignore` 保持 Vite 主类型可解析，再 Omit 掉由 Vite 掌控的 filename、sourcemap、entry/output 等
字段。这里的 Omit 就是所有权边界：用户配置算法参数，Vite 配置流水线参数。

### 3. 内联的上游快照

`chokidar.d.ts`、`connect.d.ts`、`ws.d.ts`、`commonjs.d.ts`、`alias.d.ts` 主要来自上游项目。Vite 内联它们
是因为实现已打包，不能要求用户额外安装 @types 或插件包才能解析公共 API。阅读原则：

- 了解 Vite 为什么暴露这份类型，以及在哪个配置/接口使用；
- 不把上游方法的实现归因于 Vite；
- 升级快照时保留来源和许可证，并与实际打包版本同步；
- 不为“翻完每个 ws/chokidar 字段”中断 Vite 主链阅读。

## 类型用例怎样读

`src/node/__tests_dts__` 不执行运行时代码，靠 TypeScript 编译成败表达契约：

- `config.ts`：defineConfig 重载是否保持对象、Promise 和函数返回形态；未知嵌套项是否报错。
- `plugin.ts`：Vite 插件是否覆盖 Rolldown 钩子，上下文扩展与 ROLLUP_HOOKS 是否完整。
- `importGlob.ts`：eager/query/as 组合是否得到值表、Promise 工厂、string 或 Worker。
- `postcss.ts`：Vite 对外类型是否与 postcss-load-config 一致。
- `utils.ts`：mergeWithDefaults 类型是否跟随深合并与非普通对象替换语义。

阅读 `@ts-expect-error` 时要问“这里为什么必须失败”；它不是忽略错误，而是断言这一行如果不报错，测试
反而失败。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/index.ts`，Node 公共出口：

```ts
export {
  defineConfig,
  loadConfigFromFile,
  resolveConfig,
  sortUserPlugins,
} from './config'
export { perEnvironmentPlugin } from './plugin'
export { perEnvironmentState } from './environment'
export { createServer } from './server'
export { preview } from './preview'
export { build, createBuilder } from './build'

export { optimizeDeps } from './optimizer'
export { createIdResolver } from './idResolver'
```

公共 API 是有意收窄的实现入口集合，不等同于 `src/node` 文件全集。类型阅读应从这些 export
反查声明与实现；内部 helper 即使被多模块复用，也不自动构成兼容承诺。

## 复盘题

1. 为什么公共出口文件没有实现逻辑，仍是源码阅读的起点和终点？
2. 客户端与 SSR 若共享 browser 条件，会出现哪类“双入口”问题？
3. 为什么 KNOWN_ASSET_TYPES 不能只改一个数组？
4. warnOnce 文本去重与 WeakSet 错误对象去重分别解决什么问题？
5. ImportMeta 全局增强为什么不能加入顶层 import？
6. 内联 ws/chokidar 类型对 Vite 的承诺是什么，又不承诺什么？
