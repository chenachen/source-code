# 11. 依赖预构建

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本章研究开发服务器怎样发现第三方依赖、把它们预构建为浏览器可消费的 ESM、缓存结果，并在运行期
发现漏网依赖时安全换代。它不只是一次打包，而是一套允许“服务器先启动、优化在后台完成、请求按需
等待”的并发状态机。

上游的裸包解析见第 07 章，Import Analysis 怎样把裸包 URL 指向优化产物见第 10 章。本章重点是：

```text
扫描/真实 crawl 发现依赖
→ 建立 discovered 元数据与 processing Promise
→ Rolldown 在唯一临时目录预构建
→ 比较 hash、fileHash、needsInterop
→ 原子提交，或丢弃结果后合并重跑
→ 必要时使模块图失效并 full reload
```

读完应能回答：

1. 依赖预构建同时解决了 CJS 兼容和请求数量的什么问题？
2. scanner 与浏览器触发的真实模块 crawl 为什么要并行运行、最后再比较？
3. `optimized`、`discovered`、`chunks` 分别代表什么状态？
4. 依赖文件还未落盘时，Import Analysis 为什么已经能返回优化 URL？
5. `hash`、`browserHash`、`fileHash` 各自保护哪一层一致性？
6. 什么情况下新增一个依赖可以无感提交，什么情况下必须 full reload？
7. 为什么打包期间又发现依赖时，有时要直接丢弃已经完成的候选结果？
8. 正式缓存目录为什么用两次 rename 换代，而不是先删除再复制？
9. `preAliasPlugin` 和 `optimizedDepsPlugin` 怎样把异步优化接入普通 resolve/load？
10. `holdUntilCrawlEnd` 用首屏等待换取了什么稳定性？

## 推荐阅读顺序

1. `optimizer/index.ts` 的类型区：`DepsOptimizer`、`OptimizedDepInfo`、`DepOptimizationMetadata`。
2. `plugins/preAlias.ts`：看 alias 后的裸依赖怎样提前命中优化器。
3. `optimizer/scan.ts` 的 `scanImports()`、`computeEntries()`、`rolldownScanPlugin()`。
4. `optimizer/resolve.ts`：看 include 的嵌套语法、glob 与 package exports 边界。
5. `optimizer/optimizer.ts` 的 `createDepsOptimizer()`：先只读 `init()`、`registerMissingImport()`、
   `onCrawlEnd()`。
6. 回到 `optimizer/index.ts` 的 `runOptimizeDeps()` 和 `prepareRolldownOptimizerRun()`。
7. `optimizer/rolldownDepPlugin.ts`：理解入口映射、external、CJS facade 和资源 URL。
8. 再读 `runOptimizer()`：串起批次、提交、重跑与 reload 决策。
9. `plugins/optimizedDeps.ts`：从请求侧观察 `processing`、旧 hash 和缺文件错误。
10. 最后读 scanner、竞态、exports glob、插件兼容四组测试。

不要从 `runOptimizer()` 的所有分支开始硬读。先建立元数据状态和请求等待协议，再看调度分支，复杂度会
明显下降。

## 为什么需要预构建

### 统一模块格式

浏览器原生 ESM 不能直接理解 Node 风格 `require()`、`module.exports`。很多包还是纯 CJS，另一些包同时
出现 ESM 语法与 CJS 导出。优化器让 Rolldown 提前把这些入口整理为 ESM，并记录 `needsInterop`，供
Import Analysis 在必要时补 named/default import 兼容。

### 压缩请求瀑布

一个看似单入口的 ESM 包可能由数百个内部模块组成。开发态逐文件服务会产生大量 HTTP 请求。预构建
把稳定的第三方依赖合并为较少入口和共享 chunk；项目源码仍保持按文件转换，继续享受快速 HMR。

因此预构建边界通常是：

```text
node_modules 中可优化的裸包 → 记录为依赖入口，停止继续扫描包内部源码
linked/workspace package      → 当作项目源码继续 crawl，直到遇到它真正的第三方依赖
CSS/asset/worker/query         → 交给对应 Vite 插件，不进入 JS 依赖预构建
```

## 两条发现路径：预测与校验

### scanner：快速预测

冷启动时 `scanImports()` 创建一个轻量 `ScanEnvironment`，复用插件容器和 resolve 配置，但不允许访问
模块图或完整 server 状态。它计算入口后调用 Rolldown，只做依赖图遍历，不生成正式产物：

```text
optimizeDeps.entries
  优先于顶层 input / build.rolldownOptions.input
  优先于项目内所有 HTML
→ 解析 HTML/SFC 的 script 块
→ 遍历 JS/TS/JSX、import.meta.glob
→ 遇到 node_modules 裸包时登记 id → resolved path，并 externalize
```

结果按 ID 排序。异步解析完成顺序可能每次不同，固定顺序能让依赖集合序列化、browserHash 和日志保持
稳定。

scanner 追求低成本，不追求成为完整编译器。以 Vue `<script setup lang="ts">` 为例，直接转译 TS
可能删除“只在模板使用”的 import；`extractImportPaths()` 因而用轻量正则把静态 import 重新附加为
side-effect import。它允许少量假阴性，因为真实 crawl 会补齐；误识别的候选也会在 resolve 时过滤。

### 真实模块 crawl：运行语义的事实来源

服务器开始处理首个页面后，正常插件管线会转换源码，Import Analysis/resolve 遇到尚未优化的裸依赖时
调用 `registerMissingImport()`。这条路径看到的是插件真实转换后的模块图，所以用于校验 scanner 的预测。

两者并行是冷启动优化：

```text
后台：scanner → 提前开始构建候选优化结果
前台：浏览器请求 → 真实 transform/import crawl
                          ↓
                  waitForRequestsIdle()
                          ↓
             onCrawlEnd() 比较双方依赖全集
```

如果 scanner 没漏依赖且 interop 预测一致，就直接采用已经在后台生成的候选结果；如果真实 crawl 补出
新依赖，则取消候选，把双方并集重打包。这样宁愿首轮多做一次后台工作，也避免浏览器先拿到马上过期的
模块 URL 后再整页刷新。

这套冷启动 scanner 最初见 [PR #8869](https://github.com/vitejs/vite/pull/8869)。

## scanner 怎样处理 HTML、SFC、JSX 与 glob

### HTML/SFC 脚本隔离

扫描器先去掉 HTML 注释，再为每个 `<script>` 块创建独立虚拟模块。不能把多个块简单拼到一个作用域：
Vue/Svelte 可能同时有 module/local script，重复变量会让扫描器误报语法错误。

- 纯 HTML 只收集 `type="module"`。
- Vue/Svelte/Astro 等框架文件允许普通 script。
- Svelte module script 可以重导出；组件实例 script 的 export 通常表示 props，不应 `export *`。
- 虚拟 script resolve 时恢复原 SFC 文件作为 importer，让 alias/相对路径语义与真实编译一致。

### JSX 隐式 runtime

automatic JSX runtime 的 import 是转换器注入的，源文件未必写出 `react/jsx-runtime` 或
`vue/jsx-runtime`。scanner 必须采用依赖优化专用的 JSX transform 配置，否则首个 JSX 请求才发现
runtime，会触发优化器重跑。相关历史修复见
[PR #20495](https://github.com/vitejs/vite/pull/20495)。

### `import.meta.glob`

scanner 在遍历前展开 glob，因此 glob 命中的文件也能贡献依赖。package.json `imports` 子路径模式需要
先解析，不能把 `#alias/*.js` 当普通磁盘 pattern；对应修复见
[PR #22018](https://github.com/vitejs/vite/pull/22018)。

### 入口解析必须复用插件与 root

顶层 `input` 可能是插件提供的虚拟 ID，所以入口也要经过插件容器解析；支持该场景见
[PR #23101](https://github.com/vitejs/vite/pull/23101)。相对
`build.rolldownOptions.input` 必须以项目 root 为基准，而不是 `process.cwd()`；回归修复见
[PR #22769](https://github.com/vitejs/vite/pull/22769)。

服务器在后台扫描期间关闭时，插件容器会用 `ERR_CLOSED_SERVER` 拒绝解析。结果本来就会丢弃，因此这是
取消控制流，不应变成未处理 rejection；见
[PR #22784](https://github.com/vitejs/vite/pull/22784)。

## 显式 include：嵌套依赖、glob 与 exports

`optimizeDeps.include` 不只是普通包名。`createOptimizeDepsIncludeResolver()` 支持：

```text
foo > bar > baz
```

它表示从 `foo` 的安装位置找 `bar`，再从 `bar` 的安装位置解析 `baz`，用于强制优化没有被应用源码直接
导入的嵌套依赖。

include 含 glob 时，`expandGlobIds()` 要尊重 package.json `exports`：

1. 先枚举包公开的 exports key/value；
2. 从 value 的 wildcard 找真实文件；
3. 把捕获值反推回公开子路径；
4. 再用用户 include pattern 过滤；
5. `null` value 表示显式封锁，必须跳过。

不能直接在包目录 glob，否则会绕过 exports 封装边界，把私有文件变成可导入入口。`null` 子路径的
回归修复见 [PR #22611](https://github.com/vitejs/vite/pull/22611)。

`noDiscovery: true` 时 scanner 完全关闭，只优化 include。若 include 也为空，优化器整体禁用；此时纯
CJS 包不会被自动转换，用户需要明确承担配置责任。

## 元数据就是状态机协议

`DepOptimizationMetadata` 不只是写入 `_metadata.json` 的缓存描述，它也是运行时协调对象。

| 区域          | 含义                                               |
| ------------- | -------------------------------------------------- |
| `optimized`   | 已成功打包并提交的入口依赖                         |
| `discovered`  | 已发现、最终文件名已确定，但当前批次尚未提交的入口 |
| `chunks`      | Rolldown 生成的共享 chunk 或依赖内部动态入口       |
| `depInfoList` | 三类对象的统一索引，支持按最终文件路径反查         |

单个 `OptimizedDepInfo` 的关键字段：

```text
id           规范化依赖名
src          真实入口文件
file         最终 deps cache 路径；发现时即可确定
browserHash  浏览器 URL 的 ?v= 版本
fileHash     已提交入口的 imports 图稳定性指纹
needsInterop 输入/输出导出形状是否需要额外兼容
processing   该 discovered 项所属批次的完成 Promise
exportsData  提前启动的入口导出分析 Promise
```

关键设计是“路径先确定，内容后落盘”。`registerMissingImport()` 可以立即把 `file?v=browserHash` 返回给
Import Analysis，但 `optimizedDepsPlugin.load()` 在读文件前等待 `processing`。因此单个请求被精准
阻塞，服务器其他初始化和源码转换不必等待整个依赖打包。

每批新依赖共享一个 `processing` Promise。开始一轮打包时，当前 Promise 被封存进队列，新发现项绑定
下一批 Promise。只有某次真正包含这些依赖的结果提交后，队列才统一 resolve；被丢弃的中间结果不能
提前放行等待请求。

## 三种 hash 各管一层一致性

```text
lockfileHash = 最近 lockfile + 必要时 patch 目录状态
configHash   = 会影响优化输出的 resolve/build/optimizeDeps 配置
hash         = lockfileHash + configHash

browserHash  = hash + 本轮依赖 id/src 集合 + 可选 session timestamp
fileHash     = hash + 入口输出路径 + 该 chunk 的 imports 列表
```

- `hash` 决定磁盘缓存能否跨启动复用。
- `browserHash` 是浏览器 URL 版本，防止旧请求与新优化目录混用。
- `fileHash` 判断新增依赖是否改变旧入口的共享 chunk 图。

若 lockfile/config hash 一致，启动直接复用 `_metadata.json`，跳过扫描与打包。`force` 会无条件清缓存。
空依赖结果也写元数据；否则每次启动空项目都要重复扫描。

配置 hash 只序列化会影响优化结果的字段。函数/正则转字符串，插件只记录名称，避免不可序列化对象让
缓存随机失效。lockfile 搜索优先检查常见包管理器以缩短路径遍历；同时兼容多个新旧 lockfile 格式。

## 初始化与首轮时间线

```text
createDepsOptimizer()
  └─ metadata 先带 session browserHash

init()
  ├─ 尝试复用磁盘 metadata
  ├─ 冷缓存：登记 include
  ├─ waitForRequestsIdle().then(onCrawlEnd)
  └─ scanner → discovered → 后台 runOptimizeDeps 候选

真实请求 transform
  └─ registerMissingImport()
      ├─ 立即建立 file/hash/processing
      └─ 初始化完成且 crawl 已结束后，100ms 去抖重跑

onCrawlEnd()
  ├─ scanner 完整：采用候选
  ├─ scanner 漏项/interop 不符：取消候选，取并集重跑
  └─ 无 scanner：直接优化 crawl/include 结果
```

`initState` 有 `idle → initializing → initialized` 三态。`createServer()` 与 `listen()` 之间也允许用户
主动发起 transform，此时可能早于 `init()` 发现依赖。若立即启动打包，`init()` 随后重置 metadata，
提交阶段就会拿到错配状态。现在 pre-init 只登记 missing，等待 initialized 后再调度；修复见
[PR #22852](https://github.com/vitejs/vite/pull/22852)。

### `holdUntilCrawlEnd`

默认 `true`：scanner 可以提前构建，但候选结果等真实静态 crawl 结束后才发布。优点是首屏几乎不会因
漏依赖改变共享 chunk 而 reload；代价是浏览器更晚拿到优化文件。

设为 `false`：scanner 完成即可提交，浏览器能更早并行请求；若真实 crawl 随后发现新依赖，则进入普通
重跑，旧 `fileHash` 稳定时仍可无感，否则 full reload。这一权衡由
[PR #15244](https://github.com/vitejs/vite/pull/15244) 引入。

## 一轮优化怎样生成并发布

`runOptimizeDeps()` 先创建唯一 processing 目录，并写局部 `package.json` 声明 `type: module`。随后
`prepareRolldownOptimizerRun()`：

1. 等待每个入口的 `exportsData`；
2. 把 `react-dom/client` 一类 ID 扁平化为稳定输出名；
3. 将扁平入口映回 Vite 已解析的真实 src；
4. 合并用户 Rolldown 选项、兼容转换后的 esbuild 插件与内置 dep 插件；
5. 创建可取消、可延后 `build()` 的 Rolldown context。

打包结果把入口写进 `optimized`，非入口写进 `chunks`。入口 `fileHash` 主要取决于 `chunk.imports`；代码
内容变化本身由 lockfile/config hash 和开发重启处理，这里关心的是“旧浏览器模块引用的 chunk 图是否
还成立”。

### 提交前为什么仍可能丢弃结果

`runOptimizer()` 比较新旧结果：

```text
needsInterop 变化
或主 hash 变化
或任一旧入口 fileHash 变化
  → needsReload
```

- 无需 reload：提交目录，但保留浏览器已经使用的旧 browserHash；新依赖可无感加入。
- 需要 reload，且打包期间没有再发现依赖：提交新版本、清模块图、广播 full reload。
- 需要 reload，但打包期间又发现依赖：取消当前结果，立即打包更完整全集，避免连续两次 reload。

最后一种分支最容易漏读：已经花时间打好的结果仍不能发布，因为它一发布就知道还要再次换代。批次
Promise 继续等待，直到真正包含依赖的后续结果提交。

## 原子缓存提交

构建始终写唯一临时目录，失败或取消只删除该目录，不触碰当前正式缓存。成功后先写 `_metadata.json`，
再执行：

```text
正式 deps 目录  → 唯一 backup 目录
processing 目录 → 正式 deps 目录
后台删除 backup
```

相较“删除正式目录，再移动新目录”，两次 rename 把缓存不可用窗口压到最小，也避免请求读到半写文件。
POSIX 使用同步 rename；Windows 的杀毒软件可能短暂锁目录，所以 `safeRename()` 对 EACCES/EPERM 重试，
并验证目标是否已经落地。临时目录换代方案见
[PR #12622](https://github.com/vitejs/vite/pull/12622)。异常退出残留超过 24 小时的临时目录在下次启动
异步清理，不阻塞当前冷启动。

## Rolldown 依赖插件的边界

`rolldownDepPlugin()` 统一把 Vite 的解析语义接入预构建：

- ESM import 和 CJS require 使用不同 resolve 条件与 package cache；
- 入口 ID 必须映回 Vite 预先解析的 src，避免 Rolldown 再选到不同条件入口；
- CSS、WASM、SFC、已知 asset 默认 external；用户声明可优化扩展名可移出该集合；
- `require()` 静态资源先经虚拟 facade 变成 import，再 external；
- browser external 用 Proxy 在访问属性时给出明确兼容警告；
- 相对 `new URL('./asset', import.meta.url)` 要按原依赖文件解析，再改写为相对 deps 输出目录。

资源 `new URL` 的相对位置修复见
[PR #21434](https://github.com/vitejs/vite/pull/21434)。动态模板需要 glob 枚举，仍交给主 asset 插件；优化器
只安全处理可静态确定的相对字面量。

`rolldownCjsExternalPlugin()` 只在 browser 平台把 external require 改成 import facade。Node 原生支持
require，保留语义更准确；neutral 平台无法推断目标运行时能力，也保守跳过。

`pluginConverter.ts` 只实现依赖扫描/预构建需要的 esbuild 插件子集：`onResolve`、`onLoad`、
`onStart`、`onEnd` 与有限 BuildResult。它是迁移兼容层，不代表任意 esbuild 插件都可无损运行在
Rolldown 上。

## alias 与请求侧怎样接入

### `preAliasPlugin`

普通 alias 插件把 `react` 改成某个 replacement 后，后续逻辑可能看不出它原本是裸依赖。
`preAliasPlugin` 提前解析 replacement：

- replacement 已在 optimized/discovered 中：直接返回优化 URL；
- replacement 可优化但尚未登记：调用 `registerMissingImport()`；
- SSR 未显式 include：保守不优化，因为单凭文件路径无法可靠判断 package/CJS 身份。

这个桥接修复了 alias 指向的依赖绕过优化器的问题；历史起点见提交
[`54dab71e4`](https://github.com/vitejs/vite/commit/54dab71e4)。

### `optimizedDepsPlugin`

resolve/load 请求进入优化缓存后按以下顺序检查：

1. URL 的 browserHash 是否仍属于当前元数据；
2. 入口是否仍在 `optimized/discovered/chunks`；
3. 若有 `processing`，等待对应批次提交；
4. 提交后直接读取 cache 文件及可选 sourcemap。

它会区分三类失败：

- 优化过程异常：504，让旧请求停止等待；
- browserHash 已换代：504，浏览器 reload 后请求新 URL；
- 当前优化目录内确实缺文件：404，并提示用户把问题依赖加入 exclude。

默认不容忍旧 URL，因为同一逻辑模块同时出现两种优化版本会产生重复实例。只有显式
`ignoreOutdatedRequests` 才跳过旧 hash 检查。

## 测试怎样映射源码机制

### `scan.spec.ts`

- script 正则组：验证 HTML 注释、组件名中的 `script`、普通 script、TS import 与注释剥离。
- JSX runtime：扫描必须提前发现转换器隐式注入的 runtime，首次 JSX 请求不能触发重跑。
- glob + JSX 配置：依赖优化专用 Rolldown transform 选项优先于环境默认值。
- input：顶层入口、插件虚拟入口、相对 root 的 build input 都进入同一入口解析链。
- mid-scan close：关闭错误被当作取消，不产生未处理 rejection。
- package imports glob：包内展开结果不能误记为待预构建裸依赖。

### optimizer 单元测试

- `discoverBeforeListen.spec.ts`：listen 前 transform 只登记依赖，不得抢跑优化器；对应 #22852。
- `resolve.spec.ts`：exports 中 `null` 私有子路径不被 glob include 暴露；对应 #22611。
- `rolldownDepPlugin.spec.ts`：只重写安全的相对静态 `new URL`，协议 URL、动态模板和
  `@vite-ignore` 保持原样。
- `pluginConverter.spec.ts`：esbuild `onEnd` 收到兼容层承诺的 BuildResult 字段。

阅读测试时不要只看最终 `expect`。先写出“输入处于哪个发现阶段、预期触发哪条状态分支”，再回源码找
状态变化，测试才会成为调用链索引。

## 历史演进线索

按问题演进阅读，比按提交日期更容易理解当前复杂度：

1. 非阻塞预构建与运行期发现建立了 `processing/browserHash` 协议：
   [PR #6758](https://github.com/vitejs/vite/pull/6758)、
   [PR #7379](https://github.com/vitejs/vite/pull/7379)、
   [PR #7568](https://github.com/vitejs/vite/pull/7568)。
2. scanner 改善冷启动，但引入“预测结果 vs 真实 crawl”的协调：
   [PR #8869](https://github.com/vitejs/vite/pull/8869)。
3. 临时目录原子换代解决并发请求读取半成品的问题：
   [PR #12622](https://github.com/vitejs/vite/pull/12622)。
4. `holdUntilCrawlEnd` 把速度/首屏稳定性变成显式策略：
   [PR #15244](https://github.com/vitejs/vite/pull/15244)。
5. Rolldown 迁移后，入口解析、CJS facade、JSX 和资源 URL 继续补齐与旧优化器等价的边界语义。
6. 最近的 pre-init 与关闭竞态说明：优化器最难的部分已不是“打包依赖”，而是异步生命周期所有权：
   [PR #22784](https://github.com/vitejs/vite/pull/22784)、
   [PR #22852](https://github.com/vitejs/vite/pull/22852)。

## 建议断点

第一次只放以下断点：

1. `createDepsOptimizer()` 内 `init()`：看 cache hit 与 cold start 分叉。
2. `scanImports()`：记录 computed entries 和最终 deps。
3. `registerMissingImport()`：观察 scanner 漏项怎样进入 discovered。
4. `onCrawlEnd()`：比较 `crawlDeps` 与 `scanDeps`。
5. `runOptimizer()` 的 `needsReload`：观察 hash/fileHash/interop 判定。
6. `runOptimizeDeps()` 的 `commit()`：看 processing 目录如何换成正式缓存。
7. `optimizedDepsPlugin.load()`：验证请求在哪里等待 processing。

推荐观察变量：

```text
initState
waitingForCrawlEnd
currentlyProcessing
newDepsDiscovered
metadata.optimized / discovered / chunks
depOptimizationProcessingQueue
optimizationResult
needsReload
```

第二轮再打开 `DEBUG=vite:deps` 对照日志。不要一开始在每个 resolve hook 停住，否则 node_modules 的
高频解析会淹没状态机主线。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/optimizer/optimizer.ts`，
`createDepsOptimizer()`：

```ts
let closed = false

const options = environment.config.optimizeDeps

const { noDiscovery, holdUntilCrawlEnd } = options

let metadata: DepOptimizationMetadata = initDepsOptimizerMetadata(
  environment,
  sessionTimestamp,
)

const depsOptimizer: DepsOptimizer = {
  init,
  metadata,
  registerMissingImport,
  run: () => debouncedProcessing(0),
  isOptimizedDepFile: createIsOptimizedDepFile(environment),
  isOptimizedDepUrl: createIsOptimizedDepUrl(environment),
  getOptimizedDepId: (depInfo: OptimizedDepInfo) =>
    `${depInfo.file}?v=${depInfo.browserHash}`,
  close,
  options,
}
```

优化器把 metadata、发现入口、调度、ID 版本化与关闭状态封装为同一个 Environment 私有状态机；
`browserHash` 直接进入浏览器 URL，说明元数据更新会改变客户端缓存身份。

## 复盘题

1. scanner 漏掉依赖时，为什么不一定需要 full reload？
2. 若新一轮加入依赖，但所有旧入口 `fileHash` 都没变，为什么应保留旧 browserHash？
3. `processing` 为什么放在 `OptimizedDepInfo` 上，而不是让整个 Dev Server 等一个全局 Promise？
4. 如果候选结果需要 reload，打包期间又发现新依赖，立即提交会造成什么用户可见行为？
5. 为什么 cache hit 只比较 lockfile/config，而运行期提交还要比较 fileHash/interop？
6. package exports 的 null 子路径若被 include glob 绕过，会破坏什么封装保证？
7. linked package 为什么继续扫描源码，而普通 node_modules 包在裸导入处停止？
8. alias replacement 在 SSR 中为什么比 client 更保守？
9. 双 rename 的哪个瞬间仍可能无正式目录，为什么它比 delete+copy 更安全？
10. 若关闭 `holdUntilCrawlEnd`，你会从哪些日志/hash 变化判断首屏 reload 是 scanner 漏项导致的？

能不看源码画出“scanner 候选、真实 crawl、processing 批次、原子提交、reload 判定”五者关系，才算
真正读懂依赖预构建，而不只是知道 Vite 使用 Rolldown 打包 node_modules。
