# 02A. 环境文件加载

> **证据基线**：Vite `v8.2.1`，commit `421615865dad3ed39137d17281814fc78a41246c`。本文所有源码、测试与行为结论均限定于该版本。

## 阅读目标

本节回答三个问题：

1. Vite 为什么会读取四种 `.env` 文件，它们怎样覆盖？
2. 哪些变量会进入 `import.meta.env`，哪个来源优先？
3. `NODE_ENV`、mode 和 `VITE_USER_NODE_ENV` 为什么不能混为一谈？

环境变量最终怎样被替换进客户端代码，由后续 `define` 与 Import Analysis 模块继续解释。
本节只跟踪配置解析阶段如何生成 `ResolvedConfig.env`。

## 调用位置

```text
resolveConfig()
├─ 解析 root / mode / envDir
├─ resolveEnvPrefix(config)
├─ loadEnv(mode, envDir, prefixes)
│  ├─ getEnvFilesForMode()
│  ├─ parseEnv()
│  ├─ dotenv-expand.expand()
│  ├─ Vite Task getEnvs()
│  └─ process.env 最高优先级覆盖
└─ ResolvedConfig.env
   └─ define 插件生成 import.meta.env.* 替换值
```

`loadEnv()` 也作为公开 Node API 导出。直接调用时不会自动读取 `vite.config.*`，调用方
必须自己传入 mode、envDir 和 prefix。

## 环境文件顺序

`getEnvFilesForMode('development', envDir)` 返回：

```text
.env
.env.local
.env.development
.env.development.local
```

优先级从低到高。实现不是逐个文件立即展开，而是：

```text
读取所有存在的文件
→ 按顺序拍平成 [key, value]
→ Object.fromEntries 合并同名键
→ 对最终对象统一执行变量展开
```

因此：

```dotenv
# .env
VITE_BASE_URL=$VITE_BASE_ROUTE
VITE_BASE_ROUTE=/

# .env.production
VITE_BASE_ROUTE=/app/
```

production 模式最终两个值都是 `/app/`。如果读取 `.env` 时立即展开，`VITE_BASE_URL`
会过早固定为 `/`。当前顺序来自 [PR #10113](https://github.com/vitejs/vite/pull/10113)。

`envDir: false` 返回空文件列表，用于完全关闭环境文件读取，也使 Dev Server 不再监听
`.env` 变化。相关实现：[PR #19503](https://github.com/vitejs/vite/pull/19503)。

## 文件类型判断

每个候选路径只接受：

- 普通文件：常规磁盘 `.env`。
- FIFO：1Password 等密钥工具把内容挂载成命名管道的场景。

目录和其他特殊文件被跳过。只判断 `stat.isFile()` 会令密钥挂载场景看起来像文件缺失，
因此增加 FIFO 支持：[PR #21365](https://github.com/vitejs/vite/pull/21365)。

## 三层合并优先级

`loadEnv()` 返回结果的优先级从低到高：

```text
四类 .env 文件
< Vite Task 提供的任务环境变量
< 启动进程已有的 process.env
```

最后一层支持常见写法：

```bash
VITE_API_URL=https://temporary.example vite build
```

命令行临时变量必须覆盖仓库中的 `.env`。早期实现只在键不存在时采用进程值，导致
显式输入失效，见 [issue #10676](https://github.com/vitejs/vite/issues/10676) 与
[PR #10684](https://github.com/vitejs/vite/pull/10684)。

## 变量展开为什么复制 `process.env`

`.env` 可以引用同文件或进程中的变量：

```dotenv
HOST=example.com
VITE_URL=https://$HOST
```

`dotenv-expand` 需要读取 `process.env` 才能解析外部变量，但不能把展开结果写回真实
进程对象。一个 Node.js 进程可能连续解析多个项目、Environment 或测试；全局污染会让
后一个项目读到前一个项目的配置。

所以 Vite 传入副本：

```ts
const processEnv = { ...process.env }
expand({ parsed, processEnv })
```

该隔离来自 [PR #11213](https://github.com/vitejs/vite/pull/11213)。

## mode、`NODE_ENV` 与 `VITE_USER_NODE_ENV`

- mode：选择 `.env.[mode]`，默认 serve 为 `development`、build 为 `production`。
- `NODE_ENV`：影响生产/开发语义和部分依赖行为，不决定读取哪个 mode 文件。
- `VITE_USER_NODE_ENV`：Vite 内部保存用户在 `.env` 中显式声明的 `NODE_ENV`。

示例：

```bash
NODE_ENV=production vite build --mode testing
```

```dotenv
# .env.testing
NODE_ENV=development
```

变量展开可以读取进程中的 production。若 Vite 在展开之后才检查 parsed.NODE_ENV，文件
里的 development 可能已经丢失。因此必须在 expand 前保存到 `VITE_USER_NODE_ENV`。
相关修复：[PR #11309](https://github.com/vitejs/vite/pull/11309)。

mode `local` 被禁止，因为 `.local` 已是“机器本地覆盖文件”后缀；否则 `.env.local` 的
身份和优先级会产生歧义。

## 客户端暴露边界

默认只返回 `VITE_` 前缀：

```dotenv
DATABASE_PASSWORD=secret    # 不进入客户端
VITE_PUBLIC_API=/api        # 进入 import.meta.env
```

`envPrefix` 可以是字符串或数组，但空字符串会匹配所有键，可能把 token、密码等敏感值
静态写入客户端产物，所以 `resolveEnvPrefix()` 必须抛错。

含空白前缀通常无法成为合法环境变量名，只告警并保留配置，见
[PR #21292](https://github.com/vitejs/vite/pull/21292)。

注意：前缀不是安全脱敏器。任何匹配前缀的值都会成为公开客户端数据。

## 特殊变量副作用

以下无客户端前缀的键仍会影响 Vite 自身：

- `NODE_ENV`：保存为 `VITE_USER_NODE_ENV`，供后续配置解析判断开发/生产行为。
- `BROWSER`：控制 `--open` 使用的浏览器或关闭自动打开。
- `BROWSER_ARGS`：传给浏览器进程的额外参数。

若调用方已经在 `process.env` 设置它们，`.env` 不覆盖显式进程值。
`VITE_USER_NODE_ENV` 本身符合默认 `VITE_` 前缀，所以它也可能进入 `loadEnv()` 返回值；
测试快照明确覆盖了这一行为。

## 测试如何证明行为

`packages/vite/src/node/__tests__/env.spec.ts` 使用六个 fixture 验证：

1. 通用文件与 mode 文件合并。
2. 自定义 prefix 过滤。
3. mode 文件覆盖和“合并后再展开”。
4. `.env` 中 `NODE_ENV` 的保存时机。
5. 已存在特殊进程变量不被覆盖。
6. `process.env` 对 `.env` 的最高优先级。

`config.spec.ts` 中 `resolveEnvPrefix` 分组验证默认值、空前缀拒绝、空白告警和合法自定义
前缀。

运行：

```bash
pnpm vitest run packages/vite/src/node/__tests__/env.spec.ts
pnpm vitest run packages/vite/src/node/__tests__/config.spec.ts -t resolveEnvPrefix
```

## 关键源码证据

目标版本源码摘录，来源：`packages/vite/src/node/env.ts`，`loadEnv()`：

```ts
const env: Record<string, string> = {}
const envFiles = getEnvFilesForMode(mode, envDir)

debug?.(`loading env files: %O`, envFiles)

const parsed = Object.fromEntries(
  envFiles.flatMap((filePath) => {
    const stat = tryStatSync(filePath)
    // Support FIFOs (named pipes) for apps like 1Password
    if (!stat || (!stat.isFile() && !stat.isFIFO())) return []

    const parsedEnv = parseEnv(fs.readFileSync(filePath, 'utf-8'))
    return Object.entries(parsedEnv as Record<string, string>)
  }),
)
```

`getEnvFilesForMode()` 决定文件顺序，`Object.fromEntries()` 让后出现的同名键覆盖前值；普通文件
和 FIFO 都可成为输入。后续的 prefix 过滤与 `process.env` 合并只能基于这份 `parsed` 结果继续。

## 推荐断点

1. `getEnvFilesForMode()`：观察 mode 到四个候选路径的映射。
2. `Object.fromEntries(...)`：观察 mode 文件覆盖后的 parsed。
3. `expand({ parsed, processEnv })`：比较展开前后变量。
4. 遍历 `process.env` 的最后一层覆盖。
5. `resolveEnvPrefix()` 的空字符串安全检查。

启动时增加 `--debug env`，可查看候选文件、加载耗时和最终公开变量：

```bash
vite --debug env
```

## 复盘题

1. 为什么 `.env.production` 的变量可以影响 `.env` 中对同名变量的引用？
2. 为什么 Vite Task 的环境值仍会被 `process.env` 覆盖？
3. mode 是 testing 时，`NODE_ENV` 是否必然等于 testing？
4. 为什么 `envPrefix: ''` 必须报错，而不能表示“公开全部变量”？
5. 为什么 FIFO 应当视为可读取环境文件，但目录不可以？
