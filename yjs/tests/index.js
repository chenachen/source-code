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

/** 按领域聚合测试模块，名称会成为 lib0 测试运行器的套件路径。 */
const tests = {
  doc, map, array, text, xml, encoding, undoredo, compatibility, snapshot, updates, relativePositions, idset, idmap, attribution, delta
}

/** 运行全部套件，并在 Node.js 中把布尔结果映射为进程退出码。 */
const run = async () => {
  const success = await runTests(tests)
  /* istanbul ignore next */
  if (isNode) {
    process.exit(success ? 0 : 1)
  }
}
run()
