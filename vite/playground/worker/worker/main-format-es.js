// 此入口只在 ES worker 输出格式下导入。
import NestedWorker from '../emit-chunk-nested-worker?worker'
import ImportMetaGlobWorker from '../importMetaGlob.worker?worker'

/** 把子图消息写DOM文本。
 * @param el 输出节点。
 * @param text 要展示的消息。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

text('.format-es', 'format es:')

/** ES格式专用的嵌套worker实例，收集多个子图消息供完整数组断言。 */
const nestedWorker = new NestedWorker()
/** 累计嵌套worker消息，按序列化长度排序后显示，使不同返回先后得到稳定排列。 */
const dataList = []
nestedWorker.addEventListener('message', (ev) => {
  dataList.push(ev.data)
  text(
    '.emit-chunk-worker',
    JSON.stringify(
      dataList.sort(
        (a, b) => JSON.stringify(a).length - JSON.stringify(b).length,
      ),
    ),
  )
})

/** 内部动态加载模块及URL模块的worker，页面展示合并消息与BASE_URL。 */
const dynamicImportWorker = new Worker(
  new URL('../emit-chunk-dynamic-import-worker.js', import.meta.url),
  {
    type: 'module',
  },
)
dynamicImportWorker.addEventListener('message', (ev) => {
  text('.emit-chunk-dynamic-import-worker', JSON.stringify(ev.data))
})

/** 把也作为模块使用的同一文件创建为worker，显示其基础消息。 */
const moduleWorker = new Worker(
  new URL('../module-and-worker.js', import.meta.url),
  { type: 'module' },
)

moduleWorker.addEventListener('message', (ev) => {
  text('.module-and-worker-worker', JSON.stringify(ev.data))
})

/** lazy glob worker实例，页面只展示回传的候选键数组。 */
const importMetaGlobWorker = new ImportMetaGlobWorker()

importMetaGlobWorker.postMessage('1')

importMetaGlobWorker.addEventListener('message', (e) => {
  text('.importMetaGlob-worker', JSON.stringify(e.data))
})
