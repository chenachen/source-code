// import 条件应优先命中 import.mjs；本文件的值用于区分实际入口。
/** 同一 exports 同时声明 import 与 module 时的 module.mjs 标记，检验 import 条件优先。 */
export const msg = '[fail] exports with module (module.mjs)'
