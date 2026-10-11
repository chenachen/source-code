import React from 'react'
import ReactDOM from 'react-dom/client'

// #1302：被预构建的链接包依赖另一版本 React；dedupe 应让其 hooks 与页面使用同一 React 实例。
import { useCount } from '@vitejs/test-dep-linked-include/index.mjs'

/** 渲染可点击计数按钮，验证 链接依赖与页面共享 React 实例。 */
function App() {
  const [count, setCount] = useCount()

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

ReactDOM.createRoot(document.querySelector('.dedupe')).render(
  React.createElement(App),
)
