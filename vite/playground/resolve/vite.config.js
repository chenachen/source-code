import path from 'node:path'
import { defaultClientConditions, defineConfig, normalizePath } from 'vite'
import { a } from './config-dep.cjs'

/** 传统 @virtual-file 公共虚拟 ID，供 resolveId 匹配。 */
const virtualFile = '@virtual-file'
/** 传统虚拟模块的空字节私有 ID，避免进入磁盘读取。 */
const virtualId = '\0' + virtualFile

/** 带 virtual: 协议和 .js 后缀的公共虚拟 ID，作为 #9036 回归输入。 */
const virtualFile9036 = 'virtual:file-9036.js'
/** 给协议虚拟 ID 添加空字节的私有 ID，供 load 返回源码。 */
const virtualId9036 = '\0' + virtualFile9036

/** 会生成真实包 import 的虚拟入口公共 ID，供扫描与请求阶段分别处理。 */
const virtualFileHasImport = 'virtual:file-has-import.js'
/** 不带空字节的虚拟 resolved ID，用于测试插件 load 抢先于磁盘读取。 */
const virtualIdHasImport = '/file-has-import.js'

/** 解析后仍保持原 ID 的自定义虚拟模块名称。 */
const customVirtualFile = '@custom-virtual-file'

/** 解析成带 URL scheme 私有 ID 的公共名称。 */
const virtualFileWithScheme = 'virtual-with-scheme'
/** 空字节加 https URL 的私有 ID，验证其不会被直接外部化为网络 URL。 */
const virtualIdWithScheme = '\0https://example.com/virtual.js'

/** 由 load 生成多个 import 的虚拟入口 ID。 */
const generatedContentVirtualFile = '@generated-content-virtual-file'
/** 盘符相对、磁盘绝对和 file URL 三种 specifier 与 DOM 选择器的对应表，供生成代码检查各路径解析。 */
const generatedContentImports = [
  {
    specifier: normalizePath(
      path
        .resolve(import.meta.dirname, './drive-relative.js')
        .replace(/^[a-zA-Z]:/, ''),
    ),
    elementQuery: '.drive-relative',
  },
  {
    specifier: normalizePath(
      path.resolve(import.meta.dirname, './absolute.js'),
    ),
    elementQuery: '.absolute',
  },
  {
    specifier: new URL('file-url.js', import.meta.url),
    elementQuery: '.file-url',
  },
]

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.js', '.es', '.ts'],
    mainFields: ['browser', 'custom', 'module'],
    conditions: [...defaultClientConditions, 'custom'],
  },
  define: {
    VITE_CONFIG_DEP_TEST: a,
  },
  plugins: [
    {
      name: 'virtual-module',
      /** 把传统公共虚拟 ID 解析为带空字节的私有 ID。 */
      resolveId(id) {
        if (id === virtualFile) {
          return virtualId
        }
      },
      /** 给传统私有虚拟 ID 返回成功标记源码。 */
      load(id) {
        if (id === virtualId) {
          return `export const msg = "[success] from conventional virtual file"`
        }
      },
    },
    {
      name: 'virtual-module-9036',
      /** 把 virtual:file-9036.js 公共 ID 解析为其空字节私有 ID。 */
      resolveId(id) {
        if (id === virtualFile9036) {
          return virtualId9036
        }
      },
      /** 给 #9036 私有虚拟 ID 返回成功标记模块。 */
      load(id) {
        if (id === virtualId9036) {
          return `export const msg = "[success] from virtual file #9036"`
        }
      },
    },
    {
      name: 'virtual-module-has-import',
      enforce: 'pre',
      /** 扫描时将此虚拟入口临时映射为真实包入口；正常请求解析为虚拟 ID，以保留源码里的 import 分析。 */
      resolveId(id, _importer, opts) {
        if (id === virtualFileHasImport) {
          // 扫描阶段暂用真实文件入口，使扫描器可以继续发现包依赖。
          // @ts-expect-error -- opts.scan is internal
          if (opts?.scan) {
            return normalizePath(
              path.resolve(import.meta.dirname, './exports-path/main.js'),
            )
          }
          return virtualIdHasImport
        }
      },
      /** 生成真实包的静态 import 和结果标记，供虚拟模块依赖分析。 */
      load(id) {
        if (id === virtualIdHasImport) {
          return (
            'import { msg as importedMsg } from "@vitejs/test-resolve-exports-path"\n' +
            'export const msg = importedMsg.includes("[success]") ? "[success] from virtual file that has import" : "[failure]"'
          )
        }
      },
    },
    {
      name: 'custom-resolve',
      /** 接管自定义虚拟名称并原样返回 ID，随后由本插件 load 提供源码。 */
      resolveId(id) {
        if (id === customVirtualFile) {
          return id
        }
      },
      /** 为自定义虚拟 ID 返回成功标记源码，不访问磁盘。 */
      load(id) {
        if (id === customVirtualFile) {
          return `export const msg = "[success] from custom virtual file"`
        }
      },
    },
    {
      name: 'virtual-url-scheme-test',
      /** 将公共名称解析为带空字节的 https 形式 ID，检验 scheme 和虚拟前缀共同处理。 */
      resolveId(id) {
        if (id === virtualFileWithScheme) {
          return virtualIdWithScheme
        }
      },
      /** 为带 URL scheme 的私有虚拟 ID 返回本地生成源码。 */
      load(id) {
        if (id === virtualIdWithScheme) {
          return `export const msg = "[success] from virtual file with URL scheme"`
        }
      },
    },
    {
      name: 'generated-content',
      /** 接管生成 import 代码的公共 ID，保持原名称交给 load。 */
      resolveId(id) {
        if (id === generatedContentVirtualFile) {
          return id
        }
      },
      /** 按 specifier/DOM 表生成静态 import 与页面写入代码，覆盖路径形态。 */
      load(id) {
        if (id === generatedContentVirtualFile) {
          const tests = generatedContentImports
            .map(
              ({ specifier, elementQuery }, i) =>
                `import content${i} from ${JSON.stringify(specifier)}\n` +
                `text(${JSON.stringify(elementQuery)}, content${i})`,
            )
            .join('\n')

          return (
            'function text(selector, text) {\n' +
            '  document.querySelector(selector).textContent = text\n' +
            '}\n\n' +
            tests
          )
        }
      },
    },
    {
      name: 'resolve to non normalized absolute',
      /** 将包含双斜杠的绝对路径再次交给 this.resolve，检验最终路径规范化。 */
      async resolveId(id) {
        if (id !== '@non-normalized') return
        return this.resolve(import.meta.dirname + '//non-normalized')
      },
    },
  ],
  optimizeDeps: {
    include: [
      '@vitejs/test-resolve-exports-with-module-condition-required',
      '@vitejs/test-resolve-sharp-dir',
    ],
  },
  build: {
    copyPublicDir: false,
  },
})
