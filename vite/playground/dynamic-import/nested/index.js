import mxdStatic from '../files/mxd'
import mxdStaticJSON from '../files/mxd.json'

/** 根据按钮给出的 view 名称动态导入 views 下模块，将其 msg 写到页面。
 * @param view foo 或 bar 等候选文件名片段。
 * @returns 导入并更新 DOM 后完成的 Promise。 */
async function setView(view) {
  const { msg } = await import(`../views/${view}.js`)
  text('.view', msg)
}

;['foo', 'bar'].forEach((id) => {
  document.querySelector(`.${id}`).addEventListener('click', () => setView(id))
})

// 字符串字面量动态导入：点击后加载 baz 模块并显示消息。
document.querySelector('.baz').addEventListener('click', async () => {
  const { msg } = await import('../views/baz.js')
  text('.view', msg)
})

// 全动态导入：运行时拼接 URL，由 vite-ignore 保留原导入表达式。
/** 全动态 URL 场景的文件名数组，仅取首项 qux.js；import 使用 vite-ignore 避开候选改写。 */
const arr = ['qux.js']
/** 拼出的根相对 /views/qux.js，直接交给被忽略的动态 import，build 依赖 copy 插件保留原文件。 */
const view = `/views/${arr[0]}`
document.querySelector('.qux').addEventListener('click', async () => {
  const { msg } = await import(/*@vite-ignore*/ view)
  text('.view', msg)
})

// 同一模块的静态与动态导入：点击后比较默认导出的对象身份。
document.querySelector('.mxd').addEventListener('click', async () => {
  const view = 'mxd'
  const { default: mxdDynamic } = await import(`../files/${view}.js`)
  text('.view', mxdStatic === mxdDynamic)
})

document.querySelector('.mxd2').addEventListener('click', async () => {
  const test = { jss: '../files/mxd.js' }
  const ttest = test
  const view = 'mxd'
  const { default: mxdDynamic } = await import(/*@vite-ignore*/ test.jss)
  text('.view', mxdStatic === mxdDynamic)
})

document.querySelector('.mxdjson').addEventListener('click', async () => {
  const view = 'mxd'
  const { default: mxdDynamicJSON } = await import(`../files/${view}.json`)
  text('.view', mxdStaticJSON === mxdDynamicJSON)
})

// 动态导入 blob: 对象 URL。
/** blob URL 场景的 ESM 字节，导出 msg=blob。 */
const code1 = 'export const msg = "blob"'
/** 把 code1 包装成 JavaScript MIME 的 Blob，供运行时 import。 */
const blob = new Blob([code1], { type: 'text/javascript;charset=UTF-8' })
/** Blob 的对象 URL；点击事件动态导入它并显示 msg，现有 fixture 未回收该 URL。 */
const blobURL = URL.createObjectURL(blob)
document.querySelector('.issue-2658-1').addEventListener('click', async () => {
  const { msg } = await import(/*@vite-ignore*/ blobURL)
  text('.view', msg)
})

// 动态导入 data: URL。
/** data URL 场景的 ESM 文本，导出 msg=data。 */
const code2 = 'export const msg = "data";'
/** 对 code2 做 URI 编码后生成的 JavaScript data URL，供点击事件直接 import。 */
const dataURL = `data:text/javascript;charset=utf-8,${encodeURIComponent(
  code2,
)}`
document.querySelector('.issue-2658-2').addEventListener('click', async () => {
  const { msg } = await import(/*@vite-ignore*/ dataURL)
  text('.view', msg)
})

document.querySelector('.css').addEventListener('click', async () => {
  await import('../css/index.css')
  text('.view', 'dynamic import css')
})

document.querySelector('.pkg-css').addEventListener('click', async () => {
  await import('./deps')
  text('.view', 'dynamic import css in package')
})

/** 按选择器找到节点并写入 textContent，汇总各动态 import 的结果。
 * @param el DOM 选择器。
 * @param text 要展示的结果，浏览器负责字符串转换。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

let base = 'hello'

import(`../alias/${base}.js`).then((mod) => {
  text('.dynamic-import-with-vars', mod.hello())
})

import(/*@vite-ignore*/ `https://localhost`).catch((mod) => {
  console.log(mod)
  text('.dynamic-import-with-vars-ignored', 'hello')
})

import(/*@vite-ignore*/ `https://localhost//${'test'}`).catch((mod) => {
  console.log(mod)
  text('.dynamic-import-with-double-slash-ignored', 'hello')
})

// prettier-ignore
import(
  /* 在导入参数前插入注释 */
  `../alias/${base}.js`
  /* 检验 es-module-lexer 的边界识别 */
).then((mod) => {
  text('.dynamic-import-with-vars-multiline', mod.hello())
})

import(`../alias/${base}.js?raw`).then((mod) => {
  text('.dynamic-import-with-vars-raw', JSON.stringify(mod))
})

base = 'url'
import(`../alias/${base}.js?url`).then((mod) => {
  text('.dynamic-import-with-vars-url', JSON.stringify(mod))
})

base = 'worker'
import(`../alias/${base}.js?worker`).then((workerMod) => {
  const worker = new workerMod.default()
  worker.postMessage('1')
  worker.addEventListener('message', (ev) => {
    console.log(ev)
    text('.dynamic-import-with-vars-worker', JSON.stringify(ev.data))
  })
})

base = 'hi'
import(`@/${base}.js`).then((mod) => {
  text('.dynamic-import-with-vars-alias', mod.hi())
})

base = 'self'
import(`../nested/${base}.js`).then((mod) => {
  text('.dynamic-import-self', mod.self)
})

import(`../nested/nested/${base}.js`).then((mod) => {
  text('.dynamic-import-nested-self', mod.self)
})
;(async function () {
  const { foo } = await import('./treeshaken/treeshaken.js')
  const { bar, default: tree } = await import('./treeshaken/treeshaken.js')
  const default2 = (await import('./treeshaken/treeshaken.js')).default
  const baz1 = (await import('./treeshaken/treeshaken.js')).baz1
  const baz2 = (await import('./treeshaken/treeshaken.js')).baz2.log
  const baz3 = (await import('./treeshaken/treeshaken.js')).baz3?.log
  const baz4 = await import('./treeshaken/treeshaken.js').then(
    ({ baz4 }) => baz4,
  )
  const baz5 = await import('./treeshaken/treeshaken.js').then(function ({
      baz5,
    }) {
      return baz5
    }),
    { baz6 } = await import('./treeshaken/treeshaken.js')
  foo()
  bar()
  tree()
  ;(await import('./treeshaken/treeshaken.js')).default()
  default2()
  baz1()
  baz2()
  baz3()
  baz4()
  baz5()
  baz6()
})()
// 覆盖这些动态导入语法的分析，不为每种写法设置页面断言。
;(async function () {
  const default1 = await import('./treeshaken/syntax.js').then(
    (mod) => mod.default,
  )
  const default2 = (await import('./treeshaken/syntax.js')).default,
    /** 与动态 import 默认值并列声明的空箭头函数，用于覆盖分析器读取多声明语法，不产生输出。 */
    other = () => {}
  const foo = await import('./treeshaken/syntax.js').then((mod) => mod.foo)
  const foo2 = await import('./treeshaken/syntax.js').then(
    ({ foo = {} }) => foo,
  )
  const foo3 = await import('./treeshaken/syntax.js').then((m) => m.foo)
  const e = ('' + window.doesntExist)[3] // 读取运行时属性，阻止压缩器将下标表达式常量折叠。
  const foo4 = await import('./treeshaken/syntax.js')[`th${e}n`]((m) => m.foo)
  await import('./treeshaken/syntax.js').then((mod) => mod.foo({ foo }))
  const obj = [
    '',
    {
      /** 从对象方法中解构动态导入的 foo，再调用未定义 aaa；该段只构造语法分析输入，测试不验证此调用执行成功。
       * @returns aaa 处理后的 foo 对象（调用失败时 Promise 拒绝）。 */
      async lazy() {
        const { foo } = await import('./treeshaken/treeshaken.js')
        return { foo: aaa(foo) }
      },
    },
  ]
  default1()
  default2()
  other()
  foo()
  foo2()
  foo3()
  foo4()
  obj[1].lazy()
})()

import(`../nested/static.js`).then((mod) => {
  text('.dynamic-import-static', mod.self)
})

// #22700：嵌套 import().then(() => import()) 曾把外层导入的 CSS 依赖
// 在构建产物中替换为 void 0，使外层 CSS 脱离加载链。
import('./then-css/outer.js').then((outerMod) => {
  text('.then-css-outer', outerMod.outer)
  return import('./then-css/inner.js').then((innerMod) => {
    text('.then-css-inner', innerMod.inner)
  })
})

import('./rest-destructure.js').then(({ a, ...rest }) => {
  text('.dynamic-import-rest', `${a} ${rest.b} ${rest.c}`)
})

console.log('index.js')
