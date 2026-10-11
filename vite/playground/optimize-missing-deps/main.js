import { sayName } from '@vitejs/test-missing-dep'

/** 调用 missing 依赖得到的名称；SSR 与 client 使用不同 exports 条件入口进行对照。 */
export const name = sayName()
