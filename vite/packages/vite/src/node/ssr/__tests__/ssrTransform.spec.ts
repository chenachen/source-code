import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assert, expect, test } from 'vitest'
import type { SourceMap } from 'rolldown'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transformWithOxc } from '../../plugins/oxc'
import { ssrTransform } from '../ssrTransform'
import { createServer } from '../..'

/**
 * 执行无上游 Source Map 的 SSR 转换，并把同一 code 同时作为转换输入与 originalCode。
 *
 * 输入覆盖 import/export 改写、词法作用域、循环依赖所需的提升与 live binding、
 * `import.meta`/动态导入，以及 sourcemap。快照中的 `__vite_ssr_*__` 名称分别对应
 * ModuleRunnerContext 的协议函数；阅读时应比较“原始语句”与“快照代码”的语义差异。
 */
const ssrTransformSimple = async (code: string, url = '') =>
  ssrTransform(code, null, url, code)
/** 执行无上游 Source Map 的简化转换并只返回生成代码。 */
const ssrTransformSimpleCode = async (code: string, url?: string) =>
  (await ssrTransformSimple(code, url))?.code

/**
 * 场景：默认导入成员随后用于属性访问。
 * 验证目标：转换为 SSR import 协议，并通过模块命名空间的 `default` 读取原绑定。
 */
test('default import', async () => {
  expect(
    await ssrTransformSimpleCode(`import foo from 'vue';console.log(foo.bar)`),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["default"]});
    console.log(__vite_ssr_import_0__.default.bar)"
  `,
  )
})

/**
 * 场景：具名导入在函数体内作为普通函数调用。
 * 验证目标：记录 importedNames，并用无接收者调用包装访问命名空间成员，避免错误绑定 `this`。
 */
test('named import', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { ref } from 'vue';function foo() { return ref(0) }`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["ref"]});
    function foo() { return (0,__vite_ssr_import_0__.ref)(0) }"
  `,
  )
})

/**
 * 场景：具名导入使用包含空格的任意字符串导出名。
 * 验证目标：协议记录原始导出名，并以方括号访问对应命名空间成员。
 */
test('named import: arbitrary module namespace specifier', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { "some thing" as ref } from 'vue';function foo() { return ref(0) }`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["some thing"]});
    function foo() { return (0,__vite_ssr_import_0__["some thing"])(0) }"
  `,
  )
})

/**
 * 场景：导入名 `query` 同时被函数内的语句标签使用。
 * 验证目标：continue/break 的标签引用保持原文，不被改写成导入成员访问。
 */
test('named import colliding with label', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { query } from 'vue';function foo() { query: while (true) { continue query; break query } }`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["query"]});
    function foo() { query: while (true) { continue query; break query } }"
  `,
  )
})

/**
 * 场景：命名空间导入后调用其具名成员。
 * 验证目标：整个模块映射到 SSR import 返回值，成员访问保持命名空间语义。
 */
test('namespace import', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import * as vue from 'vue';function foo() { return vue.ref(0) }`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue");
    function foo() { return __vite_ssr_import_0__.ref(0) }"
  `,
  )
})

/**
 * 场景：模块直接导出具名函数声明。
 * 验证目标：在声明前登记惰性 export getter，同时保留函数声明及其提升语义。
 */
test('export function declaration', async () => {
  expect(
    await ssrTransformSimpleCode(`export function foo() {}`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("foo", () => { try { return foo } catch {} });
    function foo() {}"
  `,
  )
})

/**
 * 场景：模块直接导出具名类声明。
 * 验证目标：登记读取本地类绑定的 export getter，并去除原 export 修饰符。
 */
test('export class declaration', async () => {
  expect(
    await ssrTransformSimpleCode(`export class foo {}`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("foo", () => { try { return foo } catch {} });
    class foo {}"
  `,
  )
})

/**
 * 场景：单条导出声明同时定义两个 const 绑定。
 * 验证目标：为每个导出名分别登记 live getter，原变量声明只执行一次。
 */
test('export var declaration', async () => {
  expect(
    await ssrTransformSimpleCode(`export const a = 1, b = 2`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("a", () => { try { return a } catch {} });
    __vite_ssr_exportName__("b", () => { try { return b } catch {} });
    const a = 1, b = 2"
  `,
  )
})

/**
 * 场景：导出列表同时包含原名导出与别名导出。
 * 验证目标：`a` 与 `c` 的 getter 分别指向本地 a、b，导出列表本身被移除。
 */
test('export named', async () => {
  expect(
    await ssrTransformSimpleCode(`const a = 1, b = 2; export { a, b as c }`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("a", () => { try { return a } catch {} });
    __vite_ssr_exportName__("c", () => { try { return b } catch {} });
    const a = 1, b = 2; "
  `,
  )
})

/**
 * 场景：从依赖直接 re-export 原名与别名成员。
 * 验证目标：生成依赖 import 协议，并让两个 export getter 指向对应命名空间字段。
 */
test('export named from', async () => {
  expect(
    await ssrTransformSimpleCode(`export { ref, computed as c } from 'vue'`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("ref", () => { try { return __vite_ssr_import_0__.ref } catch {} });
    __vite_ssr_exportName__("c", () => { try { return __vite_ssr_import_0__.computed } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["ref","computed"]});
    "
  `,
  )
})

/**
 * 场景：先具名导入绑定，再通过本地 export 列表重新导出。
 * 验证目标：导出 getter直接读取导入命名空间，避免复制值而破坏 live binding。
 */
test('named exports of imported binding', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import {createApp} from 'vue';export {createApp}`,
    ),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("createApp", () => { try { return __vite_ssr_import_0__.createApp } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["createApp"]});
    "
  `,
  )
})

/**
 * 场景：模块连续从两个依赖执行 `export *`。
 * 验证目标：按源码顺序导入每个依赖并调用 `__vite_ssr_exportAll__` 合并命名空间。
 */
test('export * from', async () => {
  expect(
    await ssrTransformSimpleCode(
      `export * from 'vue'\n` + `export * from 'react'`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue");
    __vite_ssr_exportAll__(__vite_ssr_import_0__);
    ;const __vite_ssr_import_1__ = await __vite_ssr_import__("react");
    __vite_ssr_exportAll__(__vite_ssr_import_1__);

    "
  `)
})

/**
 * 场景：通过 `export * as foo` 导出完整依赖命名空间。
 * 验证目标：foo 的 live getter 返回 SSR import 得到的整个命名空间对象。
 */
test('export * as from', async () => {
  expect(
    await ssrTransformSimpleCode(`export * as foo from 'vue'`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("foo", () => { try { return __vite_ssr_import_0__ } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("vue");
    "
  `,
  )
})

/**
 * 场景：同一说明符既被本地 import，又通过 namespace 或具名语法 re-export。
 * 验证目标：re-export getter引用自身对应的协议导入，不误复用同名本地绑定。
 */
test('re-export by imported name', async () => {
  expect(
    await ssrTransformSimpleCode(`\
import * as foo from 'foo'
export * as foo from 'foo'
`),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("foo", () => { try { return __vite_ssr_import_1__ } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo");
    const __vite_ssr_import_1__ = await __vite_ssr_import__("foo");


    "
  `)

  expect(
    await ssrTransformSimpleCode(`\
import { foo } from 'foo'
export { foo } from 'foo'
`),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("foo", () => { try { return __vite_ssr_import_1__.foo } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["foo"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("foo", {"importedNames":["foo"]});


    "
  `)

  expect(
    await ssrTransformSimpleCode(`\
import { foo } from 'foo'
export { foo as foo } from 'foo'
`),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("foo", () => { try { return __vite_ssr_import_1__.foo } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["foo"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("foo", {"importedNames":["foo"]});


    "
  `)
})

/**
 * 场景：namespace re-export 使用任意字符串导出名。
 * 验证目标：以完整字符串登记 export 名，并返回整个依赖命名空间。
 */
test('export * as from arbitrary module namespace identifier', async () => {
  expect(
    await ssrTransformSimpleCode(`export * as "arbitrary string" from 'vue'`),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("arbitrary string", () => { try { return __vite_ssr_import_0__ } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("vue");
    "
  `,
  )
})

/**
 * 场景：本地绑定以任意字符串作为导出别名。
 * 验证目标：export 协议保留字符串键并从原本地绑定读取值。
 */
test('export as arbitrary module namespace identifier', async () => {
  expect(
    await ssrTransformSimpleCode(
      `const something = "Something";export { something as "arbitrary string" };`,
    ),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("arbitrary string", () => { try { return something } catch {} });
    const something = "Something";"
  `,
  )
})

/**
 * 场景：依赖的任意字符串成员被 re-export 为另一个任意字符串名。
 * 验证目标：importedNames 和 export getter 分别保留源名称与目标名称。
 */
test('export as from arbitrary module namespace identifier', async () => {
  expect(
    await ssrTransformSimpleCode(
      `export { "arbitrary string2" as "arbitrary string" } from 'vue';`,
    ),
  ).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("arbitrary string", () => { try { return __vite_ssr_import_0__["arbitrary string2"] } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["arbitrary string2"]});
    "
  `,
  )
})

/**
 * 场景：默认导出匿名对象表达式。
 * 验证目标：表达式只求值一次并存入内部绑定，default getter 返回该绑定。
 */
test('export default', async () => {
  expect(await ssrTransformSimpleCode(`export default {}`))
    .toMatchInlineSnapshot(`
      "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
      const __vite_ssr_export_default__ = {}"
    `)
})

/**
 * 场景：无空白压缩代码先 export-all、紧接同源具名 import。
 * 验证目标：两条协议导入边界保持完整且顺序正确，不因相邻分号合并出错。
 */
test('export then import minified', async () => {
  expect(
    await ssrTransformSimpleCode(
      `export * from 'vue';import {createApp} from 'vue';`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue");
    __vite_ssr_exportAll__(__vite_ssr_import_0__);
    const __vite_ssr_import_1__ = await __vite_ssr_import__("vue", {"importedNames":["createApp"]});
    "
  `)
})

/**
 * 场景：源码在静态 import 之前使用该默认导入绑定。
 * 验证目标：SSR import 协议提升到首次使用之前，并改写早期成员访问。
 */
test('hoist import to top', async () => {
  expect(
    await ssrTransformSimpleCode(
      `path.resolve('server.js');import path from 'node:path';`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("node:path", {"importedNames":["default"]});
    __vite_ssr_import_0__.default.resolve('server.js');"
  `,
  )
})

/**
 * 场景：两个静态 import 之间只存在多行空白。
 * 验证目标：两条协议导入保持连续顺序，空白不会制造额外提升边界或语句。
 */
test('whitespace between imports does not trigger hoisting', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { dirname } from 'node:path';\n\n\nimport fs from 'node:fs';`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("node:path", {"importedNames":["dirname"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("node:fs", {"importedNames":["default"]});



    "
  `)
})

/**
 * 场景：SSR 源码读取 `import.meta.url`。
 * 验证目标：读取被改写到 ModuleRunnerContext 提供的 import-meta 协议对象。
 */
test('import.meta', async () => {
  expect(
    await ssrTransformSimpleCode(`console.log(import.meta.url)`),
  ).toMatchInlineSnapshot(`"console.log(__vite_ssr_import_meta__.url)"`)
})

/**
 * 场景：模块同时使用 `import.meta` 和名为 meta 的具名导入。
 * 验证目标：两者分别映射到 import-meta 协议对象与依赖命名空间，互不混淆。
 */
test('import.meta with imported variable named meta', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { meta } from './meta';\nconsole.log(import.meta.url, \`Hello, \${meta}!\`)`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./meta", {"importedNames":["meta"]});

    console.log(__vite_ssr_import_meta__.url, \`Hello, \${__vite_ssr_import_0__.meta}!\`)"
  `)
})

/**
 * 场景：导出函数内部执行动态 `import('./foo')`。
 * 验证目标：代码改用动态导入协议，`./foo` 只进入 dynamicDeps、不进入静态 deps。
 */
test('dynamic import', async () => {
  const result = await ssrTransformSimple(
    `export const i = () => import('./foo')`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "__vite_ssr_exportName__("i", () => { try { return i } catch {} });
    const i = () => __vite_ssr_dynamic_import__('./foo')"
  `,
  )
  expect(result?.deps).toEqual([])
  expect(result?.dynamicDeps).toEqual(['./foo'])
})

// #2221：方法定义键与导入同名时不能替换；否则 `namespace.fn() {}` 不是合法方法语法。
/**
 * 场景：类方法名与具名导入 fn 相同，方法体又调用该导入。
 * 验证目标：方法定义键保持 `fn`，只有方法体中的值引用被改写。
 */
test('do not rewrite method definition', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';class A { fn() { fn() } }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    class A { fn() { (0,__vite_ssr_import_0__.fn)() } }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

/**
 * 场景：函数内局部 const `fn` 遮蔽同名导入。
 * 验证目标：局部声明与对象简写均保持本地绑定，不被替换为依赖成员。
 */
test('do not rewrite when variable is in scope', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A(){ const fn = () => {}; return { fn }; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A(){ const fn = () => {}; return { fn }; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

// #5472：对象解构产生局部绑定后，不能再改写为同名 import。
/**
 * 场景：函数内对象解构声明局部 fn，遮蔽同名具名导入。
 * 验证目标：返回对象中的 fn 继续引用解构绑定，依赖仅保留静态记录。
 */
test('do not rewrite when variable is in scope with object destructuring', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A(){ let {fn, test} = {fn: 'foo', test: 'bar'}; return { fn }; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A(){ let {fn, test} = {fn: 'foo', test: 'bar'}; return { fn }; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

// #5472：数组解构也必须登记为当前作用域的局部绑定。
/**
 * 场景：函数内数组解构声明局部 fn，遮蔽同名具名导入。
 * 验证目标：局部 fn 的读取不被改写，证明数组 pattern 也进入作用域跟踪。
 */
test('do not rewrite when variable is in scope with array destructuring', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A(){ let [fn, test] = ['foo', 'bar']; return { fn }; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A(){ let [fn, test] = ['foo', 'bar']; return { fn }; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

// #5727：形参默认值内的模板表达式仍能引用外层 import。
/**
 * 场景：解构形参的默认模板字符串引用外层具名导入 fn。
 * 验证目标：模板插值被改写为依赖成员，而新形参绑定不错误遮蔽该引用。
 */
test('rewrite variable in string interpolation in function nested arguments', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A({foo = \`test\${fn}\`} = {}){ return {}; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A({foo = \`test\${__vite_ssr_import_0__.fn}\`} = {}){ return {}; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

// #6520：解构形参默认值里的 fn 仍指向外层 import，不能把它登记成新参数绑定。
/**
 * 场景：解构形参属性默认值直接引用外层导入 fn。
 * 验证目标：默认值求值位置使用依赖成员，函数体的形参作用域边界保持正确。
 */
test('rewrite variables in default value of destructuring params', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A({foo = fn}){ return {}; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A({foo = __vite_ssr_import_0__.fn}){ return {}; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

/**
 * 场景：函数体内声明局部函数 fn，遮蔽同名导入。
 * 验证目标：局部声明与返回值均保持本地函数绑定。
 */
test('do not rewrite when function declaration is in scope', async () => {
  const result = await ssrTransformSimple(
    `import { fn } from 'vue';function A(){ function fn() {}; return { fn }; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["fn"]});
    function A(){ function fn() {}; return { fn }; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

// #16452：具名函数表达式的名称只在函数体内形成局部绑定。
/**
 * 场景：嵌套具名函数表达式 fn 在自身函数体内读取 fn。
 * 验证目标：自引用保持函数自身绑定，不被同名导入改写。
 */
test('do not rewrite when function expression is in scope', async () => {
  const result = await ssrTransformSimple(
    `import {fn} from './vue';var a = function() { return function fn() { console.log(fn) } }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./vue", {"importedNames":["fn"]});
    var a = function() { return function fn() { console.log(fn) } }"
  `,
  )
})

// #16452：即使函数表达式出现在顶层参数中，其自引用也不能被 import 覆盖。
/**
 * 场景：顶层调用参数是具名函数表达式，默认参数与函数体都自引用 fn。
 * 验证目标：表达式内部两处 fn 均保持局部自绑定。
 */
test('do not rewrite when function expression is in global scope', async () => {
  const result = await ssrTransformSimple(
    `import {fn} from './vue';foo(function fn(a = fn) { console.log(fn) })`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./vue", {"importedNames":["fn"]});
    foo(function fn(a = fn) { console.log(fn) })"
  `,
  )
})

/**
 * 场景：函数体内类声明 cls 遮蔽同名导入。
 * 验证目标：返回对象引用本地类，转换器不改写局部声明作用域。
 */
test('do not rewrite when class declaration is in scope', async () => {
  const result = await ssrTransformSimple(
    `import { cls } from 'vue';function A(){ class cls {} return { cls }; }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["cls"]});
    function A(){ class cls {} return { cls }; }"
  `,
  )
  expect(result?.deps).toEqual(['vue'])
})

/**
 * 场景：嵌套具名类表达式 cls 在构造器内读取自身名称。
 * 验证目标：构造器中的 cls 保持类自绑定，不被同名导入替换。
 */
test('do not rewrite when class expression is in scope', async () => {
  const result = await ssrTransformSimple(
    `import { cls } from './vue';var a = function() { return class cls { constructor() { console.log(cls) } } }`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./vue", {"importedNames":["cls"]});
    var a = function() { return class cls { constructor() { console.log(cls) } } }"
  `,
  )
})

/**
 * 场景：顶层调用参数中的具名类表达式在构造器内自引用 cls。
 * 验证目标：表达式作用域内 cls 保持类自身绑定。
 */
test('do not rewrite when class expression is in global scope', async () => {
  const result = await ssrTransformSimple(
    `import { cls } from './vue';foo(class cls { constructor() { console.log(cls) } })`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./vue", {"importedNames":["cls"]});
    foo(class cls { constructor() { console.log(cls) } })"
  `,
  )
})

/**
 * 场景：catch 参数 error 遮蔽同名具名导入。
 * 验证目标：catch 子句参数保持局部绑定，同时依赖仍被记录为静态 deps。
 */
test('do not rewrite catch clause', async () => {
  const result = await ssrTransformSimple(
    `import {error} from './dependency';try {} catch(error) {}`,
  )
  expect(result?.code).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./dependency", {"importedNames":["error"]});
    try {} catch(error) {}"
  `,
  )
  expect(result?.deps).toEqual(['./dependency'])
})

// 类声明继承导入值时插入本地别名；类表达式的 extends 则可直接改写为属性读取。
/**
 * 场景：普通类和导出类都继承具名导入的父类 Foo。
 * 验证目标：转换器在首次 extends 前建立稳定本地别名，两种类均通过该别名继承。
 */
test('should declare variable for imported super class', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { Foo } from './dependency';` + `class A extends Foo {}`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./dependency", {"importedNames":["Foo"]});
    const Foo = __vite_ssr_import_0__.Foo;
    class A extends Foo {}"
  `)

  // 导出类也要在根作用域、首个使用该绑定的类之前插入别名声明。
  expect(
    await ssrTransformSimpleCode(
      `import { Foo } from './dependency';` +
        `export default class A extends Foo {}\n` +
        `export class B extends Foo {}`,
    ),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("default", () => { try { return A } catch {} });
    __vite_ssr_exportName__("B", () => { try { return B } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("./dependency", {"importedNames":["Foo"]});
    const Foo = __vite_ssr_import_0__.Foo;
    class A extends Foo {};
    class B extends Foo {}"
  `)
})

// #4049：默认导出的匿名/具名函数与类需要分别保持名称、提升和自引用语义。
/**
 * 场景：默认导出分别使用匿名函数、匿名类、具名函数与具名类。
 * 验证目标：匿名值使用内部绑定；具名声明保留名称和后续本地引用，函数仍可提升、类仍有 TDZ。
 */
test('should handle default export variants', async () => {
  // 默认匿名函数：创建内部临时绑定。
  expect(await ssrTransformSimpleCode(`export default function() {}\n`))
    .toMatchInlineSnapshot(`
      "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
      const __vite_ssr_export_default__ = function() {}
      "
    `)
  // 默认匿名类：同样创建内部临时绑定。
  expect(await ssrTransformSimpleCode(`export default class {}\n`))
    .toMatchInlineSnapshot(`
      "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
      const __vite_ssr_export_default__ = class {}
      "
    `)
  // 默认具名函数：保留函数声明及其提升语义。
  expect(
    await ssrTransformSimpleCode(
      `export default function foo() {}\n` +
        `foo.prototype = Object.prototype;`,
    ),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("default", () => { try { return foo } catch {} });
    function foo() {};
    foo.prototype = Object.prototype;"
  `)
  // 默认具名类：后续类仍可直接继承这个本地名称。
  expect(
    await ssrTransformSimpleCode(
      `export default class A {}\n` + `export class B extends A {}`,
    ),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("default", () => { try { return A } catch {} });
    __vite_ssr_exportName__("B", () => { try { return B } catch {} });
    class A {};
    class B extends A {}"
  `)
})

/**
 * 场景：SSR transform 的代码输入与原始 sourceContent 包含不同尾部注释。
 * 验证目标：Source Map sources 指向输入 ID，sourcesContent 保留调用方提供的原始源码。
 */
test('sourcemap source', async () => {
  const map = (
    await ssrTransform(
      `export const a = 1`,
      null,
      'input.js',
      'export const a = 1 /* */',
    )
  )?.map as SourceMap

  expect(map?.sources).toStrictEqual(['input.js'])
  expect(map?.sourcesContent).toStrictEqual(['export const a = 1 /* */'])
})

/**
 * 场景：两个静态 import 位于首次使用之后，转换后被提升到生成代码前两行。
 * 验证目标：生成行 1、2 分别映射回原源码中两条 import 的第 5、6 行。
 */
test('sourcemap is correct for hoisted imports', async () => {
  const code = `\n\n\nconsole.log(foo, bar);\nimport { foo } from 'vue';\nimport { bar } from 'vue2';`
  const result = (await ssrTransform(code, null, 'input.js', code))!

  expect(result.code).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["foo"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("vue2", {"importedNames":["bar"]});



    console.log((0,__vite_ssr_import_0__.foo), (0,__vite_ssr_import_1__.bar));

    "
  `)

  const traceMap = new TraceMap(result.map as any)
  expect(originalPositionFor(traceMap, { line: 1, column: 0 })).toStrictEqual({
    source: 'input.js',
    line: 5,
    column: 0,
    name: null,
  })
  expect(originalPositionFor(traceMap, { line: 2, column: 0 })).toStrictEqual({
    source: 'input.js',
    line: 6,
    column: 0,
    name: null,
  })
})

/**
 * 场景：导入函数调用含不同空白/注释形态，并包含一条 optional call。
 * 验证目标：普通 `(0, fn)` 包装的调用帧映射回 callee 起点；optional call 保留原左括号列。
 * 对应源码：`ssrTransform()` 为 imported binding call 生成身份包装及边界级 sourcemap。
 */
test('sourcemap call site of imported binding maps to callee start', async () => {
  // import 调用会包成 `(0, ...)` 以避免绑定 `this`。V8 把这种括号 callee 的调用帧
  // 锚在实参列表的 `(`；sourcemap 必须把它映射回原始 callee 起点，才能与 Node
  // 列号一致，而不是映射到 `(` 自身。见 #19625。
  const wrap = '(0,__vite_ssr_import_0__.fn)'

  /** 定位包装表达式后的实参左括号，并通过生成 map 反查原始调用位置。 */
  const mapArgParen = (generated: string, map: unknown) => {
    const afterWrap = generated.indexOf(wrap) + wrap.length
    const parenIndex = generated.indexOf('(', afterWrap)
    let line = 1
    let column = 0
    for (let i = 0; i < parenIndex; i++) {
      if (generated[i] === '\n') {
        line++
        column = 0
      } else {
        column++
      }
    }
    return originalPositionFor(new TraceMap(map as any), { line, column })
  }

  // callee `fn` 始终从第 2 行第 0 列开始；callee 与 `(` 之间的空白或注释不应改变帧位置。
  for (const call of [
    'fn()',
    'fn ()',
    'fn /* c */ ()',
    'fn\n()',
    'fn(1)',
    'fn /* c */ (1)',
  ]) {
    const code = `import { fn } from 'vue'\n${call}`
    const result = (await ssrTransform(code, null, 'input.js', code))!
    expect(mapArgParen(result.code, result.map), call).toMatchObject({
      source: 'input.js',
      line: 2,
      column: 0,
    })
  }

  // 可选调用由 Node 自身锚在 `(` 而非 callee，因此应保留原始 `(` 的位置（第 2 行第 4 列）。
  const code = `import { fn } from 'vue'\nfn?.()`
  const result = (await ssrTransform(code, null, 'input.js', code))!
  expect(mapArgParen(result.code, result.map)).toMatchObject({
    source: 'input.js',
    line: 2,
    column: 4,
  })
})

/**
 * 场景：输入 bundle 的上游 Source Map 同时引用 first.ts 与 second.ts。
 * 验证目标：SSR 转换组合映射后仍保留两个原始 sources。
 */
test('sourcemap with multiple sources', async () => {
  const code = readFixture('bundle.js')
  const map = readFixture('bundle.js.map')

  const result = await ssrTransform(code, JSON.parse(map), '', code)
  assert(result?.map)

  const { sources } = result.map as SourceMap
  expect(sources).toContain('./first.ts')
  expect(sources).toContain('./second.ts')

  /** 读取含多个 Source Map sources 的 bundle 测试夹具。 */
  function readFixture(filename: string) {
    const url = new URL(
      `./fixtures/bundled-with-sourcemaps/${filename}`,
      import.meta.url,
    )

    return readFileSync(fileURLToPath(url), 'utf8')
  }
})

/**
 * 场景：上游 Source Map 含嵌套目录源文件与入口源文件。
 * 验证目标：组合后的 sources 顺序及相对嵌套路径保持不变。
 */
test('sourcemap with multiple sources and nested paths', async () => {
  const code = readFixture('dist.js')
  const map = readFixture('dist.js.map')

  const result = await ssrTransform(code, JSON.parse(map), '', code)
  assert(result?.map)

  const { sources } = result.map as SourceMap
  expect(sources).toMatchInlineSnapshot(`
    [
      "nested-directory/nested-file.js",
      "entrypoint.js",
    ]
  `)

  /** 读取包含嵌套 source 路径的多源 Source Map 夹具。 */
  function readFixture(filename: string) {
    const url = new URL(
      `./fixtures/multi-source-sourcemaps/${filename}`,
      import.meta.url,
    )

    return readFileSync(fileURLToPath(url), 'utf8')
  }
})

/**
 * 场景：同名导入 inject 同时出现在对象简写、别名属性及多层局部解构遮蔽中。
 * 验证目标：仅未被当前词法作用域遮蔽的引用改写为导入成员，局部 inject 保持原样。
 */
test('overwrite bindings', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { inject } from 'vue';` +
        `const a = { inject }\n` +
        `const b = { test: inject }\n` +
        `function c() { const { test: inject } = { test: true }; console.log(inject) }\n` +
        `const d = inject\n` +
        `function f() {  console.log(inject) }\n` +
        `function e() { const { inject } = { inject: true } }\n` +
        `function g() { const f = () => { const inject = true }; console.log(inject) }\n`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["inject"]});
    const a = { inject: __vite_ssr_import_0__.inject };
    const b = { test: __vite_ssr_import_0__.inject };
    function c() { const { test: inject } = { test: true }; console.log(inject) }
    const d = __vite_ssr_import_0__.inject;
    function f() {  console.log((0,__vite_ssr_import_0__.inject)) }
    function e() { const { inject } = { inject: true } }
    function g() { const f = () => { const inject = true }; console.log((0,__vite_ssr_import_0__.inject)) }
    "
  `)
})

/**
 * 场景：数组解构 pattern 首位为空洞，后续绑定为 LHS 与 RHS。
 * 验证目标：作用域扫描接受空元素并保持原解构代码不变。
 */
test('Empty array pattern', async () => {
  expect(
    await ssrTransformSimpleCode(`const [, LHS, RHS] = inMatch;`),
  ).toMatchInlineSnapshot(`"const [, LHS, RHS] = inMatch;"`)
})

/**
 * 场景：箭头函数和函数声明的解构形参默认值调用具名导入。
 * 验证目标：所有默认值中的 foo/bar 调用均改写为无接收者的依赖成员调用。
 */
test('function argument destructure', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import { foo, bar } from 'foo'
const a = ({ _ = foo() }) => {}
function b({ _ = bar() }) {}
function c({ _ = bar() + foo() }) {}
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["foo","bar"]});


    const a = ({ _ = (0,__vite_ssr_import_0__.foo)() }) => {};
    function b({ _ = (0,__vite_ssr_import_0__.bar)() }) {}
    function c({ _ = (0,__vite_ssr_import_0__.bar)() + (0,__vite_ssr_import_0__.foo)() }) {}
    "
  `)
})

/**
 * 场景：对象解构把属性别名声明为局部 n，并另测导入 n 作为计算属性键、m 作为目标绑定。
 * 验证目标：解构目标遮蔽同名导入；计算键仍读取外部导入，目标 m 保持局部。
 */
test('object destructure alias', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import { n } from 'foo'
const a = () => {
  const { type: n = 'bar' } = {}
  console.log(n)
}
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["n"]});


    const a = () => {
      const { type: n = 'bar' } = {};
      console.log(n)
    }
    "
  `)

  // #9585：计算属性键与解构目标处于不同引用语境，不能把新局部绑定误作 import。
  expect(
    await ssrTransformSimpleCode(
      `
import { n, m } from 'foo'
const foo = {}

{
  const { [n]: m } = foo
}
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["n","m"]});


    const foo = {};

    {
      const { [__vite_ssr_import_0__.n]: m } = foo
    }
    "
  `)
})

/**
 * 场景：深层对象/数组解构、rest 与对象 rest 声明六个同名局部绑定。
 * 验证目标：函数内调用保持局部绑定，函数外同名调用全部改写为导入成员。
 */
test('nested object destructure alias', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import { remove, add, get, set, rest, objRest } from 'vue'

function a() {
  const {
    o: { remove },
    a: { b: { c: [ add ] }},
    d: [{ get }, set, ...rest],
    ...objRest
  } = foo

  remove()
  add()
  get()
  set()
  rest()
  objRest()
}

remove()
add()
get()
set()
rest()
objRest()
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["remove","add","get","set","rest","objRest"]});



    function a() {
      const {
        o: { remove },
        a: { b: { c: [ add ] }},
        d: [{ get }, set, ...rest],
        ...objRest
      } = foo;

      remove();
      add();
      get();
      set();
      rest();
      objRest()
    }

    (0,__vite_ssr_import_0__.remove)();
    (0,__vite_ssr_import_0__.add)();
    (0,__vite_ssr_import_0__.get)();
    (0,__vite_ssr_import_0__.set)();
    (0,__vite_ssr_import_0__.rest)();
    (0,__vite_ssr_import_0__.objRest)()
    "
  `)
})

/**
 * 场景：对象同时含普通方法名、导入值计算键、本地值计算键、属性与形参遮蔽。
 * 验证目标：只改写作为值表达式的导入计算键，静态键与局部形参保持原样。
 */
test('object props and methods', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import foo from 'foo'

const bar = 'bar'

const obj = {
  foo() {},
  [foo]() {},
  [bar]() {},
  foo: () => {},
  [foo]: () => {},
  [bar]: () => {},
  bar(foo) {}
}
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["default"]});



    const bar = 'bar';

    const obj = {
      foo() {},
      [__vite_ssr_import_0__.default]() {},
      [bar]() {},
      foo: () => {},
      [__vite_ssr_import_0__.default]: () => {},
      [bar]: () => {},
      bar(foo) {}
    }
    "
  `)
})

/**
 * 场景：类字段名与多个具名导入同名，初始化器又读取或调用这些导入。
 * 验证目标：字段键保持不变，仅初始化器及类外调用改写为依赖成员。
 */
test('class props', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import { remove, add, update, del, call } from 'vue'

class A {
  remove = 1
  add = null
  update = update
  del = () => del()
  call = call(4)
}

remove(2);
add(4);
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["remove","add","update","del","call"]});



    class A {
      remove = 1
      add = null
      update = __vite_ssr_import_0__.update
      del = () => (0,__vite_ssr_import_0__.del)()
      call = (0,__vite_ssr_import_0__.call)(4)
    }

    (0,__vite_ssr_import_0__.remove)(2);
    (0,__vite_ssr_import_0__.add)(4);
    "
  `)
})

/**
 * 场景：类含普通、计算、本地计算、私有方法及同名形参。
 * 验证目标：导入值只在计算方法键中改写，方法名、私有名和形参均保持局部语义。
 */
test('class methods', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import foo from 'foo'

const bar = 'bar'

class A {
  foo() {}
  [foo]() {}
  [bar]() {}
  #foo() {}
  bar(foo) {}
}
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["default"]});



    const bar = 'bar';

    class A {
      foo() {}
      [__vite_ssr_import_0__.default]() {}
      [bar]() {}
      #foo() {}
      bar(foo) {}
    }
    "
  `)
})

/**
 * 场景：函数内以 const/function 声明遮蔽四个导入，并在嵌套函数与模块顶层分别调用。
 * 验证目标：函数作用域内使用本地绑定；顶层未遮蔽调用改写为依赖成员。
 */
test('declare scope', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
import { aaa, bbb, ccc, ddd } from 'vue'

function foobar() {
  ddd()

  const aaa = () => {
    bbb(ccc)
    ddd()
  }
  const bbb = () => {
    console.log('hi')
  }
  const ccc = 1
  function ddd() {}

  aaa()
  bbb()
  ccc()
}

aaa()
bbb()
`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("vue", {"importedNames":["aaa","bbb","ccc","ddd"]});



    function foobar() {
      ddd();

      const aaa = () => {
        bbb(ccc);
        ddd()
      };
      const bbb = () => {
        console.log('hi')
      };
      const ccc = 1;
      function ddd() {}

      aaa();
      bbb();
      ccc()
    }

    (0,__vite_ssr_import_0__.aaa)();
    (0,__vite_ssr_import_0__.bbb)()
    "
  `)
})

/**
 * 场景：Oxc classic JSX 输出同时引用 React、导入 Foo 与被形参 Slot 遮蔽的导入 Slot。
 * 验证目标：React/Foo 访问改写到各自命名空间，函数体 `<Slot />` 继续使用形参绑定。
 */
test('jsx', async () => {
  const code = `
  import React from 'react'
  import { Foo, Slot } from 'foo'

  function Bar({ Slot = <Foo /> }) {
    return (
      <>
        <Slot />
      </>
    )
  }
  `
  const id = '/foo.jsx'
  const result = await transformWithOxc(code, id, {
    jsx: { runtime: 'classic' },
  })
  expect(await ssrTransformSimpleCode(result.code, '/foo.jsx'))
    .toMatchInlineSnapshot(`
      "const __vite_ssr_import_0__ = await __vite_ssr_import__("react", {"importedNames":["default"]});
      const __vite_ssr_import_1__ = await __vite_ssr_import__("foo", {"importedNames":["Foo","Slot"]});


      function Bar({ Slot = /* @__PURE__ */ __vite_ssr_import_0__.default.createElement((0,__vite_ssr_import_1__.Foo), null) }) {
      	return /* @__PURE__ */ __vite_ssr_import_0__.default.createElement(__vite_ssr_import_0__.default.Fragment, null, /* @__PURE__ */ __vite_ssr_import_0__.default.createElement(Slot, null));
      }
      "
    `)
})

/**
 * 场景：两个 export function 声明之间没有换行或分号。
 * 验证目标：为两个名称分别登记 getter，并注入必要分隔符保持生成代码可解析。
 */
test('continuous exports', async () => {
  expect(
    await ssrTransformSimpleCode(
      `
export function fn1() {
}export function fn2() {
}
        `,
    ),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("fn1", () => { try { return fn1 } catch {} });
    __vite_ssr_exportName__("fn2", () => { try { return fn2 } catch {} });

    function fn1() {
    };function fn2() {
    }
            "
  `)
})

// https://github.com/vitest-dev/vitest/issues/1141
/**
 * 场景：默认导出是括号包裹的具名函数表达式或类表达式。
 * 验证目标：表达式整体只求值一次并赋给内部 default 绑定，不误按声明改写。
 */
test('export default expression', async () => {
  // 下方代码模拟 Oxc 对以下 TypeScript 默认导出断言的转换结果：
  // export default <MyFn> function getRandom() {
  //   return Math.random()
  // }
  const code = `
export default (function getRandom() {
  return Math.random();
});
`.trim()

  expect(await ssrTransformSimpleCode(code)).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
    const __vite_ssr_export_default__ = (function getRandom() {
      return Math.random();
    });"
  `)

  expect(await ssrTransformSimpleCode(`export default (class A {});`))
    .toMatchInlineSnapshot(`
      "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
      const __vite_ssr_export_default__ = (class A {});"
    `)
})

// #8002：hashbang 必须保持文件首行，不能被提升的 import 协议挤到前面。
/**
 * 场景：SSR 源码以 Node hashbang 开头且没有 import。
 * 验证目标：转换可解析该语法，并逐字保留 hashbang 为生成代码首行。
 */
test('with hashbang', async () => {
  expect(
    await ssrTransformSimpleCode(
      `#!/usr/bin/env node
console.log("it can parse the hashbang")`,
    ),
  ).toMatchInlineSnapshot(`
    "#!/usr/bin/env node
    console.log("it can parse the hashbang")"
  `)
})

/**
 * 场景：LF hashbang 后先使用默认导入、再声明静态 import。
 * 验证目标：协议导入提升到使用前但仍位于 hashbang 之后。
 */
test('import hoisted after hashbang', async () => {
  expect(
    await ssrTransformSimpleCode(
      `#!/usr/bin/env node
console.log(foo);
import foo from "foo"`,
    ),
  ).toMatchInlineSnapshot(`
    "#!/usr/bin/env node
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["default"]});
    console.log((0,__vite_ssr_import_0__.default));
    "
  `)
})

/**
 * 场景：CRLF 源码的 hashbang 后存在需提升的静态 import。
 * 验证目标：CRLF 识别不影响首行保护，协议导入仍插入 hashbang 之后。
 */
test('import hoisted after CRLF hashbang', async () => {
  expect(
    await ssrTransformSimpleCode(
      '#!/usr/bin/env node\r\nconsole.log(foo);\r\nimport foo from "foo"',
    ),
  ).toMatchInlineSnapshot(`
    "#!/usr/bin/env node
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["default"]});
    console.log((0,__vite_ssr_import_0__.default));
    "
  `)
})

/**
 * 场景：hashbang 模块调用具名导入，转换需生成无接收者调用包装。
 * 验证目标：导入协议与调用包装都出现在 hashbang 之后，首行不被任何辅助代码占用。
 */
test('identity function helper injected after hashbang', async () => {
  expect(
    await ssrTransformSimpleCode(
      `#!/usr/bin/env node
import { foo } from "foo"
foo()`,
    ),
  ).toMatchInlineSnapshot(`
    "#!/usr/bin/env node
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foo", {"importedNames":["foo"]});

    (0,__vite_ssr_import_0__.foo)()"
  `)
})

// #10289：类、函数和条件块具有不同的词法作用域边界。
/**
 * 场景：模块顶层与类方法内的 if/else 分支分别声明或读取同名导入 foo、bar。
 * 验证目标：声明所在分支使用局部绑定，未声明分支读取依赖成员；类与函数边界互不泄漏。
 */
test('track scope by class, function, condition blocks', async () => {
  const code = `
import { foo, bar } from 'foobar'
if (false) {
  const foo = 'foo'
  console.log(foo)
} else if (false) {
  const [bar] = ['bar']
  console.log(bar)
} else {
  console.log(foo)
  console.log(bar)
}
export class Test {
  constructor() {
    if (false) {
      const foo = 'foo'
      console.log(foo)
    } else if (false) {
      const [bar] = ['bar']
      console.log(bar)
    } else {
      console.log(foo)
      console.log(bar)
    }
  }
};`.trim()

  expect(await ssrTransformSimpleCode(code)).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("Test", () => { try { return Test } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("foobar", {"importedNames":["foo","bar"]});

    if (false) {
      const foo = 'foo';
      console.log(foo)
    } else if (false) {
      const [bar] = ['bar'];
      console.log(bar)
    } else {
      console.log((0,__vite_ssr_import_0__.foo));
      console.log((0,__vite_ssr_import_0__.bar))
    };
    class Test {
      constructor() {
        if (false) {
          const foo = 'foo';
          console.log(foo)
        } else if (false) {
          const [bar] = ['bar'];
          console.log(bar)
        } else {
          console.log((0,__vite_ssr_import_0__.foo));
          console.log((0,__vite_ssr_import_0__.bar))
        }
      }
    };;"
  `)
})

// #10386：`var` 提升到函数作用域，而不是所在块作用域。
/**
 * 场景：if 块内用 var 声明 foo、bar，函数末尾在块外读取二者。
 * 验证目标：两处读取保持函数级 var 绑定，不被同名导入改写。
 */
test('track var scope by function', async () => {
  expect(
    await ssrTransformSimpleCode(`
import { foo, bar } from 'foobar'
function test() {
  if (true) {
    var foo = () => { var why = 'would' }, bar = 'someone'
  }
  return [foo, bar]
}`),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foobar", {"importedNames":["foo","bar"]});


    function test() {
      if (true) {
        var foo = () => { var why = 'would' }, bar = 'someone'
      };
      return [foo, bar]
    }"
  `)
})

// #11806：块级声明与 catch 参数只遮蔽各自块内的同名 import。
/**
 * 场景：函数内含块级 foo/bar 声明与 catch 参数 baz，块外仍读取导入 foo/bar。
 * 验证目标：遮蔽只作用于各自块；块外引用正确恢复为依赖成员。
 */
test('track scope by blocks', async () => {
  expect(
    await ssrTransformSimpleCode(`
import { foo, bar, baz } from 'foobar'
function test() {
  [foo];
  {
    let foo = 10;
    let bar = 10;
  }
  try {} catch (baz){ baz };
  return bar;
}`),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("foobar", {"importedNames":["foo","bar","baz"]});


    function test() {
      [__vite_ssr_import_0__.foo];
      {
        let foo = 10;
        let bar = 10;
      }
      try {} catch (baz){ baz };;
      return __vite_ssr_import_0__.bar;
    }"
  `)
})

/**
 * 场景：for-of、普通 for 与 for-in 都声明循环局部变量 test，遮蔽同名导入。
 * 验证目标：三种循环体及迭代表达式中的局部 test 均不被改写。
 */
test('track scope in for loops', async () => {
  expect(
    await ssrTransformSimpleCode(`
import { test } from './test.js'

for (const test of tests) {
  console.log(test)
}

for (let test = 0; test < 10; test++) {
  console.log(test)
}

for (const test in tests) {
  console.log(test)
}`),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./test.js", {"importedNames":["test"]});



    for (const test of tests) {
      console.log(test)
    };

    for (let test = 0; test < 10; test++) {
      console.log(test)
    };

    for (const test in tests) {
      console.log(test)
    }"
  `)
})

/**
 * 场景：对象属性中的具名类表达式使用 Foo/Bar 名称，另有匿名类继承导入 Foo。
 * 验证目标：类表达式名称不遮蔽外层导入；真正的 extends 外部引用仍改写为依赖成员。
 */
test('avoid binding ClassExpression', async () => {
  const result = await ssrTransformSimple(
    `
import Foo, { Bar } from './foo';

console.log(Foo, Bar);
const obj = {
  foo: class Foo {},
  bar: class Bar {}
}
const Baz = class extends Foo {}
`,
  )
  expect(result?.code).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./foo", {"importedNames":["default","Bar"]});



    console.log((0,__vite_ssr_import_0__.default), (0,__vite_ssr_import_0__.Bar));
    const obj = {
      foo: class Foo {},
      bar: class Bar {}
    };
    const Baz = class extends __vite_ssr_import_0__.default {}
    "
  `)
})

/**
 * 场景：静态 JSON import 与动态 JSON import 都携带 `with { type: 'json' }` 属性。
 * 验证目标：静态导入进入 SSR import 协议，动态导入继续把第二参数传给动态协议。
 */
test('import assertion attribute', async () => {
  expect(
    await ssrTransformSimpleCode(`
import * as foo from './foo.json' with { type: 'json' };
import('./bar.json', { with: { type: 'json' } });
`),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./foo.json");


    __vite_ssr_dynamic_import__('./bar.json', { with: { type: 'json' } });
    "
  `)
})

/**
 * 场景：源码交错普通语句、export-all 与具名 import，且普通语句在 import 前读取 foo。
 * 验证目标：所有依赖按源码副作用顺序提升，两个 console 读取同一 live import 成员。
 */
test('import and export ordering', async () => {
  // 假设每个被导入模块执行时输出 `mod ${mod}`，且 `foo` 为 `bar`，日志顺序应为：
  // "mod a", "mod foo", "mod b", "bar1", "bar2"
  expect(
    await ssrTransformSimpleCode(`
console.log(foo + 1)
export * from './a'
import { foo } from './foo'
export * from './b'
console.log(foo + 2)
  `),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./a");
    __vite_ssr_exportAll__(__vite_ssr_import_0__);
    ;const __vite_ssr_import_1__ = await __vite_ssr_import__("./foo", {"importedNames":["foo"]});
    const __vite_ssr_import_2__ = await __vite_ssr_import__("./b");
    __vite_ssr_exportAll__(__vite_ssr_import_2__);
    ;
    console.log(__vite_ssr_import_1__.foo + 1);



    console.log(__vite_ssr_import_1__.foo + 2)
      "
  `)
})

/**
 * 场景：默认导出立即调用具名导入，随后 namespace re-export 并读取导出名。
 * 验证目标：getter 注册被提前；依赖导入先于 default 的 foo() 调用，namespace 导出指向其协议结果。
 */
test('identity function is declared before used', async () => {
  expect(
    await ssrTransformSimpleCode(`
import { foo } from './foo'
export default foo()
export * as bar from './bar'
console.log(bar)
  `),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });
    __vite_ssr_exportName__("bar", () => { try { return __vite_ssr_import_1__ } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("./foo", {"importedNames":["foo"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("./bar");
    ;

    const __vite_ssr_export_default__ = (0,__vite_ssr_import_0__.foo)();

    console.log(bar)
      "
  `)
})

/**
 * 场景：模块只有两个连续的副作用 import。
 * 验证目标：两条 SSR import 协议按 x、y 原始顺序生成且均不丢失。
 */
test('repro', async () => {
  expect(
    await ssrTransformSimpleCode(`\
import 'x'
import 'y'
  `),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("x");
    const __vite_ssr_import_1__ = await __vite_ssr_import__("y");


      "
  `)
})

/**
 * 场景：导入函数调用紧跟表达式、控制流、声明、块与 switch 等多种无分号前驱。
 * 验证目标：转换在需要处注入语句分隔符，避免 `(0, importedFn)` 被前一表达式吞并。
 * 对应源码：imported binding call 的 `(0, ...)` 包装与 MagicString 插入边界。
 */
test('inject semicolon for (0, ...) wrapper', async () => {
  expect(
    await ssrTransformSimpleCode(`
import { f } from './f'

let x = 0;

x
f()

if (1)
  x
f()

if (1)
  x
else
  x
f()


let y = x
f()

x /*;;*/ /*;;*/
f()

function z() {
  x
  f()

  if (1) {
    x
    f()
  }
}

let a = {}
f()

let b = () => {}
f()

function c() {
}
f()

class D {
}
f()

{
  x
}
f()

switch (1) {
  case 1:
    x
    f()
    break
}

if(0){}f()

if(0){}else{}f()

switch(1){}f()

{}f(1)
`),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./f", {"importedNames":["f"]});



    let x = 0;

    x;
    (0,__vite_ssr_import_0__.f)();

    if (1)
      x;
    (0,__vite_ssr_import_0__.f)();

    if (1)
      x
    else
      x;
    (0,__vite_ssr_import_0__.f)();


    let y = x;
    (0,__vite_ssr_import_0__.f)();

    x; /*;;*/ /*;;*/
    (0,__vite_ssr_import_0__.f)();

    function z() {
      x;
      (0,__vite_ssr_import_0__.f)();

      if (1) {
        x;
        (0,__vite_ssr_import_0__.f)()
      }
    }

    let a = {};
    (0,__vite_ssr_import_0__.f)();

    let b = () => {};
    (0,__vite_ssr_import_0__.f)();

    function c() {
    }
    (0,__vite_ssr_import_0__.f)();

    class D {
    }
    (0,__vite_ssr_import_0__.f)();

    {
      x
    }
    (0,__vite_ssr_import_0__.f)();

    switch (1) {
      case 1:
        x;
        (0,__vite_ssr_import_0__.f)();
        break
    };

    if(0){};(0,__vite_ssr_import_0__.f)();

    if(0){}else{};(0,__vite_ssr_import_0__.f)();

    switch(1){};(0,__vite_ssr_import_0__.f)();

    {}(0,__vite_ssr_import_0__.f)(1)
    "
  `)
})

/**
 * 场景：switch 外使用导入别名 o，某个 case 内又声明局部 let o。
 * 验证目标：case 内读取局部 o；switch 判别、marker 与 return 仍改写为导入成员。
 */
test('a switch-case local shadows an import only within the case block', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { createObjectProperty as o } from './ast'
export function buildProps(node) {
  const marker = () => o('ref_for')
  switch (o(node.type)) {
    case 1:
      let o = node.value
      console.log(o)
      break
  }
  return o(marker)
}`,
    ),
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("buildProps", () => { try { return buildProps } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("./ast", {"importedNames":["createObjectProperty"]});

    function buildProps(node) {
      const marker = () => (0,__vite_ssr_import_0__.createObjectProperty)('ref_for');
      switch ((0,__vite_ssr_import_0__.createObjectProperty)(node.type)) {
        case 1:
          let o = node.value;
          console.log(o);
          break
      };
      return (0,__vite_ssr_import_0__.createObjectProperty)(marker)
    }"
  `)
})

/**
 * 场景：case 内声明与导入同名的函数 f 和类 C，switch 后再次调用外部 f/C。
 * 验证目标：case 内保持局部声明，case 外恢复使用导入成员。
 */
test('a switch-case function or class declaration is scoped to the case block', async () => {
  expect(
    await ssrTransformSimpleCode(
      `import { f, C } from './m'
function run(v) {
  switch (v) {
    case 1:
      function f() {}
      class C {}
      console.log(f, C)
      break
  }
  return [f(), new C()]
}`,
    ),
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("./m", {"importedNames":["f","C"]});

    function run(v) {
      switch (v) {
        case 1:
          function f() {}
          class C {}
          console.log(f, C);
          break
      };
      return [(0,__vite_ssr_import_0__.f)(), new __vite_ssr_import_0__.C()]
    }"
  `)
})

/**
 * 场景：压缩代码在 `if(true){return}` 后无分号地调用默认导入。
 * 验证目标：转换注入分隔符并生成合法无接收者调用，不把调用并入 return 块。
 */
test('does not break minified code', async () => {
  // 场景取自 Headless UI Vue 的压缩产物：
  // https://unpkg.com/@headlessui/vue@1.7.23/dist/components/transitions/transition.js
  expect(
    await ssrTransformSimpleCode(
      `import O from 'a';
const c = () => {
  if(true){return}O(1,{})
}`,
    ),
  ).toMatchInlineSnapshot(
    `
    "const __vite_ssr_import_0__ = await __vite_ssr_import__("a", {"importedNames":["default"]});

    const c = () => {
      if(true){return};(0,__vite_ssr_import_0__.default)(1,{})
    }"
  `,
  )
})

/**
 * 场景：插件虚拟模块分别返回空 mappings 对象与 null Source Map，再进入 SSR transform/load。
 * 验证目标：空 mappings 原样保留；null map 生成 SSR 映射；两种结果均可执行并导出 test。
 */
test('combine mappings', async () => {
  const server = await createServer({
    configFile: false,
    envDir: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'test-mappings',
        /** 把不同 map 哨兵场景的公开 ID 解析成虚拟模块。 */
        resolveId(source) {
          if (source.startsWith('virtual:test-mappings')) {
            return '\0' + source
          }
        },
        /** 分别返回空 mappings 和 null map，验证 SSR 转换组合边界。 */
        load(id) {
          if (id.startsWith('\0virtual:test-mappings')) {
            const code = `export default "test";\n`
            if (id === '\0virtual:test-mappings:empty') {
              return { code, map: { mappings: '' } }
            }
            if (id === '\0virtual:test-mappings:null') {
              return { code, map: null }
            }
          }
        },
      },
    ],
  })

  {
    const result = await server.environments.ssr.transformRequest(
      'virtual:test-mappings:empty',
    )
    expect(result?.map).toMatchInlineSnapshot(`
      {
        "mappings": "",
      }
    `)
    const mod = await server.ssrLoadModule('virtual:test-mappings:empty')
    expect(mod).toMatchInlineSnapshot(`
      {
        "default": "test",
      }
    `)
  }

  {
    const result = await server.environments.ssr.transformRequest(
      'virtual:test-mappings:null',
    )
    expect(result?.map).toMatchInlineSnapshot(`
      SourceMap {
        "file": undefined,
        "mappings": ";AAAA,mCAAc,CAAC,CAAC,IAAI,CAAC;",
        "names": [],
        "sources": [
          "virtual:test-mappings:null",
        ],
        "sourcesContent": [
          "export default "test";
      ",
        ],
        "version": 3,
      }
    `)
    const mod = await server.ssrLoadModule('virtual:test-mappings:null')
    expect(mod).toMatchInlineSnapshot(`
      {
        "default": "test",
      }
    `)
  }
})

/**
 * 场景：源码混合默认 import、具名 re-export、export-all、namespace re-export 与动态 import。
 * 验证目标：生成协议代码覆盖全部语句；deps 只含四个静态依赖，dynamicDeps 只含 e。
 */
test('deps', async () => {
  const result = await ssrTransformSimple(`\
import a from "a";
export { b } from "b";
export * from "c";
export * as d from "d";
import("e")
export * as A from "a";
`)
  expect(result?.code).toMatchInlineSnapshot(`
    "__vite_ssr_exportName__("b", () => { try { return __vite_ssr_import_1__.b } catch {} });
    __vite_ssr_exportName__("d", () => { try { return __vite_ssr_import_3__ } catch {} });
    __vite_ssr_exportName__("A", () => { try { return __vite_ssr_import_4__ } catch {} });
    const __vite_ssr_import_0__ = await __vite_ssr_import__("a", {"importedNames":["default"]});
    const __vite_ssr_import_1__ = await __vite_ssr_import__("b", {"importedNames":["b"]});
    const __vite_ssr_import_2__ = await __vite_ssr_import__("c");
    __vite_ssr_exportAll__(__vite_ssr_import_2__);
    const __vite_ssr_import_3__ = await __vite_ssr_import__("d");
    const __vite_ssr_import_4__ = await __vite_ssr_import__("a");




    __vite_ssr_dynamic_import__("e");

    "
  `)
  expect({
    deps: result?.deps,
    dynamicDeps: result?.dynamicDeps,
  }).toMatchInlineSnapshot(`
    {
      "deps": [
        "a",
        "b",
        "c",
        "d",
      ],
      "dynamicDeps": [
        "e",
      ],
    }
  `)
})
