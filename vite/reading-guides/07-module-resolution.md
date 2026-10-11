# 07. 模块解析

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节研究一个 import specifier 怎样变成文件 ID、外部模块或 Vite 虚拟 ID。依赖预构建只解释
resolver 与 optimizer 的交接点，完整扫描/打包流程留到第 11 章；模块 ID 得到后怎样 load 和
transform 留到第 08 章。

读完应能回答：

1. 为什么 alias 先于通用 resolve，用户 pre 插件又能在两者之间接管解析？
2. 文件路径解析为什么要保留 query/hash，且对 node_modules 中的 `#` 特判？
3. `exports`、`imports`、mainFields、main、browser 和 index 的优先级是什么？
4. conditions、externalConditions、import/require 怎样共同选择 package export？
5. dedupe、preserveSymlinks 和 package self-reference 分别解决什么？
6. external、noExternal、builtin 和 linked package 如何合成最终 external 判定？
7. PackageCache 为什么不能只用包名或路径做 key？

## 推荐阅读顺序

1. `plugins/index.ts` 中 alias/preAlias/resolve 的装配位置。
2. `plugins/resolve.ts` 的 `EnvironmentResolveOptions` 和 `oxcResolvePlugin()`。
3. 同文件的 `tryFsResolve()`：先掌握文件路径。
4. `tryNodeResolve()`、`resolvePackageEntry()`、`resolveDeepImport()`：再掌握包。
5. `packages.ts`：理解 package.json 定位、sideEffects 与缓存。
6. `external.ts`：理解 server Environment 为什么有时保留运行时 import。
7. `idResolver.ts`、`nodeResolve.ts`：看特殊调用方如何复用精简解析。
8. `resolve.spec.ts`、`external.spec.ts`：从调用顺序、file URL、builtin 和 linked package 复盘。

## 解析不是单个函数

开发态常见的 resolveId 管线是：

```text
preAlias（优化依赖存在时避免过早展开 alias）
→ @rollup/plugin-alias
→ 用户 enforce: 'pre' 插件（可在这里解析 alias 替换结果）
→ modulepreload polyfill 插件（按配置启用）
→ optimizerResolvePlugin（可选开发快路径）
→ Rolldown viteResolvePlugin
   ├─ builtin
   ├─ file URL / absolute / relative / root URL
   ├─ package imports (#alias)
   ├─ bare package / deep import
   ├─ tsconfig paths
   └─ external/noExternal
→ Vite finalize 回调
   ├─ 依赖优化产物 ID
   ├─ browserHash 查询
   └─ warning/debug
```

Vite 8 把主解析器交给 Rolldown 的原生 `viteResolvePlugin`，但 Vite 仍负责 Environment 配置、
package 数据、依赖优化器、日志和结果收尾。阅读时不要把 `plugins/resolve.ts` 误认为从头手写了
所有 resolveId；它既是适配器，也保留一套供特殊场景直接调用的文件/包算法。

alias 先把用户 specifier 映射成目标 specifier，再通过插件容器继续解析目标。用户 pre 插件可以
在通用 resolver 之前接管虚拟模块或自定义路径；未接管的目标才交给原生 resolver。alias 与
resolve 因而有先后关系，但无需相邻。Environment 的 alias 配置可以不同，解析使用当前环境的配置。

## 按 Environment 创建原生 resolver

`oxcResolvePlugin()` 返回两部分：

1. 可选 `optimizerResolvePlugin`：开发态命中已优化依赖；
2. `vite:resolve-builtin`：每个 Environment 派生一份原生 resolver。

原生插件工厂拿到的是 `PartialEnvironment`，而 depsOptimizer 等运行状态只有完整 Environment
拥有。`perEnvironmentOrWorkerPlugin()` 增加一个 `buildStart` 插件，把完整实例按 name 存入表，
再向 resolver 提供惰性 `getEnvironment()`。

`createIdResolver()` 的精简容器不执行 buildStart，所以 warning 回调必须直接使用 partialEnv 的
logger，不能调用 `getEnvironment()`；这个边界由
[PR #22509](https://github.com/vitejs/vite/pull/22509) 修复。

### 配置覆盖顺序

```text
environment.config.resolve
→ resolve plugin 的场景参数
→ createResolver/CSS/scanner 的显式 ResolveOptions 覆盖
```

所以主请求、CSS `@import`、依赖扫描和 Node 便捷 resolver 可以复用同一算法，却选择不同的
`asSrc`、`scan`、`tryIndex`、`tryPrefix`、`idOnly` 等行为。

## 一棵实用的 specifier 决策树

```text
specifier
├─ \0virtual / Vite internal
│  └─ 对应插件处理，普通文件/包解析跳过
├─ data: / http(s):
│  └─ 保持协议语义或 external
├─ file:
│  └─ 转成文件路径，保留 search/hash
├─ /absolute-or-root-url
│  └─ 源码模式按 root/文件协议解析
├─ ./relative / ../relative
│  └─ 相对 importer 目录 → tryFsResolve
├─ #package-import
│  └─ 最近 package.json imports → 再进入主解析
├─ bare package / package/subpath
│  └─ tryNodeResolve
└─ builtin
   └─ 按 Environment builtins 映射为 external 或 browserExternalId
```

实际原生插件还处理 tsconfig paths、browser external 等，但先用这棵树定位大分支，再追细节，
比从 1200 行文件头读到尾有效。

## 文件路径解析

### query/hash 必须与磁盘路径分开

Vite 模块身份包含查询：

```text
/src/data.js
/src/data.js?raw
/src/data.js?worker
```

三者可能读取同一文件，却进入不同插件语义。因此 `tryFsResolve()` 用
`splitFileAndPostfix()` 拆出文件部分，解析成功后原样拼回 postfix。

依赖中存在真实文件名带 `#` 的包（如 es5-ext）。node_modules 路径要额外区分：

```text
foo#bar?query   文件名 foo#bar + query
foo#bar         文件名可能真的含 #
foo?query#hash  # 明确属于 URL postfix
```

用户源码不支持这种含 `#` 文件名，特判只放在 node_modules 分支，避免扩大歧义。

file URL 同样保留 search/hash。`resolve.spec.ts` 证明：同一 file URL 通过直接、虚拟静态和动态
import 都复用一个模块实例；相同 query 复用另一实例，无 query 与有 query 不相等。支持和后缀
修复分别见 [PR #18422](https://github.com/vitejs/vite/pull/18422) 与
[PR #19300](https://github.com/vitejs/vite/pull/19300)。

### `tryCleanFsResolve()` 顺序

```text
1. 原路径就是文件 → 返回
2. JS 输出扩展名回退到 TS 源码
   .js  → .ts / .tsx
   .mjs → .mts
   .cjs → .cts
   .jsx → .tsx
3. 依次追加 resolve.extensions
4. 尝试 tryPrefix + basename（Sass `_partial` 等）
5. 若原路径是目录且 tryIndex
   ├─ package.json entry
   ├─ index + extensions
   └─ tryPrefix + index + extensions
```

JS specifier 解析到 TS 源文件适配了源码写运行时扩展名的规范实践，修复见
[PR #18889](https://github.com/vitejs/vite/pull/18889)。组合扩展名前先检查父目录存在，减少大量
无效 stat。

成功文件默认经过 realpath，再统一为 `/` 分隔符。`preserveSymlinks:true` 保留链接路径；这会
改变包身份、dedupe、sideEffects package 边界和缓存结果，所以它不是只影响日志显示的选项。

## package 定位与 basedir

`tryNodeResolve()` 先从 `pkg/deep/path?query` 提取顶层包名，再选择 basedir：

```text
pkg 在 resolve.dedupe
  → root

importer 是存在的绝对文件（CSS * 标记也接受）
  → dirname(importer)

否则
  → root
```

dedupe 从 root 解析，避免 monorepo/嵌套依赖给 React 等状态型库加载多个实例。

`resolvePackageData()` 支持两类包管理模型：

- Yarn PnP：`pnpapi.resolveToUnqualified()`；
- 传统 node_modules：从 basedir 逐层向上找 `node_modules/pkg/package.json`。

关闭 preserveSymlinks 时 package.json 也 realpath，确保链接包的真实目录成为 package 身份。

### package self-reference

若 importer 最近 package.json 的 name 等于被导入包名，并声明 exports，优先使用当前包数据，
无需先在 node_modules 找自己。这实现 Node package self-reference，见
[PR #16068](https://github.com/vitejs/vite/pull/16068)。

### optional peer dependency

包解析失败不一定应该立即报错。若 importer 所属主包声明：

```json
{
  "peerDependencies": { "optional-lib": "*" },
  "peerDependenciesMeta": { "optional-lib": { "optional": true } }
}
```

Vite 返回 `__vite-optional-peer-dep:<id>:<parent>` 虚拟 ID，使解析阶段可以继续；加载这个占位模块时
再报告缺失依赖。未调用的动态 import 可以保持未加载，静态 import 则会随导入方执行。这种延迟
取决于实际加载路径（[PR #20029](https://github.com/vitejs/vite/pull/20029)）。
`nodeResolveWithVite()` 用于纯 Node 路径解析，不需要这个运行时协议，因此显式关闭特判。

## package 入口优先级

### 包根入口

`resolvePackageEntry()`：

```text
package.json exports['.']（最高）
→ resolve.mainFields 顺序
→ package.json main
→ Node 默认 index.js / index.json / index.node
```

这份 TypeScript 实现中，`exports` 无法解析会抛入口错误，不会改查 mainFields。只有 exports
解析没有返回入口时才继续字段回退。若 mainFields 包含 browser 且 browser 是对象，选定相对入口
还会再次经过 browser map；这里只采用字符串映射，`false` 被 `mapped || entry` 留作原入口，deep
import 的 `false` 才返回 browser external。Sass resolver 把 mainFields 第一项设为 sass 时，
不把不匹配样式扩展名的普通 JS 入口作为结果，而是继续查找目录中的样式入口。

入口字段存在却无法落到文件时抛 `ERR_RESOLVE_PACKAGE_ENTRY_FAIL`。目录解析把这个错误和 `ENOENT`
视为入口探测失败，还能尝试目录 index；其他异常继续上抛。

### deep import

对 `pkg/subpath`：

- 包有 exports：必须按 exports 公开子路径解析；未公开直接报错；
- 包无 exports：可按 browser object 映射，再拼包目录尝试文件；
- browser 映射为 false：返回 `__vite-browser-external`；
- exports 存在时不尝试隐式目录 index，否则会绕过封装边界；
- query/hash 不参与 exports/browser key 匹配，解析后再拼回（[#7098](https://github.com/vitejs/vite/issues/7098)）。

### package imports

`#alias` 由 importer 最近 package.json 的 imports 字段解析。映射结果若以 `.` 开头，先转为相对
importer 的 specifier；若 `path.relative()` 给出普通单词开头，还要补 `./`，否则会被误认成裸包。
该边界修复见 [PR #20973](https://github.com/vitejs/vite/pull/20973)。tsconfig paths 以 `#`
开头也不能被错误截断，见 [PR #22038](https://github.com/vitejs/vite/pull/22038)。

## conditions：同一个包为何解析到不同文件

`resolveExportsOrImports()` 构造条件：

```text
配置 conditions
→ development|production 占位符按 isProduction 展开
→ 追加 import 或 require
```

内部打包/转换使用 `conditions`；外部化后由目标运行时加载的包使用 `externalConditions`。二者
可以不同。例如 Vite 内部 resolver 偏好 module，而 Node 运行时 external 可能命中 default。

PackageCache 的入口键必须包含：

- import/require；
- conditions；
- extensions；
- mainFields；
- deep import key。

否则先发生的解析会污染后续条件。`resolve.spec.ts` 先后交换 Runner import 与
pluginContainer.resolveId，仍分别得到 default/module，验证两条解析路径没有相互污染。这对应
[PR #18302](https://github.com/vitejs/vite/pull/18302) 与
[PR #18332](https://github.com/vitejs/vite/pull/18332) 的顺序无关验证。

## PackageCache 如何减少文件系统读取

PackageCache 同时缓存：

1. `resolvePackageData(pkgName, basedir, preserveSymlinks)`；
2. `findNearestPackageData(basedir)`；
3. 每个 PackageData 内的 entry/deep import 解析。

向上遍历在祖先 basedir 命中缓存后，Vite 会把相同结果回填到原始目录与祖先之间：

```text
/repo/packages/app/src/deep
→ /repo/packages/app/src
→ /repo/packages/app       命中 package.json

把结果同时缓存到 deep、src
```

后续兄弟模块共享 basedir 时不再重复读 fs。

`loadPackageData()` 去除 UTF-8 BOM（[#19000](https://github.com/vitejs/vite/pull/19000)），并把
sideEffects 编译成过滤器。不含 `/` 的 `*.css` 按 webpack 语义扩成 `**/*.css`；空数组必须
表示所有文件无副作用，不能沿用 createFilter 的“空 include 等于全匹配”默认
（[PR #16152](https://github.com/vitejs/vite/pull/16152)）。

workspace/link 包的 package.json 会被 watcher 监听，变化时删除指向同一包目录的全部缓存键；
node_modules 数量大且通常由包管理器维护，不逐包 watch。

## builtin 与 browser external

`resolve.builtins` 属于 Environment：

- server consumer 默认 Node-like builtins，`node:fs` external；
- client 不把 Node builtin 交给浏览器原生加载，而映射到 browserExternalId；
- 自定义运行时可用字符串/正则声明自己的 builtin 协议；
- 一个 Environment 的 builtin 列表不能泄漏到另一个。

若 server Environment 显式清空 builtins 却导入 Node builtin，resolver 会告警后自动 external，
避免把 node:fs 当文件/包解析，同时提醒配置与实际运行时能力不一致
（[PR #19312](https://github.com/vitejs/vite/pull/19312)）。

`resolve.spec.ts` 的 builtin 小矩阵覆盖字符串、正则、清空、默认 client/ssr 和跨 Environment
隔离。

## external/noExternal 判定

外部化意味着构建产物/Module Runner 保留运行时 import，而不是让 Vite load/transform 它。

供 server 加载路径使用的 TypeScript 判定器 `createIsConfiguredAsExternal()` 按以下顺序返回；主
插件的原生 resolver 则直接接收 external/noExternal 配置，不调用这份判定器：

```text
1. external 数组精确命中原始 id → 直接 true
2. external 数组命中顶层包名 → 解析并检查，允许链接包
3. noExternal: true → false；内部接受的 noExternal: false → true
4. noExternal filter 命中包名 → false
5. 其余 → 解析并检查；external:true 允许链接包
```

步骤 2、5 以及无法提取包名的路径会调用 `isExternalizable()`，要求：

- 必须是裸包，不能是相对/绝对/虚拟 ID；
- Node 解析成功；
- 文件无扩展名或为 `.js/.mjs/.cjs`；
- workspace/link 包只有显式 external 才外部化，`external:true` 算显式全量；
- CSS/JSON 等需要 Vite 插件处理，不能保留原生 import。

精确 external 命中和布尔 noExternal 分支直接返回，不执行上述文件检查。例如显式列出
`external:['pkg/theme.css']` 会得到 true；把它写成 `external:['pkg']` 则仍检查实际文件类型。
外围 `createIsExternal()` 先排除相对/绝对路径，再直接接受环境 builtin，最后调用配置判定器。

build 判断嵌套依赖时故意不传 importer：若一个包只从嵌套 node_modules 可解析，从输出 bundle
所在 root 不可解析，外部化只会把问题推到运行时。

最终判定按 Environment 用 WeakMap 缓存；每个判定器再按原始 id 缓存布尔结果。不同
conditions/builtins/external 配置不会串线。`external.spec.ts` 用 workspace fixture 证明链接包
默认参与转换，而 `external:true` 可以明确覆盖。

## 与依赖优化器的交界

开发态 node_modules JS 通常被预构建。resolver 有三种结果：

```text
metadata 已有优化项
  → 返回 optimized dep id

新发现且适合优化
  → registerMissingImport
  → 返回未来优化产物 id

不适合/被 exclude/noDiscovery/特殊 query/依赖内部 import
  → 返回真实文件
  → 可优化 JS 注入 ?v=browserHash
```

优化器重跑期间产物可能还未落盘，`optimizerResolvePlugin` 必须从 URL/metadata 直接识别，不能
依赖普通 fs stat。`parent > nested` metadata 还要用真实 src 包目录区分不同父依赖的同名嵌套包。

`preAlias` 为判断 alias 后的裸包是否已优化，会等待首轮 scan；这是解析与第 11 章依赖预构建
之间最重要的时序耦合。

## 特殊 resolver

### `createIdResolver()`

CSS `@import`、扫描器等只要最终 id，不需要完整模块元数据。它为每个 PartialEnvironment 惰性
创建两条精简插件管线：

```text
alias + Vite resolve（idOnly）
alias only
```

Map key 是 Environment 实例，避免不同 alias/conditions 共享容器。`createBackCompatIdResolver()`
对 client/ssr 继续经过旧 `config.createResolver` 覆盖，兼容 Astro 等历史用法；自定义
Environment 走新模型（[PR #17972](https://github.com/vitejs/vite/pull/17972)）。

### `nodeResolveWithVite()`

它给 `tryNodeResolve()` 固定生产语义：node 条件、运行时支持时追加 module-sync、无
browser/mainFields 偏好、无 optimizer、无 optional peer 协议、无 package cache。它用于获得包
入口文件路径，不处理完整 Vite URL 管线；builtin 不对应磁盘包入口，通常返回 undefined。输出
扩展名仍可能按 Vite 扩展名表回退到 TS，调用方需要决定后续如何加载该文件。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/resolve.ts`，`tryNodeResolve()`：

```ts
const deepMatch = deepImportRE.exec(id)
// 包名不含 query/hash；清理后支持 `normalize.css?inline` 一类裸包资源导入。
const pkgId = deepMatch ? deepMatch[1] || deepMatch[2] : cleanUrl(id)

let basedir: string
if (dedupe.includes(pkgId)) {
  basedir = root
} else if (
  importer &&
  path.isAbsolute(importer) &&
  // CSS 处理会给 importer 追加 `*` 标记；其余绝对 importer 必须真实存在才作为 basedir。
  (importer.endsWith('*') || fs.existsSync(cleanUrl(importer)))
) {
  basedir = path.dirname(importer)
} else {
  basedir = root
}
```

包 ID 先与 deep import 后缀分离；`dedupe` 强制从 root 查找，否则优先以真实 importer 目录为
起点。这个 `basedir` 决定后续 package data、exports 与文件入口解析的搜索空间。

## 建议断点

1. 原生 resolver 的 finalizeBareSpecifier：观察依赖为何优化、跳过或加版本查询。
2. `tryFsResolve()`：用 `/file.js?raw` 和 node_modules 中带 `#` 的路径比较 file/postfix。
3. `tryCleanFsResolve()`：从 `.js` specifier 单步命中 `.ts/.tsx`。
4. `tryNodeResolve()` basedir 选择：比较 dedupe、普通 importer、无 importer。
5. `resolvePackageEntry()`：改变 conditions/mainFields，观察 exports 与 fallback。
6. `resolveDeepImport()`：比较有/无 exports 的目录 index 行为。
7. `getResolveCacheKey()`：交换两组条件解析顺序，观察缓存槽位。
8. `createIsConfiguredAsExternal()`：比较 linked package 默认值和 external:true。

## 复盘题

1. 为什么 query 参与模块身份，却不参与 package exports key 匹配？
2. 为什么 preserveSymlinks 会影响缓存和包身份，而不只是输出路径？
3. exports 存在时，deep import 为什么不能回退目录 index？
4. conditions 与 externalConditions 若共用同一个包入口缓存，会出现什么顺序依赖？
5. workspace 链接包为什么默认不 external？
6. 精确 external、包名 external 和 external:true 对 CSS 子路径的检查有何不同？
7. optimizer 产物未落盘时，resolver 如何仍给浏览器稳定 ID？
