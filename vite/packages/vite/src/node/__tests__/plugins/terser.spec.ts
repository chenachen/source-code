import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { build } from 'vite'
import type { RollupOutput } from 'rollup'
import type { TerserOptions } from '../../plugins/terser'

/**
 * Terser worker 场景：基础压缩可在线程执行；自定义 nth_identifier 函数与
 * nameCache 不可安全结构化克隆，必须回退主线程并保留其可变/回调语义。
 */
describe('terser', () => {
  /** 使用指定 Terser 选项构建固定虚拟入口，并返回压缩后的入口代码。 */
  const run = async (terserOptions: TerserOptions) => {
    const result = (await build({
      root: resolve(import.meta.dirname, '../packages/build-project'),
      logLevel: 'silent',
      build: {
        write: false,
        minify: 'terser',
        terserOptions,
      },
      plugins: [
        {
          name: 'test',
          /** 把 Terser 场景的 entry.js 解析为内部虚拟入口。 */
          resolveId(id) {
            if (id === 'entry.js') {
              return '\0' + id
            }
          },
          /** 提供包含可改名变量与对象属性的固定压缩样本源码。 */
          load(id) {
            if (id === '\0entry.js') {
              return `
                const foo = 1;
                console.log(foo);
                const bar = { hello: 1, ["world"]: 2 };
                console.log(bar.hello + bar["world"]);
              `
            }
          },
        },
      ],
    })) as RollupOutput
    return result.output[0].code
  }

  /** 场景：使用默认 Terser 选项压缩样例代码；验证目标：worker 转换完成且返回可用代码。 */
  test('basic', async () => {
    await run({})
  })

  /** 场景：mangle.nth_identifier 提供自定义 get 函数；验证目标：回退执行保留该函数，产物变量含 prefix_。 */
  test('nth', async () => {
    const resultCode = await run({
      mangle: {
        nth_identifier: {
          get: (n) => {
            return 'prefix_' + n.toString()
          },
        },
      },
    })
    expect(resultCode).toContain('prefix_')
  })

  /** 场景：nameCache 与 keep_quoted 一起压缩 hello/world 属性；验证目标：缓存记录未引用 hello，且不错误登记被保留的 world。 */
  test('nameCache', async () => {
    const nameCache = {}

    await run({
      compress: false,
      mangle: {
        properties: {
          keep_quoted: true,
        },
      },
      nameCache,
    })

    expect(nameCache).toHaveProperty('props.props.$hello')
    expect(nameCache).not.toHaveProperty('props.props.$world')
  })
})
