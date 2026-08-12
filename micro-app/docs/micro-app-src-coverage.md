# micro-app `src` 注释覆盖与验证报告

## 版本与范围

- 包：`@micro-zoe/micro-app@1.0.0-rc.32`。
- 上游标签：`v1.0.0-rc.32`，提交 `dd445c483a7c7b29b1aa37245874e2617a385882`。
- 分析与注释范围：仅 `src/**`。`package.json`、锁文件和配置文件只用于锁定版本与工具链，不作为源码讲解对象。
- 本地 `micro-app` 是外层工作区的子目录，不能用外层仓库 HEAD 冒充上游版本；因此从上游精确标签建立只读基线，并先确认本地 `src` 与该标签一致。
- `src/__tests__/demos/**` 是测试服务器按原字节加载或直接执行的 fixture。该目录不改动；其中 26 个声明逐项登记豁免原因。

## 任务清单

- [x] 锁定真实版本、上游提交与 TypeScript 版本。
- [x] 盘点 `src` 文件、模块边界、入口、调用链、状态机和测试证据。
- [x] 审计并补齐 42 个生产源码文件的声明级中文 TSDoc。
- [x] 审计并补齐 32 个非 demo 测试文件的声明注释，关键用例补 Given/When/Then 机制说明。
- [x] 对 22 个 demo fixture 文件建立逐声明豁免清单，保持载荷字节不变。
- [x] 生成 1037 项逐声明分类清单，未分类项为零。
- [x] 用精确 TypeScript 4.1.6 执行最终覆盖审计。
- [x] 对照上游标签执行去 JSDoc AST token 比较与非 TS 文件字节比较。
- [x] 生成人可阅读的单 HTML 源码学习指南。
- [x] 初版指南在实际浏览器中完成桌面、窄屏、锚点、溢出、外部资源和控制台验收；本次扩写后另做结构、链接、转义和响应式静态门禁。

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

使用仓库 `yarn.lock` 实际锁定的 TypeScript 4.1.6：

```bash
rtk proxy node .agents/skills/read-source-code/scripts/audit-comment-coverage.mjs \
  --root micro-app \
  --path src \
  --typescript /Users/chenpengxiang/Desktop/engineering/micro-app-demo/main_apps/angular11/node_modules/typescript/lib/typescript.js \
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

- 初版曾在桌面 `1280 × 720` 与手机 `390 × 844` 实际验收：页面级横向溢出为 0，窄屏卡片/流程改单列，表格与代码块在自身容器滚动。
- 当前主稿有 18 节、34 个源码块与 34 个 `figcaption`；19 处内部锚点引用全部可解析。端到端附录有 16 节、12 个代码块，17 处内部锚点引用全部可解析。
- 两页均无重复 ID、失效本地链接、外部脚本/图片/样式依赖、未转义代码标签、裸 `&` 或 UTF-8 replacement character；标签栈配对通过。
- 主稿保留 `960px/590px`，附录保留 `1020px/680px` 等响应式断点；表格/代码设置局部横向滚动。当前扩写版因应用内浏览器安全策略拒绝本地 `file://` 页面，未重新声明实际视口渲染已通过。

## 测试证据边界

未运行测试（仅注释/文档变更）。当前目标目录没有安装自身依赖；本次以精确编译器语法解析、声明覆盖门禁、AST token 零差异和 fixture 字节零差异验证无运行代码变化。

当前 `jest.config.js` 默认只选中 7 个文件。阅读测试时发现的既有证据缺口不等同于已确认缺陷：部分 EventCenter 用例没有等待 `defer` 微任务；个别 Promise 用例未 `await`/`return`；资源与 sandbox 测试仍引用已删除导出、旧入口或旧签名；CSS 错误恢复用例被 skip；HTMLLoader 的插件段使用旧配置形态。指南把证据分为“默认套件、非默认静态、失效意图、源码”，不把未执行断言扩大成框架保证。
