# Vite 中文注释复核验收记录

本阶段完整复核了清单内 1,503 个文件、6,855 个声明与 1,844 个测试定义。实际声明内容缺漏、测试场景缺漏、未分类项均为 0。源码改动涉及 963 个文件，非注释 token 和 AST 与本阶段开始时的快照完全一致。

版本依据为仓库内 Vite 8.2.1，来源提交 `421615865dad3ed39137d17281814fc78a41246c`。比较基线是本阶段开始时的工作区，保留此前及并行任务已有改动，未以 Git HEAD 回退文件。

## 范围与阅读证据

[scope.json](scope.json) 列出每个纳入文件和 54 个排除项及理由。范围包含核心实现、公共与 vendored 类型、构建/发布脚本、测试及手写 JS/TS/JSX/TSX fixture，也包含默认结构脚本会忽略的 authored `lib` 和 `node_modules` fixture。

排除项主要是 create-vite 给用户生成的模板、文档/分享页面私有代码，以及两个故意不合法的 syntax-error 输入。后两者保留原字节，其解析失败场景由消费者测试说明。HTML、Vue、CSS 等输入资产通过测试消费者核对关系，不纳入本次 JS/TS 声明 AST 数量。

| 阅读分区 | 文件 | 声明 | 测试定义 |
| --- | ---: | ---: | ---: |
| client、runner、server、graph、SSR、公共与 vendored 类型 | 95 | 2,517 | 0 |
| config、插件、optimizer、build、assets 与脚本 | 76 | 2,256 | 0 |
| 全部测试、setup 与 harness | 226 | 803 | 1,844 |
| 根任务负责的 packages/resolve/optimizer/SSR fixtures | 511 | 463 | 0 |
| assets/build/CSS 等 fixtures | 331 | 414 | 0 |
| HMR/import/worker 等 fixtures | 264 | 402 | 0 |

[review-final.json](review-final.json) 是合并后的最终台账：每个文件有完整阅读依据，每个声明有稳定 ID、阶段原位置、当前位置、原注释、最终注释和分类；每条测试定义有场景说明和执行条件元数据。各分区原始台账保留了具体手工判断与消费者证据。

## 分类与测试场景

| 声明分类 | 数量 |
| --- | ---: |
| 已有且充分 | 4,187 |
| 已翻译扩写 | 442 |
| 新补充 | 2,154 |
| 豁免 | 72 |

分类以附着注释的阶段前后文本和人工内容复核共同确定。已有注释逐声明复读后才认可；豁免逐 ID 记录具体原因，其中 68 项属于字节敏感 fixture，4 项是由邻近工厂/集合说明完整表达的匿名字段。

测试定义中 804 项新补充、141 项翻译扩写、899 项已有且充分。复核覆盖初态/输入、操作、实际断言与实现机制，包含 setup、别名、参数表、循环和跳过分支。34 个定义通过参数表或循环展开；47 个定义自身带 skip/todo/skipIf 标记；311 个定义显式使用或继承 skipIf/runIf 条件。这些数字可重叠，均统计定义而非实际执行次数。

已修正过强或错位的解释，包括其他环境首次 buildStart 的 resolveId 触发点、循环 HMR 判断、runner 握手与缓存状态、软失效、worker lazy/eager glob、Lightning CSS 两个工厂的职责以及 tsconfig setter 条件。未将跳过、TODO 或仅构造语法输入的场景写成已经验证成功。

## 等价性与固定输入

[verification.json](verification.json) 保存全部纳入文件的阶段前后 SHA256；变更文件另保存 AST 和实际语法 token 指纹。TypeScript 6.0.3 解析全部 1,503 个文件，解析诊断、AST 差异、非注释 token 差异、受保护法律/工具/打包指令差异、原有 JSDoc 类型标注丢失均为 0。格式化产生的尾逗号和分号差异已恢复。

[byte-preservation.json](byte-preservation.json) 对 37 个固定输入文件逐字节及 SHA256 验证，差异为 0，包含两个故意非法的输入。原因涉及固定源码行列、代码帧、HTTP 原文、预计算 map/sourcesContent 及第三方压缩分发产物。

[fixture-replacement-candidates.json](fixture-replacement-candidates.json) 检查了 193 个字面量/正则首次 replace 定义和 2,182 个文件/模式候选对，新增注释抢占编辑目标为 0。`@asset-src` 是测试本来就主动替换的注释标记，其整条原文保持一致；动态计算目标及其他编辑动作由对应消费者人工复读核对。

[scope-preservation.json](scope-preservation.json) 记录阶段快照内范围外文件、BOM 和 preserve-symlinks 链接的核对：范围外文件及 BOM 差异为 0，链接仍指向 `./src/index.js`。本轮未写文章、分享目录或共享技能/审计脚本。

## 标准结构筛查与独立补充

共享脚本默认过滤后统计 1,471 个文件、6,407 个声明。原始筛查产生 99 个候选，逐项核对后分为 65 个具体声明豁免与 34 个注释附着/工具名称识别差异；后者实际已有紧邻中文 TSDoc。详见 [structure-final-raw.json](structure-final-raw.json) 与 [structure-resolution.json](structure-resolution.json)。

用独立原因表运行共享脚本的 strict-exemptions 和 fail-on-missing，最终 unresolved、unusedExemptions、diagnostics 均为 0，见 [structure-final.json](structure-final.json)。独立台账补齐了默认忽略路径、namespace/ambient 常量、函数属性赋值及条件/逻辑初始化函数等声明；6,855 项均已分类，未用标准脚本的较小数量冒充完整覆盖。

## 复验

独立验证器为 [verify-comments.cjs](verify-comments.cjs)。在仓库根执行 `node vite/annotation-audit/2026-10-11/verify-comments.cjs /tmp/vite-annotation-stage-original`，会重新生成验证记录。阶段源码快照位于临时目录；持久记录保留了基线摘要、原注释和前后指纹。

本轮未运行测试：改动仅为注释与独立审计记录，使用源码/测试消费者复读、解析及 token/AST 等价性确认边界。未提交或推送，分支保持 main。
