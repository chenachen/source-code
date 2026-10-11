import path from 'node:path'
import fs from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { describe, expect, test } from 'vitest'
import { browserLogs, isBundledDev, isServe, serverLogs } from '~utils'

/** bundled dev 跳过；其余模式检查三个目录的副作用与基类 setter 日志：主目录保留类型导入且 define 字段不触发 setter，nested 移除类型导入且赋值字段触发 setter，extends 继承前者并覆盖字段行为。 */
test.skipIf(isBundledDev)(
  'should respected each `tsconfig.json`s compilerOptions',
  () => {
    // main 的 verbatimModuleSyntax=true 保留该导入，触发副作用。
    expect(browserLogs).toContain('main side effect')
    // main 的 useDefineForClassFields=true 定义自身字段，不调用基类 setter。
    expect(browserLogs).not.toContain('data setter in MainBase')

    // nested 未设 verbatimModuleSyntax，按 false 去除该类型用途导入。
    expect(browserLogs).not.toContain('nested side effect')
    // nested 的 useDefineForClassFields=false 使用赋值，触发基类 setter。
    expect(browserLogs).toContain('data setter in NestedBase')

    // nested-with-extends 从主配置继承 verbatimModuleSyntax=true，保留副作用导入。
    expect(browserLogs).toContain('nested-with-extends side effect')
    // nested-with-extends 覆盖 useDefineForClassFields=false，触发基类 setter。
    expect(browserLogs).toContain('data setter in NestedWithExtendsBase')
  },
)

/** 仅开发模式检查扫描日志不含参数装饰器需开启 experimentalDecorators 的错误，覆盖最近 tsconfig 的配置读取。 */
test.runIf(isServe)('scanner should not error with decorators', () => {
  expect(serverLogs).not.toStrictEqual(
    expect.arrayContaining([
      expect.stringContaining(
        'Parameter decorators only work when experimental decorators are enabled',
      ),
    ]),
  )
})

describe('transformWithEsbuild', () => {
  /** 读取 main.ts 后用对象 tsconfigRaw 覆盖字段选项并调用 transformWithEsbuild，确认磁盘 tsconfig 的 verbatimModuleSyntax 仍合并进来，保留 not-used-type 导入。 */
  test('merge tsconfigRaw object', async () => {
    const main = path.resolve(import.meta.dirname, '../src/main.ts')
    const mainContent = fs.readFileSync(main, 'utf-8')
    const result = await transformWithEsbuild(mainContent, main, {
      tsconfigRaw: {
        compilerOptions: {
          useDefineForClassFields: false,
        },
      },
    })
    // 对象 tsconfigRaw 合并磁盘配置中的 verbatimModuleSyntax=true。
    expect(result.code).toMatch(/import.*".\/not-used-type";/)
  })

  /** 读取 main.ts 后用字符串 tsconfigRaw 调用 transformWithEsbuild，确认不会继续读取磁盘 verbatimModuleSyntax，未使用的类型导入被移除。 */
  test('overwrite tsconfigRaw string', async () => {
    const main = path.resolve(import.meta.dirname, '../src/main.ts')
    const mainContent = fs.readFileSync(main, 'utf-8')
    const result = await transformWithEsbuild(mainContent, main, {
      tsconfigRaw: `{
        "compilerOptions": {
          "useDefineForClassFields": false
        }
      }`,
    })
    // 字符串 tsconfigRaw 不再读取磁盘中的 verbatimModuleSyntax，
    // 这里按未设置时的 false 处理。
    expect(result.code).not.toMatch(/import.*".\/not-used-type";/)
  })

  /** 读取 main.ts 后以对象显式设 verbatimModuleSyntax=false 调用转换，确认该覆盖值使未使用的类型导入被移除。 */
  test('verbatimModuleSyntax', async () => {
    const main = path.resolve(import.meta.dirname, '../src/main.ts')
    const mainContent = fs.readFileSync(main, 'utf-8')
    const result = await transformWithEsbuild(mainContent, main, {
      tsconfigRaw: {
        compilerOptions: {
          useDefineForClassFields: false,
          verbatimModuleSyntax: false,
        },
      },
    })
    // 此处显式传入 false，覆盖磁盘配置中的 true。
    expect(result.code).not.toMatch(/import.*".\/not-used-type";/)
  })

  /** 读取 decorator.ts 并按 es2020 转换，确认最近 tsconfig 的 experimentalDecorators 使输出包含 __decorateClass。 */
  test('experimentalDecorators', async () => {
    const main = path.resolve(import.meta.dirname, '../src/decorator.ts')
    const mainContent = fs.readFileSync(main, 'utf-8')
    // 最近的 tsconfig.json 开启 experimentalDecorators=true，
    // 转换此装饰器语法应成功。
    const result = await transformWithEsbuild(mainContent, main, {
      target: 'es2020',
    })
    expect(result.code).toContain('__decorateClass')
  })
})
