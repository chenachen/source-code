import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

/** 从 escape 目录真实子目录生成别名；目标路径含括号/方括号/花括号，后续 glob 必须按字面路径转义。 */
const escapeAliases = fs
  .readdirSync(path.join(import.meta.dirname, 'escape'), {
    withFileTypes: true,
  })
  .filter((f) => f.isDirectory())
  .map((f) => f.name)
  .reduce((aliases: Record<string, string>, dir) => {
    aliases[`@escape_${dir}_mod`] = path.resolve(
      import.meta.dirname,
      `./escape/${dir}/mod`,
    )
    return aliases
  }, {})

/** post transform 插件，观察 glob 与变量动态导入在前序插件完成后的代码。 */
const transformVisibilityPlugin = {
  name: 'test:transform-visibility',
  enforce: 'post',
  /** 仅把 transform-visibility.js 替换为两个布尔标志，分别检查 glob 调用消失和动态导入 helper 出现。 */
  transform(code: string, id: string) {
    if (id.endsWith('transform-visibility.js')) {
      const globTransformed = !code.includes('import.meta.glob')
      const dynamicImportTransformed = code.includes(
        '__variableDynamicImportRuntimeHelper',
      )
      return `export default ${JSON.stringify({ globTransformed, dynamicImportTransformed })}`
    }
  },
}

// 在任何文件处理前确保目录符号链接存在；程序创建用于避开仓库符号链接的 Node 场景。
// https://github.com/nodejs/node/issues/62653
/** 测试开始前创建的 my-lib 目录符号链接；glob 与直接导入同时消费它以比较模块身份。 */
const linked = path.resolve(
  import.meta.dirname,
  'follow-symlinks/linked/my-lib',
)
if (!fs.existsSync(linked) || !fs.lstatSync(linked).isSymbolicLink()) {
  fs.rmSync(linked, { recursive: true, force: true })
  fs.symlinkSync('../packages/my-lib', linked, 'dir')
}

export default defineConfig({
  plugins: [transformVisibilityPlugin],
  resolve: {
    alias: {
      ...escapeAliases,
      '@dir': path.resolve(import.meta.dirname, './dir/'),
      '~dir': path.resolve(import.meta.dirname, './dir') + '/',
      '#alias': path.resolve(import.meta.dirname, './imports-path/'),
    },
  },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        // manualChunks(id) {
        //   if (id.includes('foo.css')) {
        //     return 'foo_css'
        //   }
        // },
      },
    },
  },
})
