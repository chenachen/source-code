# 03. 插件体系与 PluginContainer

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节只研究“插件如何被选择、排序和调用”，不深入每个内置插件怎样解析/转换模块。后续
模块再分别阅读 resolve、transform、HTML、Import Analysis、CSS 和构建插件。

读完应能回答：

1. Vite 插件与 Rolldown/Rollup 插件是什么关系？
2. `apply`、`enforce`、hook `order`、`applyToEnvironment` 分别在哪一层生效？
3. 为什么开发服务器需要模拟 Rolldown PluginContext？
4. `resolveId`、`load`、`transform` 的停止/传递规则为何不同？
5. `this.resolve({ skipSelf })` 如何避免递归，又不误伤不同子请求？

## 推荐阅读顺序

1. `plugin.ts`：插件输入类型、全局钩子、Environment 钩子。
2. `plugins/index.ts` 的 `resolvePlugins()`：内部/用户插件的整体流水线。
3. `plugins/index.ts` 的 hook 工具：单钩子排序和 filter 缓存。
4. `plugins/pluginFilter.ts`：声明式过滤条件。
5. `server/pluginContainer.ts`：开发服务器如何实际调度 hook。
6. 三份测试：`hooks.spec.ts`、`pluginFilter.spec.ts`、`pluginContainer.spec.ts`。

## Vite 插件与打包器插件

`Plugin` 继承 Rolldown 插件接口，再增加：

```text
应用级生命周期
  config / configEnvironment / configResolved
  configureServer / configurePreviewServer
  transformIndexHtml / buildApp / HMR

选择与排序
  apply / enforce / applyToEnvironment

多环境兼容
  sharedDuringBuild
  perEnvironmentStartEndDuringDev
  perEnvironmentWatchChangeDuringDev

模块 Hook 扩展
  resolveId/load/transform 的 ssr、scan、moduleType、filter
```

生产构建直接由 Rolldown 调用完整插件生命周期。开发服务器不产生 output bundle，因此
只模拟非 output 钩子；`emitFile()`、`setAssetSource()`、`getFileName()` 等方法只能告警。
可以把开发流程理解为创建 bundle，但从不调用 `bundle.generate()`。

## 应用插件与 Environment 插件

应用插件参与整个 Vite 实例的生命周期，能声明 config、server 等全局钩子。

Environment 插件由 `applyToEnvironment(environment)` 派生：

```text
返回 true
  复用当前顶层插件

返回 false/null/undefined
  当前 Environment 排除该插件

返回 PluginOption
  异步展平后，用一组 Environment 专属插件替换
```

Environment 插件在配置、Server/Builder 已解析后创建，适合读取环境配置并维护独立缓存；
不应再声明 config、configResolved、configureServer 等应用钩子。

`perEnvironmentPlugin(name, factory)` 只是一个轻量占位插件，核心就是把 factory 放进
`applyToEnvironment`。该模型由
[PR #18544](https://github.com/vitejs/vite/pull/18544) 扩展；内部插件逐步迁移见
[PR #19588](https://github.com/vitejs/vite/pull/19588)。

`applyToEnvironment` 放在 `configResolved` 后执行，因为生态插件会在 configResolved 中
修改插件/配置，Environment 工厂必须观察最终状态（
[issue #20170](https://github.com/vitejs/vite/issues/20170)）。

## 三层选择与两层排序

不要混淆四个字段：

| 字段                 | 决定什么                                  | 发生时间                      |
| -------------------- | ----------------------------------------- | ----------------------------- |
| `apply`              | 整个插件是否用于 serve/build              | 配置文件加载后、config 钩子前 |
| `enforce`            | 插件放入整体流水线的 pre/normal/post 层级 | 用户插件初次排序              |
| hook `order`         | 某一个 hook 内的 pre/normal/post          | 查询该 hook 时                |
| `applyToEnvironment` | 插件是否/如何用于某个 Environment         | configResolved 后             |

### 整体插件流水线

`resolvePlugins()` 大致装配：

```text
optimized deps / package watcher / pre-alias / alias
→ 用户 enforce:pre
→ Vite 核心 resolve、CSS、Oxc、JSON、Worker、Asset
→ 用户 normal
→ define、CSS post、HTML、URL、build pre
→ 用户 enforce:post
→ build post、DevTools
→ client injection、CSS analysis、import analysis
```

最后三个服务器分析插件必须看到前面所有转换后的最终代码，所以固定在尾部。

若任一 Environment 使用 `isBundled`，serve 也要装配 build 插件。Worker 不安装主应用
package watcher/DevTools，并为每次子构建创建独立插件实例。

### 单个 hook 排序

同一插件可以让 transform 是 pre、load 是 post：

```ts
{
  transform: { order: 'pre', handler() {} },
  load: { order: 'post', handler() {} },
}
```

所以排序不能只做一次。`createPluginHookUtils()` 为每个 hook 首次查询时单独排序并缓存。
`getSortedPluginsByHook()` 用 pre/normal/post 三个插入边界，在一个数组中稳定排序，避免每
个 hook 创建三份临时数组。

## 声明式 Hook Filter

`resolveId`、`load`、`transform` 的对象 hook 可以把廉价过滤条件交给容器：

```ts
transform: {
  filter: {
    id: { include: '**/*.js', exclude: '**/vendor/**' },
    code: 'import.meta',
    moduleType: ['js'],
  },
  handler(code, id) {},
}
```

语义：

- ID 字符串是 glob；相对 glob 以 cwd 为根，Windows 路径先转 `/`。
- code 字符串是字面子串，不是 glob；也可用正则。
- exclude 优先于 include。
- 未声明 include 时，所有未被 exclude 的输入通过。
- transform 的 ID、code、moduleType 三组条件采用短路 AND。
- 全局/粘滞正则每次匹配后复位 `lastIndex`，避免同一正则交替成功/失败。

过滤器按插件对象放入 WeakMap。缓存值即使是 `undefined` 也要记录，否则“没有 filter”的
普通插件反而会在每次请求中重复解析配置。

Hook filter 由 [PR #19602](https://github.com/vitejs/vite/pull/19602) 引入，与 pluginutils
行为对齐见 [PR #19736](https://github.com/vitejs/vite/pull/19736)。

## 开发态 PluginContainer

每个 Environment 有自己的 `EnvironmentPluginContainer`：

```text
createEnvironmentPluginContainer(environment, plugins)
  ├─ 创建容器与 hook 排序缓存
  ├─ 运行并缓存 options
  └─ 返回 Environment 专属容器

首次模块请求
  ├─ 惰性 buildStart（并发请求共享 Promise）
  ├─ resolveId
  ├─ load
  └─ transform

关闭
  ├─ 阻止新的可恢复请求
  ├─ 等待全部在途 hook settle
  ├─ buildEnd
  └─ closeBundle
```

同一 Environment 仍可建立多条插件流水线，因此 factory 显式接收 plugins，不强制读取
`environment.plugins`。内部 `createIdResolver()` 就需要一条精简解析管线。

### Hook 调度规则

| Hook                                          | 调度           | 返回值                           |
| --------------------------------------------- | -------------- | -------------------------------- |
| `options`                                     | 串行、缓存     | 后一插件接收前一结果             |
| `buildStart/watchChange/buildEnd/closeBundle` | 并行批次       | 忽略                             |
| `resolveId`                                   | 串行 hookFirst | 第一个非空结果终止               |
| `load`                                        | 串行 hookFirst | 第一个非 null/undefined 结果终止 |
| `transform`                                   | 串行全部执行   | code/map/moduleType 传给下一插件 |

并行 hook 可声明 `sequential: true`。容器先等待当前并行批次清空，独占执行该插件，再开启
下一批次；它相当于并行流水线中的 barrier。

关闭容器用 `Promise.allSettled()` 等待在途 hook，一个任务失败也不能跳过其他插件清理。
服务器重启时，可恢复 Environment 的旧 resolve/load/transform 请求抛
`ERR_CLOSED_SERVER`；transform 中间件映射为 504，让浏览器重试，而不是显示编译错误。

## PluginContext 层级

```text
BasicMinimalPluginContext
  日志、meta、error
  │
  └─ MinimalPluginContext
       + environment
       │
       └─ PluginContext
            + 当前 plugin/id/code
            + fs / parse / resolve / load
            + ModuleInfo / watch files
            │
            ├─ ResolveIdContext
            ├─ LoadPluginContext
            │    + 当前模块 addWatchFile 集合
            └─ TransformPluginContext
                 + originalCode / sourcemapChain
```

config/configEnvironment 发生得太早，没有 watchMode/Environment。configResolved 等全局钩子
仍没有单一当前 Environment。resolveId/load/transform 等模块钩子才通过
`this.environment` 获得准确归属。

`hooks.spec.ts` 用同一个插件跨 config、server、HTML、HMR、transform 的 serve/build
路径验证上下文形状和 watchMode 差异。

## `this.resolve()` 与递归跳过

错误的简化模型是“skipSelf 就把当前插件永久放入 skip Set”。真实场景：

```text
p1 处理 foo
→ p1 this.resolve(foo)             应跳过 p1，防直接递归

p2 处理 foo
→ p2 this.resolve(foo/modified)
→ p1 可以处理 foo/modified         不应因之前出现过 p1 而跳过
```

所以容器跟踪 `(plugin, id, importer)` 三元组。只有同一调用链再次遇到相同三元组才跳过；
不同 ID 或 importer 仍能进入当前插件。该修复来自
[PR #18903](https://github.com/vitejs/vite/pull/18903)。

`resolveId()` 是 hookFirst；返回 string 会转为 `{ id }`，普通磁盘路径规范化为 `/`，外部
URL 和 `\0` 虚拟 ID 保持原样。

## `this.load()` 与 ModuleInfo

插件在 transform 中调用 `this.load({ id })` 时，目标模块可能还没经过浏览器请求：

```text
ensureEntryFromUrl
→ 更新已支持的 ModuleInfo
→ container.load(id)
→ container.transform(code, id)
→ 返回最终 ModuleInfo
```

必须运行 transform；否则调用方得到 load meta 而不是最终 meta。能力与修复分别见
[PR #11469](https://github.com/vitejs/vite/pull/11469) 和
[PR #14965](https://github.com/vitejs/vite/pull/14965)。

开发模块图只实现一部分 Rollup ModuleInfo。Proxy 对未知字段抛明确错误，但对 `then` 返回
undefined，避免 async 函数把 ModuleInfo 当 thenable。

旧 `server.pluginContainer.getModuleInfo()` 需要合并 client 与 ssr：普通字段 client 优先，
meta 先合并 ssr 再由 client 覆盖。否则生态插件从旧入口会丢掉一个环境的元数据，见
[PR #18895](https://github.com/vitejs/vite/pull/18895)。

## Oxc：同一插件的 JS/native 双路径

`oxcPlugin()` 是理解 `applyToEnvironment` 的具体样本：

```text
unbundled Environment
→ JS transform hook
→ filter(id / cleanUrl(id) / refresh filter)
→ transformWithOxc()

bundled Environment
→ applyToEnvironment 返回 Rolldown nativeTransformPlugin
→ Rust/native 路径直接并入 bundler
```

两条路径共享 include/exclude、JSX refresh 与 sourcemap 语义，但 native 路径避免 JS hook 和 bundler
重复解析 AST。

### 文件语言与 tsconfig

`transformWithOxc()` 优先使用显式 `options.lang`，否则从 id 推断：

- `.cjs/.mjs` → js；
- `.cts/.mts` → ts；
- 有效尾扩展直接使用，适配 Vue block 等虚拟 id；
- 普通 query URL 先 cleanUrl 再取扩展名。

Oxc 返回它解析过的 tsconfigFilePaths；dev server 把每个路径加入 watcher。若只在首次 transform 读取
tsconfig，却不监听它，修改 JSX/class fields/decorator 配置后模块不会重新转换。为减少重复解析，Vite
复用 tsconfig resolution cache；相关优化见
[PR #21643](https://github.com/vitejs/vite/pull/21643)。

### JSX refresh 过滤

即使 JSX options 开启 refresh，以下情况仍关闭：

- server consumer；
- 用户 refresh filter 排除；
- 文件不是 JSX，代码也没有导入 jsx-runtime/jsx-dev-runtime。

这与 `@vitejs/plugin-react` 的边界对齐，避免普通模块注入 refresh runtime。用户若显式让非标准扩展进入
jsxRefreshInclude，插件把 language 强制为 js，否则 Oxc 会把未知扩展误作语言名。

旧 `jsxInject` 只加到 JSX/TSX 输出前，并插入分号防止 ASI 粘连。JSX runtime helper 始终走 ESM Oxc
runtime，见 [PR #21829](https://github.com/vitejs/vite/pull/21829)。

### 诊断归一化

Oxc/Rolldown 可一次返回多个错误。Vite 最多把前 5 项的 plugin/id/loc/frame/stack/cause 拼进 wrapper
message；原始 errors 通过 getter 暴露，避免 console.error 在已打印 summary 后再次展开全部细节。
`UNSUPPORTED_TSCONFIG_OPTION` 按 message 跨模块去重，其他 warning 仍逐次进入插件 logger。

### esbuild 兼容迁移

`convertEsbuildConfigToOxcConfig()` 只迁移仍有对应语义的 JSX、define 与过滤选项。特别注意：

```text
esbuild.jsxSideEffects = true
→ JSX 有副作用
→ Oxc jsx.pure = false
```

两个布尔值必须取反；相关回归见 [PR #22809](https://github.com/vitejs/vite/pull/22809)。banner/footer 不
属于 Oxc 语法配置，由兼容插件处理并警告用户迁移到 transform hook。

`plugins/oxc.spec.ts` 最值得读的是 useDefineForClassFields 矩阵：tsconfig target 决定 class field 语义，
Oxc 输出 target 只决定是否降级，不能反向覆盖 TypeScript 语义。

## 错误与 Source Map

PluginContext 把插件错误统一补成：

```text
plugin + id + loc + frame + pluginCode
```

兼容 `pos`、`position`、`loc`、`line/column` 多种生态格式；CSS 预处理器若把 loc 指向
include 文件，会读取真实文件生成 frame。transform 错误再通过组合 Source Map 回溯到
原始源码位置。

Source Map 采用惰性链式合并：

- `{ mappings: '' }` 是有效空映射哨兵。
- 无 `version` 的其他对象表示插件使 Map 失效。
- MagicString 未传 filename 时可能生成 `sources: ['']` 或 `[null]`；Vite 修复为当前模块
  ID 和原始源码，历史问题见 [issue #13657](https://github.com/vitejs/vite/issues/13657)。
- 没有可用 Map 时，`getCombinedSourcemap()` 为原始源码生成高精度回退 Map。

## 测试阅读重点

- `plugins/hooks.spec.ts`：各生命周期上下文、watchMode、Environment、watchChange 错误。
- `plugins/index.spec.ts`：同一 filter 在 Dev Container 与 Rolldown build 中行为一致。
- `plugins/pluginFilter.spec.ts`：include/exclude、glob/正则、Windows、三条件 AND。
- `server/__tests__/pluginContainer.spec.ts`：meta 传播、`this.load()`、Source Map、skipSelf。

`watchChange` 的异步 rejection 必须被 watcher 入口捕获并记录，不能形成未处理 Promise；
相关修复见 [PR #22188](https://github.com/vitejs/vite/pull/22188)。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/index.ts`，
`getSortedPluginsByHook()`：

```ts
let pre = 0,
  normal = 0,
  post = 0
for (const plugin of plugins) {
  const hook = plugin[hookName]
  if (hook) {
    if (typeof hook === 'object') {
      if (hook.order === 'pre') {
        sortedPlugins.splice(pre++, 0, plugin)
        continue
      }
      if (hook.order === 'post') {
        sortedPlugins.splice(pre + normal + post++, 0, plugin)
        continue
      }
    }
    sortedPlugins.splice(pre + normal++, 0, plugin)
  }
}
```

三个插入边界同时保证 `pre → normal → post` 与组内稳定顺序。排序按 `hookName` 执行，正是同一
插件不同 hook 可以拥有不同顺序的实现依据。

## 推荐断点

1. `resolvePlugins()` 返回数组：观察用户插件落在哪两个内部插件之间。
2. `getSortedPluginsByHook()`：给同一插件的 load/transform 设置不同 order。
3. `getCachedFilterForPlugin()`：第二次请求确认不再编译 glob。
4. `EnvironmentPluginContainer.buildStart()`：并发两个首次 transform 请求。
5. `resolveId()` 与 `PluginContext.resolve()`：观察 skipCalls 三元组变化。
6. `PluginContext.load()`：加载浏览器从未请求的辅助模块。
7. `_formatLog()`：让 transform 在生成 Source Map 后按位置抛错。
8. `_getCombinedSourcemap()`：观察每个插件 Map 如何反向组合。

## 复盘题

1. `enforce: 'pre'` 与 `transform: { order: 'pre' }` 有什么不同？
2. 为什么 Environment 插件工厂应在 configResolved 后执行？
3. 为什么 transform filter 必须针对每一轮的当前 code，而不是最初 code？
4. resolveId/load 为什么遇到首个结果停止，transform 为什么不能？
5. `skipSelf` 为什么不能只用 `Set<Plugin>` 实现？
6. 关闭服务器时为什么要先等待在途 hook，再执行 buildEnd/closeBundle？
7. 为什么 MagicString 的空 source 要替换成模块 ID，而不能原样返回？
