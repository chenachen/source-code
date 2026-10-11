# 16. 公共 API、诊断与兼容类型边界

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 从出口、诊断与类型看协议边界

前面的章节沿配置、请求与构建推进；这一章把那些主链共享的出口、常量和工具接起来。
沿 `src/node/index.ts` 找到公开能力，再看调用方怎样使用 logger、路径工具和兼容代理，
最后核对类型用例实际证明了哪些契约。

## 从公共出口反查实现

`src/node/index.ts` 组织 `vite` 的 Node 公共出口。可按导出分组反向跳转：

```text
createServer / preview / build
→ 三条顶层运行链

defineConfig / resolveConfig / loadEnv
→ 配置链

Plugin / Environment / ModuleGraph / HotChannel
→ 扩展协议与状态模型

parse / minify / transformWithOxc / preprocessCSS
→ 可独立调用的工具能力

Rollup* aliases / esbuildVersion / mixed ModuleGraph
→ 历史兼容层
```

这里同时导出新的 Environment API、兼容 mixed ModuleGraph 和标有 deprecated 的旧名称。
`internalIndex.ts` 经 `vite/internal` 单独转出 Rolldown experimental 的 `reactRefreshWrapperPlugin`，供内部
集成使用。公开名称的类型与弃用标记在出口处汇合，实现的时序和状态沿导出的源文件继续追。

## 共享常量连接解析与协议

`constants.ts` 集中维护跨模块必须一致的协议值：

- `ROLLUP_HOOKS` 是构建侧 `injectEnvironment` 的钩子名称表：命中后包装 Environment 上下文，
  执行交给 Rolldown。dev pluginContainer 按自身实现调度钩子。
- client/server mainFields 与 conditions 分开，防止 SSR 误选 browser 入口。
- `DEV_PROD_CONDITION` 延迟到解析期替换成 development/production。
- `/@fs/`、`/@vite/client`、`/@vite/env` 是浏览器 URL 与内部文件/运行时之间的协议。
- `KNOWN_ASSET_TYPES` 必须同步 client.d.ts 和 MIME 注册，否则运行时、TS 与响应头会分裂。
- `defaultAllowedOrigins` 匹配 localhost 及其子域、127.0.0.1、[::1] 的 HTTP/HTTPS 来源。
- optimizer 错误码让请求层区分构建失败与缓存文件缺失，选择不同恢复路径。

`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` 沿用 esbuild 的目标字符串记法，实际供当前的
Oxc/Rolldown 及相关转换步骤使用。`scripts/generateTarget.ts` 取 `2026-01-01` 为基线日期，生成
`chrome111/edge111/firefox114/safari16.4/ios16.4`；iOS 与 Safari 按独立目标维护。

## 日志输出、状态与去重

`createLogger()` 先按 LogLevel 过滤，再按终端能力选择输出模式：

```text
CI / 非 TTY / 禁止清屏 → 获准输出的消息追加到 console
可交互 TTY            → 相同 type + msg 清屏更新为 (xN)
```

最近一次 `type/msg` 与计数器是模块级状态，由默认 logger 实例共享。`warnOnce` 的文本集合和
`loggedErrors` 的 WeakSet 则属于各自实例。

`warnOnce` 只在首次见到完整文本时调用输出，再登记文本；日志级别过滤了这次输出，文本仍会登记。
`warn/warnOnce/error` 也会先把 `hasWarned` 设为 true，所以它表示调用过警告或错误方法。

WeakSet 只登记携带 `options.error` 且通过级别过滤的错误对象。`error()` 每次仍调用输出，调用方需先查
`hasErrorLogged(error)` 再决定是否调用 `logger.error(..., { error })`。当前 baseEnvironment 将这项查询
转发给顶层 logger，保持错误身份表共享。WeakSet 不延长错误对象生命周期。

目标版本源码摘录，来源：`packages/vite/src/node/logger.ts`：

```ts
warnOnce(msg, opts) {
  if (warnedMessages.has(msg)) return
  logger.hasWarned = true
  output('warn', msg, opts)
  warnedMessages.add(msg)
},
error(msg, opts) {
  logger.hasWarned = true
  output('error', msg, opts)
},
```

future deprecation 再包一层策略：只有 `future.<key> = 'warn'` 才输出，消息包含替代 API、迁移文档和默认
开启的调用栈。调用栈会过滤 Vite dist 路径，但它仍属于完整消息，因此不同调用位置可能各警告一次。

`ignoreDeprecationWarnings()` 的状态恢复发生在同步函数调用之后。目标版本源码摘录，来源：
`packages/vite/src/node/deprecations.ts`：

```ts
export function ignoreDeprecationWarnings<T>(fn: () => T): T {
  const before = _ignoreDeprecationWarnings
  _ignoreDeprecationWarnings = true
  const ret = fn()
  _ignoreDeprecationWarnings = before
  return ret
}
```

正常返回会恢复进入前的状态；返回 Promise 时马上恢复，后续异步工作不在静默范围内。
同步抛错会跳过恢复语句，使全局标记保持 true。这是这段实现的控制流，调用方应按同步范围使用。

## utils 中的路径、合并与代理

`utils.ts` 被配置、解析、静态服务和诊断共用，各函数的输入边界要跟调用点一起读：

| 工具                    | 实际处理                                                    | 调用时要保留的条件                     |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `normalizePath`         | Windows 先转反斜杠，再用 posix.normalize                    | POSIX 上不替换反斜杠                   |
| `isInNodeModules`       | 检查 `node_modules` 子串                                    | 不验证是否完整目录段                   |
| `isNodeBuiltin`         | 接受 `node:` 前缀或内置名称表                               | 不验证带前缀的名称是否存在             |
| `recursiveReaddir`      | 递归返回非目录条目的绝对路径                                | 任意 symlink 会拒绝；EACCES 目录视为空 |
| `combineSourcemaps`     | 单 source 中间层走数组链，否则沿当前 filename 加载后续 map  | 不要求列表长度固定为 2                 |
| `transformStableResult` | dev 返回 null map；build 开启 sourcemap 时生成 boundary map | 保持行结构由调用方的编辑决定           |

`mergeWithDefaults` 先深复制默认值，再递归写入覆盖值：undefined 保留默认值，null 明确覆盖，数组和函数
整体替换。递归对象检查使用 `[object Object]` 标签，因此 class 实例也可能命中；复制后会得到普通对象，
Map/Set/Date 等标签则被 `deepClone` 拒绝。整体替换的用户对象保留原引用。

目标版本源码摘录，来源：`packages/vite/src/node/utils.ts`：

```ts
const clonedDefaults = deepClone(defaults)
return mergeWithDefaultsRecursively(clonedDefaults, values)
```

旧 `rollupOptions` 名称通过 getter/setter 代理到 `rolldownOptions`。初始化只在新字段缺省时取旧字段，
没有两者都缺省时的补值逻辑；函数的非空断言属于类型层，默认对象由调用方准备。
冲突检查比较两个字段的对象引用，内容相同但引用不同也会被认作同时提供。

新增 Environment 配置时，外层副本和内层所有权有区别。目标版本源码摘录，来源：
`packages/vite/src/node/utils.ts`：

```ts
function setupRollupOptionCompatForEnvironment(environment: any): any {
  if (!isObject(environment)) {
    return environment
  }
  const merged: Record<string, any> = { ...environment }
  if (isObject(merged.build)) {
    setupRollupOptionCompat(merged.build, 'build')
  }
  return merged
}
```

这里仅浅复制 Environment，`merged.build` 仍指向原 build 对象，兼容属性直接安装在这一共享层上。

## preview、快捷键与 Source Map 诊断

`preview()` 以 `command: 'serve'`、默认 `mode/NODE_ENV: 'production'` 解析配置，插件的 apply 判断因此走
serve 条件。它从 build.outDir 提供产物，不运行开发模块或 HTML 转换。`configurePreviewServer` 先执行，
返回的安装回调在静态服务与 HTML fallback 之后、最终 HTML/404 中间件之前执行，随后才开始监听。

`sirv` 的 `shouldServe` 回调调用 `shouldServeFile`。这个 helper 只在大小写不敏感文件系统上逐级核对
文件名大小写，在其他系统上直接返回 true；候选路径没有在这一回调内取 realpath。

CLI 快捷键复用 `_shortcutsState.rl`，每次绑定替换 line listener。已有键在原位置更新 action，新键插入
列表前面；同键的新注册会替换旧 action。输入在 action 执行期间被忽略，await 正常完成才解锁，action
拒绝会保留占用状态直到重新绑定。q 的 finally 会退出进程，即使关闭服务器失败。

Source Map 辅助流程连接第三方输入与浏览器调试结果：

```text
extractSourcemapFromFile → 先内联 data URL，再外部 map 文件
injectSourcesContent    → 对缺少内容的非虚拟 source 并行 readFile
applySourcemapIgnoreList → 保留旧索引，追加命中项并去重
getCodeWithSourcemap     → 生成 JS/CSS 的内联引用
```

`extractSourcemapFromFile` 只用 `mapFileCommentRegex` 把外部文件引用换成等长空白，内联 data URL 注释仍保留。
node_modules 中的 map/source 引用会按所属包根检查规范化的文本路径；各个读取候选未逐一取 realpath。
缺少 source 的 readFile 会写入 null 并产生警告，但畸形 URI 的 decodeURI、用户 ignoreList 回调等异常
仍可向上传播，不能从“缺文件只告警”推导所有 map 处理都不会影响转换。

## 类型目录的三类文件

### 1. Vite 自有协议类型

- `types/importMeta.d.ts`：通过全局声明合并加入 `hot/env/glob`，所以不能有顶层 import。
- `types/importGlob.d.ts`：重载按 eager/lazy 与 raw/url/worker query 声明返回类型。
- `types/customEvent.d.ts`：内置 HMR、forward-console 与 bundled-dev 事件名/payload 映射。
- `types/metadata.d.ts`：模块增强 Rolldown 输出，为 chunk/asset 附加 Vite 资源依赖元数据。

`ViteTypeOptions.strictImportMetaEnv` 采用“键是否存在”判断，而不是读取布尔值。用户声明合并该键后，
ImportMetaEnv 的任意 string 索引消失，只保留内置字段和用户显式声明。

`MODE` 是用户选择的模式名，`DEV/PROD` 则来自 `config.isProduction`；例如 staging 模式仍可生成生产产物。
`SSR` 跟随 Environment consumer 是否为 server。glob 在开发与构建转换时都会展开。

glob 类型重载还保留了历史推导：`query: '?raw'` 即使未选 `import: 'default'`，也声明为 string；实际生成
namespace 还是默认值取决于 import 选项。旧 `as: 'raw'/'url'` 会补 default，而 query 不会自动补。
worker 的类型映射声明为 Worker，实际 `?worker` 模块默认导出的是构造包装器，须调用后才创建实例。
这两处要分别读 `importGlob.d.ts` 的声明和 `importMetaGlob.ts`/`worker.ts` 的变换。

### 2. 工具配置的隔离类型

Sass、Less、Stylus、esbuild 与 Terser 是可选依赖；当前 Lightning CSS 随 Vite dependencies 安装。
internal 声明通过 type-only import 和部分 `@ts-ignore` 隔离类型解析，再 Omit 掉由 Vite 掌控的
filename、sourcemap、entry/output 等字段。Sass 类型额外检查可选导入是否退化为 any，优先选择仍有
信息的声明。这里的 Omit 表达配置所有权：用户提供算法参数，Vite 设置流水线参数。

`rollupTypeCompat.d.ts` 的 Rollup* 名称全部指向当前 Rolldown 类型，保留旧命名便于现有配置迁移。

### 3. 内联的上游快照

`chokidar.d.ts`、`connect.d.ts`、`ws.d.ts`、`commonjs.d.ts`、`alias.d.ts` 主要来自上游项目。
其中 alias、chokidar、connect、ws 的声明描述集成的解析、监听、中间件与 WebSocket 接口，内联后用户
无需再安装相应类型包；文件保留上游来源与许可证。

`commonjs.d.ts` 有另一层历史边界：Vite 仍暴露 build.commonjsOptions，但当前构建不再注册
`@rollup/plugin-commonjs`，也未把这组选项传入 Rolldown；转换走 Rolldown 内置 CJS 支持。
文件里的 strictRequires 等注释描述旧插件协议，不能据此断言当前构建会执行相应选项。

## 类型用例怎样读

`src/node/__tests_dts__` 不执行运行时代码，靠 TypeScript 编译成败表达契约：

- `config.ts`：defineConfig 重载是否保持对象、Promise 和函数返回形态；未知嵌套项是否报错。
- `plugin.ts`：Vite 插件与 Rolldown/Rollup 类型是否兼容，钩子 this 是否带 Environment 扩展。
- `importGlob.ts`：eager/query/as 组合的声明是否推导为值表、Promise 工厂、string 或 Worker。
- `postcss.ts`：Vite 对外类型是否与 postcss-load-config 一致。
- `utils.ts`：mergeWithDefaults 的结果类型是否匹配嵌套覆盖、数组、函数、undefined/null。

`plugin.ts` 中 `HooksMissingInConstants` 比较 `RollupPluginHooks` 与 `(typeof ROLLUP_HOOKS)[number]`。
常量显式标成 `RollupPluginHooks[]`，元素类型已拓宽为完整联合，所以这条断言不能检出数组实际漏了某个名称。

运行时单测的证据也各有范围：`logger.spec.ts` 用六组快照检查服务器地址及网卡标签，并未测试 createLogger
去重；`constants.spec.ts` 给默认 CORS 正则输入允许/拒绝表；`shortcuts.spec.ts` 检查同键覆盖与重启后
readline/action 的复用；`utils.spec.ts` 检查路径、srcset、配置合并与 Source Map 组合；
`server/__tests__/sourcemap.spec.ts` 只检验最近 node_modules 包根的提取，不读取 map/source 文件。

`@ts-expect-error` 要求下一行产生诊断：若下一行不再报错，指令本身会成为诊断。这类反向断言与 Equal
断言一起约束发布类型；运行行为仍由源码和运行时用例说明。

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/index.ts`，Node 公共出口：

```ts
export {
  defineConfig,
  loadConfigFromFile,
  resolveConfig,
  sortUserPlugins,
} from './config'
export { perEnvironmentPlugin } from './plugin'
export { perEnvironmentState } from './environment'
export { createServer } from './server'
export { preview } from './preview'
export { build, createBuilder } from './build'

export { optimizeDeps } from './optimizer'
export { createIdResolver } from './idResolver'
```

公共 API 是有意收窄的实现入口集合，不等同于 `src/node` 文件全集。类型阅读应从这些 export
反查声明与实现；内部 helper 即使被多模块复用，也不自动构成兼容承诺。

## 复盘题

1. 为什么公共出口文件没有实现逻辑，仍是源码阅读的起点和终点？
2. 客户端与 SSR 若共享 browser 条件，会出现哪类“双入口”问题？
3. 为什么 KNOWN_ASSET_TYPES 不能只改一个数组？
4. 为什么重复调用 error() 仍会打印，调用方怎样利用 WeakSet 避免重复？
5. ImportMeta 全局增强为什么不能加入顶层 import？
6. 为什么 glob 返回值类型断言不能证明 query 自动选 default？
7. 为什么 Environment 外层副本仍可能修改原 build 对象？
