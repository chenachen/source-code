/**
 * 默认导出重写场景：把 `export default`、对象、class、TS interface/satisfies/as 等形式稳定
 * 改写到指定变量，同时保持注释与 source map 所需位置，不误处理字符串中的关键字。
 */
import { rewriteDefault } from '../src'

describe('compiler sfc: rewriteDefault', () => {
  // 模块只有具名导出；rewriteDefault 保留原代码并补空目标对象，确保后续 SFC 选项有合并入口。
  test('without export default', () => {
    expect(rewriteDefault(`export const a = {}`, 'script'))
      .toMatchInlineSnapshot(`
      "export const a = {}
      const script = {}"
    `)
  })

  // export 与 default 之间多空格；Babel 定位真实默认对象导出并替换为目标 const。
  test('rewrite export default', () => {
    expect(
      rewriteDefault(`export  default {}`, 'script'),
    ).toMatchInlineSnapshot(`"const script = {}"`)
  })

  // 字符串值含 default 但没有默认导出；字符串保持原样，仍补空目标对象。
  test('rewrite variable value default', () => {
    expect(rewriteDefault(`export const foo = 'default'`, 'script'))
      .toMatchInlineSnapshot(`
      "export const foo = 'default'
      const script = {}"
    `)
  })

  // 三种具名导出列表位置/空格包含 a as default；仅移除默认项及相应逗号，保留其余导出并绑定目标变量为 a。
  test('rewrite export named default', () => {
    expect(
      rewriteDefault(
        `const a = 1 \n export { a as b, a as default, a as c}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const a = 1 
       export { a as b,  a as c}
      const script = a"
    `)

    expect(
      rewriteDefault(
        `const a = 1 \n export { a as b, a as default    , a as c}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const a = 1 
       export { a as b,  a as c}
      const script = a"
    `)

    expect(
      rewriteDefault(
        `const a = 1 \n export { a as b } \n export { a as default, a as c }`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const a = 1 
       export { a as b } 
       export {  a as c }
      const script = a"
    `)
  })

  // 行注释中出现 export default，后面是真实默认对象；只改真实语法节点，注释原样保留。
  test('w/ comments', async () => {
    expect(rewriteDefault(`// export default\nexport default {}`, 'script'))
      .toMatchInlineSnapshot(`
      "// export default
      const script = {}"
    `)
  })

  // 跨行 export 列表只有 App as default；移除默认项、保留列表结构，再把目标变量绑定到 App。
  test('export named default multiline', () => {
    expect(
      rewriteDefault(`let App = {}\n export {\nApp as default\n}`, '_sfc_main'),
    ).toMatchInlineSnapshot(`
      "let App = {}
       export {

      }
      const _sfc_main = App"
    `)
  })

  // 跨行列表含 default 项及其后注释示例，两种空格版本；只删除真实项，其他具名导出与注释保持。
  test('export named default multiline /w comments', () => {
    expect(
      rewriteDefault(
        `const a = 1 \n export {\n a as b,\n a as default,\n a as c}\n` +
          `// export { myFunction as default }`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const a = 1 
       export {
       a as b,
       
       a as c}
      // export { myFunction as default }
      const script = a"
    `)

    expect(
      rewriteDefault(
        `const a = 1 \n export {\n a as b,\n a as default      ,\n a as c}\n` +
          `// export { myFunction as default }`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const a = 1 
       export {
       a as b,
       
       a as c}
      // export { myFunction as default }
      const script = a"
    `)
  })

  // 覆盖外部 default、foo as default、不同逗号位置、只含默认项及同名局部变量；新增独立默认 import，保留其他再导出并避免局部名冲突。
  test(`export { default } from '...'`, async () => {
    expect(
      rewriteDefault(`export { default, foo } from './index.js'`, 'script'),
    ).toMatchInlineSnapshot(`
      "import { default as __VUE_DEFAULT__ } from './index.js'
      export {  foo } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(`export { default    , foo } from './index.js'`, 'script'),
    ).toMatchInlineSnapshot(`
      "import { default as __VUE_DEFAULT__ } from './index.js'
      export {  foo } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(`export { foo,   default } from './index.js'`, 'script'),
    ).toMatchInlineSnapshot(`
      "import { default as __VUE_DEFAULT__ } from './index.js'
      export { foo,    } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(
        `export { foo as default, bar } from './index.js'`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "import { foo as __VUE_DEFAULT__ } from './index.js'
      export {  bar } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(
        `export { foo as default     , bar } from './index.js'`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "import { foo as __VUE_DEFAULT__ } from './index.js'
      export {  bar } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(
        `export { bar,   foo as default } from './index.js'`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "import { foo as __VUE_DEFAULT__ } from './index.js'
      export { bar,    } from './index.js'
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(
        `export { foo as default } from './index.js' \n const foo = 1`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "import { foo as __VUE_DEFAULT__ } from './index.js'
      export {  } from './index.js' 
       const foo = 1
      const script = __VUE_DEFAULT__"
    `)

    expect(
      rewriteDefault(
        `const a = 1 \nexport { a as default } from 'xxx'`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "import { a as __VUE_DEFAULT__ } from 'xxx'
      const a = 1 
      export {  } from 'xxx'
      const script = __VUE_DEFAULT__"
    `)
  })

  // 默认导出具名 class Foo；保留类声明并追加目标变量=Foo，而非把类声明改成对象。
  test('export default class', async () => {
    expect(rewriteDefault(`export default class Foo {}`, 'script'))
      .toMatchInlineSnapshot(`
        " class Foo {}
        const script = Foo"
      `)
  })

  // 行注释中的默认导出先于真实 Foo 类；只改类的真实 export 前缀。
  test('export default class w/ comments', async () => {
    expect(
      rewriteDefault(
        `// export default\nexport default class Foo {}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "// export default
       class Foo {}
      const script = Foo"
    `)
  })

  // 真实对象默认导出后面是类导出注释；对象改为目标变量，注释中的 class 不参与选择。
  test('export default class w/ comments 2', async () => {
    expect(
      rewriteDefault(
        `export default {}\n` + `// export default class Foo {}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const script = {}
      // export default class Foo {}"
    `)
  })

  // 块注释含 Foo 类导出，真实 Bar 位于后方；保留注释并让目标变量绑定 Bar。
  test('export default class w/ comments 3', async () => {
    expect(
      rewriteDefault(
        `/*\nexport default class Foo {}*/\n` + `export default class Bar {}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "/*
      export default class Foo {}*/
       class Bar {}
      const script = Bar"
    `)
  })

  // 开启 decorators-legacy 解析 @Component 默认类；装饰器留在类前，目标变量绑定具名 Foo。
  test('@Component\nexport default class', async () => {
    expect(
      rewriteDefault(`@Component\nexport default class Foo {}`, 'script', [
        'decorators-legacy',
      ]),
    ).toMatchInlineSnapshot(`
      "@Component class Foo {}
      const script = Foo"
    `)
  })

  // 装饰类前有 export default 行注释；装饰器与真实类改写，注释不误当导出入口。
  test('@Component\nexport default class w/ comments', async () => {
    expect(
      rewriteDefault(
        `// export default\n@Component\nexport default class Foo {}`,
        'script',
        ['decorators-legacy'],
      ),
    ).toMatchInlineSnapshot(`
      "// export default
      @Component class Foo {}
      const script = Foo"
    `)
  })

  // 默认对象后有装饰器/类的行注释示例；仅改对象，注释代码完全保留。
  test('@Component\nexport default class w/ comments 2', async () => {
    expect(
      rewriteDefault(
        `export default {}\n` + `// @Component\n// export default class Foo {}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "const script = {}
      // @Component
      // export default class Foo {}"
    `)
  })

  // 块注释中是装饰 Foo，真实默认类是 Bar；只改真实类并绑定 Bar，注释不进入 AST 导出遍历。
  test('@Component\nexport default class w/ comments 3', async () => {
    expect(
      rewriteDefault(
        `/*\n@Component\nexport default class Foo {}*/\n` +
          `export default class Bar {}`,
        'script',
      ),
    ).toMatchInlineSnapshot(`
      "/*
      @Component
      export default class Foo {}*/
       class Bar {}
      const script = Bar"
    `)
  })
})
