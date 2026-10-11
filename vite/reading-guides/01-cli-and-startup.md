# 01. CLI 与启动链路

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读目标

本模块只解决一个问题：终端中的 `vite`、`vite build`、`vite optimize`、
`vite preview` 怎样进入对应 Node API。

读完应能区分两个层次：

- `bin/vite.js` 是前置引导层：在加载 CLI 主模块前记录启动时间，按参数设置调试环境、
  启动 CPU Profiler，并尝试启用 Node.js 编译缓存。
- `src/node/cli.ts` 是命令分发层：注册参数，把 CLI 值整理成 `InlineConfig`，然后调用
  `createServer()`、`createBuilder()`、`optimizeDeps()` 或 `preview()`。

CLI 不负责模块解析、转换或构建算法。对应实现会在后续模块继续追踪。

## 主调用链

```text
package.json#bin
└─ packages/vite/bin/vite.js
   ├─ 记录 __vite_start_time
   ├─ 预解析 --debug / --filter / --profile
   ├─ 尝试启用 Node.js compile cache
   └─ import('../dist/node/cli.js')
      └─ src/node/cli.ts
         ├─ cac 注册全局选项
         ├─ cac 注册 dev/build/optimize/preview
         └─ cli.parse()
            ├─ dev     → createServer() → server.listen()
            ├─ build   → createBuilder() → builder.buildApp()
            ├─ optimize→ resolveConfig() → optimizeDeps()
            └─ preview → preview()
```

开发源码位于 `src/node/cli.ts`，发布前会被打包成 `dist/node/cli.js`。bin 入口导入后者，
它们是同一 CLI 在开发与发布时的文件形式。

## 关键对象

### `global.__vite_start_time`

引导入口记录启动时间。Dev Server 成功监听后，`cli.ts` 用它计算包含 CLI 模块加载、配置解析
和服务器创建在内的总启动耗时。若只在 `createServer()` 内开始计时，会漏掉 CLI 前置成本。

### `global.__vite_profile_session`

`--profile` 模式必须先启动 V8 Inspector，再加载 CLI 主模块，否则采样会漏掉模块求值和
配置加载。会话通过全局变量跨越 bin 与打包后的 CLI chunk。

开发服务器随后提供 `p` 快捷键：停止时写出 `.cpuprofile` 并清空当前会话引用，再次开始时
创建新会话。build 和 preview 在正常完成后停止入口采样；optimize action 没有对应的结束调用。

### `GlobalCLIOptions`

cac 返回的参数既含全局字段，也含命令专属字段。`cleanGlobalCLIOptions()` 将两者拆开：

```text
--mode staging       → InlineConfig.mode
--port 5174          → InlineConfig.server.port
--sourcemap hidden   → InlineConfig.build.sourcemap
--watch              → InlineConfig.build.watch = {}
```

若不清理，全局字段会错误进入 `server`/`build` 子配置；若不转换，字符串和布尔 CLI 值
又可能覆盖 Node API 需要的结构化配置。

## 容易忽略的场景

CLI 启动时会检查 Node 版本；不满足 `20.19+`、`22.12+` 或更高主版本时打印警告，然后继续
解析命令。后续能否完成取决于运行时是否提供实际调用的 API。

### 调试参数必须提前处理

Vite 模块在首次加载时创建带命名空间的调试函数。因此 `DEBUG` 必须早于
`import('../dist/node/cli.js')` 设置。已有 `DEBUG` 还需合并，不能覆盖其他工具的调试
命名空间。相关修复：[PR #6504](https://github.com/vitejs/vite/pull/6504)。

### Node.js 编译缓存需要提前写出

`module.enableCompileCache()` 缓存 Node.js 对 Vite 自身模块的编译结果，不是 Vite 的
依赖预构建缓存。Node.js 默认在进程结束时写缓存，但开发服务器可能长期运行或直接
`process.exit()`；所以入口在 10 秒后主动 flush，并对定时器调用 `unref()`。

- [启用编译缓存：PR #18323](https://github.com/vitejs/vite/pull/18323)
- [提前 flush：PR #19537](https://github.com/vitejs/vite/pull/19537)

### 重复参数取最后一个

输入 `vite --port 3000 --port 4000` 时，cac 会返回数组。Vite 配置只接受单值，
`filterDuplicateOptions()` 按常见 CLI 规则保留最后一个值。相关修复：
[PR #10474](https://github.com/vitejs/vite/pull/10474)。

### 数字 `host` 与特殊 `base`

cac 会推断纯数字参数类型：`--host 0` 得到 number，但服务器需要字符串 host；
`--base 0` 则是历史上表达空 base 的特殊写法。两者在 option type hook 中归一化。

- [host 修复：PR #14013](https://github.com/vitejs/vite/pull/14013)
- [base 修复：PR #14283](https://github.com/vitejs/vite/pull/14283)

### `--watch` 不能破坏配置文件

CLI 的 `--watch` 是 boolean，构建 API 的 `watch` 是对象。显式传入时应转换成 `{}`；
未传入时应保持 `undefined`，让配置文件中的 `build.watch` 正常参与后续合并。相关修复：
[PR #18390](https://github.com/vitejs/vite/pull/18390)。

转换成 `{}` 后，`mergeConfig()` 会继续保留文件中 watch 对象的具体字段。CLI 不直接覆盖
整份监听配置。`--app` 则放到顶层 `builder: {}`，不能混进 `build` 子对象。

## 测试怎样证明链路

`playground/cli/__tests__/serve.ts` 不使用默认 E2E 启动器，而是创建真实子进程：

```text
Serve 模式：vite --port <port> --strict-port
Build 模式：vite build → vite preview --port <port> --strict-port
```

`cli.spec.ts` 验证两件事：

1. 浏览器能够访问页面并执行模块，证明 bin、参数解析、命令 action 和服务器均已连通。
2. 修改 `vite.config.js` 后 CLI 子进程保持存活并输出重启信息，且端口不变时不重复打印
   URL。该用例只在 Serve 模式运行。

运行 Serve 场景：

```bash
pnpm vitest run -c vitest.config.e2e.ts playground/cli/__tests__/cli.spec.ts
```

运行 Build/preview 场景：

```bash
VITE_TEST_BUILD=1 pnpm vitest run -c vitest.config.e2e.ts playground/cli/__tests__/cli.spec.ts
```

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/cli.ts`，CLI 默认 action：

```ts
const { createServer } = await import('./server')
try {
  const server = await createServer({
    root,
    base: options.base,
    mode: options.mode,
    configFile: options.config,
    configLoader: options.configLoader,
    logLevel: options.logLevel,
    clearScreen: options.clearScreen,
    server: cleanGlobalCLIOptions(options),
    forceOptimizeDeps: options.force,
    experimental: {
      bundledDev: options.experimentalBundle,
    },
  })
  // 后续 HTTP 检查、监听和日志处理省略。
} catch (e) {
  const logger = createLogger(options.logLevel)
  logger.error(colors.red(`error when starting dev server:\n${inspect(e)}`), {
    error: e,
  })
  await stopProfiler(logger.info)
  process.exit(1)
}
```

dev action 在选中开发命令后取得 `createServer()`，再把整理好的 `InlineConfig` 交给它。
服务器对象创建后还要 `await server.listen()`，HTTP 监听成功后才打印 ready 横幅、URL 和快捷键。
创建或监听失败时，catch 输出错误、停止活动采样，然后以退出码 1 结束进程。

这里的动态 import 是命令分发写法。CLI 还静态导入了 `createBuilder()`，它经 `build.ts`、
`config.ts` 依赖服务器模块；模块加载成本应按整个依赖图理解。

## 推荐断点

1. `packages/vite/bin/vite.js` 的 `start()`。
2. `src/node/cli.ts` 中 dev action 的 `createServer()`。
3. build action 的 `createBuilder()`。
4. `filterDuplicateOptions()` 和 `cleanGlobalCLIOptions()`。
5. `playground/cli/__tests__/serve.ts` 的 `execaCommand()`。

## 复盘题

1. 为什么 `--debug` 和 `--profile` 不能完全交给 cac 解析？
2. 为什么 CLI 要删除全局字段后再把剩余对象传给 `server` 或 `build`？
3. `vite build --watch` 为什么不能直接把 boolean `true` 传给构建 API？
4. `bin/vite.js` 的 compile cache 与依赖预构建缓存有何区别？
