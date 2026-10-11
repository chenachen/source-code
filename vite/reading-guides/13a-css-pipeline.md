# 13A. CSS 编译、HMR 与构建产物

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本章研究一个 CSS 请求怎样从源码变成开发态可 HMR 的 JS 模块，或生产构建中的 CSS asset：

```text
.css/.scss/.less/.styl
→ vite:css（预处理、PostCSS/Lightning CSS、URL、Modules、deps）
→ 用户插件
→ vite:css-post（开发注入 / 构建聚合抽取）
→ vite:css-analysis（开发模块图与 HMR 边）
```

HTML 中 style/link 的入口见第 09 章，通用 HMR 生命周期见第 12 章，asset 占位符、public 目录与 Worker
将在 13B 继续。第 14 章再从完整生产构建角度串起 CSS metadata 与 HTML/manifest。

读完应能回答：

1. 同一个 `.css` 文件为什么会出现普通、`?direct`、`?inline`、`?url`、HTML proxy 等多种身份？
2. `vite:css` 与 `vite:css-post` 为什么必须位于用户插件两侧？
3. 普通 CSS 能自接受，CSS Modules 为什么通常不能？
4. @import、url() 与 PostCSS 插件注入的 URL 怎样统一解析和登记依赖？
5. Sass/Less 内联文件后，内部相对 URL 为什么要 rebase？
6. 预处理器 worker 哪些情况会回退主线程，关闭 server 时为何必须 await？
7. renderChunk 怎样判断纯 CSS chunk，并为何还要保留一个空 JS 代理到这个阶段？
8. cssCodeSplit=false 时，CSS 顺序怎样由同步 import、当前 chunk、动态 import 决定？
9. 删除纯 CSS 空 JS chunk 后，谁继承它的 importedCss/importedAssets metadata？
10. @import/@charset 为什么在压缩前提升，hash marker 又解决了什么缓存问题？

## 推荐阅读顺序

1. `css.ts` 顶部 query 正则和 `CSSOptions`。
2. `cssPlugin()` 的 load/transform：只看输入怎样变成统一 CSS、deps、modules、map。
3. `compileCSS()`：理解预处理器与 PostCSS/Lightning CSS 二阶段。
4. `cssPostPlugin.transform()` 的 serve 分支：普通、direct、inline、CSS Modules。
5. `cssAnalysisPlugin()`：看 CSS @import 怎样进入模块图。
6. `cssPostPlugin.renderChunk()`：先读 styles 聚合和 URL 占位符替换。
7. 同函数的 cssCodeSplit/legacy 分支，再读 generateBundle 的单 bundle 与纯 CSS chunk 删除。
8. URL 重写 helper：`skipUrlReplacer()`、`doUrlReplace()`、`rewriteCssImageSet()`。
9. Sass/Less/Stylus 的公共 worker/rebase 协议；不必先深读每个第三方选项。
10. 单元测试按算法组、playground 按开发/构建对照阅读。

## CSS 请求身份

URL query 是 Vite 插件间协议，不是任意 cache 参数：

| 请求身份                 | 结果                                                    |
| ------------------------ | ------------------------------------------------------- |
| `foo.css`                | 开发态 JS 注入模块；构建态空 JS 代理 + 抽取 CSS         |
| `foo.css?direct`         | 直接返回 CSS 内容，供 link/浏览器获取                   |
| `foo.css?inline`         | 导出编译后的 CSS 字符串，不插入页面                     |
| `foo.css?url`            | 导出独立 CSS 资源 URL                                   |
| `foo.module.css`         | 导出 class name 映射，同时处理样式                      |
| `?html-proxy&inline-css` | 缓存 HTML style/style attribute 编译结果，稍后回填 HTML |
| `?transform-only`        | `?url` 构建内部身份，不混入普通 CSS chunk               |

开发态 `?direct` 仍经过预处理和 URL 重写，只是 css-post 不把它包装成 JS。`?inline` 与普通 CSS Modules 的导出
语义也不同：前者导出 CSS 文本，后者导出 class 映射。

## 为什么有三个 CSS 插件

### `vite:css`：规范化输入

它在用户插件前运行，把 Sass/Less/Stylus/SugarSS 转成 CSS，应用 PostCSS 或 Lightning CSS，解析
@import/url/CSS Modules，返回 CSS code + sourcemap，并用 `addWatchFile()` 登记依赖。

它不把 CSS 包成最终 JS，因为用户插件可能还想修改统一 CSS 内容。

### `vite:css-post`：消费编译结果

它在用户插件后运行：

- serve：生成 `updateStyle()` JS、HMR accept/prune 或 CSS Modules exports；
- build：保存 CSS，给 Rolldown 一个带 side effects 的 JS 代理，renderChunk 时按实际 chunk 图抽取；
- HTML inline proxy：把最终 CSS 写回 HTML transform 缓存。

### `vite:css-analysis`：开发模块图

普通 Import Analysis 维护 JS import/HMR 边；CSS @import 和第三方插件 `addWatchFile()` 不一定以 JS import
出现在代码里。该插件把这些文件建成 file-only ModuleNode，并更新根 CSS proxy 的 importedModules，
使依赖文件编辑能反向触发根样式 HMR。

## 统一编译链

`compileCSS()` 把所有语言压成一个结果协议：

```text
输入 source + id
→ 若是 scss/sass/less/styl：compileCSSPreprocessors
→ 若 SugarSS + Lightning：先用 SugarSS parser 转换
→ transformer = postcss ? compilePostCSS : compileLightningCSS
→ 合并 preprocessor map + transformer map
→ { code, map, modules?, deps }
```

`deps` 同时包含：

- 预处理器 imports；
- CSS @import；
- url() 解析到的本地 asset；
- PostCSS `dependency`/`dir-dependency` 消息；
- Lightning CSS file/glob/url dependencies。

这些依赖既服务 watcher/HMR，也让构建系统知道相关输入。入口自身若被 Sass 误报为 dependency 会过滤，
避免自依赖循环。

## PostCSS 快路径与插件顺序

普通 CSS 同时满足以下条件时可完全跳过 PostCSS：

```text
非 SugarSS
无 postcss config
非 CSS Module
无 @import
无 url()/image-set()
```

需要处理时插件顺序概念上是：

```text
postcss-modules（若是 module）
postcss-import（若有 @import）
用户 PostCSS plugins
vite-url-rewrite（OnceExit）
```

URL 重写放 `OnceExit` 是关键：用户插件可能在源文件中没有 URL 的情况下后注入 `url()`。如果 Vite只按
原源码特征决定是否重写，新增内容会漏掉。修复见
[PR #22983](https://github.com/vitejs/vite/pull/22983)。

postcss-import 的 source 可能为空：这表示 @import 是其他插件生成的虚拟 AST 节点，此时 resolver 回退
项目 root。Vite 移除了 postcss-import 原本的 `resolve` 依赖以缩小自身 bundle，所以解析失败时要在
这里主动给出错误，而不是让第三方 fallback 静默缺失。

PostCSS messages 中的 `dir-dependency` 会按 glob 枚举当前已存在文件，再把这些文件加入 deps。
本段不向 watcher 登记 glob 或目录，所以新增匹配文件是否触发更新，取决于插件另行建立的监听。

## Lightning CSS 分支

Lightning CSS 同时承担 bundle、CSS Modules、URL dependency 分析与可选压缩。resolver 根据 importer
语言只选择对应 CSS/Sass/Less resolver；这与 PostCSS Modules composes 会遍历多个 resolver 的行为不
完全相同。

返回的 dependency placeholder 分类型处理：

- file/glob：登记 watcher deps；
- url：经 Vite asset resolver 后替换 `url("placeholder")`；
- import：函数 replacer 原样插入 URL，防止 `$&` 被 String.replace 当匹配模式。

外部 @import 中 `$` 保留的修复见
[PR #22718](https://github.com/vitejs/vite/pull/22718)。压缩阶段关闭 cssModules/visitor/customAtRules，
避免把编译阶段转换再跑一次；近期修复见
[PR #23147](https://github.com/vitejs/vite/pull/23147)。

Lightning CSS 的 Modules exports 先按 key 排序，再拼 composes class，使后续 JS 导出的属性顺序稳定；
这一步不改变 Lightning CSS 已生成的 scoped class 名。

## CSS URL 重写

`cssUrlRE` 只定位真正的 url() 函数，不能把 Sass 的 `svg-url()` 后缀误判。它支持：

- 冒号后无空格；
- image()/image-set() 中嵌套位置；
- 文件名转义括号；
- 单/双引号与裸 URL。

以下 URL 跳过：

```text
http(s)/protocol-relative
data:
#fragment
函数调用（如 var(...)）
已经是 __VITE_ASSET__/__VITE_PUBLIC_ASSET__ 占位符
```

本地 URL 先去 CSS 转义，再经 Vite resolver。替换后若包含空格、`)` 或引号冲突，会重新选择 wrapper 并
转义。不能简单保留原引号：资源内联可能改变 URL 字符集合，例如 SVG 编码后的单双引号分布。

开发态真实 asset URL 会继承 asset ModuleNode 的 HMR timestamp；样式重新注入后，图片本身也能绕过
浏览器缓存。非内联 CSS asset HMR 修复见
[PR #20581](https://github.com/vitejs/vite/pull/20581)。

构建态 `fileToUrl()` 先产生 reference placeholder，renderChunk 知道 CSS asset 的最终目录后，才用
`toOutputFilePathInCss()` 决定公开 base 或相对 CSS 输出目录的字符串 URL。CSS 无法嵌入 JS 运行时表达式。过早在 transform 阶段算相对路径会
不知道最终 chunk 名与 assetFileNames。

## Sass/Less/Stylus 与 URL rebase

预处理器会把被 @import 文件内容拼进根文件。假设：

```text
src/main.scss       @use './nested/part'
src/nested/_part.scss  url('./icon.png')
```

编译后 CSS 位于 main.scss 身份下，但 URL 原本相对 `_part.scss`。`rebaseUrls()` 因而：

```text
./icon.png
→ 以 _part.scss 解析成绝对文件
→ 再相对 main.scss 目录生成 nested/icon.png
```

它同时处理 url()、Less data-uri() 和保留为 CSS 的 `@import "foo.css"`。变量/插值 URL 必须跳过，等待
预处理器求值。

Sass resolver 使用 `.scss/.sass/.css`、`sass/style` conditions、index 与 `_partial` 前缀，但故意忽略
package main 字段；行为与 Sass NodePackageImporter 对齐，回归见
[PR #22449](https://github.com/vitejs/vite/pull/22449)。Windows/file URL 与相对导入修复可沿
[PR #19920](https://github.com/vitejs/vite/pull/19920)、
[PR #20349](https://github.com/vitejs/vite/pull/20349) 阅读。

Less 只向 FileManager 暴露 importer 目录，无法给 Vite真实 importer 文件，所以
`resolve.tsconfigPaths` 不适用于 `.less` 内部。这个限制不是 resolver 忘记传配置，而是第三方 API 缺少
身份信息。

## 预处理器 worker 生命周期

用户未配置 `preprocessorMaxWorkers` 时，CSS 配置归一化会补成 `true`。内部 helper 的转换规则是：

```text
undefined → 0，Less/Stylus 主线程 fake worker
true      → undefined，由 worker helper 自动选择上限（CPU - 1）
number    → 指定 Less/Stylus 上限
```

Less/Stylus 的以下选项使任务回退主线程：

- Less plugins（函数）；
- Stylus define 中函数或 Evaluator；

`additionalData` 函数先在主线程执行，传给 worker 的选项副本固定为 undefined；它本身不会迫使编译任务回退。

Sass 使用自身 AsyncCompiler 长期实例，不另建通用 pool；优先 sass-embedded，若平台二进制加载失败则
回退 sass，见 [PR #21002](https://github.com/vitejs/vite/pull/21002)。

`buildEnd()`/server close 必须 await Less/Sass/Stylus controller 全部 close。只调用 stop 而不等待会在
进程中残留 sass-embedded 子进程；修复见
[PR #22275](https://github.com/vitejs/vite/pull/22275)。

插件生命周期外的 `preprocessCSS()` 若找不到配置对应的 controller，会复用一个 max=0 的全局 controller。
这让 Less/Stylus 使用主线程执行，避免创建 worker pool。Sass 不读取 maxWorkers，仍复用 AsyncCompiler；
该全局 fallback 没有公开关闭入口，不能把它理解为所有预处理器都不持有长期资源。

## 开发态：CSS 变成 JS

普通 CSS transform 概念输出：

```ts
import { updateStyle, removeStyle } from '/@vite/client'
const id = '/src/main.css'
const css = '...compiled css...'
updateStyle(id, css)
import.meta.hot.accept()
import.meta.hot.prune(() => removeStyle(id))
```

所以普通 CSS 自接受：编辑只替换 style 内容，不需要重新执行 JS importer。prune 则在 import 边删除时
移除 style。

CSS Modules 还导出 class map：

```ts
export const foo = '_foo_hash'
export default { foo: '_foo_hash' }
```

编辑可能改变 export 值或名称，importer 的绑定必须重新计算，因此不能无条件自接受。`?inline` 也不插入
样式，只导出字符串。

server consumer 不需要 DOM 注入，只返回 Modules exports 或空模块；bundled Environment 从
`import.meta.hot._internal` 获取 updateStyle/removeStyle，普通模式从 `@vite/client` import。

## 构建态：为什么先保留空 JS 代理

`cssPostPlugin.transform()` 把普通 CSS 记录到 `styles`，却返回空 JS，并设置
`moduleSideEffects:'no-treeshake'`。原因是最终 CSS 分组取决于 Rolldown 真实 chunk 图；transform 阶段还不
知道该 CSS 属于哪个同步/动态/手工 chunk。

renderChunk 遍历 `chunk.modules`：

- id 在 styles：追加 CSS；
- CSS Module 含 JS exports，因此 chunk 不是 pure CSS；
- id 不在 styles 且 JS code 非空：不是 pure CSS；
- `cssScopeTo` 对应 importer export 未渲染：跳过该 CSS，实现样式 tree-shaking。

`cssScopeTo` 查找优化用跨所有 meta.chunks 的 Proxy，只有真正访问 importer 时才搜索，避免提前构造完整
renderedModules 映射；相关性能改进见本地提交 `59d0b35b3`。

## CSS code split

开启时，每个 JS chunk 最多发射一个 CSS sidecar：

```text
chunk modules CSS
→ 解析 asset/public placeholders
→ finalizeCss
→ emitFile(.css)
→ chunk.viteMetadata.importedCss.add(file)
```

CSS 的异步 finalize 使用串行 Promise queue，使 renderChunk 进入队列的顺序与资源发射顺序一致，
避免压缩耗时不同导致产物生成顺序漂移。即使当前 chunk 没有 `?url` 任务，也必须穿过同一队列，才能让后续
阶段的相对顺序一致。

JS entry 间接导入 CSS 时，CSS sidecar 名按 JS chunk basename；CSS 自身作为 entry 时保留 CSS 路径。
standalone CSS entry 的 manifest/assets 元数据演进见
[PR #21015](https://github.com/vitejs/vite/pull/21015)。

legacy IIFE/UMD 不能使用普通 ESM CSS sidecar 加载协议，样式以内联 `document.createElement('style')`
代码插进 wrapper 内部。ES 输出若有 shebang，注入点必须在 shebang 换行之后；修复见
[PR #22717](https://github.com/vitejs/vite/pull/22717) 与特殊行终止符补充
[PR #23038](https://github.com/vitejs/vite/pull/23038)。

## 单一 CSS bundle 的顺序

`cssCodeSplit:false` 时 generateBundle 按 cascade 优先级聚合：

```text
递归同步 imports 的 styles（最低）
→ 当前 chunk styles
→ 收集但暂不处理 dynamic imports
→ 所有 entry 遍历完成
→ 最后追加 dynamic chunk styles（最高）
```

`collected` 防止共享 chunk 重复；dynamicImports 用 Set 保留首次出现的确定顺序。结果只 finalize/emit
一次，originalFileName 使用 style.css 作为 manifest key。下一次 output 的 renderStart 会重置发射状态；
plugin-legacy 标记的 legacy output 在 generateBundle 跳过，避免重复 CSS，并遵守 `emitAssets`；相关修复见 [PR #20883](https://github.com/vitejs/vite/pull/20883)。

## 纯 CSS chunk 清理

一个动态入口可能只 import CSS，Rolldown 仍生成空 JS chunk。Vite 发射真实 CSS 后必须删除它，但需同步
修补：

1. 用 preliminaryFileName 把 rendered chunk 对应到 bundle 最终文件名；
2. 从所有 importer 的 `chunk.imports` 删除空 JS；
3. 把空 chunk 的 importedCss/importedAssets 转移给 importer；
4. 在生成代码中删除 ESM import/CJS require；
5. 删除 JS 和 map；standalone CSS entry 的 metadata 转到真实 CSS asset。

生成代码替换保持等长注释，降低 sourcemap 位移。CJS minifier 可能生成：

```js
;(require('a'), require('pure-css.js'), require('b'))
```

替换器必须正确保留前/后逗号或分号，不能只删字符串。特殊文件名与 import map 修复见
[PR #19814](https://github.com/vitejs/vite/pull/19814)、
[PR #22841](https://github.com/vitejs/vite/pull/22841)。空 CSS entry 应留下 `.css` 而非 `.js`，见
[PR #20518](https://github.com/vitejs/vite/pull/20518)。

## finalize、压缩与 hash marker

多个文件拼接后，CSS 规范要求 @charset 最先、外部 @import 位于其他规则之前。`hoistAtRules()` 先屏蔽
注释，再：

- 按原顺序把所有 @import 移到开头；
- 删除重复 @charset，只把第一个放在最前。

随后按 `build.cssMinify` 使用 esbuild 或 Lightning CSS。inline CSS 去掉尾换行，普通 asset 确保一个尾
换行；这个细节会影响 HTML 内联和内容 hash。

`viteHashUpdateMarker` 是只参与 hash 的临时字符串。Vite 5.4.3 改变 CSS link 的 crossorigin 请求属性
后，Chromium 可能复用旧内容 hash 缓存并阻止加载；marker 先进入 emitFile 的 source，强制生成新 hash；文件名确定后，generateBundle 再从最终 asset source 删除它。
背景见 [Issue #18038](https://github.com/vitejs/vite/issues/18038)。

## Sourcemap

每层 map 分别产生：

```text
additionalData MagicString map
→ preprocessor map
→ PostCSS/Lightning map
→ combineSourcemaps
```

任一层只有空 mappings 时，组合结果也退化为空 map，不能伪造精确映射。PostCSS 相对 sources 以输入
文件目录规范为绝对路径；`<input css ...>` 虚拟 source 加 null byte，防止后续读取磁盘。

PostCSS 自己接 prev map 可能在 sources 中重复文件名，所以 Vite不在 process 阶段传 prev，而是最后
统一 combine。

## 测试怎样映射源码

### `css.spec.ts`

- cssUrlRE：空白、嵌套函数、函数名后缀、转义括号。
- CSS Modules：composes alias 与普通/direct scoped name 一致。
- hoist：引号内分号、注释伪规则、多 charset。
- convertTargets：ES 年份与 browser 版本编码。
- getEmptyChunkReplacer：ESM/CJS、无换行、逗号链、赋值边界和等长结果。
- preprocessCSS：PostCSS/Lightning 统一 API、external URL 的 `$`。
- Sass resolver：忽略 package main，命中根 index.scss。
- library CSS 名：三层优先级。
- injectInlinedCSS：IIFE/UMD wrapper、嵌套 name、多注入、ES shebang。

### `cssPreprocessorTeardown.spec.ts`

SCSS transform 启动 sass-embedded 子进程，`server.close()` 返回时活动句柄中不再有 Sass worker。它验证
的是 server → Environment → PluginContainer → buildEnd/worker.dispose 整条关闭链。

### `playground/css`

同一 fixture 在 serve/build 下对照：

- 开发：复用编辑前 DOM 元素，证明 CSS HMR 未 reload；
- 构建：读取 asset 内容/文件名，证明抽取、顺序、minify、tree-shaking；
- 预处理器：imports、alias、additionalData、变量 URL 与 HMR；
- URL：空格、image-set、PostCSS 后注入、query、Less data-uri；
- async/scoped/module CSS：sidecar、cascade 顺序和删除未使用样式。

用例中 bundledDev 的 skips（#22863/#23028）是明确能力缺口，不应误读成普通 CSS 管线也不支持。

## 建议断点

1. `cssPlugin.transform()`：记录 id query、compileCSS 返回的 deps/modules。
2. `compileCSS()`：看语言分支和 map 组合。
3. `UrlRewritePostcssPlugin.OnceExit()`：观察插件后注入的 URL。
4. `rebaseUrls()`：比较 file/rootFile 与替换前后 URL。
5. `cssPostPlugin.transform()`：看 serve/build 和 inline/module 分流。
6. `cssPostPlugin.renderChunk()`：记录 styles、isPureCssChunk、chunkCSS。
7. `generateBundle()`：看 collect 顺序与 pureCssChunk metadata 转移。

建议观察：

```text
id / lang / query
deps / modules / preprocessorMap
styles
chunk.modules / chunk.imports / chunk.dynamicImports
isPureCssChunk
chunk.viteMetadata.importedCss / importedAssets
pureCssChunks
```

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/css.ts`，`cssPlugin()` 的
`buildStart`：

```ts
buildStart() {
  // Ensure a new cache for every build (i.e. rebuilding in watch mode)
  moduleCache = new Map<string, Record<string, string>>()
  cssModulesCache.set(config, moduleCache)

  removedPureCssFilesCache.set(config, new Map<string, RenderedChunk>())

  preprocessorWorkerController = createPreprocessorWorkerController(
    normalizeMaxWorkers(config.css.preprocessorMaxWorkers),
  )
  preprocessorWorkerControllerCache.set(
    config,
    preprocessorWorkerController,
  )
},
```

每轮 build 都重建 CSS Modules 与纯 CSS 产物缓存，并创建预处理器 worker 控制器；watch 重构建
不能沿用上一轮状态。对应 `buildEnd`/关闭路径必须消费并释放同一控制器。

## 复盘题

1. vite:css 若放在用户插件后，会漏掉哪类统一输入能力？
2. URL 重写器为什么必须在 PostCSS OnceExit，而不是只看原源码有无 url()？
3. CSS Modules 自接受会让 importer 观察到什么旧状态？
4. Sass import 内 URL 不 rebase 时，最终会相对哪个错误目录解析？
5. 普通 CSS transform 返回空 JS，为什么仍标记 no-treeshake？
6. cssCodeSplit=false 为什么动态 chunk 样式最后追加？
7. 删除纯 CSS JS chunk 时若不转移 metadata，HTML/manifest 会漏掉什么？
8. CJS 逗号链中直接删除 require 文本会产生哪些语法错误？
9. preprocessCSS 的 max=0 fallback 怎样约束 Less/Stylus，Sass 为什么仍使用 AsyncCompiler？
10. CSS hash marker 为何要参与 hash，却不能留在最终 asset？

可用 `.scss?inline`、普通 `.module.css` 与动态导入的纯 CSS 入口对照这三条分支，分别追踪导出值、
样式加载和最终资源文件。
