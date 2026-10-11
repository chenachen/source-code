import { msg as msgJs } from './hello.js'
import { msgJsx } from './hellojsx.jsx'
import { msgTsx } from './hellotsx.js'
import { msgCjs } from './hellocjs.cjs'
import { msgMjs } from './hellomjs.mjs'

/** 汇总 .js/.jsx/.cjs/.mjs 导入实际 TS/TSX/CTS/MTS 文件的结果，全部成功时写出成功标记。 */
export const msg =
  msgJs && msgJsx && msgTsx && msgCjs && msgMjs
    ? '[success] use .js / .jsx / .cjs / .mjs extension to import a TS modules'
    : '[fail]'
