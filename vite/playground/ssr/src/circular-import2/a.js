import { getB } from './b'

/** A 模块导出的 __A__ 标记；B 的转导出和 index 的读取都指向此绑定。 */
export const A = '__A__'

/** 调用从 B 模块导入的 getB 得到 __B__，在循环图中保留函数调用的初始化边。 */
export const B = getB()
