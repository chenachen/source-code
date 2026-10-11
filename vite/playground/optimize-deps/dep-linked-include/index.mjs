export { msg } from './foo.js'

// 保留 Node 内置模块导入，在不可达分支内访问它以测试浏览器外部化。
import fs from 'node:fs'

import { useState } from 'react'

/** 使用本链接依赖导入的 React useState 创建计数器，检验 dedupe 使其与页面共享 React 实例。 */
export function useCount() {
  return useState(0)
}

// 链接依赖同时带 CSS 与 Vue 组件依赖，供预构建资源处理测试。
import './test.css'

if (false) {
  fs.readFileSync()
} else {
  console.log('ok')
}

export { default as VueSFC } from './Test.vue'
