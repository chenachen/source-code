import './style.css'
import viteSvgPath from './vite.svg'
import MyWorker from './worker?worker'

/** 依次加载三个自定义命名 chunk，再执行异步 Map 示例，供现代与 legacy 输出检查。 */
async function run() {
  await import('./custom0.js')
  await import('./custom1.js')
  await import('./custom2.js')
  const { fn } = await import('./async.js')
  fn()
}

run()

let isLegacy

// LEGACY 替换后两层布尔分支仍需得出正确结果，覆盖常量折叠场景（#1999）。
if (import.meta.env.LEGACY) {
  if (import.meta.env.LEGACY === true) isLegacy = true
} else {
  if (import.meta.env.LEGACY === false) isLegacy = false
}

text('#env', `is legacy: ${isLegacy}`)

/** 保存整个 import.meta.env 对象，与直接 LEGACY 属性访问比较，验证两种替换方式一致。 */
const metaEnvObj = import.meta.env
text('#env-equal', import.meta.env.LEGACY === metaEnvObj.LEGACY)

// Set 迭代与展开的降级场景。
text('#iterators', [...new Set(['hello'])].join(''))

// structuredClone 填充在 core-js v3.20.0 之后提供。
text(
  '#features-after-corejs-3',
  JSON.stringify(structuredClone({ foo: 'foo' })),
)

// 异步生成器与 for-await 消费。
/** 逐次异步等待后产出 0、1、2，供 legacy 降级后的 for-await 消费验证顺序。 */
async function* asyncGenerator() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    yield i
  }
}
;(async () => {
  const result = []
  for await (const i of asyncGenerator()) {
    result.push(i)
  }
  text('#async-generator', JSON.stringify(result))
})()

// String.raw 标签模板触发 Babel 模板转换 helper，检查它没有暴露到 window。
text(
  '#babel-helpers',
  String.raw`exposed babel helpers: ${window._templateObject != null}`,
)

// 请求无 hash 的候选分包名，观察实际命中 JS 或回退 HTML。
import('./immutable-chunk.js')
  .then(({ fn }) => fn())
  .then((assets) => {
    text('#assets', assets.join('\n'))
  })

// 点击后动态导入 CSS。
document
  .querySelector('#dynamic-css-button')
  .addEventListener('click', async () => {
    await import('./dynamic.css')
    text('#dynamic-css', 'dynamic import css')
  })

text('#asset-path', viteSvgPath)

/** 写入 legacy 功能与运行时结果，供浏览器断言读取。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

/** 以 ?worker 构造的模块 Worker，通过 ping 触发回复验证 Worker 输出可用。 */
const worker = new MyWorker()
worker.postMessage('ping')
worker.addEventListener('message', (ev) => {
  text('.worker-message', JSON.stringify(ev.data))
})
