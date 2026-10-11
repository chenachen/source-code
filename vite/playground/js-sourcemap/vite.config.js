import { fileURLToPath } from 'node:url'
import babel from '@babel/core'
import MagicString from 'magic-string'
import { Visitor, parseSync } from 'oxc-parser'
import { defineConfig } from 'vite'
import transformFooWithInlineSourceMap from './foo-with-sourcemap-plugin.ts'

export default defineConfig({
  plugins: [
    transformFooWithInlineSourceMap(),
    {
      name: 'test-babel-transformed-optimized-dep',
      /** 只对优化目录中的 Babel class-field 依赖再次转换，返回 Babel map，验证与依赖优化 map 串联。 */
      async transform(code, id) {
        if (
          !id.includes('/deps/') ||
          !id.includes('@vitejs_test-dep-class-field-sourcemap-babel.js')
        ) {
          return
        }

        return babel.transformAsync(code, {
          filename: id,
          configFile: false,
          babelrc: false,
          ast: false,
          sourceMaps: true,
          plugins: [() => ({
            visitor: {
              /** 空 Program visitor 使 Babel 插件参与转换而不改 AST，隔离多阶段 map 串联本身。 */
              Program() {}
            }
          })],
        })
      },
    },
    {
      name: 'test-oxc-transformed-optimized-dep',
      /** 只改写优化目录中的 Oxc class-field 依赖；MagicString 记录符号原名并返回高精度 map，验证优化后的变量回映。 */
      transform(code, id) {
        if (
          !id.includes('/deps/') ||
          !id.includes('@vitejs_test-dep-class-field-sourcemap-oxc.js')
        ) {
          return
        }

        const parsed = parseSync(id, code, { range: true })
        const s = new MagicString(code)
        const visitor = new Visitor({
          /** 给所有 Identifier 追加 $$$，以 storeName 保留原名供 source map 的 names 查询。 */
          Identifier(node) {
            s.overwrite(node.start, node.end, `${node.name}$$$`, {
              storeName: true,
            })
          },
        })
        visitor.visit(parsed.program)

        return {
          code: s.toString(),
          map: s.generateMap({
            hires: true,
            source: id,
            includeContent: true,
          }),
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@vitejs/test-dep-class-field-sourcemap-babel': fileURLToPath(
        new URL('./dep-class-field-sourcemap-babel/index.js', import.meta.url),
      ),
      '@vitejs/test-dep-class-field-sourcemap-oxc': fileURLToPath(
        new URL('./dep-class-field-sourcemap-oxc/index.js', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    exclude: ['@vitejs/test-dep-malicious-sourcemap'],
    include: [
      '@vitejs/test-dep-class-field-sourcemap-babel',
      '@vitejs/test-dep-class-field-sourcemap-oxc',
    ],
    // 强制降低 class fields 语法，使优化依赖构造器出现测试检查的参数重命名，
    // 再验证后续 Babel/Oxc 变换能回映到原参数。
    rolldownOptions: {
      transform: {
        target: 'es2015',
      },
    },
  },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        // manualChunks(name) {
        //   if (name.endsWith('after-preload-dynamic.js')) {
        //     return 'after-preload-dynamic'
        //   }
        //   if (name.endsWith('after-preload-dynamic-hashbang.js')) {
        //     return 'after-preload-dynamic-hashbang'
        //   }
        //   if (name.endsWith('after-preload-dynamic-no-dep.js')) {
        //     return 'after-preload-dynamic-no-dep'
        //   }
        //   if (name.includes('with-define-object')) {
        //     return 'with-define-object'
        //   }
        // },
        codeSplitting: {
          groups: [
            { name: 'after-preload-dynamic', test: 'after-preload-dynamic.js' },
            {
              name: 'after-preload-dynamic-hashbang',
              test: 'after-preload-dynamic-hashbang.js',
            },
            {
              name: 'after-preload-dynamic-no-dep',
              test: 'after-preload-dynamic-no-dep.js',
            },
            { name: 'with-define-object', test: 'with-define-object' },
          ],
        },
        /** 仅给 hashbang 分包添加首行解释器指令，验证 preload mapDeps 注入位于 banner 之后。 */
        banner(chunk) {
          if (chunk.name.endsWith('after-preload-dynamic-hashbang')) {
            return '#!/usr/bin/env node'
          }
        },
        sourcemapDebugIds: true,
      },
    },
  },
  define: {
    __testDefineObject: '{ "hello": "test" }',
  },
})
