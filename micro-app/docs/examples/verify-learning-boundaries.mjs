/**
 * rc.32 学习用隔离验证。运行：在 micro-app 目录用 Node 24 执行
 * node docs/examples/verify-learning-boundaries.mjs
 *
 * 直接读取本地 TS，Node 仅擦除类型；不修改源码、不安装依赖、不启动服务器。
 * EventCenter / CSSParser / 动态脚本调度使用真实实现，导入的环境依赖在下方替身中给出。
 * 这不是浏览器集成测试：不证明 DOM 补丁安装、原生 module 求值或网络行为。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

/** 从脚本位置找源码，避免执行目录改变后读到另一份实现。 */
const source = path => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
/** 擦除简单模块导入/导出与 TS 类型后，在无 I/O 的测试上下文中求值。 */
function evaluate(text, names, bindings) {
  const plainModule = text.replace(/^import[^\n]*\n/gm, '')
    .replace(/export default /g, '').replace(/export /g, '')
  const js = stripTypeScriptTypes(plainModule, { mode: 'strip' })
  return vm.runInNewContext(`${js}\n;({${names}})`, bindings, { timeout: 1000 })
}
/** 取指定完整函数到下一个说明块，失败即退出，不静默使用自写算法。 */
function functionSource(path, start, end) {
  const text = source(path)
  const left = text.indexOf(start)
  const right = text.indexOf(end, left + start.length)
  assert.ok(left >= 0 && right > left, `源码边界变化：${path}`)
  return text.slice(left, right)
}
/** 用受控微任务队列观察异常，避免制造未处理 Promise rejection。 */
const tasks = []
const common = {
  logError() {},
  isFunction: value => typeof value === 'function',
  isPlainObject: value => Object.prototype.toString.call(value) === '[object Object]',
  assign: Object.assign,
  defer: callback => tasks.push(callback),
}
const { EventCenter } = evaluate(source('interact/event_center.ts'), 'EventCenter', common)
const center = new EventCenter()
const calls = []
center.on('A', () => { calls.push('A:first'); throw new Error('listener failed') })
center.on('A', () => calls.push('A:second'))
center.on('B', () => calls.push('B'))
center.dispatch('A', { value: 1 }, () => calls.push('A:next'), false, () => calls.push('A:dom'))
center.dispatch('B', { value: 2 }, () => calls.push('B:next'))
assert.equal(tasks.length, 1)
assert.deepEqual(JSON.parse(JSON.stringify(center.getData('A'))), {})
assert.throws(tasks.shift(), /listener failed/)
assert.deepEqual(calls, ['A:first'])
assert.equal(center.getData('A').value, 1)
assert.equal(center.getData('B').value, undefined)
assert.equal(center.eventList.get('B').tempData.value, 2)
assert.equal(tasks.length, 0, '旧队列未自动重试')
center.off('A')
center.off('B')

// CSS 的 URL 替身仅覆盖本例绝对 HTTPS 目录：不声称验证 CompletionPath 的全部协议分支。
const { CSSParser } = evaluate(source('sandbox/scoped_css.ts'), 'CSSParser', {
  microApp: { options: {}, tagName: 'micro-app' },
  isFireFox: () => false,
  trim: value => value.trim(),
  CompletionPath: (path, base) => new URL(path, base).href,
  getLinkFileDir: path => new URL('.', path).href,
  logError() {},
})
/** 每次都 reset，验证与生产 commonAction 相同的解析器复用边界。 */
function css(input) {
  const parser = new CSSParser()
  try { return parser.exec(input, 'micro-app[name=demo]', 'https://child.example/app/') }
  finally { parser.reset() }
}
assert.equal(css('/* scopecss-disable div */div{background:url(/test.png);}'),
  '/* scopecss-disable div */div{background:url("https://child.example/test.png");}')
assert.equal(css('div{/* scopecss-disable-next-line */background:url(/test.png);}'),
  'micro-app[name=demo] div{/* scopecss-disable-next-line */background:url(/test.png);}')
assert.equal(css('/* scopecss-disable */div{background:url(/test.png);}'),
  '/* scopecss-disable */div{background:url(/test.png);}')
assert.doesNotThrow(() => css('div {'), '输入耗尽，缺右花括号未必抛错')

const remoteSource = functionSource('source/scripts.ts', 'export function runDynamicRemoteScript (',
  '/**\n * 处理运行期创建的内联脚本')
/** 仅替换运行环境，保持缓存分派、catch 和通知语句为真实源码。 */
async function remoteCase({ cached, fail, native = false, downloadFail = false }) {
  const events = []
  const pending = []
  const deferred = []
  const origin = {}
  const { runDynamicRemoteScript } = evaluate(remoteSource, 'runDynamicRemoteScript', {
    document: { createComment: () => ({}) },
    globalEnv: { rawDocument: {} },
    pureCreateElement: () => ({}),
    isInlineMode: () => native,
    isTypeModule: () => native,
    dispatchOnLoadEvent: node => { assert.equal(node, origin); events.push('load') },
    dispatchOnErrorEvent: node => { assert.equal(node, origin); events.push('error') },
    defer: callback => deferred.push(callback),
    runScript() { if (fail) throw new Error('execution failed') },
    fetchSource() {
      const request = downloadFail ? Promise.reject(new Error('download failed')) : Promise.resolve('downloaded')
      // collect the final catch Promise so all notifications are settled before assertion
      return { then(callback) {
        const result = request.then(callback)
        return { catch(onError) { const settled = result.catch(onError); pending.push(settled); return settled } }
      } }
    },
    logError() {},
  })
  runDynamicRemoteScript('https://child.example/feature.js', { name: 'demo' }, { code: cached ? 'cached' : '' }, origin)
  for (const task of deferred) {
    if (fail) assert.throws(task, /execution failed/)
    else task()
  }
  await Promise.all(pending)
  return events
}
assert.deepEqual(await remoteCase({ cached: false, fail: false }), ['load'])
assert.deepEqual(await remoteCase({ cached: false, fail: true }), ['error'])
assert.deepEqual(await remoteCase({ cached: false, downloadFail: true }), ['error'])
assert.deepEqual(await remoteCase({ cached: true, fail: true }), [])
assert.deepEqual(await remoteCase({ cached: false, fail: false, native: true }), [],
  '原生 module 不在普通返回路径伪造 load；浏览器回调未由此隔离用例模拟')
// 静态契约检查：不把受控运行误称为浏览器 module 失败或原型身份验证。
const inlineSource = source('source/scripts.ts').slice(source('source/scripts.ts').indexOf('function runCode2InlineScript ('))
assert.ok(inlineSource.includes('scriptElement.onload = onloadHandler'))
assert.ok(!/scriptElement\.onerror\s*=/.test(inlineSource))
const patchSource = source('source/patch.ts')
const releaseSource = patchSource.slice(patchSource.indexOf('function releasePatchDocument()'),
  patchSource.indexOf('let hasRejectMicroAppStyle'))
for (const method of ['createComment', 'insertAdjacentElement']) {
  assert.ok(!new RegExp(`prototype\\.${method}\\s*=`).test(releaseSource), `${method} 未恢复`)
}
assert.ok(!/DocumentFragment.*prototype|rawRootDocumentFragment/.test(releaseSource.replace(/\/\*[^]*?\*\//g, '')))
console.log('PASS: EventCenter 批次中断、CSS URL 门禁、动态脚本通知分支（隔离验证）')
