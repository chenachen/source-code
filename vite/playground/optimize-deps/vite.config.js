import fs from 'node:fs'
import module from 'node:module'
import { defineConfig } from 'vite'
/** 以此 ESM 配置文件为基准创建 require，用于解析绝对 alias 的真实入口。 */
const require = module.createRequire(import.meta.url)

export default defineConfig({
  define: {
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: {
    dedupe: ['react'],
    alias: {
      'node:url': 'url',
      '@vitejs/test-dep-alias-using-absolute-path':
        require.resolve('@vitejs/test-dep-alias-using-absolute-path'),
    },
  },
  optimizeDeps: {
    include: [
      '@vitejs/test-dep-linked-include',
      '@vitejs/test-nested-exclude > @vitejs/test-nested-include',
      '@vitejs/test-dep-cjs-external-package-omit-js-suffix',
      // 此项不可优化，预期记录警告而非中断整个优化任务。
      '@vitejs/test-non-optimizable-include',
      '@vitejs/test-dep-optimize-exports-with-glob/**/*',
      '@vitejs/test-dep-optimize-exports-with-root-glob/**/*.js',
      '@vitejs/test-dep-optimize-with-glob/**/*.js',
      '@vitejs/test-dep-cjs-with-external-deps',
      '@vitejs/test-dep-cjs-with-es-module-flag',
      // 仅由请求时的 transform 插件注入，扫描器看不到；显式 include 提前优化。
      '@vitejs/test-dep-cjs-for-injected-import',
    ],
    exclude: [
      '@vitejs/test-nested-exclude',
      '@vitejs/test-dep-non-optimized',
      '@vitejs/test-dep-esm-external',
      'stream',
    ],
    rolldownOptions: {
      plugins: [
        {
          name: 'replace-a-file',
          /** 优化器 load 插件匹配测试包入口后返回替代 hello 模块。 */
          load(id) {
            if (/dep-esbuild-plugin-transform(?:\\|\/)index\.js$/.test(id)) {
              return `export const hello = () => 'Hello from an esbuild plugin'`
            }
          },
        },
      ],
    },
    entries: ['index.html', 'unused-split-entry.js'],
  },

  build: {
    // 禁用压缩，减少构建测试耗时。
    minify: false,
  },

  plugins: [
    testVue(),
    notjs(),
    virtualModulePlugin(),
    injectImportIntoOptimizedDep(),
    {
      name: 'test-astro',
      /** 只把 .astro 输入替换为空默认导出，供 CommonJS 深层后缀补全后的插件转换。 */
      transform(code, id) {
        if (id.endsWith('.astro')) {
          code = `export default {}`
          return { code }
        }
      },
    },
  ],
})

// 处理链接依赖的 Test.vue，生成可被页面观察的成功组件。
/** 创建处理链接包 Test.vue 的插件，其余非虚拟 Vue 文件回退为空模块。 */
function testVue() {
  return {
    name: 'testvue',
    /** 命中特定 Test.vue 时生成可渲染成功标记的组件；其他非虚拟 .vue 返回空模块。 */
    transform(code, id) {
      if (id.includes('dep-linked-include/Test.vue')) {
        return {
          code: `
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'Test',
  render() {
    return '[success] rendered from Vue'
  }
})
`.trim(),
        }
      }

      // 其他非虚拟 Vue 文件回退为空模块。
      if (!id.startsWith('\0') && id.endsWith('.vue')) {
        return { code: `export default {}` }
      }
    },
  }
}

// 为自定义 .notjs 文件移除标签包装，提供合法 JS 扫描输入。
/** 创建 .notjs 扩展名扫描与转换插件，移除 fixture 的自定义标签包装。 */
function notjs() {
  return {
    name: 'notjs',
    /** 为优化器追加 .notjs 扩展名和带 ID filter 的 load 插件。 */
    config() {
      return {
        optimizeDeps: {
          extensions: ['.notjs'],
          rolldownOptions: {
            plugins: [
              {
                name: 'esbuild-notjs',
                load: {
                  filter: { id: /\.notjs$/ },
                  /** 读取 .notjs 文件并移除首个 <notjs> 与结束标签，返回可扫描的 JS 内容。 */
                  handler(id) {
                    let contents = fs.readFileSync(id, 'utf-8')
                    contents = contents
                      .replace('<notjs>', '')
                      .replace('</notjs>', '')
                    return contents
                  },
                },
              },
            ],
          },
        },
      }
    },
    /** 正常模块请求时移除 .notjs 包装，与优化器 load 的输入解包保持一致。 */
    transform(code, id) {
      if (id.endsWith('.notjs')) {
        code = code.replace('<notjs>', '').replace('</notjs>', '')
        return { code }
      }
    },
  }
}

// 向被请求的优化输出注入 CJS 具名 import，模拟运行时 transform 插件追加依赖的行为。
/** 创建只对已优化目标依赖输出注入 CJS 具名 import 的插件。 */
function injectImportIntoOptimizedDep() {
  return {
    name: 'inject-import-into-optimized-dep',
    /** 仅命中目标 .vite/deps 输出且尚未注入时，前置 injectedMsg 的具名 import。 */
    transform(code, id) {
      if (
        /\.vite[\\/]deps[\\/].*test-dep-with-injected-import/.test(id) &&
        !code.includes('test-dep-cjs-for-injected-import')
      ) {
        return {
          code:
            `import { msg as injectedMsg } from '@vitejs/test-dep-cjs-for-injected-import';\n` +
            code,
        }
      }
    },
  }
}

/** 创建 Foo.vue 公共虚拟 ID 到空字节私有 ID 的解析与加载插件。 */
function virtualModulePlugin() {
  const virtualModuleId = 'virtual:test-virtual-file/Foo.vue'
  const resolvedVirtualModuleId = '\0' + virtualModuleId

  return {
    name: 'test-virtual-module',
    /** 仅将指定虚拟组件公共 ID 解析为带空字节前缀的私有 ID。 */
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId
      }
    },
    /** 仅为指定私有 ID 返回 VirtualComponent 默认导出源码。 */
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export default { name: 'VirtualComponent' }`
      }
    },
  }
}
