import './style.css'
import './main.css'
import './order'

import './chunk.css'
import chunkCssUrl from './chunk.css?url'

// 暴露 URL 到全局，使该资产导入不会因结果未使用而被裁剪。
globalThis.__test_chunkCssUrl = chunkCssUrl

import('./async.css')
import('./async-js')

import('./inline.css?inline').then((css) => {
  document.querySelector('.dynamic-inline').textContent = css.default
})

import('./mod.module.css').then((css) => {
  document.querySelector('.dynamic-module').textContent = JSON.stringify(
    css.default,
  )
  document.querySelector('.mod').classList.add(css.default.mod)
})
