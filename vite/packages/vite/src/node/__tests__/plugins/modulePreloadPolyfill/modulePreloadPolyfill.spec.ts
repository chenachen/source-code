import { describe, it } from 'vitest'
import type { ModuleFormat, RolldownOutput } from 'rolldown'
import { build } from '../../../build'
import { modulePreloadPolyfillId } from '../../../plugins/modulePreloadPolyfill'

/** 按输出格式构建只导入 modulepreload polyfill 的虚拟入口，并返回内存产物。 */
const buildProject = ({ format = 'es' as ModuleFormat } = {}) =>
  build({
    logLevel: 'silent',
    build: {
      write: false,
      rolldownOptions: {
        input: 'main.js',
        output: {
          format,
        },
        treeshake: {
          moduleSideEffects: false,
        },
      },
      minify: false,
    },
    plugins: [
      {
        name: 'test',
        /** 把唯一 main.js 入口解析为内部虚拟模块。 */
        resolveId(id) {
          if (id === 'main.js') {
            return `\0${id}`
          }
        },
        /** 让虚拟入口仅导入 polyfill，以隔离格式相关的 tree-shaking 行为。 */
        load(id) {
          if (id === '\0main.js') {
            return `import '${modulePreloadPolyfillId}'`
          }
        },
      },
    ],
  }) as Promise<RolldownOutput>

/**
 * 只导入 polyfill 的入口按 ES/CJS 分别构建；比较快照，检查格式相关的 polyfill 保留与删除。
 */
describe('load', () => {
  /** 场景：ES 输出入口只导入 modulepreload polyfill；验证目标：保留其副作用模块，快照包含 polyfill 内容。 */
  it('loads modulepreload polyfill', async ({ expect }) => {
    const { output } = await buildProject()
    expect(output).toHaveLength(1)
    expect(output[0].code).toMatchSnapshot()
  })

  /** CJS 入口仅导入 polyfill；快照检查产物不含浏览器 polyfill 代码。 */
  it("doesn't load modulepreload polyfill when format is cjs", async ({
    expect,
  }) => {
    const { output } = await buildProject({ format: 'cjs' })
    expect(output).toHaveLength(1)
    expect(output[0].code).toMatchSnapshot()
  })
})
