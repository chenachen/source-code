// 动态导入多种 CJS 依赖，将 default/namespace 互操作与 React hooks 的运行结果写入页面。
// 同一 fixture 供开发预构建与生产构建测试使用。
;(async () => {
  const { useState } = await import('react')
  const React = (await import('react')).default
  const ReactDOM = await import('react-dom/client')

  const clip = await import('clipboard')
  if (typeof clip.default === 'function') {
    text('.cjs-dynamic-clipboard', 'ok')
  }

  const { Socket } = await import('phoenix')
  if (typeof Socket === 'function') {
    text('.cjs-dynamic-phoenix', 'ok')
  }

  const cjsFromESM = await import('@vitejs/test-dep-cjs-compiled-from-esm')
  if (typeof cjsFromESM.default.default === 'function') {
    text('.cjs-dynamic-dep-cjs-compiled-from-esm', 'ok')
  }

  const cjsFromCJS = await import('@vitejs/test-dep-cjs-compiled-from-cjs')
  if (
    typeof cjsFromCJS.default === 'function' &&
    typeof cjsFromCJS !== 'function' &&
    cjsFromCJS.bar === 'bar'
  ) {
    text('.cjs-dynamic-dep-cjs-compiled-from-cjs', 'ok')
  }

  const cjsWithEsModuleFlag =
    await import('@vitejs/test-dep-cjs-with-es-module-flag')
  text(
    '.cjs-dynamic-dep-cjs-with-es-module-flag',
    cjsWithEsModuleFlag.default.info,
  )

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

  ReactDOM.createRoot(document.querySelector('.cjs-dynamic')).render(
    React.createElement(App),
  )

  /** 把互操作检查结果写入指定 DOM 节点，供浏览器测试读取。 */
  function text(el, text) {
    document.querySelector(el).textContent = text
  }
})()
