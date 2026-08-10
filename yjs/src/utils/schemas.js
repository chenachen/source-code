import * as s from 'lib0/schema'

/** 识别 Yjs `Doc` 实例的运行时 schema，供 lib0 schema 组合器复用。 */
export const $ydoc = /** @type {s.Schema<Doc>} */ (s.$type('y:doc', null))
