import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import MagicString from 'magic-string'
import type { Plugin } from 'rolldown'
import { defineConfig } from 'rolldown'
import { ImportType, init, parse } from 'es-module-lexer'
import licensePlugin from './rollupLicensePlugin'

/** 当前 Vite 包的构建配置目录，用于定位源码、dist 与许可证文件。 */
// eslint-disable-next-line n/no-unsupported-features/node-builtins
const dirname = import.meta.dirname
/** Vite package.json；依赖列表决定 Node 产物的 external，devDependencies 仅 watch 时额外 external。 */
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)).toString(),
)
/** DEBUG_DISABLE_SOURCE_MAP 非空时禁止 watch 输出的内联 sourcemap。 */
const disableSourceMap = !!process.env.DEBUG_DISABLE_SOURCE_MAP

/** 独立打包浏览器环境注入模块，输出 client/env.mjs。 */
const envConfig = defineConfig({
  input: path.resolve(dirname, 'src/client/env.ts'),
  platform: 'browser',
  transform: {
    target: 'es2020',
  },
  output: {
    dir: path.resolve(dirname, 'dist'),
    entryFileNames: 'client/env.mjs',
  },
})

/** 普通开发客户端入口配置；@vite/env 保持外部导入，目标语法 es2020。 */
const clientConfig = defineConfig({
  input: path.resolve(dirname, 'src/client/clientEntry.ts'),
  platform: 'browser',
  transform: {
    target: 'es2020',
  },
  external: ['@vite/env'],
  output: {
    dir: path.resolve(dirname, 'dist'),
    entryFileNames: 'client/client.mjs',
  },
})

// bundled dev HMR 使用独立入口。
/** 独立打包 bundled dev 客户端，防止整包 HMR 代码进入普通 client.mjs。 */
const bundledDevClientConfig = defineConfig({
  input: path.resolve(dirname, 'src/client/bundledDevClient.ts'),
  platform: 'browser',
  transform: {
    target: 'es2020',
  },
  external: ['@vite/env'],
  output: {
    dir: path.resolve(dirname, 'dist'),
    entryFileNames: 'client/bundledDevClient.mjs',
  },
})

/** Node 入口共享的 ESM 输出、副作用优化和命名配置；外部依赖不保留 live-binding 包装。 */
const sharedNodeOptions = defineConfig({
  platform: 'node',
  treeshake: {
    moduleSideEffects: [
      {
        test: /acorn|astring|escape-html/,
        sideEffects: false,
      },
      {
        external: true,
        sideEffects: false,
      },
    ],
    propertyReadSideEffects: false,
  },
  output: {
    dir: './dist',
    entryFileNames: `node/[name].js`,
    chunkFileNames: 'node/chunks/[name].js',
    exports: 'named',
    format: 'esm',
    externalLiveBindings: false,
  },
})

/** Vite Node API、CLI 与 internal 入口构建；依赖 external，内置 shim/源位置/许可证及 watch 辅助插件。 */
const nodeConfig = defineConfig({
  ...sharedNodeOptions,
  input: {
    index: path.resolve(dirname, 'src/node/index.ts'),
    cli: path.resolve(dirname, 'src/node/cli.ts'),
    internal: path.resolve(dirname, 'src/node/internalIndex.ts'),
  },
  external: [
    /^vite\//,
    'fsevents',
    /^rolldown\//,
    /^tsx\//,
    /^@vitejs\/devtools\//,
    /^#/,
    'sugarss', // postcss-import -> sugarss
    'supports-color',
    'utf-8-validate', // ws
    'bufferutil', // ws
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
  ],
  plugins: [
    shimDepsPlugin({
      'postcss-load-config/src/req.js': [
        {
          src: "const { pathToFileURL } = require('node:url')",
          replacement: `const { fileURLToPath, pathToFileURL } = require('node:url')`,
        },
        {
          src: '__filename',
          replacement: 'fileURLToPath(import.meta.url)',
        },
      ],
      // Vite CSS 路径始终传入 resolve/load，因此删除 postcss-import 未使用的默认 resolver/read-cache 导入。
      'postcss-import/index.js': [
        {
          src: 'const resolveId = require("./lib/resolve-id")',
          replacement: 'const resolveId = (id) => id',
        },
        {
          src: 'const loadContent = require("./lib/load-content")',
          replacement: 'const loadContent = () => ""',
        },
      ],
      'postcss-import/lib/parse-styles.js': [
        {
          src: 'const resolveId = require("./resolve-id")',
          replacement: 'const resolveId = (id) => id',
        },
      ],
    }),
    buildTimeImportMetaUrlPlugin(),
    licensePlugin(
      path.resolve(dirname, 'LICENSE.md'),
      'Vite core license',
      'Vite',
    ),
    writeTypesPlugin(),
    enableSourceMapsInWatchModePlugin(),
    externalizeDepsInWatchPlugin(),
  ],
})

/** 独立构建 ModuleRunner，启用只压缩不改名/不改 codegen 的输出并检查总 chunk 代码 55 kB 限制。 */
const moduleRunnerConfig = defineConfig({
  ...sharedNodeOptions,
  input: {
    'module-runner': path.resolve(dirname, 'src/module-runner/index.ts'),
  },
  external: [
    'fsevents',
    'lightningcss',
    /^rolldown\//,
    '@vitejs/devtools/cli-commands',
    ...Object.keys(pkg.dependencies),
  ],
  plugins: [bundleSizeLimit(55), enableSourceMapsInWatchModePlugin()],
  output: {
    ...sharedNodeOptions.output,
    minify: {
      compress: true,
      mangle: false,
      codegen: false,
    },
  },
})

export default defineConfig([
  envConfig,
  clientConfig,
  bundledDevClientConfig,
  nodeConfig,
  moduleRunnerConfig,
])

// #region Plugins

/** watch 构建未显式禁止 map 时，将每个输出的 sourcemap 改为 inline。 */
function enableSourceMapsInWatchModePlugin(): Plugin {
  return {
    name: 'enable-source-maps',
    /** 按 watchMode 与环境开关决定是否覆盖 sourcemap 选项。 */
    outputOptions(options) {
      if (this.meta.watchMode && !disableSourceMap) {
        options.sourcemap = 'inline'
      }
    },
  }
}

/** watch 时写出直接 re-export 源码的声明入口，供本地联调读取最新类型。 */
function writeTypesPlugin(): Plugin {
  return {
    name: 'write-types',
    /** 仅 watch 输出后写 Node API 与 ModuleRunner 两个声明入口。 */
    writeBundle() {
      if (this.meta.watchMode) {
        writeFileSync(
          'dist/node/index.d.ts',
          "export * from '../../src/node/index.ts'",
        )
        writeFileSync(
          'dist/node/module-runner.d.ts',
          "export * from '../../src/module-runner/index.ts'",
        )
      }
    },
  }
}

/** watch 模式把开发依赖加入 external，缩短本仓库联调构建；要求现有 external 为数组。 */
function externalizeDepsInWatchPlugin(): Plugin {
  return {
    name: 'externalize-deps-in-watch',
    /** watch 时扩展 external；非数组 external 明确失败，普通构建不变。 */
    options(options) {
      if (this.meta.watchMode) {
        options.external ||= []
        if (!Array.isArray(options.external))
          throw new Error('external must be an array')
        options.external = options.external.concat(
          Object.keys(pkg.devDependencies),
        )
      }
    },
  }
}

/** 按依赖文件配置的文本补丁，可用固定 src 或正则 pattern 找到替换位置。 */
interface ShimOptions {
  /** 定位单次固定文本替换；找不到预期文本时构建报错。 */
  src?: string
  /** 替换文本；pattern 模式支持逐个恢复 $1 等捕获引用。 */
  replacement: string
  /** 正则替换条件，exec 循环处理匹配位置；调用者应提供可推进的正则。 */
  pattern?: RegExp
}

/** 对已列出的依赖逐条执行构建期补丁，并记录文件是否至少被转换；普通成功构建末检查预期文件均出现。 */
function shimDepsPlugin(deps: Record<string, ShimOptions[]>): Plugin {
  const transformed: Record<string, boolean> = {}

  return {
    name: 'shim-deps',
    transform: {
      filter: {
        id: new RegExp(`(?:${Object.keys(deps).join('|')})$`),
      },
      /** 按规范化 id 找到补丁列表，依次更新代码；固定 src 或 pattern 未找到预期目标时通过插件上下文报错。 */
      handler(code, id) {
        const file = Object.keys(deps).find((file) =>
          id.replace(/\\/g, '/').endsWith(file),
        )
        if (!file) return

        for (const { src, replacement, pattern } of deps[file]) {
          const magicString = new MagicString(code)

          if (src) {
            const pos = code.indexOf(src)
            if (pos < 0) {
              this.error(
                `Could not find expected src "${src}" in file "${file}"`,
              )
            }
            transformed[file] = true
            magicString.overwrite(pos, pos + src.length, replacement)
          }

          if (pattern) {
            let match
            while ((match = pattern.exec(code))) {
              transformed[file] = true
              const start = match.index
              const end = start + match[0].length
              let _replacement = replacement
              for (let i = 1; i <= match.length; i++) {
                _replacement = _replacement.replace(`$${i}`, match[i] || '')
              }
              magicString.overwrite(start, end, _replacement)
            }
            if (!transformed[file]) {
              this.error(
                `Could not find expected pattern "${pattern}" in file "${file}"`,
              )
            }
          }

          code = magicString.toString()
        }

        console.log(`shimmed: ${file}`)

        return code
      },
    },
    /** 普通构建未报错时核对所有预期 shim 文件均被处理；watch 或已有错误时跳过补验。 */
    buildEnd(err) {
      if (this.meta.watchMode) return

      if (!err) {
        for (const file in deps) {
          if (!transformed[file]) {
            this.error(
              `Did not find "${file}" which is supposed to be shimmed, was the file renamed?`,
            )
          }
        }
      }
    },
  }
}

/** 把 src 中未带 KEEP 标记的 import.meta.url 先写成占位编号，再按产物位置还原指向原源码文件的 URL 表达式。 */
function buildTimeImportMetaUrlPlugin(): Plugin {
  const idMap: Record<string, number> = {}
  let lastIndex = 0

  const prefix = `__vite_buildTimeImportMetaUrl_`
  const keepCommentRE = /\/\*\*\s*[#@]__KEEP__\s*\*\/\s*$/

  return {
    name: 'import-meta-current-dirname',
    transform: {
      filter: {
        code: 'import.meta.url',
      },
      /** 仅转换 src 路径中的 import.meta.url，保留紧邻 KEEP 注释的访问；用 lexer 排除普通文本。 */
      async handler(code, id) {
        const relativeId = path.relative(dirname, id).replaceAll('\\', '/')
        // 仅替换 src/ 中的访问。
        if (!relativeId.startsWith('src/')) return

        let index: number
        if (idMap[id]) {
          index = idMap[id]
        } else {
          index = idMap[id] = lastIndex
          lastIndex++
        }

        await init

        const s = new MagicString(code)
        const [imports] = parse(code)
        for (const { t, ss, se } of imports) {
          if (
            t === ImportType.ImportMeta &&
            code.slice(se, se + 4) === '.url'
          ) {
            // 紧邻 /** #__KEEP__ */ 的访问保留输出模块本身的 URL。
            if (keepCommentRE.test(code.slice(0, ss))) {
              keepCommentRE.lastIndex = 0
              continue
            }

            // 将当前访问先写成跨阶段占位符。
            s.overwrite(ss, se + 4, `${prefix}${index}`)
          }
        }
        return s.hasChanged() ? s.toString() : undefined
      },
    },
    /** 按占位编号反查原文件，计算输出文件到源码的相对路径；生成 ES/CJS URL 表达式，其他格式或反查失败时报错。 */
    renderChunk(code, chunk, outputOptions) {
      if (!code.includes(prefix)) return

      return code.replace(
        /__vite_buildTimeImportMetaUrl_(\d+)/g,
        (_, index) => {
          const originalFile = Object.keys(idMap).find(
            (key) => idMap[key] === +index,
          )
          if (!originalFile) {
            throw new Error(
              `Could not find original file for ${prefix}${index} in ${chunk.fileName}`,
            )
          }
          const outputFile = path.resolve(outputOptions.dir!, chunk.fileName)
          const relativePath = path
            .relative(path.dirname(outputFile), originalFile)
            .replaceAll('\\', '/')

          if (outputOptions.format === 'es') {
            return `new URL(${JSON.stringify(relativePath)}, import.meta.url)`
          } else if (outputOptions.format === 'cjs') {
            return `new URL(${JSON.stringify(
              relativePath,
            )}, require('node:url').pathToFileURL(__filename))`
          } else {
            throw new Error(`Unsupported output format ${outputOptions.format}`)
          }
        },
      )
    },
  }
}

/**
 * 检查非 watch 输出的全部 chunk 代码 UTF-8 字节数，不计 asset 内容。
 * @param limit - 十进制 kB 上限（1 kB = 1000 字节）。
 */
function bundleSizeLimit(limit: number): Plugin {
  let size = 0

  return {
    name: 'bundle-limit',
    /** 非 watch 模式累计当前 bundle 所有 chunk 的代码字节数，留到 closeBundle 检查。 */
    generateBundle(_, bundle) {
      if (this.meta.watchMode) return

      size = Buffer.byteLength(
        Object.values(bundle)
          .map((i) => ('code' in i ? i.code : ''))
          .join(''),
        'utf-8',
      )
    },
    /** 非 watch 模式以十进制 kB 比较最终代码体积，超过上限时报告构建错误。 */
    closeBundle() {
      if (this.meta.watchMode) return

      const kb = size / 1000
      if (kb > limit) {
        this.error(
          `Bundle size exceeded ${limit} kB, current size is ${kb.toFixed(
            2,
          )}kb.`,
        )
      }
    },
  }
}

// #endregion
