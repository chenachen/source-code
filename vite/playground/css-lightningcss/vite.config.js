import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    transformer: 'lightningcss',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'nested'),
    },
  },
  build: {
    cssTarget: ['chrome61'],
    cssMinify: 'lightningcss',
  },
  plugins: [testLightningcssVisitorDuringMinify()],
})

/** 创建仅构建启用的插件，统计 Lightning CSS MediaQuery visitor 的调用并输出计数资产。 */
function testLightningcssVisitorDuringMinify() {
  let mediaQueryVisits = 0

  return {
    name: 'test-lightningcss-visitor-during-minify',
    apply: 'build',
    /** 把计数 visitor 合并进 css.lightningcss，使 CSS 转换与压缩读取同一配置。 */
    config() {
      return {
        css: {
          lightningcss: {
            visitor: {
              /** 计入一次媒体查询访问并原样返回节点，避免统计改变 CSS 语义。 */
              MediaQuery(query) {
                mediaQueryVisits++
                return query
              },
            },
          },
        },
      }
    },
    /** 把累计 visitor 调用次数写入文本资产，供构建测试断言压缩阶段也执行 visitor。 */
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'media-query-visits.txt',
        source: String(mediaQueryVisits),
      })
    },
  }
}
