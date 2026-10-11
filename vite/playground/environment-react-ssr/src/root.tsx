import React from 'react'

/** SSR 与浏览器共用组件：计数初始零，effect 把 hydrated 置 true，两个按钮更新计数。
 * @returns 显示 hydration 状态与计数的 React 节点。 */
export default function Root() {
  const [count, setCount] = React.useState(0)

  const [hydrated, setHydrated] = React.useState(false)
  React.useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div>
      <div>hydrated: {String(hydrated)}</div>
      <div>Count: {count}</div>
      <button onClick={() => setCount((v) => v - 1)}>-1</button>
      <button onClick={() => setCount((v) => v + 1)}>+1</button>
    </div>
  )
}
