import { createThing } from './shared.js'

/** 经 shared 重导出的 createThing 生成本入口标记，随后声明 HMR 自接受。 */
export const result = createThing('b')

import.meta.hot?.accept()
