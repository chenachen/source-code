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
 * 场景：浏览器 ES 输出需要加载 modulepreload polyfill，CJS 输出必须通过
 * `isModernFlag=false` 被 tree-shaking 删除。
 */
describe('load', () => {
  /** 场景：ES 输出入口只导入 modulepreload polyfill；验证目标：保留其副作用模块，快照包含 polyfill 内容。 */
  it('loads modulepreload polyfill', async ({ expect }) => {
    const { output } = await buildProject()
    expect(output).toHaveLength(1)
    expect(output[0].code).toMatchSnapshot()
  })

  /** 场景：CJS 输出入口导入 modulepreload polyfill；验证目标：现代浏览器标志为 false，空副作用模块被 tree-shake。 */
  it("doesn't load modulepreload polyfill when format is cjs", async ({
    expect,
  }) => {
    const { output } = await buildProject({ format: 'cjs' })
    expect(output).toHaveLength(1)
    expect(output[0].code).toMatchSnapshot()
  })
})
