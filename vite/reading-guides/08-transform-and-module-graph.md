# 08. Transform 与模块图

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节研究开发服务器收到模块请求后，怎样把 URL 解析、加载、转换并缓存，以及 ModuleGraph
怎样记录模块身份、依赖边和失效状态。插件 hook 的调度规则已在第 03 章说明，文件 ID 如何得到已在
第 07 章说明；本章聚焦两者进入请求热路径后的协作。

读完应能回答：

1. URL、resolved ID 和 file 为什么是三种身份，分别在哪些索引中使用？
2. 两个相同 URL 的并发请求怎样共享 Promise，失效穿插其中时为何必须开新请求？
3. 为什么 load 成功后才创建模块图节点，而 resolve 成功不能立即入图？
4. transformResult、ETag、pending request 和 HTTP 304 分别是哪一层缓存？
5. 硬失效与软失效保存、清除哪些状态，失效为什么需要向 importer 传播？
6. client 软失效为什么只改 import 时间戳，SSR 又为什么连代码都不用改？
7. Source Map 补源码为什么存在 package 安全边界？
8. client/ssr 分图后，旧 ModuleGraph API 怎样仍表现为一张图？

## 推荐阅读顺序

1. `middlewares/transform.ts`：从 HTTP 请求类型、URL 规范化和 304 进入主链。
2. `transformRequest.ts` 的 `transformRequest()` 与 `doTransform()`：理解并发和两级缓存。
3. 同文件的 `loadAndTransform()`：串起 access check、load、入图、transform 和结果缓存。
4. `moduleGraph.ts` 的三张索引表、`_ensureEntryFromUrl()` 和 `updateModuleInfo()`。
5. `invalidateModule()` 与 `handleModuleSoftInvalidation()`：理解 HMR 快路径。
6. `sourcemap.ts`：理解转换产物如何补源码、标记 ignoreList 和防止越界读取。
7. `mixedModuleGraph.ts`：最后看 Environment API 迁移期的旧接口兼容，不要先被代理代码打断主线。
8. 三份测试：用最小场景复盘扩展名推断、resolved ID 去重、双图兼容和包根边界。

## 一次 HTTP 模块请求

```text
GET /src/main.ts?t=...
→ cachedTransformMiddleware
   └─ 非 CSS 且 URL+ETag 精确命中 → 304
→ transformMiddleware
   ├─ 跳过 document、非 GET/HEAD、/、favicon
   ├─ decode URL，移除 HMR timestamp
   ├─ 处理 .map 请求
   ├─ 识别 JS / ?import / CSS / HTML proxy
   ├─ 移除 ?import，解开 /@id/ 虚拟 ID
   ├─ CSS 按 direct/import 分离身份
   └─ environment.transformRequest(url)
      → transformRequest
      → doTransform
      → loadAndTransform
→ send(code, etag, cache-control, sourcemap)
```

`Sec-Fetch-Dest: document` 的请求必须继续交给 HTML/static fallback。若把导航请求误当 JS，服务器
会返回转换后的模块代码而不是页面。响应追加 `Vary: Sec-Fetch-Dest`，保证代理缓存不会把文档与
模块响应混为一份。

### CSS 为什么有两个 URL 身份

同一 `style.css` 有两种消费者：

```text
import './style.css'       → JS 模块，运行时注入样式
<link href="/style.css">  → ?direct，直接返回 text/css
```

二者源码文件相同，转换代码和 ETag 却不同。通用缓存中间件发现 CSS 时不立即 304；主 transform
中间件先根据 Accept 规范化为 direct/import URL，再查对应节点的 ETag。否则浏览器可能把 JS
包装结果的 ETag 用于 `<link>` 请求。

### HTTP 错误不是一律 500

```text
依赖优化仍在处理 / 旧优化产物    → 504，等待页面用新版本重试
普通模块不存在                  → 交给下游，最终通常 404
资源 ID 被 server.fs 拒绝       → 403
可恢复服务器已经关闭            → 504，客户端连接新实例
真正的插件/转换异常              → next(error)，由错误中间件格式化
```

版本 hash 对应的优化依赖可使用一年 immutable 缓存；项目源码仍是 `no-cache + ETag`。两者的
可变性不同，不能共用 cache-control。

## 模块的三种身份

```text
URL       浏览器/Runner 请求身份，例如 /src/data.ts?raw
id        resolveId 后的插件身份，例如 /abs/app/src/data.ts?raw
file      去 query 的磁盘关联，例如 /abs/app/src/data.ts
```

EnvironmentModuleGraph 因此维护不同索引：

| 索引               | 用途                     | 关键约束                                 |
| ------------------ | ------------------------ | ---------------------------------------- |
| `urlToModuleMap`   | 从请求回到节点           | query 不同通常是不同模块身份             |
| `idToModuleMap`    | 从规范 ID 去重节点       | 多个 URL 可解析到同一节点                |
| `fileToModulesMap` | 文件变化找到所有派生模块 | 一个文件可有 raw、url、worker 等多个节点 |
| `etagToModuleMap`  | HTTP 条件请求快速查节点  | 只供 client 图使用，更新结果时维护       |

`ensureEntryFromUrl()` 先 resolve URL，再按 resolved ID 查已有节点。`/x.js` 与 `/xx.js` 若都解析到
`/x.js`，第二个 URL 只登记到同一节点，而不是复制 meta、importers 和失效状态。这一竞态/去重
边界的历史修复见 [PR #9759](https://github.com/vitejs/vite/pull/9759)。

未解析 URL 的查找本身也是异步操作。图用 `unresolvedUrlToModuleMap` 暂存 Promise，让并发调用
共享一次 resolve；Promise 完成后移除临时项。它与 transform 的 pending request 类似，但前者
只合并“URL 对应哪个节点”，后者合并完整加载和转换。

## 四层缓存不能混为一谈

```text
HTTP ETag                         浏览器已有内容，可能直接 304
environment._pendingRequests      同一时刻合并 transform Promise
ModuleNode.transformResult        服务端长期内存转换结果
deps optimizer immutable output   带内容版本的磁盘/HTTP 产物
```

`doTransform()` 先按 URL 找节点；未命中才 resolve，再按规范 ID 找节点。第二次查询解决“URL 尚未
登记，但相同 ID 已转换”的情况。命中节点后又分两条：有软失效状态则快速修补；有普通
transformResult 则直接返回。

不要把 pending Promise 当结果缓存。它只活到请求 settle，`finally` 会清掉槽位；长期复用由
ModuleNode 保存。这样失败 Promise 不会永久污染后续请求。

## 并发请求与失效竞态

`transformRequest()` 给每次真实处理记录单调时间，并把 `{ request, timestamp, abort }` 放进
`_pendingRequests`。同 URL 再来时：

```text
已有请求开始时间 > 模块最近失效时间
  → 在途结果仍新鲜，共享 Promise

已有请求开始时间 <= 模块最近失效时间
  → 时序是“请求 1 → 失效 → 请求 2”
  → 清掉旧 pending 所有权，请求 2 建立新 transform
```

这里的 abort 只是不再共享旧 Promise，不强行取消插件 hook。插件可能有不可取消的异步副作用，
旧调用者仍可收到旧结果；关键是旧结果不能覆盖新缓存。`loadAndTransform()` 完成时再次比较开始
时间与 `lastInvalidationTimestamp`，只有较新的请求能写 transformResult。

这套双重保护分别覆盖历史上的模块图竞态、过期结果写缓存、失效后继续复用 pending request：
[PR #5470](https://github.com/vitejs/vite/pull/5470)、
[PR #7254](https://github.com/vitejs/vite/pull/7254)、
[PR #7283](https://github.com/vitejs/vite/pull/7283)。访问被拒绝的并发请求也必须正常 settle，不能
留下永久 pending 槽位，见 [PR #20503](https://github.com/vitejs/vite/pull/20503)。

## loadAndTransform 的阶段边界

### 1. 访问控制

会读取真实文件的 `?raw`、`?url`、`?inline`、SVG 查询先同时检查 clean path 与完整 ID，防止
恶意 query 绕过 server.fs。普通 ID 在最终文件确定后由 load 回退检查。虚拟模块以 `\0` 开头，
不应当按宿主文件路径检查。

### 2. 插件 load 优先，磁盘只是回退

```text
pluginContainer.load(id)
├─ 返回 string/object → 使用插件的 code、map、moduleType
└─ 返回 null
   ├─ server.fs 允许 → UTF-8 读取文件并加入 watcher
   └─ 仍无 code → 区分 publicDir import 与普通不存在，抛专用错误
```

二进制、虚拟模块和特殊 query 应由插件拥有；文件系统回退只负责普通文本。publicDir 文件构建时
原样复制，不经过插件转换，因此源码 import 它不是“路径碰巧找不到”，而是违反资源模型。

### 3. load 成功后才入图

resolve 只说明“它可能对应这个 ID”，不证明插件能 load。若在 load 前建节点，API 路由、缺失
文件和被下游中间件处理的 URL 都会污染图。入图后再执行 transform，import analysis 等插件才能
把依赖边写回已存在节点。

### 4. transform 与 Source Map 规范化

插件 transform 串行传递 code、map 和 moduleType。插件未声明类型时，Vite 从已知扩展名推断
非 JS 类型；无扩展名继续留空。字符串 map 解析成对象，缺失 map 保留 null，空 mappings 则是
显式“无需 fallback”的结果。

client 结果生成弱 ETag；启用 `moduleRunnerTransform` 的 server Environment 还要通过
`ssrTransform()` 改写成 Module Runner 协议。最后只有未在处理中失效的结果才写图缓存。

## 模块图怎样维护依赖边

`updateModuleInfo()` 接收 import analysis 解析出的依赖，完成双向更新：

```text
当前模块 importedModules = 新集合
每个新依赖.importers += 当前模块
每个已移除依赖.importers -= 当前模块
当前模块.acceptedHmrDeps / acceptedHmrExports / isSelfAccepting = 新 HMR 元数据
返回不再被任何模块引用的依赖集合
```

只维护 `A.importedModules` 而不维护 `B.importers`，文件变化时就无法向上寻找受影响边界。删除文件
时还要清理它作为 importer 留在依赖节点中的反向引用，避免悬挂边。

CSS 分析过程中可能只有文件依赖、尚无浏览器 URL，`createFileOnlyEntry()` 会创建 asset 节点。
后续真实 URL 到来时仍可按 file 找到它；这类节点不能被错误当成可直接请求的 JS/CSS 模块。

## 硬失效与软失效

| 状态   | 保存什么                                        | 下次请求                       |
| ------ | ----------------------------------------------- | ------------------------------ |
| 未失效 | `transformResult`                               | 直接内存命中                   |
| 硬失效 | 标记 `HARD_INVALIDATED`，清结果/ETag/错误       | 完整 load + transform          |
| 软失效 | 把旧 `transformResult` 移入 `invalidationState` | 复用旧代码并修补 import 时间戳 |

失效时先清 `transformResult`、SSR 执行错误和 ETag 反向索引，再更新单调时间。传播到 importer 时：

- 显式失效的根模块必须硬失效；
- importer 若只是依赖版本变化，可软失效；
- 同一轮传播中，硬失效可以把先前的软失效升级；
- `seen` 防止循环依赖无限递归，但升级判断必须发生在提前返回之前；
- 直接 CSS 请求不能按 JS import 语法重写，需走硬失效边界
  （[PR #18252](https://github.com/vitejs/vite/pull/18252)）。

软失效是 HMR 性能优化（[PR #14654](https://github.com/vitejs/vite/pull/14654)）：模块本身源码没变，
无需重跑整条插件管线。client 用 `es-module-lexer` 扫描旧转换结果，对已更新依赖写入新的 `?t=`；
静态直接 import 还可触发预热。替换只改变 URL 字符，不改变行结构，因此旧 Source Map 可沿用，
但 code 对应的 ETag 必须重算。

SSR 不靠浏览器 query 破缓存，Module Runner 管理执行缓存，所以直接复用旧 transformResult。无论
client 还是 SSR，修补结束都再次做时间戳新鲜度检查，防止修补过程中发生第二次失效。

## Source Map：可调试性与安全边界

Source Map 处理分四类：

1. 从源码尾部读取 inline/external map，并用等长空白移除引用，保持行列稳定；
2. 对缺失的 `sourcesContent` 并行读取原源码；
3. 根据 `server.sourcemapIgnoreList` 合并 `x_google_ignoreList`；
4. 响应 `.map` 请求或把 map 以内联 data URL 附加到 JS/CSS。

第三方 map 不能被当作可信文件读取清单。若转换文件在 node_modules，Vite 先找最近的普通包或
`@scope/pkg` 根；外部 map 文件和每个 source 都必须仍位于该包内。否则恶意依赖可用
`../../.env` 一类路径把宿主文件读进 `sourcesContent` 并发送给浏览器。这个边界见
[PR #22158](https://github.com/vitejs/vite/pull/22158)。嵌套 node_modules 必须取最后一段，才能
限制到真正产出 map 的内层包。

找不到普通 source 只告警，不让模块转换失败；虚拟 source 则根本不尝试磁盘读取。可调试性是
附加能力，不能改变应用能否运行。

## Mixed ModuleGraph 兼容层

Environment API 把 client 与 ssr 状态拆成独立 EnvironmentModuleGraph，但旧插件仍期待：

```text
server.moduleGraph.getModuleById(id) → 一个 ModuleNode
module.importers / importedModules   → 一个 Set
idToModuleMap / fileToModulesMap     → 一张 Map
```

`mixedModuleGraph.ts` 用包装对象提供“合并视图”：

- ModuleNode 同时持有可选 `_clientModule` 与 `_ssrModule`；
- 相同 URL/ID 的双环境节点合成一个包装实例；
- Set/Map 代理遍历两边并按逻辑模块去重；
- 旧 `ssr?: boolean` 参数把调用路由到对应环境图；
- `DualWeakMap` 以一对底层节点缓存包装对象，保证同一输入始终返回同一实例。

稳定实例很重要：插件可能用节点作 Set/Map key 或比较引用。只保证字段相等仍会破坏插件，相关
修复见 [PR #18455](https://github.com/vitejs/vite/pull/18455)。阅读这里时把它当迁移适配器，不要
反向理解为 client/ssr 又共享了缓存；真实状态仍在两张 Environment 图中。

## 用例怎样映射源码

| 用例                         | 固定的契约                             | 对应源码                      |
| ---------------------------- | -------------------------------------- | ----------------------------- |
| `getModuleTypeFromId` 表驱动 | 复合文件名取已知末尾类型，无扩展名不猜 | `defaultModuleTypes`          |
| 失效清除 SSR error           | 重试不能继续抛旧执行错误               | `invalidateModule()`          |
| 两 URL 解析到同一 ID         | 复用同节点及 meta                      | `_ensureEntryFromUrl()`       |
| backward compatibility       | 双图节点、Set 遍历和失效保持旧 API     | `mixedModuleGraph.ts`         |
| node_modules 包根表驱动      | 普通/scope/嵌套/Windows 安全边界       | `getNodeModulesPackageRoot()` |

这些用例不是主链的端到端演示，而是锁定最容易在重构时破坏的身份与边界条件。主链应从源码
状态机阅读，用例用于反证自己的理解。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/server/transformRequest.ts`，
`transformRequest()`：

```ts
const timestamp = monotonicDateNow()

url = removeTimestampQuery(url)

const pending = environment._pendingRequests.get(url)
if (pending) {
  return environment.moduleGraph.getModuleByUrl(url).then((module) => {
    if (!module || pending.timestamp > module.lastInvalidationTimestamp) {
      // The pending request is still valid, we can safely reuse its result
      return pending.request
    } else {
      // Request 1 for module A     (pending.timestamp)
      // Invalidate module A        (module.lastInvalidationTimestamp)
      // Request 2 for module A     (timestamp)

      // First request has been invalidated, abort it to clear the cache,
      // then perform a new doTransform.
      pending.abort()
      return transformRequest(environment, url, options)
    }
  })
}
```

同 URL 的请求通常复用 pending Promise；若模块在该请求开始后已失效，则中止旧工作并递归重跑。
因此并发去重不能只按 URL 缓存，还必须和模块图的失效时间比较。

## 建议断点

用一个含 TS、CSS 和动态 import 的最小页面，按顺序观察：

1. `viteTransformMiddleware`：记录原始 URL、规范化 URL、Accept 与 Sec-Fetch-Dest。
2. `transformRequest`：观察 `_pendingRequests` 是否合并两个相同请求。
3. `doTransform`：分别观察 URL 命中、resolved ID 命中和全未命中。
4. `loadAndTransform`：记录插件 load 是否接管、节点何时入图、transform 前后 code/map。
5. `updateModuleInfo`：观察 importedModules 与目标节点 importers 的双向变化。
6. `invalidateModule`：修改深层依赖，观察软/硬状态怎样传播到 importer。
7. `handleModuleSoftInvalidation`：观察依赖 URL 的 `?t=` 与 ETag 更新。

并发竞态可在 load hook 中手工挂起 Promise：发请求 A，修改文件触发失效，再发请求 B。正确结果
是 B 不复用 A，且 A 即使最后完成也不能写回模块缓存。这个实验用来验证思路即可；纯注释修改
本身不需要重复执行测试套件。

## 复盘题

1. 为什么清掉 pending request 还不够，写 transformResult 前仍要比较时间戳？
2. 如果只用 URL 作为唯一索引，alias 或虚拟 URL 会制造什么重复状态？
3. 为什么直接 CSS 的 ETag 判断晚于普通模块的快速 304？
4. load 失败的 URL 若提前入图，会怎样影响 HMR、404 与后续中间件？
5. 软失效为什么能保留 Source Map，却不能保留旧 ETag？
6. 环形依赖中，`seen` 判断放在软→硬升级之前会发生什么？
7. 为什么 sourcemap 的 source 读取边界是 package root，而不只是 node_modules root？
8. Mixed ModuleGraph 若每次访问都创建新包装节点，会破坏哪些插件代码？
