# 14A. 生产构建编排与 Environment

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本章研究 Vite 怎样把已解析配置变成一次或多次 Rolldown 构建：

```text
build(inlineConfig)
→ createBuilder()
→ 为每个命名环境解析 config / 创建插件实例
→ BuildEnvironment
→ resolveRolldownOptions()
→ rolldown() / watch()
→ generate 或 write 每个 output
→ 回填 viteMetadata
```

本章不展开 HTML/CSS/asset 插件内部算法，它们分别见 09、13A、13B。动态 import preload、
manifest、压缩与报告放在 14B；SSR 模块执行语义放在第 15 章。

读完应能回答：

1. `build()` 与 `createBuilder()` 有什么关系？
2. build 配置的默认值为什么依赖 client/server、lib 和 bundled-dev？
3. 顶层 input、lib entry、SSR entry、rolldownOptions.input 的优先级是什么？
4. 应用、库与 SSR 为什么使用不同 `preserveEntrySignatures`？
5. package.json 的 `type` 怎样影响 `.js/.mjs/.cjs`？
6. 为什么 ES 库压缩必须保留 pure annotations？
7. BuildEnvironment 怎样进入传统 Rollup/Rolldown plugin hook？
8. `viteMetadata` 为什么放在外置 Map，而不是只写 chunk 对象？
9. watch 重建为何要重置 metadata 和重新准备 outDir？
10. 多 Environment 为什么默认重新解析配置并创建插件实例？
11. sharedConfigBuild 与 sharedPlugins 分别共享什么？
12. `buildApp` hook 与默认“构建全部环境”的顺序是什么？

## 推荐阅读顺序

1. `BuildEnvironmentOptions` 与 `resolveBuildEnvironmentOptions()`。
2. `resolveBuildPlugins()`，只看构建插件前后顺序。
3. 旧 `build()` API，再进入 `createBuilder()`。
4. `resolveRolldownOptions()`：入口、平台、插件、output。
5. `resolveBuildOutputs()` 与 `resolveLibFilename()`。
6. `buildEnvironment()` 的 watch 和一次性分支。
7. `injectEnvironmentToHooks()` 与四类 wrapper。
8. `ChunkMetadataMap` 与 `injectChunkMetadata()`。
9. `toOutputFilePathInJS/WithoutRuntime()`。
10. `prepareOutDirPlugin()`。
11. 最后读 `createBuilder()` 的共享配置/插件策略。

## 两层 API

### `build()`：兼容单环境入口

```ts
const builder = await createBuilder(inlineConfig, true)
const environment = Object.values(builder.environments)[0]
return builder.build(environment)
```

它保留传统 Vite Build API：只建立 client 或 ssr 环境，返回一个 output、output 数组或 watcher。
`true` 表示使用 legacy Builder 兼容路径。

### `createBuilder()`：多环境编排器

Builder 暴露：

- `environments`：已初始化的 BuildEnvironment；
- `build(environment)`：构建指定环境并标记 `isBuilt`；
- `buildApp()`：让插件和框架决定构建顺序；
- `runDevTools()`：可选构建工具集成。

Environment API 引入 Builder 的演进见
[PR #18432](https://github.com/vitejs/vite/pull/18432)，`buildApp` hook 见
[PR #19971](https://github.com/vitejs/vite/pull/19971)。

## Build 配置归一化

`resolveBuildEnvironmentOptions()` 不只是填默认值。它把多个历史形态归一成后续可直接消费的协议。

### 与环境相关的默认值

| 配置          | client               | server / SSR   | bundled-dev    |
| ------------- | -------------------- | -------------- | -------------- |
| platform      | browser              | node           | 按 consumer    |
| minify        | oxc                  | false          | false          |
| emitAssets    | true                 | false          | 按 consumer    |
| cssCodeSplit  | 非 lib 时 true       | 非 lib 时 true | 非 lib 时 true |
| cssMinify     | 跟随 build.minify    | lightningcss   | 跟随规则       |
| modulePreload | `{ polyfill: true }` | 配置仍归一化   | 配置仍归一化   |

SSR target=webworker 是例外：platform 使用 browser；若 external 中残留 CJS require，再追加
`esmExternalRequirePlugin()`，因为 worker 运行时没有 Node `createRequire`。对应修复见
[PR #21963](https://github.com/vitejs/vite/pull/21963)。

### 特殊值

- `baseline-widely-available` 展开成固定浏览器 target 数组；默认 target 更新见
  [PR #21193](https://github.com/vitejs/vite/pull/21193)；
- target 数组去重，因为 Oxc 不接受重复值；
- 字符串 `'false'` 归一成布尔 false，`minify: true` 归一成 oxc；
- `modulePreload` 最终只有 false 或完整对象；
- 旧 rollupOptions 与新 rolldownOptions 通过 getter 保持兼容。

对象展开会把 getter 求值成普通数据属性，所以 resolved 对象上必须再次建立兼容访问器。相关修复见
[PR #22691](https://github.com/vitejs/vite/pull/22691)。

顶层 input 可补给缺少 entry 的 `build.lib`，但必须复制 lib 对象，不能修改用户配置；回归见
[PR #23135](https://github.com/vitejs/vite/pull/23135)。

## 构建专用插件顺序

`resolveBuildPlugins()` 返回 pre/post 两组：

```text
pre
├─ prepareOutDir（正式 build，且非 worker）
├─ build.rolldownOptions.plugins
└─ webWorkerPost（worker 构建）

post
├─ buildImportAnalysis
├─ esbuild final transform（选择 esbuild minify 时）
├─ terser
├─ license / manifest / ssrManifest / reporter（非 worker）
└─ native load fallback
```

用户放进 `build.rolldownOptions.plugins` 的插件也需要 `perEnvironmentPlugin`：它们只有在正式 build 或
bundled 环境中展开，且读取当前环境的 build 配置。

## 入口优先级

`resolveRolldownOptions()` 的入口决策：

```text
库模式：
rolldownOptions.input
→ build.lib.entry
→ resolveBuildEnvironmentOptions 已从顶层 input 补入的 lib.entry

非库模式：
build.ssr 字符串入口
→ rolldownOptions.input
→ 顶层 input
→ root/index.html
```

顶层 input 是较新的统一选项，见
[PR #22642](https://github.com/vitejs/vite/pull/22642)；让插件参与顶层 input 解析的回归见
[PR #23101](https://github.com/vitejs/vite/pull/23101)。

边界校验：

- SSR 入口不能是 HTML；服务端需要明确模块入口；
- `cssCodeSplit=false` 时不能把 CSS 本身列为 input；单 CSS bundle 需要由 JS/HTML 图聚合；
- lib 已启用却仍无 entry 时立即报错。

## Rolldown 输入配置

Vite 主要覆写：

- `preserveEntrySignatures`：SSR=`allow-extension`，lib=`strict`，应用=false；
- plugins：全部经 Environment wrapper；
- onLog：进入 Vite 日志适配；
- transform.target：build target；
- define：禁止 Rolldown 重复替换 NODE_ENV；
- `.css` 暂按 JS 模块代理；
- experimental.viteMode=true；
- chunkImportMap：按当前环境配置并注入 baseUrl。

用户 rolldownOptions 在内部默认值之后展开，但 Vite 会对 input、plugins、onLog 等关键协议再明确设值。

## Output 与库模式

### format 展开

`resolveBuildOutputs()`：

| lib 入口 | 未指定 formats 的默认值 |
| -------- | ----------------------- |
| 单入口   | es + umd                |
| 多入口   | es + cjs                |

UMD/IIFE 需要唯一入口和 `name`，否则无法生成单一全局变量。用户若显式提供 output 数组，该数组完全决定
格式，`lib.formats` 只给出忽略警告。

### 文件扩展名

`resolveOutputJsExtension()` 同时观察 package.json `type` 与 output format：

| package type | ES output | CJS/UMD output |
| ------------ | --------- | -------------- |
| module       | `.js`     | `.cjs`         |
| commonjs     | `.mjs`    | `.js`          |

这样 Node 不会按包级默认类型误读文件。库入口文件名优先级：用户函数 → 用户字符串 → package name（单字符串
入口）→ entry alias。

### 默认文件名

```text
应用 entry/chunk/asset → assets/[name]-[hash].ext
SSR entry              → [name].mjs/js/cjs
库 entry               → resolveLibFilename()
库 chunk               → [name]-[hash].ext
库 asset               → [name].[ext]
```

## 压缩与 ES 库纯标注

ES 库是给下游打包器消费的中间产物。若压缩空白时删除 `/* @__PURE__ */`，下游无法 tree-shake 构造调用，
所以 Vite：

- comments.annotation 在 ES lib 下保持；
- Oxc 只 compress/mangle，不执行 codegen whitespace minify；
- esbuild/Terser 分支也采用相同原则（14B 详述）。

相关修复见 [PR #21740](https://github.com/vitejs/vite/pull/21740) 与
[PR #20522](https://github.com/vitejs/vite/pull/20522)。

## `buildEnvironment()`

### 一次性构建

```text
创建 ChunkMetadataMap
→ resolveRolldownOptions
→ rolldown(options)
→ 对每个 output 调 write 或 generate
→ 给最终 output 回填 viteMetadata
→ 输出耗时
→ finally bundle.close()
```

`write=false` 仍执行完整输出生成，只是不写磁盘，适合框架读取内存产物。

### Watch 构建

watch 分支：

1. 解析所有 output dirs 与 emptyOutDir；
2. 把旧 Chokidar 选项转换为 Rolldown watcher；
3. BUNDLE_START 清除本轮 metadata reset 标记；
4. BUNDLE_END 关闭 event.result 并报告耗时；
5. ERROR 增强错误并输出。

watch 选项完整转发修复见
[PR #20674](https://github.com/vitejs/vite/pull/20674)，watch 重建重新清理 outDir 见
[PR #22207](https://github.com/vitejs/vite/pull/22207)。

## Environment 怎样进入插件 Hook

Rolldown 调用标准 hook 时不知道 Vite Environment。`injectEnvironmentToHooks()` 克隆插件并包装：

```text
resolveId/load/transform
→ context.environment = 当前 Environment
→ options.ssr = consumer === server（兼容旧 API）

renderChunk/augmentChunkHash/generateBundle/writeBundle
→ 注入 Environment
→ 同步 viteMetadata
```

插件可能是 class 实例，克隆时必须保留原型。对象式 hook 还带 `filter/order`；sharedPlugins 下同一原 hook
会产生多个环境 wrapper，`wrappedHookMap` 让后续 filter/order 赋值同步到全部副本。每环境独立 hook 对象的
修复见 [PR #21472](https://github.com/vitejs/vite/pull/21472)。

旧 options.ssr 正在走向废弃。启用 future deprecation 时，它被定义成 getter：只有插件真的读取才报警，
不会让未使用旧参数的插件产生噪声。实现背景见
[PR #20433](https://github.com/vitejs/vite/pull/20433)。

## ChunkMetadataMap

Vite 插件需要给 chunk/asset 追加：

- `importedCss`；
- `importedAssets`；
- 暂时共享的 modules 对象。

这些数据被 CSS、manifest、SSR manifest、preload 等多个插件跨 hook 使用。Rolldown 在不同阶段可能给出
不同 chunk 对象，因此用 preliminaryFileName/fileName 作为 key 放入外置 Map，再用 defineProperty 把同一
metadata 挂回对象。

使用 defineProperty 而非赋值，是为了不被 Rolldown 误判为输出发生修改。metadata 的枚举性和 build 返回值
修复可沿 [PR #261](https://github.com/vitejs/vite/pull/261)、
[PR #262](https://github.com/vitejs/vite/pull/262) 阅读。

watch 模式每轮第一次 renderChunk 重置该 chunk metadata，防止旧 CSS/asset 集合残留；修复见
[PR #342](https://github.com/vitejs/vite/pull/342)。

## 构建 URL 运行时

资源插件只知道最终 filename 后，统一调用：

- `toOutputFilePathInJS()`：允许返回 runtime 表达式；
- `toOutputFilePathWithoutRuntime()`：CSS/HTML 只能接受字符串；
- `createToImportMetaURLBasedRelativeRuntime()`：按 format 生成相对 URL 代码。

相对 base 的运行时机制：

| format      | 基准                                            |
| ----------- | ----------------------------------------------- |
| es          | `import.meta.url`                               |
| cjs         | Node `__dirname` 或浏览器 currentScript/baseURI |
| iife        | currentScript/baseURI                           |
| umd         | Node、location、document 三路兼容               |
| worker-iife | `self.location.href`                            |

`experimental.renderBuiltUrl` 可直接返回字符串、要求 relative，或为 JS 返回 runtime 表达式。CSS/HTML 无法
嵌入任意 JS，收到 runtime 时必须报错。

文档基准 URL 构造还需防 DOM Clobbering，相关修复见
[PR #18115](https://github.com/vitejs/vite/pull/18115)。

## 输出目录准备

`prepareOutDirPlugin` 在每个环境首次 renderStart：

1. 汇总所有 output dir；
2. 解析 emptyOutDir 安全默认值；
3. 清空目录，但保留 `.git` 与嵌套的其他 output dir；
4. 检查 publicDir/outDir 是否重叠；
5. 把 publicDir 复制到每个输出目录。

worker 子构建不运行它，避免嵌套构建清空主输出，修复见
[PR #20556](https://github.com/vitejs/vite/pull/20556)。

Vite Task 会追踪读写输入；emptyDir 对目录的枚举不是真正构建输入，需要 `ignoreInput(outDir)` 排除，集成见
[PR #22453](https://github.com/vitejs/vite/pull/22453)。首轮 write=false 后再次 write=true 仍须复制 public，
回归见 [PR #22328](https://github.com/vitejs/vite/pull/22328)。

## 多 Environment 共享策略

默认：每个环境重新 resolveConfig，并创建新插件实例。原因是构建插件通常假定一个实例一次只处理一个
bundle；开发态才长期并发服务多个 Environment。

| 选项              | 行为                          |
| ----------------- | ----------------------------- |
| sharedConfigBuild | 环境间复用同一 ResolvedConfig |
| sharedPlugins     | 复用首次解析的全部插件实例    |
| sharedDuringBuild | 单个插件主动选择复用          |

即使共享插件，插件也必须通过 `this.environment.config` 读取环境级 minify/chunkImportMap 等配置，不能捕获
顶层 config 的某个环境值。sharedPlugins 下 chunkImportMap 的隔离回归见
[PR #23184](https://github.com/vitejs/vite/pull/23184)。

`buildApp()` 顺序：pre/normal 插件 hooks → `builder.buildApp` → post hooks。若全部自定义逻辑结束后仍没有
任何 Environment 标记为 built，Builder 回退为构建全部环境，保证最小配置有产物。

## 错误与日志

`enhanceRollupError()` 给错误补：插件名、文件/行列、统一 code frame。stack 可能已被读取缓存，所以不能
只改 message，要先剥离旧 message 前缀再显式重建 stack。

`onRollupLog()`：

- 未解析 import 默认升级为错误，`?commonjs-external` 除外；
- 过滤已知循环与动态 import variables 噪声；
- 补 `[plugin name]`；
- 兼容新 onLog 与旧 onwarn；
- 未知 level 至少按 info 输出。

构建日志接入 Environment context 见
[PR #18142](https://github.com/vitejs/vite/pull/18142)，插件名前缀见
[PR #205](https://github.com/vitejs/vite/pull/205)。

## 测试地图

`build.spec.ts` 主要分五组：

1. build 集成：CSS 改动传播 hash、顶层/虚拟 input、manifest 资产归属；
2. resolveBuildOutputs：lib formats、UMD/IIFE 约束、入口优先级；
3. resolveLibFilename：函数/字符串/package name/package type/多入口；
4. Builder：shared config/plugins、per-environment minify、emitAssets、chunkImportMap；
5. 日志、manifest 重建与 publicDir 二次构建。

阅读时优先看注释标出的配置算法和状态回归，不必逐个记忆文件名快照。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/build.ts`，`build()`：

```ts
export async function build(
  inlineConfig: InlineConfig = {},
): Promise<RolldownOutput | RolldownOutput[] | RolldownWatcher> {
  const builder = await createBuilder(inlineConfig, true)
  const environment = Object.values(builder.environments)[0]
  if (!environment) throw new Error('No environment found')
  return builder.build(environment)
}
```

传统 `build()` 已是 Builder 的单 Environment 兼容层：创建 legacy builder、选择首个环境、再委托
真实构建。多 Environment 编排应从 `createBuilder()` 阅读，不能从这个返回值反推完整状态。

## 建议断点

1. `resolveBuildEnvironmentOptions()`：比较 client/ssr/custom 的 resolved 值。
2. `createBuilder()`：观察 sharedConfigBuild=false 时 resolveConfig 次数。
3. `resolveRolldownOptions()`：记录 input、platform、preserveEntrySignatures、outputs。
4. `injectEnvironmentToHooks()`：查看同一插件在两个环境中的 clone/context。
5. `ChunkMetadataMap.reset/get()`：watch 两轮观察集合生命周期。
6. `buildEnvironment()`：对比 write=false、write=true 与 watch。
7. `prepareOutDir()`：多 output dir 时观察 skipDirs。
8. `toOutputFilePathInJS()`：切换 base 与 format 查看 runtime。

## 复盘题

1. 为什么旧 `build()` 只取 Builder 的第一个 Environment？
2. lib entry 从顶层 input 补入时，为何必须复制用户对象？
3. SSR webworker 为什么 platform=browser 却还需要处理 external CJS？
4. UMD/IIFE 为什么不能像 ES/CJS 一样自然支持多入口？
5. package type 与 output format 不匹配时，为何要改变扩展名？
6. ES 库 whitespace minify 会怎样影响下游？
7. 为什么不能给每个 Rolldown chunk 对象各存一份 viteMetadata？
8. 对象式 hook 的 filter/order 为什么需要跨环境 wrapper 同步？
9. sharedPlugins=true 后，插件读取顶层 config 会产生什么错误？
10. write=false 的构建为什么不应永久跳过下一轮 publicDir 复制？
11. CSS/HTML 为什么不能接受 renderBuiltUrl runtime 返回值？
12. buildApp 自定义编排什么情况下会触发默认全环境构建？
