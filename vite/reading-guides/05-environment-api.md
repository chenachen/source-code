# 05. Environment API

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本节研究 Vite 怎样把“一台开发服务器”拆成多个运行目标，以及每个目标如何持有自己的配置视图、
插件上下文和模块图，并接入依赖优化器和运行时通信。模块图的内部数据结构、transform 细节、HMR 传播算法
留给后续章节；生产构建的 `BuildEnvironment` 留给生产构建章节。

读完应能回答：

1. Environment API 解决了旧 `ssr: boolean` 模型的什么限制？
2. `environment.config` 为什么既像 `ResolvedConfig`，又能读到环境覆盖项？
3. client、默认 server、自定义远端运行时分别使用哪种 Environment？
4. `init()`、`listen()`、`close()` 各负责什么，为什么不能合成一个构造函数？
5. `RunnableDevEnvironment` 与 `FetchableDevEnvironment` 的通信能力边界是什么？
6. 同一插件实例跨多个 Environment 时，怎样避免缓存和状态串线？

## 推荐阅读顺序

1. `config.ts` 的 `EnvironmentOptions`、`resolveEnvironmentOptions()`：先理解配置怎样分层。
2. `baseEnvironment.ts`：看顶层配置与环境覆盖项如何合成。
3. `environment.ts`：看类型总入口和 `perEnvironmentState()`。
4. `server/environment.ts` 构造函数：看每个开发环境拥有的运行状态。
5. 同文件的 `init()`、`listen()`、`close()`：看生命周期。
6. `runnableEnvironment.ts` 与 `fetchableEnvironments.ts`：比较通信模型。
7. `environment.spec.ts`：从 resolve conditions 的开发/构建场景验证隔离性。

## 从 `ssr: boolean` 到 Environment

旧模型只有两条隐含分支：

```text
server.transformRequest(url, { ssr: false }) → client
server.transformRequest(url, { ssr: true })  → ssr
```

它无法自然表达 `client`、`ssr`、`worker`、`edge`、`rsc` 等任意数量的运行目标。模块节点中
也要同时保存 client/ssr 两套关系和 transform 结果，调用链到处传递 `ssr` 布尔值。

Environment API（[PR #16471](https://github.com/vitejs/vite/pull/16471)）把运行目标变成
显式对象：

```text
server.environments.client.transformRequest(url)
server.environments.ssr.transformRequest(url)
server.environments.edge.transformRequest(url)
```

Environment 本身已经确定上下文，不需要每个 API 再接受 `ssr` 参数。每个开发实例持有（依赖优化器可禁用或由框架注入，client 的 WebSocket 由顶层服务器提供）：

```text
Environment
├─ name / mode
├─ config / logger / plugins
├─ pluginContainer
├─ moduleGraph
├─ depsOptimizer
├─ hot transport
└─ transform / fetch / reload / close 等操作
```

`server.moduleGraph`、`server.pluginContainer`、`server.transformRequest({ ssr })` 仍存在，但只是
client/ssr 的迁移兼容门面。阅读新实现时应直接进入具体 Environment。

## 配置的三层结构

### 用户输入

下面示意配置结构；自定义工厂的实现省略。

```ts
export default {
  resolve: {/* 所有环境默认值 */},
  environments: {
    client: { consumer: 'client' },
    ssr: { consumer: 'server' },
    edge: {
      consumer: 'server',
      resolve: { conditions: ['workerd'] },
      dev: {
        createEnvironment(name, config) {
          /* ... */
        },
      },
      build: { outDir: 'dist/edge' },
    },
  },
}
```

`SharedEnvironmentOptions` 对开发与构建都有效，包括 input、define、resolve、consumer、
keepProcessEnv、optimizeDeps、isBundled。`dev` 和 `build` 子对象只放阶段专属选项。

### 已解析覆盖项

`resolveEnvironmentOptions()` 为每个名称分别确定：

- `consumer`：client 名称默认是 `client`，其他名称默认是 `server`；
- resolve conditions/mainFields/builtins；
- `keepProcessEnv` 和依赖优化策略；
- 默认 Environment 工厂；
- 开发态是否 recoverable、是否执行 Module Runner transform；
- 构建输出选项和 `isBundled`；
- 最终适用于该 Environment 的插件列表。

默认 client 创建普通 `DevEnvironment`，使用共享 WebSocket、禁止服务端 `fetchModule`；默认
非 client 创建 `RunnableDevEnvironment`，供服务端 Module Runner 执行模块。

### `environment.config` 代理

`PartialEnvironment` 不复制整份配置，而是建立 Proxy：

```text
读取 prop
├─ prop === logger → Environment 专属 logger
├─ prop 在环境覆盖项中 → environment._options[prop]
└─ 否则 → topLevelConfig[prop]
```

所以插件可以写 `this.environment.config.resolve.conditions`，也能读取共享 root、server、mode。
`getTopLevelConfig()` 在确实需要未覆盖的全局对象时显式返回原配置。

日志器也不复制底层输出逻辑，只在 info/warn/error 选项中附加 `(environmentName)`。名称字符
哈希产生稳定 info 颜色，warn/error 继续使用黄/红色。Environment 名称只允许字母数字、
`_`、`$`，因为它还会用于目录和 `environments.<name>` 访问，不应要求额外转义
（[PR #18255](https://github.com/vitejs/vite/pull/18255)）。

## 类层级不是运行时层级

```text
PartialEnvironment
  配置代理 + 日志
  │
  └─ BaseEnvironment
       最终插件列表 + _initiated
       │
       ├─ DevEnvironment          mode = dev
       │    ├─ RunnableDevEnvironment
       │    └─ FetchableDevEnvironment
       ├─ BuildEnvironment        mode = build
       ├─ ScanEnvironment         internal
       └─ UnknownEnvironment      mode = unknown
```

不要写 `environment.mode !== 'build'` 来判断开发态：未来可能新增模式。应正向判断
`environment.mode === 'dev'`，或使用 `isRunnableDevEnvironment()` 等能力型 type guard。

`UnknownEnvironment` 的意义就是阻止“除了 build 都是 dev”的封闭世界假设。

## `DevEnvironment` 持有的状态

构造函数依次建立：

1. 读取 `config.environments[name]`，再合并工厂传入的单实例 `context.options`；
2. 选择普通 transform 或完整打包开发模式；
3. 创建本 Environment 独占的 `EnvironmentModuleGraph`；
4. 创建首轮静态 import 稳定检测器；
5. 标准化 HotChannel，并注册 fetchModule/getBuiltins/invalidate 消息；
6. 按配置创建显式或自动发现依赖优化器。

Environment 插件列表已在配置解析时派生；插件容器仍需异步执行 `options` hook，
因此由 `init()` 创建，而非在同步构造函数中创建。`pluginContainer` getter 在 init 前主动报错，把错误生命周期访问暴露在
最近的位置。

每个模块图的 resolve 回调绑定自己的插件容器，因此相同 URL 可以在 client、ssr、edge 中
解析为不同 ID，具有不同 importers、transformResult 和 HMR 边界。

## 三阶段生命周期

### `init()`：创建插件容器

`init()` 接收共享 watcher，异步创建插件容器并完成 `options` hook。`_initiated` 在异步创建前
置位，防止重复进入；顶层服务器等待首次 init 完成后才继续装配。重启还传入 `previousInstance`，
默认实现不迁移它；自定义子类可在确认实例来源后迁移自己的状态。

输入登记属于容器 `buildStart()` 的收尾：先等待符合条件的插件 `buildStart` hook，再通过
`_registerInputsAsSafeModules()` 解析入口，把非 external 的绝对路径加入顶层共享的
`safeModulePaths`。它并非在 `init()` 中完成，也不是每个 Environment 的独立安全集合。
解析必须带 `scan: true`，否则会形成：

```text
dependency scan 触发首次 buildStart
→ buildStart 完成插件 hooks 后解析 input
→ 普通 resolve 等待 dependency scan
→ dependency scan 等待 buildStart
→ 死锁
```

未声明 input 时，回退 `index.html` 的解析异常被忽略；用户显式声明 input 时，解析器抛出的异常
继续向上传递。解析返回空或 external 时均不登记安全路径。插件 `buildStart` 错误发生在回退
解析之前，始终向上传递。顶层 input 同样经过插件解析（源码中的 #23101）。

### `listen()`：启动与预热

`listen()` 启动 HotChannel，初始化完整 bundle 或依赖优化器，再按配置 warmup 文件。它不创建
HTTP Server；顶层 Dev Server 负责网络监听，Environment 只启动自己的运行时能力。

服务器重启的严格顺序是：

```text
newEnvironment.init({ previousInstance })
→ previousEnvironment.close()
→ newEnvironment.listen(server)
```

先 init 新实例可在配置/插件创建失败时保留旧服务；先 close 旧实例再 listen 新实例可防止两套
优化器、通道或运行时同时工作。独立 `listen` 生命周期来自
[PR #18263](https://github.com/vitejs/vite/pull/18263)。

### `close()`：等待而不是只发出停止信号

关闭时先置 `_closing`，使 recoverable 环境的转换检查拒绝后续工作；停止首轮爬取完成检测，再并行等待：

```text
bundledDev.close() 或 pluginContainer.close()
depsOptimizer.close()
自定义 HotChannel.close()
全部在途 transform request settle
```

顶层 `WebSocketServer` 可能被多个 Environment 共享，不能由单个实例关闭；它由 Dev Server
统一释放。自定义 HotChannel 由所属 Environment 在这里关闭。所有分支使用
`allSettled()`，单个插件清理失败不能制造其他资源泄漏。

## transform、warmup 与首轮爬取

`transformRequest(url)` 进入当前 Environment 的 resolve → load → transform 管线并更新其模块
图。自定义 transport 可以声明远端已经执行 fs 安全校验，Vite 才允许跳过本地检查；普通
WebSocket 不能借这个字段绕过 `/@fs/` 边界。该安全修复见
[PR #22159/#22163](https://github.com/vitejs/vite/pull/22159)。

`warmupRequest(url)` 是投机预转换：

- 完整打包开发模式无需逐 URL 预热；
- 优化依赖已换代、服务器已关闭属于正常取消；
- 其他错误记日志，但不能产生无人等待的 rejection；
- 它不改变真实请求遇错时仍应失败的语义。

首轮静态 import 发现使用 `CrawlEndFinder`：每个 id 只登记一次；在途集合清空后再等待 50ms
静默期，吸收刚发现的下一层 import。`waitForRequestsIdle(id)` 若在插件 hook 内调用，必须传入
当前 id 把自己排除，否则 hook 等待的正是由自己完成的任务。

## 运行时通信的三个级别

### 原始 `DevEnvironment`

提供 transform、fetchModule、模块图和 HotChannel 等开发能力。框架/运行时集成者自行定义
模块执行器和应用请求处理器，并安排跨运行时的请求与结果传输。

### `RunnableDevEnvironment`

```text
Vite Server 进程
├─ DevEnvironment
└─ ModuleRunner → 在同一 JS runtime 执行用户模块
```

`runner.import()` 可以直接返回函数、类实例等活的 JavaScript 值，无序列化成本。但它要求用户
模块与 Vite Server 运行在同一个 runtime，不能代表独立 Worker/边缘沙箱。

Runner 惰性创建并缓存：未使用 SSR 执行时不修改进程 Source Map 行为，也不承担模块执行成本。
关闭时只有已经创建的 Runner 才会被关闭，避免为清理反向创建资源；漏关 Runner 曾导致模块
缓存/HMR listener 存活（[PR #18282](https://github.com/vitejs/vite/pull/18282)）。

### `FetchableDevEnvironment`

```text
宿主中间件 Request
→ environment.dispatchFetch(request)
→ context.handleRequest(request)
→ 目标运行时
→ Response
```

它把应用请求入口限定为标准 Fetch `Request`/`Response`。框架提供的 `handleRequest` 可以再把请求
转交独立 Worker/Edge 运行时；本类只调用处理器，不实现进程通信或序列化。这个 API 返回 Response，
不会像 `runner.import()` 那样直接返回模块导出的函数、类实例。

工厂先检查全局 Request/Response 是否存在和 handleRequest 是否提供；dispatch 时再用 `instanceof` 检查输入输出，
尽早发现 polyfill/realm 不一致或错误返回普通对象。该实验接口来自
[PR #19664](https://github.com/vitejs/vite/pull/19664)。

## 插件状态怎样按 Environment 隔离

同一个插件实例会跨 Environment 调用 hook：

```ts
import { perEnvironmentState } from 'vite'

const getState = perEnvironmentState(() => ({ transformed: 0 }))

export default {
  name: 'counter',
  transform() {
    getState(this).transformed++
  },
}
```

`perEnvironmentState(initial)` 内部使用 `WeakMap<Environment, State>`：

- key 是实例，不是名称；同名重启后的新实例拥有新状态；
- 值只在该 Environment 第一次调用时创建；
- Environment 不可达后，WeakMap 不阻止回收；
- 必须用 `stateMap.has(environment)` 判断是否初始化。

若用 `if (!stateMap.get(environment))`，合法的 `false`、`0`、`''` 会在
每次 hook 调用时重新初始化；[PR #22715](https://github.com/vitejs/vite/pull/22715) 就修复了
这个 falsy 状态缓存问题。

## 用例怎样证明隔离

`environment.spec.ts` 为 `ssr`、`worker`、`custom1`、`custom1_2` 配置不同/相同 resolve
conditions，并从四条路径读取同一个条件导出包：

| 场景           | 经过的解析路径              | 证明什么                                 |
| -------------- | --------------------------- | ---------------------------------------- |
| dev noExternal | Vite 插件 resolve/transform | conditions 随 DevEnvironment 隔离        |
| dev external   | ModuleRunner 原生外部加载   | externalConditions 也随 Environment 隔离 |
| 兼容 SSR + CSS | `server.ssrLoadModule()`    | 旧 API 正确代理到默认 SSR Environment    |
| build          | 四个 BuildEnvironment       | 同一配置隔离模型跨开发与构建成立         |

`custom1` 与 `custom1_2` 故意使用相同条件但不同名称：相同输出不是按名称写死，同时也证明
配置结果相同不意味着必须共享 Environment 实例或模块图。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/baseEnvironment.ts`，`PartialEnvironment`
构造函数：

```ts
this.config = new Proxy(
  options as ResolvedConfig & ResolvedEnvironmentOptions,
  {
    get: (target, prop: keyof ResolvedConfig) => {
      if (prop === 'logger') {
        return this.logger
      }
      if (prop in target) {
        return this._options[prop as keyof ResolvedEnvironmentOptions]
      }
      return this._topLevelConfig[prop]
    },
  },
)
```

Environment 配置不是深拷贝：环境覆盖项优先，未覆盖字段回退顶层配置，`logger` 则绑定环境
包装器。这个代理只定制属性读取，不做深拷贝，也没有阻止写入的 trap；因此它不是不可变配置，
嵌套对象仍共享原配置引用。

输入登记的调用时机来自 `server/pluginContainer.ts` 的 `buildStart()`（源码摘录，省略 hooks
收集与门闩）：

```ts
this._buildStartPromise = (async () => {
  await hookPromise
  if (this.environment.mode === 'dev') {
    await this.environment._registerInputsAsSafeModules()
  }
})()
await this._buildStartPromise
```

`hookPromise` 失败时不会进入输入登记；默认 `index.html` 的解析容错只在后续登记方法内部生效。
`dev.spec.ts` 的“fallback inputs 不吞 buildStart 错误”用例，正是区分这两个失败阶段。

状态隔离来自 `environment.ts` 的 `perEnvironmentState()`（源码摘录）：

```ts
const stateMap = new WeakMap<Environment, State>()
return function (context: PluginContext) {
  const { environment } = context
  if (!stateMap.has(environment)) {
    stateMap.set(environment, initial(environment))
  }
  return stateMap.get(environment)!
}
```

例如初始化返回 `0`，第一次调用写入 Environment 实例对应的槽位，第二次 `has()` 仍为 true。
同名重启后传入新实例，则新建另一个槽位；名称相同不等于缓存 key 相同。

## 建议断点

1. `resolveEnvironmentOptions()`：比较 client、ssr、worker 的 consumer 和默认 dev 工厂。
2. `PartialEnvironment` Proxy 的 get trap：分别读取环境覆盖字段与顶层字段。
3. `DevEnvironment` 构造函数：比较 client WebSocket 和 server HotChannel。
4. `init()`：确认 pluginContainer 在构造后、初始化前确实不可访问。
5. `CrawlEndFinder.registerRequestProcessing()`：观察多层静态 import 怎样延长静默期。
6. `RunnableDevEnvironment.runner`：确认首次读取才创建，之后身份稳定。
7. `perEnvironmentState()`：用两个 Environment 调同一个插件 hook，观察 WeakMap 槽位。

## 复盘题

1. 为什么 Environment 配置用 Proxy 兜底顶层配置，而不是把完整对象深拷贝一份？
2. 为什么 client 默认禁用 fetchModule，server 默认启用 Module Runner transform？
3. 如果所有 Environment 共享 moduleGraph，resolve conditions 不同时会出现什么缓存错误？
4. 为什么 WebSocketServer 由顶层 Server 关闭，自定义 HotChannel 却由 Environment 关闭？
5. Runnable 能传递任意值却不适合边缘运行时，Fetchable 能跨运行时却失去了什么？
6. 为什么 `WeakMap.get()` 的真值判断不能表示“状态是否已初始化”？
