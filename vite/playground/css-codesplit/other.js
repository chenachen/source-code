import './style.css'
import './chunk.css'
import chunkCssUrl from './chunk.css?url'

// 暴露 URL 到全局，使该资产导入不会因结果未使用而被裁剪。
globalThis.__test_chunkCssUrl = chunkCssUrl
