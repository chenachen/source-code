# React 六包源码注释与分享教程：任务基线

本文件前段保存原源码注释创建任务的版本、范围与门禁。2026-10-10 的内容审查
记录在末节，当前修订与验证结果见 `09-evidence.html`；原声明覆盖要求不替代本轮内容质量审查。

## 模式与交付物

- 模式：源码讲解、源码与测试注释、测试证据整理、分享级教程。
- 注释：只增加或修正解释性中文注释，不改变运行语义、导出、测试输入或断言。
- 教程：在 `share/react/` 交付可离线打开的多页面 HTML；首页统一目录、
  术语和阅读顺序，各模块可按复杂度拆成多页。
- 串联：至少覆盖客户端创建元素、创建 root、更新调度、render/commit、DOM 写入、
  事件与卸载；SSR 只覆盖本次范围内的 ReactDOM 环境适配边界。
- 审计：交付声明级分类统计、章节到源码与测试的证据表、生成物排除理由。

## 可验证版本

- React、ReactDOM、React DOM bindings：`19.3.0`。
- React reconciler：`0.34.0`。
- Scheduler：`0.28.0`。
- Shared：内部包版本 `0.0.0`，运行时 React 版本来自
  `packages/shared/ReactVersion.js` 的 `19.3.0`。
- 目标六包初始文件集合：666 个文件。
- 目标六包初始内容 SHA-256 组合指纹：
  `c2a539918749f7336c0ea9ee6ca941bb8a35a2dac518314d3c640aeb5bb223dd`。

上述指纹来自初次注释任务的编辑前集合。React 快照没有独立的上游 Git 元数据，
因此包内版本和快照指纹用于固定分析对象，不从版本号反推上游 tag/commit。
2026-10-10 内容审查开始时，上层项目位于 `main`，基线 commit 为
`3c0d7e3bb22c02e9d136b1627b119ea857b9bb9d`；`react/` 与 `share/react/` 已跟踪且无已有改动。
这是本项目的版本记录，不是 React 上游身份。

## 包含范围

- `packages/shared`
- `packages/scheduler`
- `packages/react`
- `packages/react-reconciler`
- `packages/react-dom-bindings`
- `packages/react-dom`
- 上述包内的入口、实现、fork、发布 shim、Flow/TypeScript 类型、测试与手写测试夹具。
- `packages/react/src/__tests__/ReactCoffeeScriptClass-test.coffee` 采用人工覆盖复核；
  Flow/TypeScript 审计器不把 CoffeeScript 当作可解析输入。
- React 包内 1 个 `.ts` 测试与 5 个仓库自有 `.d.ts` 测试桩使用 TypeScript 审计器，
  不因后缀而静默漏掉。

测试的物理文件仍在注释范围内；教程中的证据归属按真实机制划分。例如放在
`packages/react-dom` 的事件、受控表单和 reconciler 测试，会分别进入 DOM bindings
或 reconciler 教程页。

## 明确排除

- `packages/scheduler/npm/umd/*.js`：未被当前发布清单引用的 legacy UMD 预构建产物。
- `packages/react/src/__tests__/__snapshots__/*.snap`：Jest 生成快照。
- `packages/react-reconciler/src/__tests__/__snapshots__/*.snap`：Jest 生成快照。
- `packages/react-dom-bindings/src/server/fizz-instruction-set/ReactDOMFizzInstructionSetInlineCodeStrings.js`：
  由 Fizz instruction-set 生成器写出的内联代码字符串，不是手写实现。
- 构建产生但当前源码树中不存在的 `cjs/`、`dist/`、`build/` 产物。
- `package.json`、README、许可证正文：作为版本、入口与发布证据读取，不参与声明审计。
- `packages/react-server`：ReactDOM SSR 的请求状态机依赖它，但用户指定的六包不包含它。
  因此教程不会把 ReactDOM 环境适配链误称为完整 Fizz 内核调用链。

发布目录中的手写 NODE_ENV/环境路由 shim 不是核心实现，但编码了真实入口选择；除上面
明确列出的生成物外，仍需注释和人工复核。

后两项是在对应包开始编辑前的精确盘点中补记：文件路径、snapshot 目录和生成器引用都
提供了可核验的生成证据。首次粗扫尚未应用这两项，因此下方初始表仍如实保留
dom-bindings 的 93 文件 / 1,744 声明；终态分母排除该生成文件后为 92 / 1,737，
不以回写旧数字掩盖口径变化。

## 允许编辑的文件

- 六个目标包中的源码、类型、测试与手写发布 shim：仅注释变化。
- `share/react/**`：任务基线、证据清单和多页面分享教程。
- `scripts/source-code-analysis/audit-flow-comment-coverage.mjs`：Flow 声明审计适配器。
- `scripts/source-code-analysis/audit-comment-only-semantics.mjs`：逐文件 AST/token 语义门禁。
- `scripts/source-code-analysis/audit-guide-source-snippets.mjs`：教程代码框证据身份与连续原码匹配门禁。
- `scripts/source-code-analysis/audit-guide-html.mjs`：离线 HTML 结构、链接、锚点与页面可达性门禁。

不修改其他包的源码，不补功能，不修测试，不调整构建配置，不自动提交或推送。

## 初始声明级结构基线

React 使用 Flow 语法；技能原 TypeScript 审计器会对精确对象、variance 和 opaque type
报解析错误。为满足“解析错误必须失败”的门禁，本任务使用同一分类规则的 Hermes
适配器扫描 JS/JSX，并用 `hermes-parser@0.36.1` 解析。早期计划按 `package.json`
声明的 TypeScript `^5.4.3` 下限执行；仓库 `yarn.lock` 实际解析为 5.7.3，最终独立
TS/d.ts 语义门禁则明确固定为 TypeScript 5.9.3。三者不是同一个版本概念，终验结论
只引用实际执行的 5.9.3，不把 manifest 下限或仓库 lock 版本冒充运行版本。

下面是首次无解析错误扫描。数字尚未评价注释是否为中文、是否准确或是否充分：

| 包 | 可解析文件 | 声明 | 已有结构注释 | 未解决 |
|---|---:|---:|---:|---:|
| shared | 54 | 815 | 74 | 741 |
| scheduler | 21 | 245 | 9 | 236 |
| react（Flow） | 68 | 963 | 50 | 913 |
| react（单个 TS 测试） | 1 | 118 | 1 | 117 |
| react-reconciler | 169 | 5,542 | 149 | 5,393 |
| react-dom-bindings | 93 | 1,744 | 165 | 1,579 |
| react-dom | 204 | 6,023 | 32 | 5,991 |
| 合计 | 610 | 15,450 | 480 | 14,970 |

React 的 5 个 `.d.ts` 测试桩、手写发布 shim，以及其他包的发布 shim 会在对应批次
纳入最终扫描，所以最终声明总数可能高于首次基线；新增项不能靠维持旧分母隐藏。

## 阅读与执行顺序

1. `shared`：身份、公共 Flow 契约、flags、内部桥、错误与调试工具。
2. `scheduler`：优先级、双最小堆、host loop、continuation、取消与环境 fork。
3. `react`：元素、Children、类型描述对象、hooks dispatcher、transition 与 cache。
4. `react-reconciler`：Fiber、Lane、update queue、begin/complete/commit、hooks、Suspense。
5. `react-dom-bindings`：HostConfig、属性、表单、事件、hydration 与资源。
6. `react-dom`：公开入口、root 生命周期、portal/flush、流式与静态环境适配。
7. 跨包客户端主线、事件主线、hydration 主线、异常与清理路径。

每个包按“模块拆分 → 声明审计 → 源码注释 → 代表测试注释 → 模块教程 → 包级验收”
推进。并发编辑只分配不重叠文件；包级结果仍按上述依赖顺序串联与验收。

## 原注释任务的完成门禁

- 所有纳入声明均归类为已有且充分、已翻译扩写、新补充或带具体理由的豁免；
  未分类和未解决均为零。
- 命名函数、方法、构造器和薄包装均有职责说明；不以“简单”作为豁免理由。
- 普通英文解释性注释已翻译并按真实机制补足；许可证、工具指令、生成标记保留原样。
- 关键测试说明 Given、When、Then、验证机制与对应源码，不把未覆盖行为扩大成保证。
- 每个关键教程章节含真实源码摘录和测试证据；完整调用链覆盖入口、状态或副作用、
  异常或清理。
- HTML 离线资源、链接、锚点、代码转义、窄屏布局和页面间导航通过检查；无教程自身的
  TODO、占位符或断链。连续/删节源码摘录可如实保留上游 TODO、FlowFixMe 等工具或维护标记。
- 最终 diff 只有注释、教程与审计工具；若仅注释/文档变化，不机械运行全量测试，
  但必须重跑结构审计、解析检查和全文人工复核。

## 2026-10-10 内容审查与修订

本轮按既有解读模块审查并直接修复：六包纳入的 650 个手写语言文件中已有注释，
以及 `share/react/` 全部 19 个 HTML 页面、图示与示例。保留多页面和单文件教程形式，
不新增整套教程，不改框架运行逻辑或测试断言。Vue、Vite 及其他会话改动不在本轮范围。

审查以实现、调用者和测试体核对条件、状态、时序和因果；删除只复述测试名的模板说明。
上面的声明覆盖数据记录原注释任务，本轮不以保留模板凑覆盖数字。最新内容审查范围、
主要修正与实际验证结果统一记录于 `09-evidence.html`。
