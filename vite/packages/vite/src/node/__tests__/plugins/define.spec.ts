import { describe, expect, test } from 'vitest'
import { rolldown } from 'rolldown'
import { definePlugin } from '../../plugins/define'
import { resolveConfig } from '../../config'
import { PartialEnvironment } from '../../baseEnvironment'

/**
 * 构造同一 define 配置的两条执行路径：SSR dev 直接调用 JS/Oxc transform，build 则把
 * define 注入 Rolldown 原生 options。用同组语义断言防止两种实现漂移。
 */
async function createDefinePluginTransform(
  define: Record<string, any> = {},
  isSsrDev = false,
) {
  const ssr = isSsrDev
  const build = !isSsrDev
  const config = await resolveConfig(
    { configFile: false, define, environments: { ssr: {} } },
    build ? 'build' : 'serve',
  )
  const instance = definePlugin(config)
  const environment = new PartialEnvironment(ssr ? 'ssr' : 'client', config)

  return async (code: string) => {
    if (isSsrDev) {
        // @ts-expect-error transform.handler should exist
      const result = await instance.transform.handler.call(
        { environment },
        code,
        'foo.ts',
      )
      return result?.code || result
    } else {
      const nativeDefinePlugin = await (
        definePlugin(config) as any
      ).applyToEnvironment(environment)
      const bundler = await rolldown({
        input: 'entry.js',
        plugins: [
          {
            name: 'test',
            /** 把 define 测试传入的裸 ID 解析为内部虚拟模块。 */
            resolveId(id) {
              if (id === 'entry.js') {
                return '\0' + id
              }
            },
            /** 为内部虚拟 ID 返回调用方提供的 JavaScript 源码。 */
            load(id) {
              if (id === '\0entry.js') {
                return code
              }
            },
          },
          {
            name: 'native:define',
            options: nativeDefinePlugin.options.bind({ environment }),
          },
        ],
        experimental: {
          attachDebugInfo: 'none',
        },
      })
      return (await bundler.generate()).output[0].code
    }
  }
}

describe('definePlugin (SSR dev)', () => {
  /** 固定 JavaScript 文件名创建 define 转换器，供各 define 矩阵复用。 */
  const createJsDefinePluginTransform = (define: Record<string, any> = {}) =>
    createDefinePluginTransform(define, true)

  /** 场景：自定义标识符分别紧邻分号或与分号有空格；验证目标：两种写法都按语法节点替换，而非依赖文本拼接。 */
  test('replaces custom define', async () => {
    const transform = await createJsDefinePluginTransform({
      __APP_VERSION__: JSON.stringify('1.0'),
    })
    expect(await transform('export const version = __APP_VERSION__ ;')).toBe(
      'export const version = "1.0";\n',
    )
    expect(await transform('export const version = __APP_VERSION__;')).toBe(
      'export const version = "1.0";\n',
    )
  })

  /** 场景：源码不含任何 define 快速匹配模式；验证目标：transform 返回 undefined，保留源码并跳过 Oxc 开销。 */
  test('should not replace if not defined', async () => {
    const transform = await createJsDefinePluginTransform({
      __APP_VERSION__: JSON.stringify('1.0'),
    })
    expect(await transform('export const version = "1.0";')).toBe(undefined)
    expect(
      await transform('export const version = import.meta.SOMETHING'),
    ).toBe(undefined)
  })

  /** 场景：define 值是非 JSON 源码表达式且源码还含未知 env；验证目标：只替换显式配置项，未知 env 留给开发运行时。 */
  test('replace import.meta.env when it is a invalid json', async () => {
    const transform = await createJsDefinePluginTransform({
      'import.meta.env.LEGACY': '__VITE_IS_LEGACY__',
    })

    expect(
      await transform(
        'export const isLegacy = import.meta.env.LEGACY;\nimport.meta.env.UNDEFINED && console.log(import.meta.env.UNDEFINED);',
      ),
    ).toMatchInlineSnapshot(`
      "export const isLegacy = __VITE_IS_LEGACY__;
      import.meta.env.UNDEFINED && console.log(import.meta.env.UNDEFINED);
      "
    `)
  })
})

describe('native definePlugin', () => {
  /** 场景：bundled 路径配置相同的自定义 define；验证目标：该表达式合并进 Rolldown transform options 并出现在产物。 */
  test('replaces custom define', async () => {
    const transform = await createDefinePluginTransform({
      __APP_VERSION__: JSON.stringify('1.0'),
    })
    expect(await transform('export const version = __APP_VERSION__;')).toBe(
      'const version = "1.0";\nexport { version };\n',
    )
    expect(await transform('export const version = __APP_VERSION__ ;')).toBe(
      'const version = "1.0";\nexport { version };\n',
    )
  })

  /** 场景：源码引用未配置的普通表达式；验证目标：define 插件不替换它，只允许 bundler 做正常输出改写。 */
  test('should not replace if not defined', async () => {
    const transform = await createDefinePluginTransform({
      __APP_VERSION__: JSON.stringify('1.0'),
    })
    expect(await transform('export const version = "1.0";')).toBe(
      'const version = "1.0";\nexport { version };\n',
    )
    expect(
      await transform('export const version = import.meta.SOMETHING'),
    ).toBe('const version = import.meta.SOMETHING;\nexport { version };\n')
  })

  /** 场景：在 client Environment 转换内建 SSR 标志；验证目标：import.meta.env.SSR 被固定替换为 false。 */
  test('replaces import.meta.env.SSR with false', async () => {
    const transform = await createDefinePluginTransform()
    expect(await transform('export const isSSR = import.meta.env.SSR;')).toBe(
      'const isSSR = false;\nexport { isSSR };\n',
    )
  })

  /** 场景：用户 define 显式覆盖 import.meta.hot；验证目标：define 插件保留用户值，不执行默认 HMR 特殊处理。 */
  test('preserve import.meta.hot with override', async () => {
    // build 默认移除 import.meta.hot，使死代码可 tree-shake。
    const transform = await createDefinePluginTransform()
    expect(await transform('export const hot = import.meta.hot;')).toBe(
      'const hot = void 0;\nexport { hot };\n',
    )
    // 用户显式同值 define 可以覆盖默认行为，为自定义 runtime 保留 import.meta.hot。
    const overrideTransform = await createDefinePluginTransform({
      'import.meta.hot': 'import.meta.hot',
    })
    expect(await overrideTransform('export const hot = import.meta.hot;')).toBe(
      'const hot = import.meta.hot;\nexport { hot };\n',
    )
  })

  /** 场景：生产构建访问未声明的静态 import.meta.env 点属性；验证目标：该访问被替换为 undefined。 */
  test('replace import.meta.env.UNKNOWN with undefined', async () => {
    const transform = await createDefinePluginTransform()
    expect(await transform('export const foo = import.meta.env.UNKNOWN;')).toBe(
      'const foo = void 0;\nexport { foo };\n',
    )
  })

  /** 场景：import.meta.env 使用计算属性访问；验证目标：不套用静态点属性通配替换，保留给运行时处理。 */
  test('leave import.meta.env["UNKNOWN"] to runtime', async () => {
    const transform = await createDefinePluginTransform()
    expect(
      await transform('export const foo = import.meta.env["UNKNOWN"];'),
    ).toMatch(/const foo = .*\["UNKNOWN"\];\nexport \{ foo \};\n/s)
  })

  /** 场景：用户用同值 define 显式声明某个静态 env 访问；验证目标：该访问按用户配置保留。 */
  test('preserve import.meta.env.UNKNOWN with override', async () => {
    const transform = await createDefinePluginTransform({
      'import.meta.env.UNKNOWN': 'import.meta.env.UNKNOWN',
    })
    expect(await transform('export const foo = import.meta.env.UNKNOWN;')).toBe(
      'const foo = import.meta.env.UNKNOWN;\nexport { foo };\n',
    )
  })

  /** 场景：用户 define 值是非 JSON 源码表达式且还访问未知静态 env；验证目标：用户值原样嵌入，未知访问由通配规则消去。 */
  test('replace import.meta.env when it is a invalid json', async () => {
    const transform = await createDefinePluginTransform({
      'import.meta.env.LEGACY': '__VITE_IS_LEGACY__',
    })

    expect(
      await transform(
        'export const isLegacy = import.meta.env.LEGACY;\nimport.meta.env.UNDEFINED && console.log(import.meta.env.UNDEFINED);',
      ),
    ).toMatchInlineSnapshot(
      `"const isLegacy = __VITE_IS_LEGACY__;\nexport { isLegacy };\n"`,
    )
  })

  /** 场景：源码直接读取裸 import.meta.env；验证目标：替换为汇总内建 env 与用户 env define 的稳定对象。 */
  test('replace bare import.meta.env', async () => {
    const transform = await createDefinePluginTransform()
    expect(await transform('export const env = import.meta.env;')).toMatch(
      /const env = .*;\nexport \{ env \};\n/s,
    )
  })
})
