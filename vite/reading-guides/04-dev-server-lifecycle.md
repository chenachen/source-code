# 04. Dev Server 生命周期

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节研究开发服务器怎样创建、监听、关闭与原地重启，以及端口、文件监听和 CLI 快捷键如何
跨生命周期保持一致。请求经过哪些中间件、模块怎样 transform、文件变化怎样生成 HMR 更新，
分别留给后续模块。

读完应能回答：

1. `createServer()` 为什么不等于“服务器已经监听”？
2. middleware mode 与普通模式共用哪些资源，又在哪些地方分叉？
3. 为什么 client Environment 会提前 `buildStart`，其他 Environment 却保持惰性？
4. `port: 0`、端口冲突、通配地址和 `strictPort` 如何共同决定真实端口？
5. `close()` 为什么同时需要幂等门闩、`allSettled()` 和主动销毁 socket？
6. `restart()` 如何重建全部内部状态，却让用户持有的 server/middlewares 引用不变？

## 推荐阅读顺序

1. `server/index.ts` 的 `createServer()`、`_createServer()`：先看完整装配骨架。
2. 同文件的 `listen()`、`close()` 与 `createServerCloseFn()`：看启动和释放边界。
3. `http.ts`：看 HTTP/HTTPS Server 与端口选择算法。
4. `watch.ts`：看监听范围、忽略规则与关闭 watcher 时的兼容对象。
5. `server/index.ts` 的 `restartServer()`：带着前面的资源模型理解原地重启。
6. `shortcuts.ts`：看 readline 和快捷键定义怎样跨重启复用。
7. `dev.spec.ts`、`http.spec.ts`、`watcher.spec.ts`、`shortcuts.spec.ts` 和
   `cssPreprocessorTeardown.spec.ts`：用场景反推每条契约存在的原因。

## 总状态链

```text
createServer(inlineConfig)
└─ _createServer()
   ├─ resolveConfig('serve')
   ├─ 并行准备 public 文件、HTTPS、watch 配置
   ├─ 创建 Connect、HTTP Server（middleware mode 为 null）、WebSocket
   ├─ 创建 watcher 或 NoopWatcher
   ├─ 并行创建并 init 所有 Environment
   ├─ 建立旧 moduleGraph/pluginContainer 兼容门面
   ├─ 注册 watcher 事件与中间件栈
   ├─ initServer：插件 buildStart + configureServer 后置钩子
   └─ 返回 ViteDevServer（尚未占用端口）

server.listen()
├─ resolveHostname()
├─ startServer() → httpServerStart()
├─ listening 前先写入 resolvedUrls
├─ Environment.listen(server)
└─ 首次启动且配置 open 时打开浏览器

server.close()
└─ 共享同一个 close Promise
   └─ watcher / WebSocket / Environment / HTTP / SSR runner 并行关闭

server.restart()
└─ 共享同一个 restart Promise
   ├─ 先构造新 Server，失败则保留旧服务
   ├─ 关闭旧 Server
   ├─ 新状态迁入旧公开对象
   ├─ 复用旧 Connect 与 readline
   └─ 重新 listen 或只启动 middleware Environment
```

关键认知是：`createServer()` 只完成“可运行服务器对象”的构造，不主动调用底层
`httpServer.listen()`。这让嵌入方可以先追加中间件、事件监听或调整宿主服务器，再决定何时
占用端口。CLI 是 `await createServer()` 后显式 `await server.listen()`。

## `_createServer()` 的装配阶段

### 1. 配置与一次性归属

传入普通 `InlineConfig` 时先以 `serve` command 解析；传入 `ResolvedConfig` 时直接复用。
`usedConfigs` 防止同一个已解析配置对象同时属于两个 Server，因为其中的插件实例、缓存与
Environment 配置都带有生命周期状态。

开发服务器是长运行交互进程，所以关闭任务缓存：网络响应和 HMR 无法像纯构建产物一样从
缓存安全重放。

### 2. HTTP、WebSocket 与 Connect

普通模式创建：

```text
Connect middleware stack
        ↓ request handler
HTTP/HTTPS Server
        ↓ upgrade / custom HMR server
WebSocket Server
```

middleware mode 只创建 Connect 和 Environment，不创建/监听 HTTP Server。宿主应用通过
`app.use(vite.middlewares)` 接管网络入口；因此 `listen()`、`printUrls()` 在此模式没有意义。
WebSocket 仍会按 HMR 配置连接已有宿主或独立 HMR Server。

`resolveHttpServer()` 的选择规则：

- 无 HTTPS：HTTP/1 Server。
- HTTPS 且未配置 proxy：允许 HTTP/2，并启用 HTTP/1 fallback。
- HTTPS 且配置 proxy：使用 HTTPS/HTTP1，避免代理与 HTTP/2 兼容问题。
- HTTP/2 的 session 与 stream 错误显式吞掉，避免客户端重置连接导致未处理异常
  （[PR #21024](https://github.com/vitejs/vite/pull/21024)）。

### 3. 文件监听

watcher 不只监听 `root`：配置文件依赖、当前 mode 的 env 文件、位于 root 外的 publicDir 都
要显式加入。输出目录、缓存目录和 `.git` 被忽略，防止构建产物或依赖缓存反向触发开发更新。

`server.watch: null` 不返回 `null`，而是创建接口完整的 `NoopWatcher`。这样插件、Environment
和关闭流程仍可无条件调用 `add()`、`on()`、`close()`，不用把“是否启用 watcher”的分支扩散
到整条调用链。

watcher 的 create/delete/update 最终都会：

1. 检查 tsconfig 变化；
2. 通知各 Environment 的插件容器；
3. 更新 public 文件索引或模块图；
4. 进入 HMR 主流程。

public 文件新建时还要删除同路径已转换模块的 ETag 索引，否则请求可能命中旧 transform 缓存，
违反 public 文件优先规则。

### 4. Environment 初始化

所有 Environment 彼此无初始化顺序依赖，因此并行 `createEnvironment()` 与 `init()`。重启时
新 Environment 得到 `previousInstance`，可迁移仍有意义的状态；插件容器、模块图等与配置
绑定的部分仍会重建。

旧 API `server.moduleGraph` 与 `server.pluginContainer` 只是 client/ssr Environment 上的兼容
门面。阅读新代码时应优先沿 `server.environments[name]` 继续追踪。

### 5. 插件初始化门闩

`initServer()` 用 Promise 缓存初始化，避免并发请求或 `listen()` 重复执行：

```text
client.pluginContainer.buildStart()
→ configureServer 前置钩子已在装配过程中执行
→ 安装内部中间件
→ 执行 configureServer 返回的后置钩子（逆序）
```

client Environment 会提前 `buildStart`，因为它承担浏览器请求和兼容 API 的默认入口；其他
Environment 保持首次请求时惰性启动，避免没有 SSR/自定义环境请求时支付初始化成本。

`dev.spec.ts` 中的用例证明：`build.lib` 不应泄漏为开发态 Rolldown input；显式 Environment
input 可以预标为 safe module；入口缺少 `index.html` 只静默跳过，但插件 `buildStart` 错误不能
被同一个 fallback 吞掉。

## 监听与端口选择

### `resolvedUrls` 的时序

`server.listen()` 在底层 Server 上用 `prependListener('listening', ...)` 计算 `resolvedUrls`。
因此用户更早注册的普通 `listening` listener 被调用时，也能读取最终 URL。对应测试专门锁定
这个事件顺序，而不是只检查 listen 之后的结果。

首次启动可以按 `server.open` 打开浏览器；重启传入 `isRestart: true`，不会重复打开新标签页。
开启 `preTransformRequests` 时，打开前并行发起一次 HTML GET，使其中的静态 import 更早进入
预转换。这只是性能优化，请求失败会被忽略。

### `httpServerStart()` 算法

端口并不是简单地“listen 失败就 +1”：

```text
port === 0
  → 先在第一个 host 让 OS 分配随机端口
  → 其余 host 绑定同一个真实端口

strictPort === true
  → 直接尝试目标 host:port
  → 冲突立即失败，不扫描后续端口

strictPort === false
  → concrete host 监听前先探测通配地址上的冲突
  → 仅 EADDRINUSE 可以让端口 +1
  → 在所有候选 host 上成功后返回该端口
```

`port: 0` 必须让多地址共用同一个 OS 随机端口，而不是各分配一个端口
（[PR #23158](https://github.com/vitejs/vite/pull/23158)）。具体地址和通配地址可能互相占用，
所以要在实际绑定前预检通配地址；相关边界由
[PR #21381](https://github.com/vitejs/vite/pull/21381)、
[PR #22150](https://github.com/vitejs/vite/pull/22150) 固化。

只有 `EADDRINUSE` 表示“换端口可恢复”；权限、地址非法等错误必须直接抛出，不能伪装成端口
扫描（[PR #21642](https://github.com/vitejs/vite/pull/21642)）。每次探测都要成对解绑
`error`/`listening` listener，避免多 host、多端口重试累积监听器
（[PR #21451](https://github.com/vitejs/vite/pull/21451)）。

重启时 `startServer()` 记录“配置端口”和“上次真实端口”。若配置没变，就优先复用上次经过
冲突回退后得到的真实端口，避免页面 URL 重启后无故跳回原配置端口
（[issue #14418](https://github.com/vitejs/vite/issues/14418)）。

## 关闭语义

`server.close()` 不是一个简单的 HTTP close：

```text
close Promise 门闩
├─ watcher.close()
├─ ws.close()
├─ 每个 environment.close()
│  └─ plugin container → disposer/buildEnd/closeBundle
├─ closeHttpServer()
│  ├─ destroy 所有已跟踪 socket
│  └─ server.close()
└─ SSR compat ModuleRunner.close()
```

第一次调用建立 `closeServerPromise`，之后全部返回同一个 Promise，防止双重释放
（[PR #19204](https://github.com/vitejs/vite/pull/19204)）。互不依赖的资源使用
`Promise.allSettled()`：某个插件清理失败不能阻止 watcher、socket 和其他 Environment 退出。

`createServerCloseFn()` 监听所有连接并在关闭时主动 destroy，避免 keep-alive 让 Node 的
`server.close()` 长时间等待。若 Server 从未 listen，则直接完成，避免
`ERR_SERVER_NOT_RUNNING`。

`cssPreprocessorTeardown.spec.ts` 从外部资源角度验证完整关闭链：SCSS transform 启动
sass-embedded worker，`server.close()` 返回时 worker 必须已经退出。它验证的不是 CSS 输出，
而是 Environment/插件 disposer 的等待语义。

## 原地重启

重启的难点不是“再调用一次 createServer”，而是兼顾新配置和旧引用：

1. 并发 `restart()` 共享 `_restartPromise`，避免多个新实例同时争抢端口
   （[PR #21636](https://github.com/vitejs/vite/pull/21636)、
   [PR #21810](https://github.com/vitejs/vite/pull/21810)）。
2. 先完整构造新 Server，成功后才关闭旧 Server；配置错误时旧服务继续可用。
3. 暂不 listen 新实例，让旧 Server 先释放 HTTP/WS 资源和端口。
4. `Object.assign(oldServer, newServer)` 把新状态迁入用户一直持有的对象。
5. 保留旧 Connect 对象，只替换其 `stack`。否则宿主曾执行的
   `app.use(vite.middlewares)` 会继续指向旧中间件
   （[PR #15166](https://github.com/vitejs/vite/pull/15166)）。
6. `_setInternalServer()` 重绑新方法的闭包；传给 `configureServer` 的 reflex Proxy 也始终
   反射当前内部 Server。
7. 普通模式重新 listen；middleware mode 只调用各 Environment 的 `listen(server)`。

`restartServerWithUrls()` 只有在配置端口、host 或 DNS 地址顺序变化时重新打印 URL，减少无意义
日志。`resolvedUrls` 在关闭后归零，重新 listening 后再生成，不能跨实例当作永久配置读取。

## 预览服务器是独立装配链，不是开发服务器换 mode

`preview()` 解析 production 配置并服务 `build.outDir`，但不会创建 ModuleGraph、执行按请求 transform
或启用 HMR。它复用 HTTP、代理、CORS、host 校验和地址打印基础设施，形成另一条中间件链：

```text
resolveConfig(serve, production, isPreview=true)
→ CORS / host check
→ configurePreviewServer 前置钩子
→ proxy / compression / base
→ sirv(distDir)
→ SPA/MPA html fallback
→ configurePreviewServer 后置钩子
→ indexHtml / 404
→ listen / resolvedUrls / openBrowser
```

顺序决定可扩展性：proxy 必须早于静态文件；插件返回的后置钩子位于静态 fallback 与最终 HTML/404
之间；custom appType 不挂载 Vite 的 HTML fallback。`server.close()` 仍用 Promise 门闩，信号处理、插件
和编程调用同时关闭时只释放一次底层 HTTP Server。

`resolvePreviewOptions()` 逐项继承 `server` 的通用配置，但端口单独默认 4173，让 dev 5173 与 preview
可同时运行。CLI 在 dist 不存在且没有插件接管时给出“先 build”错误；编程调用保留空服务器，允许宿主
自行挂载内容。

## 启动辅助链路

- `publicDir.ts` 启动时建立 URL Set；遇到目录符号链接便退回逐请求 stat。无缓存路径必须确认拼接结果
  仍在 publicDir 内，不能让 `/../` 穿越边界。
- `searchRoot.ts` 识别 pnpm/lerna、package.json workspaces 和 Deno workspace；没有标记时退回最近包根，
  该结果参与默认 `server.fs.allow`。
- `warmup.ts` 后台展开显式文件与 glob。HTML 走 `transformIndexHtml` 以连带预转换入口，其他文件走
  Environment warmupRequest；root 外普通模块编码成 `/@fs/`，root 外 HTML 则忽略。
- `openBrowser.ts` 在 macOS 优先用 JXA 复用已运行 Chromium 的目标/空白标签，失败后无条件降级到
  `open` 包；`BROWSER=none` 禁用，`.js` 值则作为用户 Node 脚本执行。
- `logger.ts` 用级别阈值、WeakSet 错误去重与 `warnOnce` 控制噪声；只有可交互 TTY 才清屏折叠连续
  相同消息。网络 URL 标签与网卡名按索引对齐，超长标签截断（#22830）。

## 快捷键为什么属于生命周期

`bindCLIShortcuts()` 维护两个状态：一个 readline，以及按 key 合并的快捷键定义。再次绑定时，
同 key 使用最新定义，其他旧定义保留；因此插件和用户可以分别注册。

重启前临时移除旧 Server 对 readline 的所有权，避免 close 销毁 stdin；新 Server 复用同一
readline 和定义。插件 `configureServer` 会重新执行，同 key 的 action 必须替换为新 Server
闭包；用户手工追加的定义仍保留。这个边界由
[PR #21166](https://github.com/vitejs/vite/pull/21166) 修复，`shortcuts.spec.ts` 同时验证对象复用、
顺序和 action 归属。

## 历史问题对应的设计约束

| 历史问题                                | 今天源码中的约束                 |
| --------------------------------------- | -------------------------------- |
| 重复 close 触发多次清理（#19204）       | close Promise 幂等门闩           |
| 并发 restart 争抢端口（#21636、#21810） | restart Promise 合并调用         |
| middleware 引用在重启后失效（#15166）   | 复用 Connect，只替换 stack       |
| 非 strictPort 重启后端口漂移（#14418）  | 记录配置端口与真实端口           |
| 快捷键调用旧 Server（#21166）           | 迁移 readline 并重绑定定义       |
| wildcard/具体地址冲突（#21381、#22150） | 绑定前进行通配地址预检           |
| 端口重试吞掉其他网络错误（#21642）      | 只恢复 EADDRINUSE                |
| HTTP 探测监听器泄漏（#21451）           | 成功/失败路径都解绑临时 listener |
| 随机端口在多地址上不一致（#23158）      | 首个地址选端口，其余地址复用     |

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/server/index.ts`，`createServer()` 与
`_createServer()`：

```ts
export function createServer(
  inlineConfig: InlineConfig | ResolvedConfig = {},
): Promise<ViteDevServer> {
  return _createServer(inlineConfig, { listen: true })
}

export async function _createServer(
  inlineConfig: ResolvedConfig | InlineConfig | undefined = {},
  options: {
    listen: boolean
    previousEnvironments?: Record<string, DevEnvironment>
    previousShortcutsState?: ShortcutsState<ViteDevServer>
    previousRestartPromise?: Promise<void> | null
    previousForceOptimizeOnRestart?: boolean
  },
): Promise<ViteDevServer> {
  // The dev server is a long-running, interactive process whose outputs
  // (network responses, HMR updates) cannot be replayed from a cache.
  disableCache()

  const config = isResolvedConfig(inlineConfig)
    ? inlineConfig
    : await resolveConfig(inlineConfig, 'serve')

  if (usedConfigs.has(config)) {
    throw new Error(`There is already a server associated with the config.`)
  }
```

公开入口只确定“需要监听”，实际装配进入 `_createServer()`；已解析配置具有一次性 server
归属，重复复用会在创建任何长生命周期资源前失败。

## 建议断点

1. `_createServer()`：观察普通模式与 middleware mode 的 `httpServer` 差异。
2. `initServer()`：同时触发多个入口，观察 Promise 门闩和 client 的 eager `buildStart`。
3. `httpServerStart()`：分别传 `port: 0`、被占端口和 `strictPort: true`。
4. `closeServer()`：观察各 Environment disposer 与 HTTP socket 的并行关闭。
5. `restartServer()` 的 `Object.assign()` 前后：比较公开对象、Connect 与内部字段的身份。
6. `bindCLIShortcuts()`：观察插件定义如何在重启后覆盖同 key 的旧 action。
7. `preview()` 中插件前置/后置钩子执行处：观察中间件插入位置。
8. `checkPublicFile()` 的缓存/无缓存两条路径：比较性能短路与路径安全检查。

## 复盘题

1. 如果 `createServer()` 自动 listen，嵌入式宿主和用户事件监听会失去哪些控制？
2. 为什么关闭流程适合 `allSettled()`，初始化流程却常用 `Promise.all()`？
3. 为什么重启必须先构造新实例再关闭旧实例？如果顺序反过来，配置错误时会怎样？
4. 为什么只 `Object.assign()` 还不够，必须单独保留 Connect 并重绑闭包？
5. strictPort 为何不能先探测通配地址后再决定是否失败？
6. NoopWatcher 相比在每个调用点判断 `watcher !== null`，减少了哪类复杂度？
7. preview 为什么不能直接复用开发服务器的 ModuleGraph 和 transform 中间件？
8. publicDir 扫描因符号链接失败后，为何是退回 stat，而不是让服务器启动失败？
