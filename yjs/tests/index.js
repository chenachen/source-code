/* eslint-env node */

import * as map from './y-map.tests.js'
import * as array from './y-array.tests.js'
import * as text from './y-text.tests.js'
import * as xml from './y-xml.tests.js'
import * as encoding from './encoding.tests.js'
import * as undoredo from './undo-redo.tests.js'
import * as compatibility from './compatibility.tests.js'
import * as doc from './doc.tests.js'
import * as snapshot from './snapshot.tests.js'
import * as updates from './updates.tests.js'
import * as relativePositions from './relativePositions.tests.js'
import * as idset from './IdSet.tests.js'
import * as idmap from './IdMap.tests.js'
import * as attribution from './attribution.tests.js'
import * as delta from './delta.tests.js'

import { runTests } from 'lib0/testing'
import { isBrowser, isNode } from 'lib0/environment'
import * as log from 'lib0/logging'

if (isBrowser) {
  log.createVConsole(document.body)
}

/**
 * 按领域聚合 15 个测试模块，名称成为 lib0 测试运行器的套件路径。
 *
 * runTests 遍历各模块导出名，以 `test` 或 `benchmark` 开头的入口才作为用例；导出的 init/compare 等 fixture 不独立注册。
 * 随机与循环生成的多个输入在其所属导出函数内执行，注释需说明这些输入的差异，而不是另造 it/test 注册。
 */
const tests = {
  doc, map, array, text, xml, encoding, undoredo, compatibility, snapshot, updates, relativePositions, idset, idmap, attribution, delta
}

/**
 * 运行聚合套件（支持 lib0 的 `--filter` 筛选），并在 Node.js 中把结果映射为进程退出码。
 *
 * 异步等待运行器逐用例执行及用例返回的 Promise；浏览器保留页面展示结果，Node.js 用 0/1 表示整个选定套件成败。
 */
const run = async () => {
  const success = await runTests(tests)
  /* istanbul ignore next */
  if (isNode) {
    process.exit(success ? 0 : 1)
  }
}
run()
