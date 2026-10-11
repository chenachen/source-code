import * as depSelfReferenceUrlWorker from '@vitejs/test-dep-self-reference-url-worker'
import myWorker from '../my-worker.ts?worker'
import InlineWorker from '../my-worker.ts?worker&inline'
import InlineSharedWorker from '../my-inline-shared-worker?sharedworker&inline'
import mySharedWorker from '../my-shared-worker?sharedworker&name=shared'
import TSOutputWorker from '../possible-ts-output-worker?worker'
import NestedWorker from '../worker-nested-worker?worker'
import { mode } from '../modules/workerImport'
import SelfReferenceWorker from '../self-reference-worker?worker'

/** 按选择器写DOM文本，统一展示不同worker回传值。
 * @param el 输出节点。
 * @param text 待显示结果。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

document.querySelector('.mode-true').textContent = mode

/** 独立worker包装器创建的默认实例；发送ping后展示响应、mode、插件、资产与CJS字段。 */
const worker = new myWorker()
worker.postMessage('ping')
worker.addEventListener('message', (e) => {
  text('.pong', e.data.msg)
  text('.mode', e.data.mode)
  text('.bundle-with-plugin', e.data.bundleWithPlugin)
  text('.asset-url', e.data.viteSvg)
  text('.dep-cjs', e.data.depCjs.test)
})

/** 传name选项创建的独立实例，回传名称用于检查选项保留。 */
const namedWorker = new myWorker({ name: 'namedWorker' })
namedWorker.postMessage('ping')
namedWorker.addEventListener('message', (e) => {
  text('.pong-named', e.data.name)
})

/** inline包装器实例，发送ping后显示基础消息。 */
const inlineWorker = new InlineWorker()
inlineWorker.postMessage('ping')
inlineWorker.addEventListener('message', (e) => {
  text('.pong-inline', e.data.msg)
})

/** 带name的inline实例，页面显示worker全局的名称。 */
const namedInlineWorker = new InlineWorker({ name: 'namedInlineWorker' })
namedInlineWorker.postMessage('ping')
namedInlineWorker.addEventListener('message', (e) => {
  text('.pong-inline-named', e.data.name)
})

/** 单独创建的inline实例，页面只显示其import.meta.url。 */
const inlineWorkerUrl = new InlineWorker()
inlineWorkerUrl.postMessage('ping')
inlineWorkerUrl.addEventListener('message', (e) => {
  text('.pong-inline-url', e.data.metaUrl)
})

/** 发送Unicode专用输入的inline实例，页面显示带特殊字符的回传。 */
const unicodeInlineWorker = new InlineWorker()
unicodeInlineWorker.postMessage('ping-unicode')
unicodeInlineWorker.addEventListener('message', (e) => {
  text('.pong-inline-unicode', e.data.msg)
})

/** 创建默认SharedWorker端口并start监听；调用两次以触发共享计数达到二。 */
const startSharedWorker = () => {
  const sharedWorker = new mySharedWorker()
  sharedWorker.port.addEventListener('message', (event) => {
    text('.tick-count', event.data)
  })
  sharedWorker.port.start()
}
startSharedWorker()
startSharedWorker()

/** 使用相同name创建端口并start；调用两次验证命名实例复用。 */
const startNamedSharedWorker = () => {
  const sharedWorker = new mySharedWorker({ name: 'namedSharedWorker' })
  sharedWorker.port.addEventListener('message', (event) => {
    text('.tick-count-named', event.data)
  })
  sharedWorker.port.start()
}
startNamedSharedWorker()
startNamedSharedWorker()

/** 创建inline SharedWorker端口并start；调用两次检验内联共享URL稳定性。 */
const startInlineSharedWorker = () => {
  const inlineSharedWorker = new InlineSharedWorker()
  inlineSharedWorker.port.addEventListener('message', (event) => {
    text('.pong-shared-inline', event.data)
  })
  inlineSharedWorker.port.start()
}

startInlineSharedWorker()
startInlineSharedWorker()

/** 经插件输出类型转换的worker实例，发送ping后检查响应。 */
const tsOutputWorker = new TSOutputWorker()
tsOutputWorker.postMessage('ping')
tsOutputWorker.addEventListener('message', (e) => {
  text('.pong-ts-output', e.data.msg)
})

/** 父worker实例；按消息类型把源URL、查询子worker、URL子worker和eager glob输出分发到页面。 */
const nestedWorker = new NestedWorker()
nestedWorker.addEventListener('message', (ev) => {
  if (typeof ev.data === 'string') {
    text('.nested-worker', JSON.stringify(ev.data))
  } else if (typeof ev.data === 'object') {
    const data = ev.data
    if (data.type === 'module') {
      text('.nested-worker-module', JSON.stringify(ev.data))
    } else if (data.type === 'constructor') {
      text('.nested-worker-constructor', JSON.stringify(ev.data))
    } else if (data.type === 'importMetaGlobEager') {
      text('.importMetaGlobEager-worker', JSON.stringify(ev.data))
    }
  }
})
nestedWorker.postMessage('ping')

/** 传给三种URL Worker的动态选项对象，vite-ignore标记允许其跳过静态选项求值。 */
const workerOptions = { type: 'module' }
// 使用相对 URL 创建 worker。
/** 相对文件URL与动态选项创建的Worker，用于检查入口URL解析。 */
const w = new Worker(
  new URL('../url-worker.js', import.meta.url),
  /* @vite-ignore */ workerOptions,
)
w.addEventListener('message', (ev) =>
  text('.worker-import-meta-url', JSON.stringify(ev.data)),
)

// 使用别名 URL 创建 worker。
/** 通过@alias URL与动态选项创建的Worker。 */
const wResolve = new Worker(
  new URL('@/url-worker.js', import.meta.url),
  /* @vite-ignore */ workerOptions,
)
wResolve.addEventListener('message', (ev) =>
  text('.worker-import-meta-url-resolve', JSON.stringify(ev.data)),
)

// 使用省略扩展名的 URL 创建 worker。
/** 省略扩展名的URL Worker，解析器补全真实入口。 */
const wWithoutExt = new Worker(
  new URL('../url-worker', import.meta.url),
  /* @vite-ignore */ workerOptions,
)
wWithoutExt.addEventListener('message', (ev) =>
  text('.worker-import-meta-url-without-extension', JSON.stringify(ev.data)),
)

/** 给SharedWorker选项提供运行时名称。
 * @returns 固定名称module。 */
const genWorkerName = () => 'module'
/** new URL创建的module SharedWorker，端口start后显示常量消息。 */
const w2 = new SharedWorker(
  new URL('../url-shared-worker.js', import.meta.url),
  {
    name: genWorkerName(),
    type: 'module',
  },
)
w2.port.addEventListener('message', (ev) => {
  text('.shared-worker-import-meta-url', JSON.stringify(ev.data))
})
w2.port.start()

/** eager glob加worker查询生成包装器namespace映射，按确定键选择构造器。 */
const workers = import.meta.glob('../importMetaGlobEager.*.js', {
  query: '?worker',
  eager: true,
})
/** 从glob映射的default构造器创建实例，发送消息后展示键数组。 */
const importMetaGlobEagerWorker = new workers[
  '../importMetaGlobEager.worker.js'
].default()
importMetaGlobEagerWorker.postMessage('1')
importMetaGlobEagerWorker.addEventListener('message', (e) => {
  text('.importMetaGlobEager-worker', JSON.stringify(e.data))
})

/** 查询包装器的自身引用实例，main输入只触发一层nested，输出按行累积。 */
const selfReferenceWorker = new SelfReferenceWorker()
selfReferenceWorker.postMessage('main')
selfReferenceWorker.addEventListener('message', (e) => {
  document.querySelector('.self-reference-worker').textContent += `${e.data}\n`
})

/** URL创建的自身引用实例，main输入只触发一层nested，消息按行累积。 */
const selfReferenceUrlWorker = new Worker(
  new URL('../self-reference-url-worker.js', import.meta.url),
  {
    type: 'module',
  },
)
selfReferenceUrlWorker.postMessage('main')
selfReferenceUrlWorker.addEventListener('message', (e) => {
  document.querySelector('.self-reference-url-worker').textContent +=
    `${e.data}\n`
})

// 未注入 hot 的构建产物才启动 require(JSON) worker。
if (!import.meta.hot) {
  const cjsInteropWorker = new Worker(
    new URL('../worker-require-json.js', import.meta.url),
    { type: 'module' },
  )
  cjsInteropWorker.addEventListener('message', (e) => {
    if (e.data.ok) {
      text('.worker-require-json', e.data.content)
    } else {
      text('.worker-require-json', e.data.error)
    }
  })
} else {
  text('.worker-require-json', 'skipped in dev')
}

depSelfReferenceUrlWorker.startWorker((e) => {
  document.querySelector('.self-reference-url-worker-dep').textContent +=
    `${e.data}\n`
})
