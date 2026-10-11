import C, { update } from './dep.js'

/** 在 update 调用前读取当前默认导出的返回值，用于和更新后的 y 对照。 */
const x = C.f()
update()
/** 在 update 调用后再次读取默认导出，比较快照导出与 live binding 的区别。 */
const y = C.f()
export default [x, y]
