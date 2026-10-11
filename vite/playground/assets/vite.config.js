import path from 'node:path'
import { defineConfig } from 'vite'

// assetsInclude 的相对模式按当前 cwd 解析；测试进程 cwd 不同，
// 因此切到配置目录，使行为与从项目根启动 Vite 一致。
process.chdir(import.meta.dirname)

export default defineConfig({
  base: '/foo/bar',
  publicDir: 'static',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'nested'),
      fragment: path.resolve(import.meta.dirname, 'nested/fragment-bg.svg'),
    },
  },
  assetsInclude: ['**/*.unknown', './nested/*.custom'],
  build: {
    outDir: 'dist/foo',
    assetsInlineLimit: 8000, // 8000 字节
    manifest: true,
    watch: {},
  },
})
