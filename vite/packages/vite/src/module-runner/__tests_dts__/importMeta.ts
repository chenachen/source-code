/**
 * 类型测试场景：验证 ModuleRunnerImportMeta 在结构上兼容 ImportMeta，包括 @types/node
 * 对 dirname、filename、url、resolve、main 的声明合并。
 *
 * 过去接口直接 `extends ImportMeta`，消费者在 `skipLibCheck: false` 且扩展 ImportMeta 时会
 * 触发 TS2717“后续属性声明类型不同”。现在只在测试中检查可赋值性，既守住兼容性又避免
 * 把声明合并冲突传播给用户（#21710）。
 */

import type { ExpectExtends, ExpectTrue } from '@type-challenges/utils'
import type { ModuleRunnerImportMeta } from '../types'

/** 编译期断言集合：运行器 import.meta 必须覆盖标准 ImportMeta（除 Node 专用 main）。 */
export type cases = [
  // ModuleRunnerImportMeta 必须覆盖除 Node 专用 `main` 外的全部 ImportMeta 能力。
  ExpectTrue<ExpectExtends<Omit<ImportMeta, 'main'>, ModuleRunnerImportMeta>>,
]

export {}
