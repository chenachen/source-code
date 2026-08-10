# 06. 中间件与请求入口

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节研究一个 HTTP 请求怎样被分流到代理、静态文件、HTML 或模块转换，以及安全检查为何必须
位于特定顺序。`transformMiddleware` 只看到交接边界，内部 resolve/load/transform 留到第 08
章；`indexHtmlMiddleware` 的标签转换留到第 09 章。

读完应能回答：

1. Connect 中间件的注册顺序为什么就是请求语义？
2. 为什么非法 request-target 和 Host 校验必须早于文件系统访问？
3. proxy 的 bypass 返回 string、false、undefined 分别意味着什么？
4. public、root 静态文件与 `/@fs/` 为什么需要三条入口？
5. `server.fs.deny`、safeModulePaths、`server.fs.allow` 的优先级是什么？
6. 为什么“路径不允许”还要区分 denied 与 fallback？
7. HTML fallback 为什么只改写 URL，不直接读取 index.html？

## 推荐阅读顺序

1. `server/index.ts` 中连续的 `middlewares.use()`：先记住总顺序。
2. `rejectInvalidRequest.ts`、`hostCheck.ts`：看进入业务前的安全边界。
3. `proxy.ts`、`base.ts`：看请求何时离开 Vite、何时规范化成内部 URL。
4. `static.ts`：看 public、root、`/@fs/` 和文件访问控制。
5. `htmlFallback.ts`：看页面导航怎样改写。
6. `send.ts`、`error.ts`、`notFound.ts`：看正常/错误响应怎样结束。
7. host/static 单元用例与 proxy/base/fs-serve playground：用场景复盘顺序约束。

## 中间件总顺序

开发服务器在 `initServer()` 期间按下列顺序装配 Connect：

```text
request
│
├─ time（仅 DEBUG）
├─ reject invalid request-target
├─ CORS
├─ Host validation（HTTP）
├─ 用户 configureServer 前置中间件
├─ cached transform 快路径
├─ proxy
├─ base 剥离/重定向
├─ open-in-editor
├─ HMR ping
├─ publicDir 原样文件
├─ bundledDev lazy/memory files
├─ transform
├─ /@fs/ 静态文件
├─ root 静态文件
├─ HTML fallback
├─ configureServer 后置中间件（逆序）
├─ index.html transform
├─ 404（仅独立模式）
└─ error middleware
```

Connect 是线性责任链：中间件若写完响应就停止，否则调用 `next()`；带错误参数的
`next(err)` 会跳到四参数错误中间件。因此这里的顺序不是组织偏好，而是安全和路由契约。

几个容易忽略的顺序原因：

- proxy 在 base 前：代理 context 匹配用户看到的原始 URL；
- public 在 transform 前：public 文件必须原样提供；
- transform 在 root static 前：JS/TS/CSS 请求先获得插件转换机会；
- `/@fs/` 在 root static 前且独立处理：其根是文件系统 `/`，不是项目 root；
- HTML fallback 在静态/transform 后：只有前面都未命中的页面导航才应改写；
- configureServer 后置钩子在 index.html 前：插件仍能提供自定义 HTML；
- error 最后：任意前置层都能通过 `next(err)` 汇聚到同一响应。

## 第一层：拒绝不可信请求形状

### request-target 中的 `#`

HTTP fragment 不会发送给服务器，HTTP/1.1 和 HTTP/2 的 request-target 都不允许 `#`。但
Node 会接收手写 TCP 请求中的 `#`，而 Vite 的 URL 清洗、路径拼接和 `fs.deny` 默认它不存在。

攻击形态例如：

```text
GET /src/safe.txt#/../../.env HTTP/1.1
```

若某层把 `#` 后视为 fragment、另一层却把它视为路径，就会产生校验对象和读取对象不一致。
`rejectInvalidRequestMiddleware()` 因此位于最前面，直接返回 RFC 建议的 400。该修复见
[PR #19830](https://github.com/vitejs/vite/pull/19830)。

### Host 与 DNS rebinding

浏览器同源策略信任域名，但攻击者可以让自己控制的域名先指向公网服务，再把 DNS 响应改为
`127.0.0.1`。若开发服务器接受任意 Host，恶意网页就可能在“同一域名”下读取本地源码。

Host validation 根据 `server.allowedHosts` 拒绝未知 Host，并把以下显式地址自动加入允许项：

- `server.host`；
- `server.ws.host`；
- `preview.host`；
- 可解析的 `server.origin` hostname。

这些配置已经表示用户期望 Vite 响应该主机，无需重复声明。origin 可能是框架占位字符串，URL
解析失败只跳过自动加入，不阻止启动（[#19241](https://github.com/vitejs/vite/pull/19241)）。

底层 Host 校验器收到冻结的 allowedHosts 副本，可缓存结果且不受调用方后续改数组影响。该安全
边界由 Vite 的 DNS rebinding 修复引入；HTTPS 已用证书绑定可信主机，所以顶层装配不会重复
添加同类 Host 中间件。

### CORS 与 Host 不是同一件事

CORS 决定浏览器脚本能否读取跨 origin HTTP 响应；Host validation 决定服务器是否接受请求
目标主机。非浏览器客户端不受 CORS 约束，所以不能用 CORS 代替 Host 校验。HMR WebSocket
还要结合 Host、Origin 和一次性 token，形成独立握手边界。

fs-serve 的 cross-origin 场景分别从浏览器和 Node 发请求，就是为了覆盖这些机制而不是把它们
误当成一个开关。

## proxy：请求离开 Vite 的分流点

每个 proxy context 创建一个 `ProxyServer`：context 以 `^` 开头时作为正则，其余按 URL 前缀
匹配。对象枚举顺序决定首个命中项。

字符串简写：

```ts
'/api': 'http://localhost:3000'
```

会规范化为 `{ target, changeOrigin: true }`。底层 http-proxy 会修改选项，所以 Vite 保存浅拷贝，
让后续 bypass/rewrite 看到稳定用户配置。

### HTTP bypass 状态机

```text
bypass(req, res, options)
├─ string
│  ├─ req.url = result
│  ├─ res 已结束 → return
│  └─ next()，交回 Vite 管线
├─ false
│  └─ Vite 直接返回 404
├─ null/undefined/true
│  └─ 继续 proxy.web()
└─ throw/reject
   └─ next(error)
```

async bypass 由 [PR #18940](https://github.com/vitejs/vite/pull/18940) 支持；bypass 自己结束响应
后不能继续 next，否则会二次写响应（[PR #19318](https://github.com/vitejs/vite/pull/19318)）。
false 直接 404 的契约见 [PR #14579](https://github.com/vitejs/vite/pull/14579)。

### WebSocket bypass

WebSocket upgrade 不经过 Connect 普通请求链，proxy 直接监听底层 HTTP Server 的 `upgrade`。
它没有 `ServerResponse`，所以 bypass 的 res 是 undefined：

- string：改写 `req.url`，停止当前代理处理；
- false：向 socket 写最小 404 后关闭；
- 空值：可选 rewrite 后调用 `proxy.ws()`。

WS 上游常检查 Origin。`rewriteWsOrigin` 可把它改为 target origin，但这会削弱上游 CSRF 防护，
必须由用户显式开启（[PR #16558](https://github.com/vitejs/vite/pull/16558)）。

代理目标失败时，HTTP 返回 502 Bad Gateway，而不是暗示 Vite 自身异常的 500
（[PR #21652](https://github.com/vitejs/vite/pull/21652)）；WS 则记录错误并结束 socket。

## base：公开 URL 与内部 URL 的边界

`baseMiddleware()` 只在 `base !== '/'` 时注册：

```text
公开请求 /docs/src/main.ts
→ 验证 pathname 以 /docs/ 开头
→ req.url 改为 /src/main.ts
→ 后续中间件统一按无 base URL 工作
```

它不会修改响应代码中的公开 import URL；生成 URL 的插件仍读取 config.base。base-conflict 用例
正是防止“入口剥离 base”误演化成“输出也丢 base”。

独立服务器访问 `/` 或 `/index.html` 时 302 到 base，并保留查询部分。访问 base 外路径时：

- Accept 包含 HTML：404 HTML，提供可点击的建议地址；
- 资源请求：404 text/plain，避免浏览器把错误页当资源；
- middleware mode：直接 next，由宿主路由决定重定向或 404（[#4057](https://github.com/vitejs/vite/issues/4057)）。

proxy 在 base 前，所以 `/docs/api` 是否代理取决于用户配置的原始 context，而不是剥离后的
`/api`。这是阅读路由问题时应首先检查的顺序。

## 三条静态文件入口

### publicDir

public 文件不经过 transform，URL 直接相对公开根提供。为避免每次请求 `existsSync`，服务器
启动时建立文件 Set，watcher 和 restart 负责更新。

以下请求必须跳过 public 原样响应：

- `?import` 模块请求；
- `/@fs/`、Vite client 等内部 URL；
- `?url`、`?raw` 等需要插件转换的资源查询。

例如 `/public-file.js?url` 应得到“URL 字符串模块”，而不是文件 JS 原文。这个边界见
[PR #17915](https://github.com/vitejs/vite/pull/17915)。

### 项目 root

普通静态层从 config.root 提供文件，但主动跳过：

- 尾斜杠与 `.html`：交给 HTML fallback/transform；
- 内部 URL：交给专用协议；
- `//host/path`：避免 URL 构造器将其解释为 scheme-relative 地址
  （[PR #19059](https://github.com/vitejs/vite/pull/19059)）。

直接静态请求也应用 resolve.alias，使资源路径和模块解析尽量一致。alias 替换后位于 root 内的
绝对路径会重新改写为请求相对路径，再交给 sirv。

### `/@fs/`

monorepo 链接包可能位于 root 外，又引用其旁边的资源。Vite 把绝对文件 ID 编码为
`/@fs/absolute/path`，此中间件以文件系统 `/` 为 sirv root 读取。Windows 还要移除 URL 形式
中多余的盘符前导处理。

`/@fs/` 只解决“怎样表达绝对路径”，绝不表示“允许读取任意路径”。它和 root 静态入口最终
都进入相同 `server.fs` 安全判定。

## `server.fs` 文件访问算法

### 为什么检查放在 sirv 内

请求 URL 不是最终磁盘文件：目录可能映射到 index、符号链接可能指向别处、编码/alias 会改变
路径。安全检查如果只发生在请求进入 sirv 前，校验路径可能不是最终读取路径。

`sirvOptions.shouldServe(filePath)` 收到 sirv 已解析出的真实候选文件，再调用
`checkLoadingAccess()`。这条修复见 [PR #19965](https://github.com/vitejs/vite/pull/19965)。

### 判定优先级

```text
server.fs.strict === false
  → allowed

Windows 路径含 ~ 或盘符之外的 :
  → denied

fsDenyGlob(filePath 去尾斜杠) 命中
  → denied

safeModulePaths 命中
  → allowed

任一 fs.allow 是同路径或真实父目录
  → allowed

否则
  → denied
```

`deny` 早于 safeModulePaths/allow，所以扩大 allow 不能意外开放 `.env`、证书或版本控制文件。

`isFileInTargetPath()` 使用规范化路径的“相同文件/父目录”判断，不能用字符串 startsWith；否则
`/parenta` 会被误认为 `/parent` 的子目录（[PR #14241](https://github.com/vitejs/vite/pull/14241)）。

### Windows 特殊路径

NTFS/Windows 有两类普通 POSIX 思维看不到的别名：

- 8.3 短文件名：`.env` 可能通过 `ENV~1` 访问；
- Alternate Data Stream：`.env::$DATA` 可指向同一默认数据流。

strict 模式因此拒绝包含 `~` 的路径，以及盘符之外仍含 `:` 的路径。修复背景见
[PR #22572](https://github.com/vitejs/vite/pull/22572)。这是略偏保守的策略：牺牲少量合法文件名，
换取 deny 无法被文件系统别名绕过。

Node 读取 `/foo.png/` 可能仍落到 `/foo.png`，所以 deny 匹配前还要移除尾斜杠
（[PR #20968](https://github.com/vitejs/vite/pull/20968)）。

### denied 与 fallback

不在 allow list 的路径不能一律返回 403：`/api/users` 很可能根本不是文件，而是后续用户
中间件处理的 API。

```text
isFileLoadingAllowed(path) → allowed
否则 isFileReadable(path) → denied（存在但无权读取）
否则 → fallback（不存在，继续 next）
```

这条三态判定防止 Vite 过度拒绝未知路由（[PR #20410](https://github.com/vitejs/vite/pull/20410)）。
真实 denied 返回转义后的 403 HTML，并在终端一次性打印 allow 配置提示；fallback 最终可能由
API、HTML fallback 或 404 接管。

## HTML fallback 只负责改写

`htmlFallbackMiddleware()` 只处理 GET/HEAD，排除 favicon，并要求 Accept 是 HTML、`*/*` 或
等价的缺省/空值。按顺序尝试：

```text
/page.html  → 文件存在则保持 /page.html
/docs/      → /docs/index.html 存在则改写
/about      → /about.html 存在则改写
SPA mode    → 最终改写 /index.html
```

完整打包开发模式从 memoryFiles 判断存在性，普通模式查磁盘。decodeURIComponent 遇到畸形 URI
只 next，不能把导航请求升级为 500。

它不直接读取文件，因为后续 `indexHtmlMiddleware` 还要做 fs.strict 校验、插件 HTML hook、
模块脚本代理和 HMR client 注入。将“选择哪个 HTML”与“怎样转换 HTML”分开，也让用户的
configureServer 后置中间件能在 index.html 前提供自定义响应。

## 正常响应、404 与错误响应

### `send()`

transform 得到内容后，`send()` 统一处理：

1. 已结束的响应不再写入；
2. 默认生成弱 ETag，If-None-Match 相等则返回 304；
3. 写入 MIME、`Cache-Control: no-cache`、ETag 与用户 headers；
4. 对 JS/CSS 注入真实 Source Map；
5. JS 没有 map 时生成 identity fallback map；已有内联 map 或明确空 mappings 时跳过；
6. HEAD 返回与 GET 一致的状态/headers，但不发送 body。

fallback map 修复了浏览器断点无法对齐的问题
（[PR #13514](https://github.com/vitejs/vite/pull/13514)），已有内联 map 不能重复注入
（[PR #14370](https://github.com/vitejs/vite/pull/14370)）。HEAD 的响应头/状态契约由
[PR #20421](https://github.com/vitejs/vite/pull/20421) 固化。

### 404 与 Error

独立模式的 `notFoundMiddleware()` 在所有普通中间件都 next 后返回空 404。middleware mode 不
安装它，宿主应用还有机会处理路由。

`errorMiddleware()` 必须保留四个形参；Connect 用函数 arity 判断它是错误中间件。错误会：

- 过滤/格式化后写入终端；
- 通过 client HotChannel 推给已打开页面的 ErrorOverlay；
- 独立模式返回能动态加载 Overlay 的 500 HTML；若 Overlay 自身加载失败，退回纯 DOM 错误页；
- middleware mode 可 `next()` 给宿主错误处理器。

`prepareError()` 只复制 message、stack、id、frame、plugin、loc 等必要字段，避免 PostCSS 等插件
挂载的完整对象导致序列化过大或失败，并移除终端控制字符。

## 用例怎样映射源码

| 用例                    | 锁定的机制                                               |
| ----------------------- | -------------------------------------------------------- |
| `hostCheck.spec.ts`     | 四类显式 host/origin 自动加入允许列表                    |
| `static.spec.ts`        | 父目录判断不能被相似字符串前缀绕过                       |
| `proxy-bypass`          | false、async、throw、上游失败的四条代理分支              |
| `base-conflict`         | 请求入口剥离 base 不应删除输出 import 的 base            |
| `fs-serve` matrix       | root 与 `/@fs/` 在 allow/deny/query/特殊路径下行为一致   |
| `fs-serve` raw request  | `#`、点段、反斜杠和 Source Map 穿越在 URL 规范化前被覆盖 |
| `fs-serve` cross origin | CORS、Host、WS Origin/token 是不同安全层                 |

fs-serve 矩阵同时检查正常 JSON/虚拟模块可用。安全测试若只断言“危险请求被拒绝”，很容易把
“全部请求都坏了”误认为成功；放行场景是必要的反证。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/server/index.ts`，`_createServer()` 的中间件装配：

```ts
// serve static files under /public
// this applies before the transform middleware so that these files are served
// as-is without transforms.
if (publicDir) {
  middlewares.use(servePublicMiddleware(server, publicFiles))
}

if (config.experimental.bundledDev) {
  middlewares.use(triggerLazyBundlingMiddleware(server))
  middlewares.use(memoryFilesMiddleware(server))
} else {
  // main transform middleware
  middlewares.use(transformMiddleware(server))

  // serve static files
  middlewares.use(serveRawFsMiddleware(server))
  middlewares.use(serveStaticMiddleware(server))
}
```

Connect 的注册顺序就是请求控制流：public 资源先原样返回；bundled-dev 改走内存文件；普通开发
模式先尝试模块转换，只有未处理请求才回退到 `/@fs/` 与 root 静态文件。

## 建议断点

1. `server/index.ts` 第一个 `middlewares.use()`：单步观察 Connect 怎样寻找下一个 handler。
2. `rejectInvalidRequestMiddleware()`：用原始 TCP 请求传入含 `#` 的 target。
3. proxy 的 HTTP/WS 两个 bypass 分支：比较 res 是否存在及 string 返回后的控制流。
4. `sirvOptions.shouldServe()`：比较请求 URL、sirv 最终 filePath 和 allow/deny 结果。
5. `isFileLoadingAllowed()`：按 deny、safeModulePaths、allow 三个入口观察优先级。
6. `htmlFallbackMiddleware()`：分别请求 `/about`、`/docs/`、未知 SPA 路径。
7. `send()`：用相同 ETag 重发请求，再比较 GET 与 HEAD。

## 复盘题

1. 如果 baseMiddleware 放在 proxy 前，用户应按公开 URL 还是内部 URL 配 proxy context？
2. 为什么 public 文件在 transform 前，而 root 静态文件在 transform 后？
3. CORS 已拒绝跨源浏览器请求时，为什么仍必须校验 Host？
4. 为什么 `/@fs/` 是路径编码协议，不是访问授权？
5. safeModulePaths 为什么不能覆盖 fs.deny？
6. 不存在且不允许的路径若直接返回 403，会破坏哪些宿主 API/SPA 场景？
7. Error middleware 少写一个未使用形参，为什么会导致 Connect 不再把错误交给它？
