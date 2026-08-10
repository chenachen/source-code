# 02B. 配置合并、加载与解析

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读目标

本节回答五个问题：

1. 内联配置、`vite.config.*`、插件返回值和默认值，谁覆盖谁？
2. 为什么 `resolveConfig()` 很长，它实际可以切成哪些阶段？
3. `bundle`、`runner`、`native` 三种配置加载器有什么差别？
4. 顶层兼容配置如何映射到 client、ssr 和自定义 Environment？
5. 为什么 `config` 钩子串行，而 `configResolved` 钩子可以并行？

## 推荐阅读顺序

不要从 `resolveConfig()` 第一行硬读到底。按下面顺序建立概念：

1. `config.ts` 的 `UserConfig`、`InlineConfig`、`ResolvedConfig`：先分清输入与输出。
2. `config.ts` 的 `configDefaults`：确认哪些默认值能静态确定。
3. `utils.ts` 的 `mergeConfigRecursively()`：掌握合并规则和兼容代理。
4. `config.ts` 的 `loadConfigFromFile()`：理解配置文件如何变成 `UserConfig`。
5. `config.ts` 的 `resolveConfig()`：沿六阶段主链阅读。
6. `config.spec.ts`：用具体输入/输出反证自己的理解。

## 四种配置形态

```text
UserConfig
  用户在 vite.config.* 中可写的普通配置

InlineConfig extends UserConfig
  CLI / Node API 额外可写 configFile、configLoader、forceOptimizeDeps

EnvironmentOptions
  client、ssr 或自定义 Environment 的局部覆盖

ResolvedConfig
  路径、默认值、插件、Environment 和兼容字段均已解析的最终快照
```

`defineConfig()` 只提供 TypeScript 推断，运行时原样返回输入。它不会加载 `.env`、不会
合并默认值，也不会提前运行插件。

## 合并优先级

主流程的覆盖关系是：

```text
静态默认值
< vite.config.*
< CLI / Node API inlineConfig
< 插件 config 钩子返回值
< 具体 environments[name] 覆盖
```

mode 单独遵循：

```text
命令默认 mode < 配置文件 mode < inlineConfig.mode（CLI --mode）
```

`mergeConfig(a, b)` 表示 `b` 优先，但不是普通对象扩展：

- `alias`、`assetsInclude`、`noExternal`、`allowedHosts` 等字段使用专门数组规则。
- `build/worker/optimizeDeps` 的 `rollupOptions` 会映射到 `rolldownOptions`。
- `server.hmr` 的连接字段会映射到 `server.ws`，但 `overlay` 不迁移。
- 顶层 `input` 允许专门合并，任意嵌套对象里的同名字段不自动享受该规则。
- 函数式配置不能直接交给 `mergeConfig()`；必须先用 `ConfigEnv` 执行成对象。
- `null`/`undefined` 在普通 merge 中表示忽略；`mergeWithDefaults()` 则保留显式 `null`。

Environment 合并还有一个特殊规则：环境级 `resolve.noExternal` 需要能够用 `undefined`
重置顶层继承值，否则 server 环境无法撤销 client/顶层策略。该场景来自
[PR #20077](https://github.com/vitejs/vite/pull/20077)。

## `resolveConfig()` 六阶段

```text
InlineConfig
  │
  ├─ 1. 旧字段代理、NODE_ENV、配置文件、最终 mode
  ├─ 2. 插件展平 / apply / enforce / config 钩子
  ├─ 3. client + ssr + custom Environment 继承与 configEnvironment
  ├─ 4. .env、root、base、cacheDir、server/build 等派生配置
  ├─ 5. ResolvedConfig、Worker 工厂、Vite 内部插件
  └─ 6. configResolved、Environment 插件、兼容回填、最终校验
       │
       └─ ResolvedConfig
```

### 阶段 1：配置文件与 mode

`NODE_ENV` 在加载配置前就要建立临时值。`@vue/compiler-*` 等依赖可能在配置导入期间读取
它；等配置加载结束再设置已经太晚。

配置文件加载后执行：

```ts
mergeConfig(configFileResult, inlineConfig)
```

因此 CLI/Node API 显式值覆盖文件值。配置文件仍可改变 mode，但 `inlineConfig.mode` 再次
覆盖它。

### 阶段 2：插件配置钩子

插件先异步展平、执行 `apply` 过滤，再按 `enforce` 分为 pre、normal、post。

`config` 钩子必须串行：

```text
插件 A 读取当前配置 → 返回补丁 → 立即合并
                                  ↓
插件 B 读取 A 合并后的配置 → 返回补丁 → 立即合并
```

插件既可以返回新对象，也可以原地修改收到的配置。返回原对象时 Vite 不重复合并。
Rolldown 兼容代理必须在每轮合并后立即可见，否则后续旧插件从 `rollupOptions` 读不到前一
插件写入的 `rolldownOptions`。相关迁移见
[PR #21612](https://github.com/vitejs/vite/pull/21612) 与
[PR #22043](https://github.com/vitejs/vite/pull/22043)。

### 阶段 3：Environment 继承

开发阶段始终准备 client 和 ssr；只有真正调用 SSR 加载能力时才初始化 SSR 优化器。
构建阶段则只在用户显式声明 SSR 时创建 SSR 构建。

顶层字段并非全部无条件继承：

- `input`、完整 `resolve`、`optimizeDeps` 默认只进入 client。
- client 默认 `preTransformRequests: true`，server/custom 默认 `false`。
- 每个 server consumer 重新计算 mainFields/conditions，不能继承 browser 默认值。
- 旧 `ssr.*` 先作为 `environments.ssr` 的低优先级默认值，再把最终结果同步回旧入口。
- `configEnvironment` 对每个环境分别运行，环境对象必须隔离，防止原地修改泄漏。

顶层 input 当前拒绝未转义 glob；真实文件名含 `*` 时写成 `\*`，校验后再反转义。这样
未来支持 glob 时不会改变旧项目含特殊字符路径的语义，见
[PR #22642](https://github.com/vitejs/vite/pull/22642)。

### 阶段 4：派生配置

这一阶段把用户语义转成运行时语义：

- root：绝对化、realpath、路径分隔符规范化。
- env：执行 02A 的 `loadEnv()`，再加入 `BASE_URL/MODE/DEV/PROD`。
- base：serve 和 SSR 不接受相对部署语义；普通 build 可保留 `'./'`。
- cacheDir：最近 package 根的 `node_modules/.vite`；无 package.json 但已有 node_modules 时
  仍使用它；两者都没有才用 root/.vite（
  [PR #21777](https://github.com/vitejs/vite/pull/21777)）。
- publicDir：`false` 或空字符串显式关闭，否则相对 root 解析。
- define 安全检查：把完整 `process.env` 放入 define 可能泄露 token/CI 密钥，命中特征时
  告警（[PR #19517](https://github.com/vitejs/vite/pull/19517)）。

### 阶段 5：ResolvedConfig 与 Worker

Worker 每次子构建都重新调用 `worker.plugins()`，并重新运行 `config`、内部插件解析和
`configResolved`。不能复用主构建插件实例：插件可能缓存上下文，额外 Rolldown 调用会
污染状态；产物后处理插件也未必适合 Worker。

`ResolvedConfig.webSocketToken` 使用 72 位随机值。浏览器页面必须携带该 token 才能连接
本机 HMR WebSocket，避免任意恶意网页监听/干扰开发会话。

### 阶段 6：插件解析与校验

内部插件依赖大部分 ResolvedConfig，所以先用用户插件占位，组装对象后再调用
`resolvePlugins()` 回填。

`configResolved` 钩子读到完整顶层配置，彼此无顺序数据依赖，因此并行执行。生态插件会
在这个钩子里继续修改插件/兼容字段，所以 Environment 插件和若干兼容回填必须放在它
之后。

最后校验 output 的 `assetFileNames` 一致性、互斥实验选项、已删除 SSR CJS 选项，以及
`build.outDir` 是否覆盖 root/父目录。

## 三种配置加载器

| loader   | 执行方式                                  | TS/模块兼容        | 依赖跟踪                         | 适用场景               |
| -------- | ----------------------------------------- | ------------------ | -------------------------------- | ---------------------- |
| `bundle` | Rolldown 打成本地单 chunk，再由 Node 执行 | 最强，默认值       | 收集 chunk moduleIds             | 普通项目、兼容旧配置   |
| `runner` | Vite Module Runner 执行                   | 经过 Runner 转换   | Runner 返回依赖                  | 实验性运行时集成       |
| `native` | 当前 Node/Deno 直接 import                | 完全服从运行时能力 | Vite Task 可跟踪；普通运行时为空 | 原生兼容配置、减少转换 |

显式 `configFile` 相对 cwd 解析；未指定时才在 `configRoot` 中按默认文件名顺序搜索。
函数式默认导出收到 `{ command, mode, isSsrBuild, isPreview }`，可以异步返回，但结果必须
是对象。

### bundle loader 为什么注入文件变量

本地配置依赖打入一个 chunk 后，源码文件原来的作用域消失。Vite 为每个模块注入：

```text
__dirname / __filename
import.meta.url / dirname / filename / resolve / main
```

否则这些值会指向临时 bundle，而不是原始配置文件。相关演进包括
[PR #2780](https://github.com/vitejs/vite/pull/2780)、
[PR #8442](https://github.com/vitejs/vite/pull/8442)、
[PR #20516](https://github.com/vitejs/vite/pull/20516) 和
[PR #20962](https://github.com/vitejs/vite/pull/20962)。

带 hashbang 的配置必须先保留解释器首行，再插入变量。CRLF 和少见行终止符分别由
[PR #21158](https://github.com/vitejs/vite/pull/21158) 与
[PR #23038](https://github.com/vitejs/vite/pull/23038) 覆盖。

### ESM 与 CJS 如何执行 bundle

- ESM：写入唯一 `.mjs` 临时文件、原生 import、finally 删除。Node 优先放在最近的
  `node_modules/.vite-temp`；Deno 放在配置旁，避免 `npm:` import 被 node_modules 的
  Node 模块语义破坏。
- CJS：短暂替换目标扩展名的 `require.extensions` loader，把目标文件 `_compile` 成
  bundle 代码，并清除 require cache。Windows 路径必须使用与 Node loader 一致的
  `realpath` 结果，否则盘符大小写差异使 loader 无法命中（
  [issue #12923](https://github.com/vitejs/vite/issues/12923)）。

### native 迁移告警

bundle loader 能容忍但 native Node ESM 可能拒绝：

- ESM 中使用 `__dirname` / `__filename`。
- 相对 import 省略扩展名或依赖目录 index 补全。
- JSON import 缺少 `with { type: 'json' }`。
- `type: commonjs` 包中的 `.js` 配置使用 ESM 语法。

Vite 在 bundle 加载成功后给出迁移告警，不改变当前行为。能力由
[PR #22850](https://github.com/vitejs/vite/pull/22850) 引入，随后排除虚拟模块误报并允许
显式跳过扫描（[#22979](https://github.com/vitejs/vite/pull/22979)、
[#23000](https://github.com/vitejs/vite/pull/23000)）。

## 测试如何证明行为

`config.spec.ts` 的本模块用例分三组：

1. `mergeConfig`：特殊数组规则、Environment 重置、新旧 Rolldown 字段和 HMR/WS 代理。
2. `resolveConfig`：插件返回/原地修改、input、Environment 继承、对象引用与默认值。
3. `loadConfigFromFile`：默认文件矩阵、依赖导入、文件作用域变量、hashbang、native 告警。

运行：

```bash
pnpm vitest run packages/vite/src/node/__tests__/config.spec.ts -t mergeConfig
pnpm vitest run packages/vite/src/node/__tests__/config.spec.ts -t resolveConfig
pnpm vitest run packages/vite/src/node/__tests__/config.spec.ts -t loadConfigFromFile
```

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/config.ts`，`resolveConfig()`：

```ts
let config = inlineConfig
config.build ??= {}
setupRollupOptionCompat(config.build, 'build')
config.worker ??= {}
setupRollupOptionCompat(config.worker, 'worker')
config.optimizeDeps ??= {}
setupRollupOptionCompat(config.optimizeDeps, 'optimizeDeps')
if (config.ssr) {
  config.ssr.optimizeDeps ??= {}
  setupRollupOptionCompat(config.ssr.optimizeDeps, 'ssr.optimizeDeps')
}
```

解析入口先补齐各配置域并统一兼容字段，之后才加载文件、执行插件钩子和派生
`ResolvedConfig`。这解释了为何下游阶段可把这些对象当作已存在状态，而不重复做空值分支。

## 推荐断点

1. `mergeConfigRecursively()`：观察 `path` 如何选择特殊规则。
2. `loadConfigFromFile()`：比较显式 configFile 与默认发现路径。
3. `runConfigHook()`：观察后一插件读到前一插件的合并结果。
4. `runConfigEnvironmentHook()`：比较 client、ssr、custom 的独立对象。
5. `resolveEnvironmentOptions()`：观察 consumer 如何改变 resolve/dev 默认值。
6. `bundleConfigFile()` 的两个插件：查看第三方依赖 externalize 与文件变量注入。
7. `loadConfigFromBundledFile()`：分别用 `.mts` 和 `.cts` 进入 ESM/CJS 执行分支。
8. `configResolved` 前后：观察用户插件、内部插件与 Environment 插件何时最终确定。

启动时使用 `vite --debug config` 可以打印最终配置；配置很大，建议只在断点旁对比关注
字段，不要把整份输出当作阅读入口。

## 复盘题

1. 为什么 `defineConfig()` 不能提前验证最终配置？
2. 为什么插件 `config` 钩子必须串行，而 `configResolved` 可以并行？
3. 为什么顶层 input 默认只进入 client Environment？
4. 为什么 ESM bundle 需要写临时文件，而 CJS 可以替换 `require.extensions`？
5. native loader 下省略相对 import 扩展名为何会失败，但 bundle loader 可以成功？
6. 为什么 `ResolvedConfig.optimizeDeps` 要与 client Environment 共享同一对象引用？
7. 为什么 Worker 插件必须由函数每次返回新实例？
