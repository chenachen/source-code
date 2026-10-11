# micro-app `src` 注释覆盖与验证报告

## 版本与范围

- 包：`@micro-zoe/micro-app@1.0.0-rc.32`。
- 上游标签：`v1.0.0-rc.32`，提交 `dd445c483a7c7b29b1aa37245874e2617a385882`。
- 分析与注释范围：仅 `src/**`。`package.json`、锁文件和配置文件只用于锁定版本与工具链，不作为源码讲解对象。
- 本地 `micro-app` 是外层工作区的子目录，不能用外层仓库 HEAD 冒充上游版本；因此从上游精确标签建立只读基线，并先确认本地 `src` 与该标签一致。
- `src/__tests__/demos/**` 是测试服务器按原字节加载或直接执行的 fixture。该目录不改动；其中 26 个声明逐项登记豁免原因。

## 2026-10-10 内容审查与修复

本次按 `review-source-explanations` 完整审查两篇既有 HTML：主稿 18 章、端到端附录 16 章，包含正文、源码摘录、流程图、状态表、清理矩阵、示例和测试引用。同时通读全部 42 个生产 TS 文件及 32 个非 demo 测试/辅助文件的现有注释，对照相关 fixture 核实行为。修正后可分享。

上游精确标签再次核对为 [`v1.0.0-rc.32`](https://github.com/jd-opensource/micro-app/tree/v1.0.0-rc.32)，解引用提交仍为 `dd445c483a7c7b29b1aa37245874e2617a385882`。本次只修讲解材料；框架和测试的运行代码、fixture、上游使用手册均保留。

| 原讲解与阅读影响 | 修正后的说明 | 决定行为的实现 |
|---|---|---|
| “HTML 与静态资源两路”：把 HTML 获取误算为资源屏障的一方 | HTML 抽取启动样式处理、脚本预取两路；两路各结算一次，到 2 才保存模板并放行挂载 | `source/index.ts`、`create_app.ts · onLoad()` |
| “串行预取等待资源完成”：误以为下一应用不会与当前加载交叠 | 预取包装回调在首次 `onLoad/onLoadError` 时结算；后续资源处理和预渲染仍可继续 | `prefetch.ts · preFetchInSerial()` |
| “原始代码只需抓取一次”：误以为缓存会合并并发请求 | 已有非空原码时复用；缓存没有存放进行中的请求 Promise，多次未完成请求可并存 | `source/source_center.ts`、`source/links.ts`、`source/scripts.ts` |
| “重入数据进入下一批，避免共用 tempData”：将队列交换扩大成数据隔离 | 队列和完成步骤被交换，通道对象仍共享；A 回调重入尚未处理的 B 会影响本批 B，并可能在下一批重复通知 | `interact/event_center.ts · process()/dispatch()` |
| “保留函数伪类内部逗号，只切顶层列表”：把解析器当作完整 CSS 语法树 | 只保护属性选择器方括号中的逗号；`:is()`、`:has()` 等多参数函数伪类仍会被逗号拆开 | `sandbox/scoped_css.ts · formatSelector()` |
| 将 UMD 注册点当作静态脚本完成屏障，或把卸载通知放在 UMD hook 前 | setter 收齐 hooks 后可立即调用 mount；unmount 的实参先调用 UMD hook，再进入子事件通知。同步 throw 不进入后续处理，返回 Promise 的拒绝会继续收尾 | `sandbox/with/index.ts`、`sandbox/iframe/index.ts`、`create_app.ts` |
| “UMD 卸载克隆 DOM”“afterhidden 在转移容器后”：误解节点身份与观察时机 | 软卸载和 keep-alive 用 `cloneContainer(..., false)` 移动原节点；基座 unmount/afterhidden 回调发生在部分容器清理或转移之前 | `create_app.ts · actionsAfterUnmounted()/hiddenKeepAliveApp()/cloneContainer()` |
| “完整恢复全部 DOM 补丁”：扩大 release 的范围 | Document `createComment` 与 DocumentFragment `append/prepend` 未在 release 中恢复；受管事件解绑还需区分 capture 参数 | `source/patch.ts · releasePatchDocument()/releasePatchElementAndDocument()`、两类沙箱的 effect release |
| “关闭沙箱后只渲染 UMD app”“重挂事件断言证明恢复”：混淆运行分派与测试观测 | 无沙箱仍渲染 DOM、执行脚本，但不经沙箱 setter 识别 hooks；共用且未清空的日志 mock 只能观察曾出现的日志 | `create_app.ts · mount()`、`__tests__/main.test.ts` |
| 将旧入口、旧 library fixture 和未等待 Promise 的用例列为本版机制证据 | 逐条核对实际导出、hook 捕获入口、初始化顺序与断言；测试索引标出具体适配缺口，正文依据当前实现解释行为 | `jest.config.js`、`__tests__/sandbox/**`、`__tests__/unit/**`、`__tests__/create_app.test.ts` |

文章还补准了五种路由模式的 URL/state 写入和事件时序、请求补址、沙箱 ready 与清理边界、JSX 事件监听以及命令式 API 的结算条件。源码摘录、流程图和示例同步修正。重复的作者验收日志、空泛免责话术和“请自行验证”式结尾已删除；影响行为的具体条件紧邻相应解释保留。

完整文件清单保存在 `micro-app-src-declaration-coverage.json` 的 `reviewedFiles`（74 个 TS 文件）与 `articleFiles`（两篇 HTML）中。

本次逐声明清单保持原任务分类，更新当前行号和覆盖状态；下文“新补充/已翻译扩写”数字描述初次注释任务，不表示本次新增了同等数量的注释。

## 初次注释任务清单

- [x] 锁定真实版本、上游提交与 TypeScript 版本。
- [x] 盘点 `src` 文件、模块边界、入口、调用链、状态机和测试证据。
- [x] 审计并补齐 42 个生产源码文件的声明级中文 TSDoc。
- [x] 审计并补齐 32 个非 demo 测试文件的声明注释，关键用例补 Given/When/Then 机制说明。
- [x] 对 22 个 demo fixture 文件建立逐声明豁免清单，保持载荷字节不变。
- [x] 生成 1037 项逐声明分类清单，未分类项为零。
- [x] 用精确 TypeScript 4.1.6 执行最终覆盖审计。
- [x] 对照上游标签执行去 JSDoc AST token 比较与非 TS 文件字节比较。
- [x] 生成人可阅读的单 HTML 源码学习指南。
- [x] 指南通过桌面、窄屏、锚点、溢出、外部资源和控制台验收；2026-10-10 修订版再次完成真实渲染及静态门禁。

## 初始覆盖基线

| 区域 | 文件 | 声明 | 已记录 | 需要 TSDoc | 缺少注释 | 未解决 |
|---|---:|---:|---:|---:|---:|---:|
| 生产源码 | 42 | 942 | 284 | 138 | 520 | 658 |
| 非 demo 测试 | 32 | 69 | 3 | 6 | 60 | 66 |
| demo fixture | 22 | 26 | 8 | 8 | 10 | 18 |
| 合计 | **96** | **1037** | **295** | **152** | **590** | **742** |

## 最终覆盖

| 区域 | 声明 | documented | exempt | missing | needs-tsdoc | unresolved |
|---|---:|---:|---:|---:|---:|---:|
| 生产源码 | 942 | 942 | 0 | 0 | 0 | 0 |
| 非 demo 测试 | 69 | 69 | 0 | 0 | 0 | 0 |
| demo fixture | 26 | 0 | 26 | 0 | 0 | 0 |
| 合计 | **1037** | **1011** | **26** | **0** | **0** | **0** |

审计器诊断为 0，未使用豁免为 0。审计脚本的 `byKind.constructor` 受普通对象继承属性影响会显示异常字符串；声明总数、逐记录类别与所有覆盖门禁不受影响。

## 逐声明分类

| 区域 | 新补充 | 已翻译扩写 | 已有且充分 | 豁免 | 合计 |
|---|---:|---:|---:|---:|---:|
| 生产源码 | 520 | 422 | 0 | 0 | 942 |
| 非 demo 测试 | 60 | 8 | 1 | 0 | 69 |
| demo fixture | 0 | 0 | 0 | 26 | 26 |
| 合计 | **580** | **430** | **1** | **26** | **1037** |

分类规则：初始 `missing` 归为“新补充”；初始普通注释、英文注释、不完整 TSDoc 或已被实质扩写的 TSDoc 归为“已翻译扩写”；原文与最终文本完全一致且信息充分的声明归为“已有且充分”；fixture 声明归为“豁免”并逐条给出原因。

- 完整逐声明记录：`docs/micro-app-src-declaration-coverage.json`。
- fixture 豁免来源：`docs/micro-app-src-comment-exemptions.json`。

## 生产源码拆分

| 模块批次 | 文件 | 声明 | 新补充 | 已翻译扩写 |
|---|---:|---:|---:|---:|
| 公共入口、`CreateApp`、元素控制、预取、工具库 | 6 | 268 | 145 | 123 |
| 应用管理、常量、环境、嵌套、通信、生命周期、Worker | 9 | 179 | 113 | 66 |
| HTML/CSS/JS 资源加载、动态节点补丁、共享缓存 | 8 | 117 | 65 | 52 |
| 路由、请求代理、沙箱适配与函数绑定 | 9 | 133 | 54 | 79 |
| Scoped CSS、with 沙箱、iframe 沙箱 | 10 | 245 | 143 | 102 |
| 合计 | **42** | **942** | **520** | **422** |

## 验证

### 声明覆盖

使用仓库 `yarn.lock` 实际锁定的 TypeScript 4.1.6。本次从对应 npm 包临时提取编译器，没有安装项目依赖；以下调用形式中的 `MICRO_APP_TS_COMPILER` 指向该版本 `lib/typescript.js` 的绝对路径：

```bash
rtk proxy node .agents/skills/read-source-code/scripts/audit-comment-coverage.mjs \
  --root micro-app \
  --path src \
  --typescript "$MICRO_APP_TS_COMPILER" \
  --exemptions docs/micro-app-src-comment-exemptions.json \
  --strict-exemptions \
  --format json \
  --missing-only \
  --fail-on-missing
```

结果：96 个代码文件、1037 个声明；1011 documented、26 exempt、0 unresolved，退出码 0。

### 运行语义与 fixture 字节

- 74 个 TypeScript 文件：解析为 AST，忽略 JSDoc 子树后逐 token 对照上游标签，差异 0。
- 56 个非 TypeScript 文件：逐文件 SHA-256 对照上游标签，差异 0。
- 文件路径集合一致：130 个 `src` 文件，无新增、删除或重命名。
- 非 demo 范围没有遗留完整英文说明句；ESLint/TypeScript 指令、注释代码、协议字面量和 TODO 语义均保留。

### HTML 指南

2026-10-10 对最终两页做静态结构检查，并用 Chromium 实际渲染、检查截图：

- 主稿：18 章、34 个代码块与 34 个 `figcaption`；附录：16 章、13 个代码块。
- 桌面 `1280 × 900`、手机 `390 × 844` 共四次渲染：页面 `scrollWidth` 分别等于 1280/390，页面横向溢出均为 0。表格和代码块在自身容器滚动。
- 修复主稿版本说明中长提交哈希造成的 52px 窄屏溢出，用 `.callout code { overflow-wrap: anywhere; }` 保留完整文本并允许换行。
- 两页标签栈配对、ID、内部锚点、本地文件链接、代码转义和 UTF-8 检查全部通过；报告链接已同步修正。
- 控制台错误、页面异常、外部脚本/图片/样式请求均为 0。

### 针对讲解疑问的最小运行验证

- 使用 TypeScript 4.1.6 转译当前 `EventCenter` 类，只注入其工具依赖，验证首次派发同步可读、A/B 同批跨通道重入和 `clearData` 待提交回写。实际记录为首批 `a-step → b:2 → old-step`，下一批 `b:2 → new-step`，与文章推演一致。
- 从当前源码提取 `CSSParser` 和所需工具函数执行，核对函数伪类、根选择器、控制注释、未闭合输入及嵌套 CSS。附录推演输出与实际结果逐字一致；嵌套 fixture 与预期 scoped CSS 逐字一致。
- 主稿教程化 Jest 用例、附录 3 段 Demo JS 和 4 段控制流简写通过 TypeScript 4.1.6 语法解析；附录 Demo 与 With 包装后的脚本通过 V8 语法检查。HTTP Demo 未部署执行。

## 测试证据边界

未运行完整 Jest 套件（项目依赖未安装，本次仅注释/文档变更）。已执行上列最小源码验证；完整 `src` 使用 TypeScript 4.1.6 解析，74 个 TS 文件的非注释 AST 同时与任务开始时的工作区基线、上游 rc.32 一致，56 个非 TS 文件字节一致。声明覆盖仍为 1037 项、0 缺口。

当前 `jest.config.js` 默认只选中 7 个文件。阅读测试时发现的既有证据缺口不等同于已确认缺陷：部分 EventCenter 用例没有等待 `defer` 微任务；个别 Promise 用例未 `await`/`return`；资源与 sandbox 测试仍引用已删除导出、旧入口或旧签名；CSS 错误恢复用例被 skip；HTMLLoader 的插件段使用旧配置形态。指南把证据分为“默认套件、非默认静态、失效意图、源码”，不把未执行断言扩大成框架保证。
