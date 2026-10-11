// 同时静态导入 CommonJS 默认值与具名导出；React 的动态 exports 赋值用来检验互操作。
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Socket } from 'phoenix'
import clip from 'clipboard'
import m from '@vitejs/test-dep-cjs-with-es-module-flag'
import cjsFromESM from '@vitejs/test-dep-cjs-compiled-from-esm'
import cjsFromCJS from '@vitejs/test-dep-cjs-compiled-from-cjs'
import * as cjsFromCJSNamespace from '@vitejs/test-dep-cjs-compiled-from-cjs'

// 重导出已经导入过的名称，同时覆盖别名与默认导出。
export { useState } from 'react'
export { useState as anotherNameForUseState } from 'react'
export { default as React } from 'react'

if (typeof clip === 'function') {
  text('.cjs-clipboard', 'ok')
}

if (typeof Socket === 'function') {
  text('.cjs-phoenix', 'ok')
}

text('.cjs-with-es-module-flag', m.info)

if (typeof cjsFromESM.default === 'function') {
  text('.cjs-dep-cjs-compiled-from-esm', 'ok')
}

if (
  typeof cjsFromCJS === 'function' &&
  typeof cjsFromCJSNamespace !== 'function' &&
  cjsFromCJSNamespace.bar === 'bar'
) {
  text('.cjs-dep-cjs-compiled-from-cjs', 'ok')
}

/** 渲染可点击计数按钮，验证 CommonJS 默认/具名导入得到可用 React hooks。 */
function App() {
  const [count, setCount] = useState(0)

  return React.createElement(
    'button',
    {
      /** 将本次渲染捕获的 count 加一，供浏览器点击后观察导入 hooks 正常工作。 */
      onClick() {
        setCount(count + 1)
      },
    },
    `count is ${count}`,
  )
}

ReactDOM.createRoot(document.querySelector('.cjs')).render(
  React.createElement(App),
)

/** 把互操作检查结果写入指定 DOM 节点，供浏览器测试读取。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
