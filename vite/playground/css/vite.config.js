import path from 'node:path'
import { pathToFileURL } from 'node:url'
import stylus from 'stylus'
import { defineConfig } from 'vite'

// 构造宿主存在 window/location 的 Sass 场景，验证预处理器兼容处理。
// https://github.com/sass/dart-sass/issues/710
// @ts-expect-error refer to https://github.com/vitejs/vite/pull/11079
globalThis.window = {}
// @ts-expect-error refer to https://github.com/vitejs/vite/pull/11079
globalThis.location = new URL('http://localhost/')

/** CSS alias 与多入口绝对路径的基准，独立于测试启动 cwd。 */
const dirname = import.meta.dirname

export default defineConfig({
  input: {
    index: path.resolve(dirname, './index.html'),
    treeshakeScoped: path.resolve(dirname, './treeshake-scoped/index.html'),
    empty: path.resolve(dirname, './empty.css'),
  },
  plugins: [
    {
      // 模拟组件模块的 scoped CSS：默认导出未使用时，对应样式也应被裁剪。
      name: 'treeshake-scoped-css',
      enforce: 'pre',
      /** 为 -scoped.css 设置 cssScopeTo 元信息：普通模块绑定 importer 的 default，barrel 场景绑定整个 importer。 */
      async resolveId(id, importer) {
        if (!importer || !id.endsWith('-scoped.css')) return

        const resolved = await this.resolve(id, importer)
        if (!resolved) return

        return {
          ...resolved,
          meta: {
            vite: {
              cssScopeTo: [
                importer,
                resolved.id.includes('barrel') ? undefined : 'default',
              ],
            },
          },
        }
      },
    },
  ],
  build: {
    cssTarget: 'chrome61',
    rolldownOptions: {
      output: {
        /** 把 manual-chunk.css 分到嵌套目录 chunk，验证 CSS 资产引用在分包路径变化后仍正确。 */
        manualChunks(id) {
          if (id.includes('manual-chunk.css')) {
            return 'dir/dir2/manual-chunk'
          }
        },
      },
    },
    emptyOutDir: false, // 多个配置共享 dist，不清空其他配置的产物。
  },
  esbuild: {
    logOverride: {
      'unsupported-css-property': 'silent',
    },
  },
  resolve: {
    alias: [
      { find: '=', replacement: dirname },
      { find: /^=replace\/(.*)/, replacement: `${dirname}/$1` },
      { find: 'spacefolder', replacement: dirname + '/folder with space' },
      { find: '#alias', replacement: dirname + '/aliased/foo.css' },
      {
        find: '#alias?inline',
        replacement: dirname + '/aliased/foo.css?inline',
      },
      {
        find: '#alias-module',
        replacement: dirname + '/aliased/bar.module.css',
      },
    ],
  },
  css: {
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]',

      // getJSON 可用于生成 CSS Modules 类名的 TypeScript 声明；下方为停用示例。

      // getJSON(cssFileName, json, _outputFileName) {
      //   let typings = 'declare const classNames: {\n'
      //   for (let className in json) {
      //     typings += `    "${className}": string;\n`
      //   }
      //   typings += '};\n'
      //   typings += 'export default classNames;\n'
      //   const { join, dirname, basename } = require('path')
      //   const typingsFile = join(
      //     dirname(cssFileName),
      //     basename(cssFileName) + '.d.ts'
      //   )
      //   require('fs').writeFileSync(typingsFile, typings)
      // },
    },
    preprocessorOptions: {
      scss: {
        additionalData: `$injectedColor: orange;`,
        importers: [
          {
            /** 接管 virtual-dep 与 .wxss 导入并统一映射为自定义 Sass URL，其他路径交回默认 importer。 */
            canonicalize(url) {
              return url === 'virtual-dep' || url.endsWith('.wxss')
                ? new URL('custom-importer:virtual-dep')
                : null
            },
            /** 为第一个 Sass importer 的自定义 URL 提供空 SCSS，覆盖虚拟导入成功而无 CSS 内容的场景。 */
            load() {
              return {
                contents: ``,
                syntax: 'scss',
              }
            },
          },
          {
            /** 只接管 virtual-file-absolute，映射到另一自定义 Sass URL。 */
            canonicalize(url) {
              return url === 'virtual-file-absolute'
                ? new URL('custom-importer:virtual-file-absolute')
                : null
            },
            /** 返回包含 file: URL 的 @use，验证自定义 importer 产物可继续导入真实绝对 Sass 文件。 */
            load() {
              return {
                contents: `@use "${pathToFileURL(path.join(import.meta.dirname, 'file-absolute.scss')).href}"`,
                syntax: 'scss',
              }
            },
          },
        ],
      },
      styl: {
        additionalData: `$injectedColor ?= orange`,
        imports: [
          './options/relative-import.styl',
          path.join(dirname, 'options/absolute-import.styl'),
        ],
        define: {
          $definedColor: new stylus.nodes.RGBA(51, 197, 255, 1),
          /** 生成 Stylus RGBA 节点，作为通过 define 传入的自定义函数验证其调用和序列化边界。 */
          definedFunction: () => new stylus.nodes.RGBA(255, 0, 98, 1),
        },
      },
    },
    preprocessorMaxWorkers: true,
  },
})
