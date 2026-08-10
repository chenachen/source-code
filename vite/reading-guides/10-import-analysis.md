# 10. Import Analysis

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本章研究插件初步转换完成后，Vite 怎样理解源码中的 import 语义：先展开
`import.meta.glob`/变量动态 import，再由开发态 Import Analysis 解析 specifier、改写浏览器 URL、
注入 env/HMR runtime，并把依赖边写入 ModuleGraph。

普通 resolve 算法见第 07 章，ModuleGraph/软失效见第 08 章，HMR 更新传播见第 12 章。本章只解释
“源码如何产生正确 URL、依赖边与 HMR 边界”。构建态动态 import preload 由
`importAnalysisBuild.ts` 完成，留到生产构建章节。

读完应能回答：

1. 为什么 `import.meta.glob` 和变量动态 import 必须早于主 Import Analysis？
2. resolved ID 怎样变成 root URL、`/@fs/` 或 `/@id/`？
3. 非 JS/CSS 为何附加 `?import`，CSS 本身为什么不需要？
4. 同一文件里的 import 为什么并行 resolve，却仍用按源码索引的数组收集结果？
5. 字面量动态 import、模板变量 import 和不可分析表达式分别走哪条分支？
6. `@vite-ignore` 抑制了什么，又没有替用户完成什么？
7. `import.meta.hot.accept/acceptExports` 怎样变成模块图边界？
8. optimizer 已把 CJS 转换过，为何 Import Analysis 仍可能补 named import interop？
9. glob 的文件新增/删除为何也能触发 HMR？

## 推荐阅读顺序

1. `plugins/index.ts`：确认 `importGlobPlugin`、`dynamicImportVarsPlugin`、`importAnalysisPlugin` 顺序。
2. `importMetaGlob.ts` 的 `parseImportGlob()` 与 `transformGlobImport()`。
3. `dynamicImportVars.ts` 的 `transformDynamicImport()` 与运行时 helper。
4. `importAnalysis.ts` 文件头的 URL helper 和插件总注释。
5. `transform()` 中 es-module-lexer 解析、`normalizeUrl()` 与并行 import 循环。
6. 同循环的 HMR/env/dynamic import/CJS interop 分支。
7. 循环后的 runtime 注入与 `moduleGraph.updateModuleInfo()`。
8. `transformCjsImport()`：最后单独理解 CJS 兼容，不要让它打断 URL 主线。
9. glob/动态 import/CJS 三组单元测试与 dynamic-import playground。

## 三段式调用链

```text
上游语言/用户插件 transform
→ vite:import-glob
   └─ import.meta.glob('./pages/*.ts') → 对象 + 静态/动态 imports
→ vite:dynamic-import-vars
   └─ import(`./pages/${name}.ts`) → glob 对象 + runtime lookup helper
→ vite:import-analysis（仅 unbundled dev）
   ├─ es-module-lexer 扫描 import/export/import.meta
   ├─ resolve + URL 规范化
   ├─ HMR/env/helper/CJS interop 注入
   └─ updateModuleInfo
```

前两步把可枚举的动态语法变成普通 imports，主分析器才能把每个候选模块写入图。无法枚举的表达式
保留到运行时，并由主分析器选择警告/`?import` helper。

bundled Environment 中 glob 与变量 import 委托 Rolldown 原生插件；unbundled Environment 使用
TypeScript 实现以支持开发态 HMR 文件 matcher。两边目标语义相同，但不要误以为主
`vite:import-analysis` 也在构建时运行。

## `import.meta.glob`：从声明到 imports

输入：

```ts
const pages = import.meta.glob('./pages/*.ts')
```

默认 lazy 输出概念上是：

```ts
const pages = /* #__PURE__ */ Object.assign({
  './pages/a.ts': () => import('./pages/a.ts'),
  './pages/b.ts': () => import('./pages/b.ts'),
})
```

`{ eager:true }` 则在文件头生成静态 import，对象 value 直接引用 namespace/named export。静态形式
可参与 tree-shaking，但会立即加载全部模块；lazy 形式保持按 key 加载。

### parser 为什么要词法定位后再 AST 校验

`stripLiteral()` 先屏蔽字符串/注释中的伪调用，正则快速找到 `import.meta.glob(`；随后只对单个调用
片段做 AST 解析，验证：

- 1–2 个参数；
- pattern 是字符串、无插值模板或它们的数组；
- 第二参数是可静态求值对象；
- option key/type 合法；
- base 以 `/`、`./`、`../` 开始，不能是否定 pattern。

动态变量不能作为 glob 参数，因为 Vite 必须在变换时枚举完整文件集。代码本身若不是合法 JS，glob
快路径不抢先报错，交给后续语言插件/Import Analysis 给出更准确诊断。

寻找闭括号不是简单 `indexOf`：选项对象或表达式中可能有嵌套括号；字符串/注释已经被
stripLiteral 屏蔽，因此计数剩余括号即可。

### pattern、import path 与对象 key

三者身份不同：

```text
globsResolved  tinyglobby 枚举用的绝对 pattern
importPath     生成代码实际 import 的相对 specifier
filePath       暴露给用户作为对象 key 的路径
```

`/` pattern 相对项目 root；`./`/`../` 相对 importer 或显式 base；裸 pattern 可经 alias/package
imports resolver。resolver 返回路径中的 `[`、`(` 等 glob 字符必须转义，但用户声明的 `*` 动态后缀
要保留，所以 `globSafeResolvedPath()` 从末尾找共同后缀，只转义静态前缀。含括号路径的变量 import
相关修复见 [PR #17940](https://github.com/vitejs/vite/pull/17940)。

虚拟模块没有可靠磁盘 dirname，因此相对 glob 无法定义，必须用 root 绝对 pattern 或显式 base。
即使 pattern 当前零命中也必须报错，不能因结果 `{}` 而隐藏非法语义；见
[PR #22497](https://github.com/vitejs/vite/pull/22497)。

### 选项如何改变生成代码

| 选项            | 作用                                        |
| --------------- | ------------------------------------------- |
| `eager`         | 静态 import，而非返回 import() 的函数       |
| `import`        | 只取指定 named/default export               |
| `query`         | 给每个 import specifier 拼资源 query        |
| `base`          | 改变枚举基准和暴露 key，不改变模块真实文件  |
| `exhaustive`    | 包含 dot files/node_modules，不应用默认忽略 |
| `caseSensitive` | 同时控制枚举和开发态 HMR matcher            |

旧 `as:'raw'/'url'` 被规范成 query + default import，并给迁移警告。query 对象先经 stringifyQuery 变
字符串；`importGlobRestoreExtension` 可为 query 补 `lang.<ext>`，让下游插件恢复原扩展名语义。

`Object.keys(import.meta.glob(...))` 不观察 value，因此只生成 key/0 对象，不生成真实 imports；
`Object.values` 则省略 key。这个优化减少扫描与 bundle 体积，同时保持调用结果。

### glob HMR matcher

开发态插件保存：

```text
Environment → importer ID → [matcher, matcher...]
```

文件 create/delete 时不一定已有 ModuleNode，普通文件→节点索引找不到受影响模块。`hotUpdate`
反向用 matcher 检查新/删文件，把声明该 glob 的 importer 加入更新集合。正 pattern、负 pattern、
dot/node_modules、caseSensitive 选项必须与 tinyglobby 枚举完全一致；否则初次结果与 HMR 结果漂移。
数组否定 pattern 修复见 [PR #20872](https://github.com/vitejs/vite/pull/20872)，caseSensitive matcher
对齐见 [PR #22711](https://github.com/vitejs/vite/pull/22711)。

## 变量动态 import：glob + 运行时选择

输入：

```ts
import(`./pages/${name}.ts`)
```

可理解为：

```ts
__variableDynamicImportRuntimeHelper(
  import.meta.glob('./pages/*.ts'),
  `./pages/${name}.ts`,
  3,
)
```

`@rollup/plugin-dynamic-import-vars` 的 `dynamicImportToGlob()` 负责从 AST 推导 pattern。alias/裸路径
先 resolve，再相对 importer 生成 glob 与 raw runtime path。raw/url/worker query 作为 glob option
传递，确保候选模块仍走对应资源插件。

helper 按完整 runtime path 查对象：lazy value 调函数，eager value 包 `Promise.resolve`；未命中在
microtask 中 reject，保持 `import()` 异步失败语义。变量只能表示一层文件名，跨目录未命中时错误
会给出这个限制提示（[PR #16519](https://github.com/vitejs/vite/pull/16519)）。

只有模板字面量进入此插件。普通字面量留给主分析器；普通变量/函数表达式无法枚举，继续保留。
`@vite-ignore` 则明确跳过 glob 转换。

## 主 Import Analysis 的输入与输出

插件只在 unbundled Environment 启用。它先 strip BOM，再由 es-module-lexer 一次得到：

```text
imports：静态 import/export-from、动态 import、import.meta
exports：当前模块导出名，用于 acceptExports 判断
```

lexer 失败时按文件类型给更有用的建议：`.vue` 提示安装插件；JSX 提示扩展名/tsconfig；未知格式
提示语言插件或 assetsInclude。疑似二进制含 Unicode replacement character 时不打印乱码 frame。

map、json 和 direct CSS 可跳过。无 import 的模块仍必须用空集合更新 ModuleGraph，因为用户可能
刚删除最后一条 import；这会移除旧反向边并触发 prune，不能直接 return 而不更新。

## resolved ID 到浏览器 URL

`normalizeUrl()` 先 resolve，再用 `normalizeResolvedIdToUrl()` 选择公开协议：

```text
resolved.id 在 root 内
  → /src/main.ts

优化依赖或 root 外真实文件
  → /@fs/absolute/path.js

虚拟/非浏览器 specifier
  → /@id/__x00__virtual-id

external URL / data URI
  → 原样交给浏览器
```

transform 中间件收到 `/@id/` 后会 unwrap，再把原 ID 交给插件。`/@fs/` 则让浏览器可表达绝对路径，
同时仍受 server.fs 控制。

client 还要做：

1. 非 JS/CSS 资源加 `?import`；
2. 相对 JS/CSS 和同文件虚拟子模块继承 optimizer version；
3. 已 HMR 更新的依赖加 `?t=`；
4. 最后补公开 base。

`?import` 是“把资源作为模块处理”的协议，不是任意 cache buster。CSS import 不加它，因为 CSS
插件根据非 direct 请求自然返回 JS 注入模块；`<link>` 则由 HTML/CSS 管线显式形成 direct 身份。

SSR 不补浏览器 base，不重写 external/builtin，缺失 external 留给 Node/Module Runner；但本地依赖
仍 resolve 并入 server Environment 的独立模块图。

## 并行 resolve，稳定收集

一个文件可有大量 imports，插件用 `Promise.all(imports.map(...))` 并行 resolve。但每项结果写入以
lexer index 分配的槽位：

```text
orderedImportedUrls[index]
orderedAcceptedUrls[index]
orderedAcceptedExports[index]
```

最后再按数组顺序 filter/merge。若直接在异步任务完成时 push，网络/文件系统时序会改变集合顺序，
导致调试输出、HMR 边与结果不稳定。顺序修复见
[PR #14465](https://github.com/vitejs/vite/pull/14465)，并行优化见
[PR #12754](https://github.com/vitejs/vite/pull/12754)。

escaped specifier 使用 lexer 的 `.n` 解码值解析，MagicString 仍用原始位置覆盖；否则
`import './foo\\ bar.js'` 一类路径会解析错误，早期修复见
[PR #2162](https://github.com/vitejs/vite/pull/2162)。

## 动态 import 的三类结果

```text
import('./foo.js')
  → 可 resolve，直接改写 URL并入图

import(`./pages/${name}.js`)
  → dynamicImportVars 先展开为 glob + helper

import(getPath())
  → 无法静态分析，保留运行时表达式
  → 开发态警告；加 @vite-ignore 可抑制
  → 若可能返回非 JS/CSS URL，包 __vite__injectQuery(expr, 'import')
```

`@vite-ignore` 表示“这是有意的运行时 import”，只抑制警告/静态展开，不保证目标会被打进 bundle，
也不保证 bundled dev 能服务项目源码。dynamic-import playground 对 bundled dev 跳过源码直取，正是
这个真实缺口（#23028），不能把 skip 误读成能力已支持。

`__vite__injectQuery` 只给 `.`/`/` 路径加 query，协议/裸包原样保留；手工处理 pathname 是为了保留
`../` 相对语义。classic worker 不能 prepend ESM import，所以直接内联 helper 函数体。

## import.meta.env 与 import.meta.hot

只有 lexer 实际看到 `.env`/`.hot` 才注入 runtime，避免所有模块膨胀。

`import.meta.env` 在开发态变成当前 Environment 的对象赋值；client/SSR 仅 `SSR` 布尔值不同，用户
`define['import.meta.env.*']` 合并进去。classic worker 不是 ESM，不能注入。

`import.meta.hot` 会 prepend：

```ts
import { createHotContext } from '/@vite/client'
import.meta.hot = createHotContext(normalizedModuleUrl)
```

词法 helper 同时提取：

- `accept()` 无参数 → self accepting；
- `accept('./dep')` → acceptedHmrDeps；
- `acceptExports(['foo'])` → acceptedHmrExports；
- 接受全部实际 exports → 实践上升级为 self accepting。

accept URL 必须再走与 import 相同的 resolve，并改写成 ModuleGraph 中节点的规范 URL。解析失败时
不能用历史 fallback 猜路径；相关简化见 [PR #21382](https://github.com/vitejs/vite/pull/21382)。

实验性 partial accept 还记录每个依赖使用的 binding。namespace、dynamic import 与 import.meta 记
为 `*`；named/default 静态 import 可精确记录。第 12 章会解释它如何缩小更新传播。

## 写回 ModuleGraph 与 prune

循环结束得到：

```text
importedUrls          源码 imports + pluginContainer.addWatchFile
staticImportedUrls    仅源码 import，移除 ?t=，供软失效 URL 匹配
importedBindings      partial accept 使用的 export 集
acceptedUrls          accept 的依赖边界
acceptedExports       acceptExports 的导出边界
isSelfAccepting       最终自接受状态
```

普通 CSS 模块图由 css-analysis 更新，避免两边竞争；`.css?raw`/`.css?url` 是 JS 资源模块，仍走本章。
`updateModuleInfo()` 返回已经没有 importer 的旧依赖，`handlePrunedModules()` 发 prune 事件并清理
客户端状态。删除最后一条 import 即使当前模块不使用 HMR API也应 prune，修复见
[PR #20768](https://github.com/vitejs/vite/pull/20768) 与
[PR #20781](https://github.com/vitejs/vite/pull/20781)。

解析失败时清掉 importer 的 self-accept 并登记错误节点，否则修复缺失文件后的更新会错误停在该
模块，见 [PR #9534](https://github.com/vitejs/vite/pull/9534)。

## 优化 CJS 的二次互操作

optimizer 通常已把 CJS 变成浏览器 ESM，但两类输入仍需 Import Analysis 补桥接：

1. 优化入口需要 named/default/namespace 语义对齐；
2. 其他插件向优化文件注入的新 import 不属于 optimizer 原始输出
   （[PR #23029](https://github.com/vitejs/vite/pull/23029)）。

内部 `chunk-XXXXXXXX.js` 已是 optimizer 标准格式，不再 interop。动态 import 改成 `.then()` 包装
namespace；静态 import/export 改成唯一默认导入和属性赋值：

```ts
import { useState } from 'react'
// 概念输出
import __vite__cjsImport0_react from '/node_modules/.vite/deps/react.js'
const useState = __vite__cjsImport0_react['useState']
```

Node mode 与 Web mode 的 default 选择不同。生成赋值插到 shebang/directive 后的安全文件起点，
多条同 ID import 用 importIndex 避免变量冲突。改写补回原换行数，维持 Source Map 行号。

`export * from CJS` 无法静态枚举且不支持动态重赋值，只能警告并保留 URL 改写；named re-export
则生成内部变量后重新 export。单元快照逐一锁住这些语义。

## 用例怎样映射源码

| 用例                             | 场景/目标                                     | 对应源码                   |
| -------------------------------- | --------------------------------------------- | -------------------------- |
| `importGlob/parse.spec.ts`       | 静态 pattern/options 与所有错误边界           | `parseImportGlob()`        |
| `importGlob/fixture.spec.ts`     | 完整代码生成、虚拟模块、行数、query extension | `transformGlobImport()`    |
| `importGlob/utils.spec.ts`       | 最深共同 cwd 且按目录段判断                   | `getCommonBase()`          |
| `dynamicImportVar/parse.spec.ts` | alias/相对层级与 raw/url/worker query         | `transformDynamicImport()` |
| `plugins/import.spec.ts`         | CJS import/export 两种 interop mode           | `transformCjsImport()`     |
| dynamic-import playground        | 浏览器执行、ignore、CSS、嵌套、tree-shaking   | 三段插件链 + 构建          |

playground 的 `@vite-ignore` 用例同时检查“功能运行”和“没有误警告”；nested CSS 用例证明外层动态
import 的副作用不会被内层 import 分析覆盖；生成资产检查则验证无法分析 URL 不会被错误 preload。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/importAnalysis.ts`，
`importAnalysisPlugin()`：

```ts
return {
  name: 'vite:import-analysis',

  applyToEnvironment(environment) {
    return !environment.config.isBundled
  },

  async transform(source, importer) {
    const environment = this.environment as DevEnvironment
    const ssr = environment.config.consumer === 'server'
    const moduleGraph = environment.moduleGraph

    if (canSkipImportAnalysis(importer)) {
      debug?.(colors.dim(`[skipped] ${prettifyUrl(importer, root)}`))
      return null
    }
```

插件先以 Environment 能力边界排除 bundled 模式，再按模块 ID 快速退出；真正重写时同时持有
consumer 类型与模块图。因此 URL 改写、SSR 分支和依赖边更新属于同一次 transform 事务。

## 建议断点

1. `parseImportGlob`：观察 stripLiteral 后 match 与 AST 参数范围。
2. `transformGlobImport`：比较 globsResolved、importPath、filePath。
3. `hotUpdate`：新增一个匹配文件，看无 ModuleNode 的新文件如何反向找到 importer。
4. `transformDynamicImport`：比较 userPattern、rawPattern 和 query params。
5. `importAnalysisPlugin.transform`：记录 lexer 的 `s/e/ss/se/d/a/n` 字段。
6. `normalizeUrl`：分别导入 root 文件、root 外文件、裸包、虚拟模块与资源。
7. 并行循环结束后比较 orderedImportedUrls 和 importedUrls。
8. `updateModuleInfo`：删除最后一个 import，观察 prunedImports。
9. `transformCjsImport`：对 named/default/namespace/re-export 比较生成代码。

纯注释任务不需要运行测试。以后若修改异步收集算法，可用两个故意延迟不同时间的 resolve hook
验证最终 importedUrls 仍按源码顺序；这是对“并行执行、索引归位”思路的最小实验。

## 复盘题

1. 为什么 glob 参数不能是运行时变量，而变量动态 import 又能支持有限变量？
2. 虚拟模块为何不能默认解释 `./*.ts`？
3. glob 初次枚举与 HMR matcher 若使用不同的 ignore/caseSensitive 选项，会出现什么现象？
4. `/@id/` 为什么要在浏览器请求出去前包装、回到服务器后解开？
5. `?import` 与 `?direct` 各在表达什么消费者语义？
6. 并行 resolve 若直接 push 结果，除了测试不稳定还会影响哪些 HMR 行为？
7. `@vite-ignore` 为什么不能保证生产构建包含目标文件？
8. 没有 imports 的模块为什么仍必须 updateModuleInfo？
9. optimizer 产物中的相对 import 与插件后注入 import，为何互操作策略不同？
