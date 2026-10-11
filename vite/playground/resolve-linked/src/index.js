import { msg as depMsg } from '../dep'

/** 拼接上级 depMsg 的成功标记，供浏览器确认 root 外依赖被解析与加载。 */
export const msg = `[success] out of root monorepo dep with ${depMsg}`
