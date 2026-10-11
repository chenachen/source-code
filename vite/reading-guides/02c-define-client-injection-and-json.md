# 02C. Define、客户端配置注入与 JSON 模块

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读边界

本章接续 02A 的 env 加载与 02B 的配置解析，回答解析后的值怎样真正进入用户代码和 Vite 客户端：

```text
config.define / config.env / mode / base / server.ws
├─ bundled build/dev → Rolldown 原生 define transform
├─ SSR dev           → Vite definePlugin + Oxc transform
├─ client dev 全局值 → clientInjectionsPlugin
└─ client dev import.meta.env.* → importAnalysisPlugin（第 10 章）
```

JSON 模块放在本章末尾：它既是配置数据，又具有 default/named import、`?url`、`?raw` 与 HMR 等模块
语义。

读完应能回答：

1. 为什么 define 不能简单用 `String.replace()`？
2. client dev 为什么跳过 definePlugin 的逐模块 transform？
3. build、bundled-dev 与 SSR dev 分别由谁执行 define？
4. `process.env` 为什么在库构建中不替换？
5. 裸 `import.meta.env` 怎样汇总内建 env 与用户 define？
6. 未知点属性与计算属性为什么处理不同？
7. 快速正则怎样同时匹配 `process.env` 与 `process?.env`？
8. 每个 Environment 为什么单独缓存 define 产物？
9. client.ts 中的 WebSocket 地址为何由编译期占位符注入？
10. middleware mode 的 HMR 端口优先级是什么？
11. `@vite/env` 怎样把点路径写进不同 JavaScript realm？
12. JSON named exports 与 stringify=auto 分别解决什么问题？

## 推荐阅读顺序

1. `plugins/define.ts` 的 `definePlugin()` 外层分支。
2. `generatePattern()`：define 表、裸 env 对象和快速正则。
3. `replaceDefine()`、`serializeDefine()`。
4. `plugins/clientInjections.ts`：unbundled client 的另一条路径。
5. `client/env.ts`：define 对象怎样写入 global。
6. `plugins/json.ts` 的类型与请求判断，再结合 Rolldown 原生 JSON 插件理解。
7. 对照 define 单元测试、define playground 与 JSON playground。

## Define 的三条执行路径

| Environment               | 执行位置                               | 原因                             |
| ------------------------- | -------------------------------------- | -------------------------------- |
| bundled build/bundled-dev | Rolldown `transform.define` / 原生插件 | bundler 已解析 AST，避免重复转换 |
| SSR unbundled dev         | `definePlugin.transform` → Oxc         | Node/Runner 需要实际替换后的模块 |
| client unbundled dev      | client injection + import analysis     | 避免每个浏览器模块启动 Oxc       |

`define.spec.ts` 用同一 helper 构造 SSR dev 与 native build 路径，分别检查显式 define 替换。
内建 env 的处理还取决于 command 与 isBundled：unbundled dev 的 env 对象由 import analysis 注入。

## 为什么不是字符串替换

以下源码只应改表达式位置：

```js
console.log(process.env.NODE_ENV)
console.log('process.env.NODE_ENV')
console.log(`value: ${process?.env.NODE_ENV}`)
```

Oxc/Rolldown define 能区分字符串文本、模板表达式、属性访问与标识符边界。它还生成 sourcemap；对象值
造成位置变化时 map 仍要与上游插件合成，相关修复见
[PR #15805](https://github.com/vitejs/vite/pull/15805)。

transform 前先跑快速正则。正则 key 来自实际 define 表，并把属性点扩成可选问号加点，所以
`process?.env` 也能命中。未命中直接返回，不启动 AST transform；这项优化见
[PR #14788](https://github.com/vitejs/vite/pull/14788)。

## `process.env` 与库模式

非库模式且 `environment.config.keepProcessEnv=false` 时，默认定义：

```text
process.env / global.process.env / globalThis.process.env → {}
三种 NODE_ENV 路径 → 当前 NODE_ENV 或 mode
```

client dev 只替换具体 `process.env.NODE_ENV` 表达式，不创建全局 process shim。否则依赖可能在 dev 看到
一个对象、build 又看到编译期常量，产生环境差异。

库构建完全跳过默认 process.env 替换。库是给下游应用消费的中间产物，不能固化库作者机器上的 mode，
也不能替最终宿主决定 Node/browser polyfill 策略。

server consumer 默认 `keepProcessEnv=true`，所以 SSR dev 通常保留运行时环境；client consumer
和旧 `ssr.target: 'webworker'` 默认关闭。用户显式的 process.env define 仍可参与替换，库模式
跳过的是 Vite 自动生成的默认表。

## `import.meta.env`

bundled 环境把 config.env 展开为静态点属性，并补：

- `import.meta.env.SSR`：按当前 Environment consumer 计算；
- `import.meta.hot`：生产 build 默认 undefined，便于 tree-shaking；
- `import.meta.env.*`：未知静态属性为 undefined；
- 裸 `import.meta.env`：序列化成完整稳定对象。

同一 resolved config 可同时创建 client/server Environment，SSR 不能在插件创建时提前固定。define 表由
Environment WeakMap 惰性缓存，不同环境分别生成；环境不再被持有时，相应缓存也可回收。

build 时，用户 `define['import.meta.env.X']` 同时进入点属性替换和裸 env 对象。bundled-dev 的
用户值仍进入点属性表，但 `userDefineEnv` 的收集受 `isBuild` 控制，裸对象只汇总 config.env 与 SSR；
因此当前版本中 `import.meta.env.X` 与 `import.meta.env['X']` 对这类额外定义可得到不同结果。

源码摘录，`plugins/define.ts` 的 `generatePattern()`；字符串先按 define 约定转换，裸对象单独收集：

```ts
for (const key in environment.config.define) {
  userDefine[key] = handleDefineValue(environment.config.define[key])
  if (isBuild && key.startsWith('import.meta.env.')) {
    userDefineEnv[key.slice(16)] = environment.config.define[key]
  }
}
```

`serializeDefine()` 对 key 排序，使裸对象输出顺序稳定；相关修复见
[PR #17748](https://github.com/vitejs/vite/pull/17748)。字符串值按
“源码表达式”处理，而不是自动 JSON stringify，因此可以写 `undefined`、`window` 或兼容标识符；普通对象
和数值才 JSON 序列化。

计算属性 `import.meta.env['UNKNOWN']` 不由静态通配规则直接消去；它保留为序列化 env 对象上的
属性读取，键也可来自变量。静态 `.UNKNOWN` 则直接替为 undefined。用户可用同值 define 保留
某个静态访问，`preserve import.meta.env.UNKNOWN with override` 测试覆盖该写法。

## Client injections

`clientInjectionsPlugin()` 只应用于 unbundled Environment。buildStart 先解析 hostname，再生成一个闭包，
transform 命中规范化后的 client 或 env 入口时替换其中的占位符：

- mode、base、server host；
- WebSocket protocol/hostname/port/path/direct fallback；
- HMR timeout、overlay 开关、配置文件显示名；
- WebSocket token；
- forward-console 配置；
- 非 import.meta.env 的用户 define。

用函数作为 `String.replace` replacer，避免序列化值中的 `$&`、`$1` 被解释成替换模板。

HMR 端口优先级：

源码摘录，`plugins/clientInjections.ts` 的 `createClientConfigValueReplacer()`：

```ts
let port = wsConfig?.clientPort || wsConfig?.port || null
if (config.server.middlewareMode && !isWsServerSpecified) {
  port ||= 24678
}
```

```text
server.ws.clientPort
→ server.ws.port
→ middlewareMode 且未提供独立 WS server 时 24678
→ client 运行时 new URL(import.meta.url).port
```

首次连接的 path 使用 `path.posix.join(devBase, server.ws.path)`。directTarget 使用显式 ws host/port，
缺省时回到已解析 server hostname/port，并只附加 dev base；它不追加 server.ws.path。
普通 client 首连失败且没有显式 HMR 端口时才尝试该直连地址，已有端口配置时直接暴露连接错误。
bundled-dev 读取 `bundledDevClient.ts` 后走同一配置 replacer，复用这组连接配置值；Rolldown runtime
无法额外 import `@vite/env`，所以内联前删除该副作用 import。

## `@vite/env` 与 realm

`client/env.ts` 选择全局对象：

```text
globalThis → self → window → Function fallback
```

因此同一注入代码可在页面、Web Worker 与旧宿主中执行。每个 define key 按点拆段，逐层创建对象，最后
写叶值。它只负责全局 define；正常 `import.meta.env` 已在模块转换阶段静态处理。

带 query 的 env 入口仍需识别为同一内部模块，修复见
[PR #20998](https://github.com/vitejs/vite/pull/20998)。

## JSON 模块

`resolvePlugins()` 注册 `viteJsonPlugin({ ...config.json, minify: isBuild })`。实际转换来自
Rolldown 1.2.1 的原生插件，按以下条件选择输出：

1. `namedExports=true` 且输入是对象：生成顶层命名导出和由它们组成的 default 对象。
   这一分支优先，即使 `stringify=true` 也使用对象字面量，供 bundler 删除未使用属性。
2. 未进入对象命名导出分支时，`stringify=true` 生成 `JSON.parse("...")`；`'auto'` 仅在去 BOM 后
   原始源码超过 10,000 UTF-8 字节时启用。数组也走这个判断。
3. 其余输入生成 JavaScript 字面量。若希望对象使用 JSON.parse，需要同时设 `namedExports=false`。

例如默认选项下 `{ "hello": "world" }` 有命名导出 hello 和对象 default；小数组 `[1, 2]`
直接生成数组，较大数组则可生成 JSON.parse。这里的输出分支见
[Rolldown 1.2.1 原生实现](https://github.com/rolldown/rolldown/blob/v1.2.1/crates/rolldown_plugin_vite_json/src/lib.rs)，
阈值见其 [constants.rs](https://github.com/rolldown/rolldown/blob/v1.2.1/crates/rolldown_plugin_utils/src/constants.rs)。

本地 `isJSONRequest()` 同时识别 `.json`/`.json5` 及其 query，但原生插件默认转换的是 `.json`，
该辅助判断不等于默认支持 JSON5 语法。`?url` 与 `?raw` 被原生 JSON 插件的特殊 query 检查跳过，
随后由 assetPlugin 返回 URL 或原文本。
playground 同时区分：

| 写法                | 结果                              |
| ------------------- | --------------------------------- |
| `import data`       | 完整对象 default                  |
| `import { key }`    | 顶层 named export                 |
| `import()`          | 含 default/named 的 namespace     |
| `fetch('/x.json')`  | 原始 HTTP JSON                    |
| `?url`              | 资源 URL，bundled 时可能 data URL |
| `?raw`              | 原文件文本                        |
| CJS `require(json)` | Node 风格对象，不额外套 default   |

JSON playground 的 HTML 入口直接导入 hmr.json，没有 hot.accept 边界。编辑 JSON 后更新沿导入者
到达页面入口，触发 full reload；`should full reload` 用例检查重新执行页面后展示的新值。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/plugins/define.ts`，`definePlugin()`：

```ts
const isBuild = config.command === 'build'
const isBuildLib = isBuild && config.build.lib

const processEnv: Record<string, string> = {}
if (!isBuildLib) {
  const nodeEnv = process.env.NODE_ENV || config.mode
  Object.assign(processEnv, {
    'process.env': `{}`,
    'global.process.env': `{}`,
    'globalThis.process.env': `{}`,
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'global.process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'globalThis.process.env.NODE_ENV': JSON.stringify(nodeEnv),
  })
}
```

外层先决定是否生成默认表，`generatePattern(environment)` 再通过 keepProcessEnv 决定是否将它
合入当前环境。三个全局对象拼写拥有同一默认值；用户 define 随后覆盖同名条目。

## 建议断点

1. `definePlugin.applyToEnvironment()`：比较 bundled 与 unbundled 返回值。
2. `generatePattern()`：分别观察 client/server define 表。
3. `pattern.test(code)`：用普通属性与可选链各停一次。
4. `replaceDefine()`：看 Oxc 输出与 map。
5. `createClientConfigValueReplacer()`：观察 middleware/ws 端口优先级。
6. `client/env.ts` 的 segments 循环：看点路径怎样创建对象。

## 复盘题

1. 若 client dev 每个模块都运行 Oxc define，会增加什么成本？
2. 为什么用户字符串 define 不自动 JSON.stringify？
3. 为何库构建不能默认把 process.env 变成空对象？
4. `import.meta.env.UNKNOWN` 与 `import.meta.env[key]` 为什么不能同样处理？
5. 为什么 client 配置值要在服务端解析后注入，而不是浏览器请求一个 config JSON？
6. JSON named export 与 `JSON.parse` 优化是否解决同一个问题？
