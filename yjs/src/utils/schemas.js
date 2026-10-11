import * as s from 'lib0/schema'

/** Doc 的运行时 schema 标记；`Doc.js` 将它安装到 `Doc.prototype.$type`，供 lib0 schema 识别。 */
export const $ydoc = /** @type {s.Schema<Doc>} */ (s.$type('y:doc', null))
