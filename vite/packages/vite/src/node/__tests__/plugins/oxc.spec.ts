import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { transformWithOxc } from '../../plugins/oxc'

/** Oxc 显式 JSX 选项应覆盖 tsconfig 的 preserve，并启用 automatic runtime 与 pure 标记。 */
describe('transformWithOxc', () => {
  /** 场景：tsconfig 要求 preserve，但调用方显式选择 automatic JSX runtime；验证目标：调用方配置优先并生成 automatic runtime 代码。 */
  test('correctly overrides TS configuration and applies automatic transform', async () => {
    const jsxImportSource = 'bar'
    const result = await transformWithOxc(
      'const foo = () => <></>',
      path.resolve(
        import.meta.dirname,
        './fixtures/oxc-tsconfigs/jsx-preserve/baz.jsx',
      ),
      {
        jsx: {
          runtime: 'automatic',
          importSource: jsxImportSource,
        },
      },
    )
    expect(result?.code).toContain(`${jsxImportSource}/jsx-runtime`)
    expect(result?.code).toContain('/* @__PURE__ */')
  })

  /** 场景：tsconfig 使用 react-jsx，而调用方显式选择 preserve；验证目标：调用方配置优先，原 JSX 文本保持不变。 */
  test('correctly overrides TS configuration and preserves code', async () => {
    const foo = 'const foo = () => <></>'
    const result = await transformWithOxc(
      foo,
      path.resolve(
        import.meta.dirname,
        './fixtures/oxc-tsconfigs/jsx-react-jsx/baz.jsx',
      ),
      {
        jsx: 'preserve',
      },
    )
    expect(result?.code).toContain(foo)
  })

  /** 场景：调用方为 classic runtime 显式提供 pragma 与 fragment；验证目标：覆盖 tsconfig 并生成对应工厂调用。 */
  test('correctly overrides TS configuration and transforms code', async () => {
    const jsxFactory = 'h',
      jsxFragment = 'bar'
    const result = await transformWithOxc(
      'const foo = () => <></>',
      path.resolve(
        import.meta.dirname,
        './fixtures/oxc-tsconfigs/jsx-complex-options/baz.jsx',
      ),
      {
        jsx: {
          runtime: 'classic',
          pragma: jsxFactory,
          pragmaFrag: jsxFragment,
        },
      },
    )
    expect(result?.code).toContain(
      `/* @__PURE__ */ ${jsxFactory}(${jsxFragment}, null)`,
    )
  })

  /**
   * 场景矩阵：useDefineForClassFields 由 tsconfig target/显式值决定，Oxc target 只控制是否
   * 还要降级输出，不能反向改变 TypeScript class field 语义。
   */
  describe('useDefineForClassFields', async () => {
    /** 按 Oxc target 与指定 tsconfig 转换 class field 代码，返回结果供语义矩阵比较。 */
    const transformClassCode = async (target: string, tsconfigDir: string) => {
      const result = await transformWithOxc(
        `
          class foo {
            bar = 'bar'
          }
        `,
        path.resolve(import.meta.dirname, tsconfigDir, './bar.ts'),
        { target },
      )
      return result?.code
    }

    const [
      defineForClassFieldsTrueTransformedCode,
      defineForClassFieldsTrueLowerTransformedCode,
      defineForClassFieldsFalseTransformedCode,
    ] = await Promise.all([
      transformClassCode('esnext', './fixtures/oxc-tsconfigs/use-define-true'),
      transformClassCode('es2021', './fixtures/oxc-tsconfigs/use-define-true'),
      transformClassCode('esnext', './fixtures/oxc-tsconfigs/use-define-false'),
    ])

    /** 场景：tsconfig 与 Oxc target 都是 esnext；验证目标：class field 使用 define 语义且无需进一步降级。 */
    test('target: esnext and tsconfig.target: esnext => true', async () => {
      const actual = await transformClassCode(
        'esnext',
        './fixtures/oxc-tsconfigs/target-esnext',
      )
      expect(actual).toBe(defineForClassFieldsTrueTransformedCode)
    })

    /** 场景：tsconfig 决定 useDefineForClassFields=true，而 Oxc target 较低；验证目标：只降低输出形式，不改变 define 语义。 */
    test('target: es2021 and tsconfig.target: esnext => true', async () => {
      const actual = await transformClassCode(
        'es2021',
        './fixtures/oxc-tsconfigs/target-esnext',
      )
      expect(actual).toBe(defineForClassFieldsTrueLowerTransformedCode)
    })

    /** 场景：tsconfig target 低于 ES2022 且未显式配置 class field；验证目标：采用 TypeScript 兼容的 assignment 语义。 */
    test('target: es2021 and tsconfig.target: es2021 => false', async () => {
      const actual = await transformClassCode(
        'es2021',
        './fixtures/oxc-tsconfigs/target-es2021',
      )
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })

    /** 场景：tsconfig 选择 assignment 语义而 Oxc 输出 target 更高；验证目标：输出 target 不反向覆盖 TypeScript 语义。 */
    test('target: esnext and tsconfig.target: es2021 => false', async () => {
      const actual = await transformClassCode(
        'esnext',
        './fixtures/oxc-tsconfigs/target-es2021',
      )
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })

    /** 场景：tsconfig target 为 ES2022 且未显式配置；验证目标：class field 默认采用标准 define 语义。 */
    test('target: es2022 and tsconfig.target: es2022 => true', async () => {
      const actual = await transformClassCode(
        'es2022',
        './fixtures/oxc-tsconfigs/target-es2022',
      )
      expect(actual).toBe(defineForClassFieldsTrueTransformedCode)
    })

    /** 场景：tsconfig 没有 target 与显式 class field 选项；验证目标：维持 TypeScript 兼容默认值 false。 */
    test('target: es2022 and tsconfig.target: undefined => false', async () => {
      const actual = await transformClassCode(
        'es2022',
        './fixtures/oxc-tsconfigs/empty',
      )
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })
  })

  /** 场景：tsconfig 开启 emitDecoratorMetadata；验证目标：Oxc 自动生成 design:type 元数据 helper。 */
  test('supports emitDecoratorMetadata: true', async () => {
    const result = await transformWithOxc(
      `
          function LogMethod(target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
            console.log(target, propertyKey, descriptor);
          }

          class Demo {
            @LogMethod
            public foo(bar: number) {}
          }

          const demo = new Demo();
        `,
      path.resolve(
        import.meta.dirname,
        './fixtures/oxc-tsconfigs/decorator-metadata/bar.ts',
      ),
    )
    expect(result?.code).toContain('_decorateMetadata("design:type"')
  })
})
