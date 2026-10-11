import ReactDomClient from 'react-dom/client'
import React from 'react'
import Root from './root'

/** 找到服务端 HTML 的 root，借 React transition 调度 hydrateRoot，挂载共享 Root 组件。
 * @returns 调度完成的 Promise；这里不等待 React hydration 全部完成。 */
async function main() {
  const el = document.getElementById('root')
  React.startTransition(() => {
    ReactDomClient.hydrateRoot(el!, <Root />)
  })
}

main()
