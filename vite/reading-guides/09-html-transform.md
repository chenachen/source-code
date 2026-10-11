# 09. HTML 转换

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

Vite 把 HTML 当作开发服务器入口，也是构建图入口。本章研究 `transformIndexHtml` 钩子、开发态
内联代理、资源 URL 改写，以及构建态“HTML → 入口 JS → 最终 HTML”的往返过程。

第 06 章已经解释 HTML fallback 怎样选中 `.html` 文件；第 08 章已经解释代理 URL 怎样进入模块
变换。本章从文件被选中后开始，到 HTML 响应或构建 asset 生成结束。

读完应能回答：

1. 开发态和构建态共用哪些 HTML hooks，顺序为何略有不同？
2. 内联 module script/CSS 为什么必须变成 `?html-proxy` 虚拟模块？
3. SPA fallback、base、嵌套 HTML 与 `/@fs/` 怎样共同决定资源 URL 和代理缓存 key？
4. 构建为何先把 HTML 编译成入口 JS，之后又在 generateBundle 还原 HTML？
5. 何时能消去 HTML 入口 chunk，为什么必须后序注入依赖脚本？
6. 多入口共享 chunk 时，CSS 收集缓存为什么要保存未过滤全集？
7. import map、CSP nonce 与 Vite client 在 head 中有哪些顺序约束？
8. 缺少 head/body 的不完整 HTML 如何确定结构化标签注入位置？

## 推荐阅读顺序

1. `server/middlewares/indexHtml.ts` 的 `indexHtmlMiddleware()`：先看 HTML 从磁盘/内存到响应。
2. `createDevHtmlTransformFn()`：记录开发态完整 hook 顺序。
3. `devHtmlHook()` 与 `processNodeUrl()`：理解代理模块、URL、HMR timestamp 和预热。
4. `plugins/html.ts` 的 `htmlInlineProxyPlugin()`：理解代理请求如何取回内联源码。
5. `buildHtmlPlugin().transform`：看 HTML 怎样变成入口模块。
6. `buildHtmlPlugin().generateBundle`：看 chunk 图、CSS、资源 hash 怎样写回 HTML。
7. `resolveHtmlTransforms()` 与 `applyHtmlTransforms()`：再总结用户 hook 协议。
8. import map、env、nonce 和标签序列化 helpers。
9. 三份测试：单元测试锁 CSS 图算法，中间件测试锁代理身份，playground 验证浏览器语义。

## HTML 请求从哪里进入

```text
浏览器导航 /foo
→ htmlFallbackMiddleware
   └─ 选择 /foo.html、/foo/index.html 或 /index.html
→ indexHtmlMiddleware
   ├─ bundled dev：从 memoryFiles 取构建产物
   │  └─ 产物过期/尚无产物 → 返回含 HMR runtime 的等待页
   ├─ unbundled dev：server.fs 检查 → 读磁盘 → transformIndexHtml
   └─ preview：限制在输出目录 → 直接读生成后的 HTML
→ send(..., 'html')
```

`Sec-Fetch-Dest: script` 即使路径以 `.html` 结尾也不能在这里响应页面，它可能是模块请求。开发态
HTML 读取必须经过 `server.fs`，相关修复见
[PR #20736](https://github.com/vitejs/vite/pull/20736)；preview 不复用源码 fs 配置，但仍禁止路径
逃出构建输出目录。

bundled dev 的首次打包可能未完成。中间件返回临时页并内嵌 HMR runtime，构建产物准备好后自动
reload。业务 chunk 生成后，Vite client 必须注入在它们之前，否则业务代码可能在 HMR runtime
初始化前执行（[PR #23161](https://github.com/vitejs/vite/pull/23161)）。

## transformIndexHtml 的阶段协议

用户插件可声明：

```ts
transformIndexHtml: hook
// 或
transformIndexHtml: { order: 'pre' | 'post', handler: hook }
```

hook 返回三种形状：

```text
string                         直接替换 HTML
HtmlTagDescriptor[]            只注入结构化标签
{ html, tags }                 同时替换 HTML 与注入标签
```

`applyHtmlTransforms()` 串行 await。后一个 hook 总能看到前一个 hook 的文本/标签注入结果，不能把
它理解为并行 map。结构化标签按 `head-prepend`（默认）、`head`、`body-prepend`、`body` 分组。

### 开发态顺序

```text
检查 import map 初始顺序
→ 注入 CSP nonce meta
→ 用户 pre hooks
→ %ENV% 替换
→ devHtmlHook
→ 用户 normal hooks
→ 用户 post hooks
→ 给 script/style/link 补 nonce
→ 把 import map 移到 module script/preload 前
```

### 构建态顺序

```text
transform 阶段：内置 pre import-map / nonce → 用户 pre → env
→ HTML 编译成入口 JS并保存中间 HTML

generateBundle 阶段：注入 chunk/script/preload/CSS，替换内联 CSS 占位符
→ 用户 normal → 用户 post → nonce → import-map 收尾
→ 替换 asset/public 占位符
→ emit HTML asset
```

构建 normal/post hooks 在 generateBundle 执行，能读取 `bundle`、`chunk` 和已经注入的产物标签。
此时内联 CSS 已写回 HTML，普通 asset/public URL 仍可能是占位符；Vite 在这些 hooks 结束后才把
占位符替换为最终文件名和 base。这既处理前序转换产生的占位符，也处理 hook 新增的占位符。

## 开发态：HTML 中的代码进入模块图

浏览器不会为内联 script/style 单独发模块请求，插件容器和模块图也就无从跟踪。`devHtmlHook`
将它们显式模块化。

### 内联 module script

```html
<script type="module">
  import './main.js'
</script>
```

改写为类似：

```html
<script type="module" src="/index.html?html-proxy&index=0.js"></script>
```

原代码按 `config → HTML 路径 → index` 存入 `htmlProxyMap`。浏览器请求代理 URL 后，
`htmlInlineProxyPlugin.resolveId/load` 按 index 取回 code/map，后续完全复用普通模块的 resolve、
transform、Import Analysis 与 HMR。

代理模块强制 `moduleSideEffects:true`。HTML 明确声明脚本就是运行入口，即使包或用户配置
`treeshake.moduleSideEffects=false`，也不能被消除。

### 内联 CSS

两种内联 CSS 处理不同：

```text
<style>...</style>
  → 当次 HTML transform 中建立 CSS 代理节点并执行 CSS transform
  → 把结果与内联 sourcemap 写回 style 内容

style="background:url(...)"
  → 建立 `inline-css&style-attr` 代理
  → css-post 将转换结果写入 htmlProxyResult
  → 再替换属性值
```

只有 style 属性含 `url()` 或 `image-set()` 时需要进入 CSS/asset 管线；普通颜色、布局声明原样保留，
避免为每个属性制造无意义模块。

重新 transform 相同 HTML 会覆盖代理缓存。ModuleGraph 上可能已有同 URL 的 transformResult，因此
新缓存写入后必须使旧代理节点失效；否则连续 reload 会一直拿到第一次内容。这一修复见
[PR #18696](https://github.com/vitejs/vite/pull/18696)。

## 代理模块的路径身份

代理缓存 key、公开代理 URL 和磁盘 filename 不是一回事：

| 场景                   | proxyModulePath   | proxyModuleUrl  | 缓存要点                                |
| ---------------------- | ----------------- | --------------- | --------------------------------------- |
| `/index.html` 真实文件 | root-relative URL | 同公开 URL      | 解码后去 root                           |
| `/@fs/abs/index.html`  | 绝对文件路径      | `/@fs/...`      | key 仍要与插件端 root-relative 查询一致 |
| `/` SSR transform      | `\0/index.html`   | 包装后的虚拟 ID | 不生成磁盘 sourcemap                    |
| 虚拟 HTML 名           | `\0<name>`        | 包装后的虚拟 ID | 交给虚拟模块协议                        |

`/@fs/` 曾因 transform 侧缓存 key 与代理 load 侧 URL 不同而报 “No matching HTML proxy module”，
修复见 [PR #21762](https://github.com/vitejs/vite/pull/21762)。SSR 集成以 `/` 调用
`transformIndexHtml` 时，若把 root 目录当真实 HTML 文件，还会产生错误 sourcemap/ID；虚拟标记
相关修复见 [PR #7993](https://github.com/vitejs/vite/pull/7993)。

## HTML 资源属性表

`assetSource.ts` 把“哪些 HTML 属性含资源 URL”从 HTML 主遍历中抽成数据表。默认覆盖：

```text
img/source       → src + srcset
video            → src + poster
link             → href + imagesrcset
SVG image/use    → href + xlink:href
audio/embed/input/object/track → 各自资源属性
meta             → 仅白名单 name/property 的 content
```

meta.content 不能一律处理。description、theme-color 等 content 是普通文本；只有 twitter:image、Windows
tile image、Open Graph image/audio/video 等明确 URL 类型才进入资源管线。这批默认资源源的扩充见
[PR #11138](https://github.com/vitejs/vite/pull/11138)。

`html.additionalAssetSources` 可为自定义元素或 data-* 属性追加：

- `srcAttributes`：单 URL；
- `srcsetAttributes`：候选列表；
- `filter({ key, value, attributes })`：结合兄弟属性决定是否启用。

扩展规则追加到默认规则，不会替换默认表；默认 filter 与用户 filter 独立执行。如果默认规则
跳过某个 meta.content，用户为它显式增加的规则仍可按自己的 filter 接受该属性。该 API 见
[PR #21412](https://github.com/vitejs/vite/pull/21412)。

扫描结果不只含 key/value，还保存元素全部属性与 parse5 精确 location。HTML transform 因而能让 filter
看上下文，并用 MagicString 只改属性值。SVG namespace 属性会还原成 `xlink:href`。

元素含 `vite-ignore` 时短路全部资源动作，只返回一个 remove 动作：最终 HTML 去掉控制标记，但 src、
srcset 等 URL 原样保留。这不同于返回空数组；若不删除标记，它会泄漏到生产 HTML。

`assetSource.spec.ts` 用 source offsets 验证 parse5 位置，并覆盖默认 meta 白名单、自定义元素、data-*、
srcset、filter 独立性与未配置时的向后兼容。

## 开发态 URL 改写、HMR 与预热

`processNodeUrl()` 同时处理 script、link、src/href、srcset 与额外资源属性：

```text
1. root URL 补 config.base；根 index.html 的嵌套 SPA fallback 也把相对 URL 锚定到 base
2. 对非 public JS/CSS 计算预热用的绝对 URL；普通嵌套页以实际 HTML 目录为基准
3. 去 base 后查 client ModuleGraph
4. 模块发生过 HMR → 给返回的 URL 追加 ?t=lastHMRTimestamp
5. 对预热 URL 解码并调用 warmupRequest
```

SPA 示例：浏览器导航 `/a/b`，实际返回根 `/index.html`。若保留 `./main.js`，浏览器会请求
`/a/main.js`；Vite 看到 originalUrl 表示嵌套导航而 htmlPath 是 `/index.html`，把 `./main.js` 改为
`/main.js`（base 为 `/ui/` 时是 `/ui/main.js`），使资源仍以根入口目录为基准。普通
`/nested/index.html` 中的 `./main.js` 保留相对写法。含 `:` 的裸 URL 不参与相对拼接。

模块图按 transform 中间件去 base 后的 URL 建索引。HTML 若拿 `/ui/src/main.ts` 直接查图，就找
不到 `/src/main.ts` 的 HMR timestamp，可能让带/不带 timestamp 的同一入口执行两次。修复见
[PR #22932](https://github.com/vitejs/vite/pull/22932)。

预热只是性能优化。`decodeURI()` 遇到畸形 URL 时必须跳过预热并保留页面响应，不能让坏 src 把
整页变成 500（[PR #22781](https://github.com/vitejs/vite/pull/22781)）。

## 构建态：先把 HTML 编译成入口 JS

`buildHtmlPlugin.transform` 用 parse5 遍历 HTML，再用 MagicString 做位置稳定的局部编辑：

```text
外链 module script     → `import "url"`，删除原标签
内联 module script     → 缓存 html-proxy，再 import 代理
普通 stylesheet link   → side-effect import，记录原标签范围
style/style 属性        → CSS 代理 import + HTML 占位符
src/href/srcset         → asset/public 构建占位符
经典内联 script import() → 只改写字面量资源 URL
```

HTML 由此成为打包器入口。模块脚本的依赖图、tree-shaking、chunk 拆分、CSS 提取和 asset hash 都能
走同一构建管线。transform 结束保存“已移除入口标签、尚含资源占位符”的中间 HTML，并返回入口
JS。

若 stylesheet 带 `media` 或 `disabled`，它有条件加载语义，不能改成无条件 JS import
（[PR #6751](https://github.com/vitejs/vite/pull/6751)）。无法 resolve 的 stylesheet 也会撤回临时
import、保留原 link，让部署环境在运行时解释。

删除原节点时，Vite 尽量连上一行换行与缩进一起删除；但节点前方同一行有文本时只删节点本身。
这是输出整洁与不误删用户内容之间的边界。

## generateBundle：用真实 chunk 图还原 HTML

打包结束才知道入口 chunk、依赖 chunk、CSS 和资源文件名。每份中间 HTML 按 facadeModuleId 找回
入口 chunk，然后：

```text
入口含实际代码
  → 注入一个 module script
  → 静态依赖注入 modulepreload

入口只含 side-effect imports，且为 ES 输出
  → 入口 chunk 可消去
  → 按依赖图后序注入多个 module script
  → 删除入口空壳文件

两者都
  → 收集 chunk 子图 CSS
  → 替换 inline CSS 占位符
  → 执行 normal/post HTML hooks
  → 替换 asset/public 占位符
  → emit HTML asset
```

`isEntirelyImport()` 宁可假阴性保留小入口，也不能误删实际代码。它逐 token 消费空白、注释与
side-effect import，避免一条大正则在长/特殊代码上指数回溯，见
[PR #22848](https://github.com/vitejs/vite/pull/22848)。

入口消去后多个 script 的执行顺序必须等价于原入口 import：先深层依赖，后 importer。因此
`getImportedChunks()` 使用后序遍历。external import 没有 bundle chunk，直接保留 URL。

## CSS 子图缓存为何保存“未过滤全集”

`getCssFilesForChunk()` 同时维护：

```text
seenChunks   当前入口遍历防环
seenCss      当前入口输出去重
cache        每个 chunk 在本次遍历中收集、未受 seenCss 过滤的 CSS 列表
```

关键是 cache 不能保存当前 `seenCss` 过滤后的结果。设 entryA 先从 chunk1 看到 shared.css，再遍历
chunk2；chunk2 返回时会过滤 shared.css。若把这个子集缓存，entryB 单独依赖 chunk2 时就永远拿
不到 shared.css。Vite 因此用 allFiles 写缓存，用 filteredFiles 返回本入口。

这个跨入口缺样式问题由 [PR #22017](https://github.com/vitejs/vite/pull/22017) 修复。单元测试覆盖
深层共享叶子与菱形依赖：这些无环子图的缓存不会因当前入口已经见过某份 CSS 而缺项。

环由 `seenChunks` 切断：A→B→A 第一次从 A 遍历时，B 的回边直接返回空数组，B 缓存仅记录
b.css，A 返回 b.css、a.css。后续入口若直接复用 B 缓存，会只得到 b.css。因此现有循环用例
验证了单次遍历终止与去重，缓存不能被描述成任意环图的完整可达 CSS 集。

## import map、nonce 与 head 顺序

浏览器要求 import map 在首次 module script/modulepreload 触发解析之前生效。Vite 前置 hook 先
警告用户的错误顺序，后置 hook 再把 map 移到首个模块资源之前。匹配不能只认自闭合 preload，
普通 `<link ...>` 同样会触发加载（[PR #21409](https://github.com/vitejs/vite/pull/21409)）。

启用 Rolldown chunk import map 时，Vite 从 bundle 读取生成的 map 并插到首个模块资源前。用户
map 先被移动到该资源前，再插入生成 map，所以同时存在时的顺序是“用户 map → 生成 map →
模块资源”，不是生成 map 覆盖用户 map。功能入口见
[PR #21580](https://github.com/vitejs/vite/pull/21580)。源码会对多份 map 输出兼容性警告。

CSP nonce 分两层：

1. head meta 用 nonce 属性隐藏真实值，Vite runtime 可读取对应 meta 语义；
2. post hook 给 script/style 与 stylesheet/modulepreload/preload link 补 nonce。

用户已有 nonce 时不覆盖；chunk import map 也只有配置 `cspNonce` 时才输出属性，否则不能生成
空 nonce（[PR #22713](https://github.com/vitejs/vite/pull/22713)）。

## 不完整 HTML 的标签注入回退

HTML 片段并不一定有完整 head/body。注入函数遵循确定回退：

```text
head-prepend
  → <head> 后
  → <html> 后 / doctype 后 / 文档起点

head
  → </head> 前
  → 无 </head>：<body> 前
  → <html> 后 / doctype 后 / 文档起点

body-prepend
  → <body> 后
  → 无 body：</head> 后
  → 文档头部回退

body
  → </body> 前
  → 无 body：</html> 前
  → 文件尾
```

序列化器继承现有缩进，link/meta/base 使用 void tag 形式；属性值经 `escape-html`，布尔 true 只
输出属性名，false 不输出。这避免插件返回的动态属性突破 HTML 边界。

## parse5 的容错与警告

Vite 需要源码位置做 MagicString 精确编辑，因此不能只用正则解析 HTML。parse5 以
`scriptingEnabled:false` 解析 noscript 内容，并报告错误。Vite接受浏览器/生态常见的：

- 缺 DOCTYPE；
- head 中未闭合元素；
- 重复属性（浏览器使用第一项）；
- 非 void 元素自闭合；
- `<?xml>` 与 lit 生成的 `<?>`。

其余错误按错误码去重，附文件位置和 code frame，最后交给 logger.warn；解析仍继续并遍历
parse5 容错后的树。这份实现不会仅因这些 parse5 诊断返回 500 或发送 overlay 错误。

## 用例怎样映射源码

| 用例层级                      | 场景/目标                                              | 对应机制                       |
| ----------------------------- | ------------------------------------------------------ | ------------------------------ |
| `node/__tests__/html.spec.ts` | CSS 链、共享、菱形、环与跨入口缓存                     | `getCssFilesForChunk()`        |
| `indexHtml.spec.ts`           | root 与 `/@fs/` 内联代理均可 load                      | proxy path/cache key           |
| `indexHtml.spec.ts`           | non-root base 下入口得到 HMR timestamp                 | `stripBase()` 后查图           |
| playground hook 组            | string/tags/combined 与四个注入位置                    | `applyHtmlTransforms()`        |
| playground build 组           | async/defer、零 JS、入口消去与执行顺序                 | `generateBundle()`             |
| playground invalid 组         | 仍保留旧的 500/overlay 断言，与当前 warning 实现不一致 | 旧诊断契约，不能作当前行为证据 |
| playground serve behavior     | file/dir/fallback 优先级                               | HTML fallback + index 中间件   |
| playground reload             | 代理 URL 不变时仍拿新内联代码                          | 代理节点失效                   |

单元测试推演 CSS 图算法；中间件测试核对 URL/缓存身份；浏览器 playground 的执行顺序、CSS
生效和 import map 用例观察最终页面。invalid 组的旧断言需要单独更新，当前诊断以
`traverseHtml()` 的 warning 路径为准。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/html.ts`，`resolveHtmlTransforms()`：

```ts
for (const plugin of plugins) {
  const hook = plugin.transformIndexHtml
  if (!hook) continue

  if (typeof hook === 'function') {
    normalHooks.push(hook)
  } else {
    const handler = hook.handler
    if (hook.order === 'pre') {
      preHooks.push(handler)
    } else if (hook.order === 'post') {
      postHooks.push(handler)
    } else {
      normalHooks.push(handler)
    }
  }
}
```

函数形态默认进入 normal；对象形态按 `order` 分组。三组 hook 之后由开发或构建链分别插入内建
转换，解释了相同用户 API 在两个阶段仍能保持顺序契约。

## 建议断点

1. `viteIndexHtmlMiddleware`：观察 fallback 后 URL、filePath 与 dev/preview 分支。
2. `applyHtmlTransforms`：记录 hook 顺序以及每次返回的 string/tags。
3. `devHtmlHook`：观察 proxyModulePath、proxyModuleUrl、proxyCacheUrl 的差异。
4. `addInlineModule` 与 `htmlInlineProxyPlugin.load`：核对同一 index 如何存取代码/map。
5. `processNodeUrl`：用嵌套页、non-root base 和 SPA fallback 比较 URL。
6. `buildHtmlPlugin.transform`：观察 HTML 怎样累积 `js` 入口和资源占位符。
7. `generateBundle`：查看入口 chunk 能否消去、imports 后序与 CSS 收集结果。
8. `postImportMapHook`：观察用户 map、chunk map 与 module script 最终顺序。

## 复盘题

1. 内联 module script 若不拆成代理模块，会失去哪些插件/HMR 能力？
2. 为什么代理缓存不能只以片段 index 为 key？
3. `/@fs/` HTML 中公开 URL、磁盘路径和 cache key 各是什么？
4. 为什么用户 normal/post hooks 不能都在 build transform 阶段执行？
5. 入口 chunk 只含 imports 时，直接删除而不注入依赖 script 会怎样？
6. `seenCss` 为什么必须每个入口独立，而 chunk cache 又必须跨入口共享？
7. import map 若晚于 modulepreload，会出现什么浏览器时序问题？
8. 畸形资源 URI 为什么应跳过预热，而不应让 transformIndexHtml 失败？
9. 缺少 head/body 时，四种 injectTo 分别落到哪里？
