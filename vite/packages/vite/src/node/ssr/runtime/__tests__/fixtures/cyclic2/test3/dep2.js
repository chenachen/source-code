import { dep1 } from './index.js'
/** 经聚合 index 回读 dep1.ok，构造不同重导出顺序下的循环求值结果。 */
export const dep2 = { ok: dep1.ok }
