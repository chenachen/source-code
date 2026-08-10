import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { InternalModuleFormat } from 'rolldown'
import MagicString from 'magic-string'
import { resolveConfig } from '../../config'
import type { InlineConfig } from '../../config'
import {
  convertTargets,
  createCSSResolvers,
  cssPlugin,
  cssUrlRE,
  getEmptyChunkReplacer,
  hoistAtRules,
  injectInlinedCSS,
  preprocessCSS,
  resolveLibCssFilename,
} from '../../plugins/css'
import { PartialEnvironment } from '../../baseEnvironment'
import { normalizePath } from '../../utils'

/** 定位 CSS、Sass 与 URL 解析夹具的当前 spec 目录。 */
const dirname = import.meta.dirname

/**
 * 场景：URL 重写只应识别真正的 CSS url() 函数。
 * 机制：cssUrlRE 允许空格、嵌套函数位置和转义括号，同时排除标识符后缀（如 svg-url）。
 * 目标：后续异步替换拿到完整原始参数，不误改 Sass 函数声明。
 */
describe('search css url function', () => {
  /** 场景：声明冒号后有空格再出现 url()；验证目标：cssUrlRE 能识别该资源函数。 */
  test('some spaces before it', () => {
    expect(
      cssUrlRE.test("list-style-image: url('../images/bullet.jpg');"),
    ).toBe(true)
  })

  /** 场景：冒号后紧接 url()；验证目标：cssUrlRE 不依赖空格仍能匹配。 */
  test('no space after colon', () => {
    expect(cssUrlRE.test("list-style-image:url('../images/bullet.jpg');")).toBe(
      true,
    )
  })

  /** 场景：url() 位于行首；验证目标：边界断言允许它被识别。 */
  test('at the beginning of line', () => {
    expect(cssUrlRE.test("url('../images/bullet.jpg');")).toBe(true)
  })

  /** 场景：文本是 Sass 函数名 svg-url；验证目标：cssUrlRE 不把名称后缀误判为 CSS url()。 */
  test('as suffix of a function name', () => {
    expect(
      cssUrlRE.test(`@function svg-url($string) {
      @return "";
    }`),
    ).toBe(false)
  })

  /** 场景：url() 紧跟在外层函数左括号后；验证目标：嵌套位置仍可匹配。 */
  test('after parenthesis', () => {
    expect(
      cssUrlRE.test(
        'mask-image: image(url(mask.png), skyblue, linear-gradient(rgba(0, 0, 0, 1.0), transparent));',
      ),
    ).toBe(true)
  })

  /** 场景：url() 紧跟在参数逗号后；验证目标：嵌套函数的后续参数仍可匹配。 */
  test('after comma', () => {
    expect(
      cssUrlRE.test(
        'mask-image: image(skyblue,url(mask.png), linear-gradient(rgba(0, 0, 0, 1.0), transparent));',
      ),
    ).toBe(true)
  })

  /** 场景：URL 文件名含转义右括号；验证目标：捕获组返回完整 public/awkward-name\)2.png，而非提前截断。 */
  test('should capture the full url with escaped parentheses', () => {
    const css = 'background-image: url(public/awkward-name\\)2.png);'
    const match = cssUrlRE.exec(css)
    expect(match?.[1].trim()).toBe('public/awkward-name\\)2.png')
  })
})

/** CSS Modules 的 composes 解析、scoped name 在普通/direct 两种请求身份间必须一致。 */
describe('css modules', () => {
  /** 场景：CSS Modules 通过 alias composes 另一个模块；验证目标：转换结果同时包含被组合类与当前 scoped 类。 */
  test('css module compose/from path resolutions', async () => {
    const { transform } = await createCssPluginTransform({
      configFile: false,
      resolve: {
        alias: [
          {
            find: '@',
            replacement: path.join(
              import.meta.dirname,
              './fixtures/css-module-compose',
            ),
          },
        ],
      },
    })

    const result = await transform(
      `\
.foo {
position: fixed;
composes: bar from '@/css/bar.module.css';
}`,
      '/css/foo.module.css',
    )

    expect(result.code).toMatchInlineSnapshot(
      `
      "._bar_1b4ow_1 {
        display: block;
        background: #f0f;
      }
      ._foo_86148_1 {
      position: fixed;
      }"
    `,
    )
  })

  /** 场景：PostCSS Modules 配置自定义 scoped name；验证目标：普通模块请求与 direct 请求生成完全相同 CSS。 */
  test('custom generateScopedName', async () => {
    const { transform } = await createCssPluginTransform({
      configFile: false,
      css: {
        modules: {
          generateScopedName: 'custom__[hash:base64:5]',
        },
      },
    })
    const css = `\
.foo {
  color: red;
}`
    const result1 = await transform(css, '/foo.module.css') // JS 模块请求。
    const result2 = await transform(css, '/foo.module.css?direct') // 浏览器 direct CSS 请求。
    expect(result1.code).toBe(result2.code)
  })

  /** 场景：Lightning CSS Modules 使用同一自定义 scoped name；验证目标：普通与 direct 请求的类名结果一致。 */
  test('custom generateScopedName with lightningcss', async () => {
    const { transform } = await createCssPluginTransform({
      configFile: false,
      css: {
        modules: {
          generateScopedName: 'custom__[hash:base64:5]',
        },
        transformer: 'lightningcss',
      },
    })
    const css = `\
.foo {
  color: red;
}`
    const result1 = await transform(css, '/foo.module.css') // JS 模块请求。
    const result2 = await transform(css, '/foo.module.css?direct') // 浏览器 direct CSS 请求。
    expect(result1.code).toBe(result2.code)
  })
})

/** 聚合 CSS 后提升 @import/@charset，并验证引号内分号和注释不会破坏词法边界。 */
describe('hoist @ rules', () => {
  /** 场景：普通规则后出现 @import；验证目标：hoistAtRules 把 import 移到样式最前。 */
  test('hoist @import', async () => {
    const css = `.foo{color:red;}@import "bla";`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@import "bla";.foo{color:red;}`)
  })

  /** 场景：@import url() 的引号内容含分号；验证目标：整条规则不被截断并提升到顶部。 */
  test('hoist @import url with semicolon', async () => {
    const css = `.foo{color:red;}@import url("bla;bla");`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@import url("bla;bla");.foo{color:red;}`)
  })

  /** 场景：@import 的 data URL 含媒体类型分号；验证目标：解析器保留完整 data URL 后提升规则。 */
  test('hoist @import url data with semicolon', async () => {
    const css = `.foo{color:red;}@import url(data:image/png;base64,iRxVB0);`
    const result = await hoistAtRules(css)
    expect(result).toBe(
      `@import url(data:image/png;base64,iRxVB0);.foo{color:red;}`,
    )
  })

  /** 场景：@import 字符串路径内部含分号；验证目标：分号按引号内容处理，不结束规则。 */
  test('hoist @import with semicolon in quotes', async () => {
    const css = `.foo{color:red;}@import "bla;bar";`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@import "bla;bar";.foo{color:red;}`)
  })

  /** 场景：普通规则后出现 @charset；验证目标：charset 被提升到文件首部。 */
  test('hoist @charset', async () => {
    const css = `.foo{color:red;}@charset "utf-8";`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@charset "utf-8";.foo{color:red;}`)
  })

  /** 场景：输入含重复 @charset；验证目标：输出顶部只保留第一条。 */
  test('hoist one @charset only', async () => {
    const css = `.foo{color:red;}@charset "utf-8";@charset "utf-8";`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@charset "utf-8";.foo{color:red;}`)
  })

  /** 场景：import、charset 与普通规则交错；验证目标：charset 最先、imports 保持次序，普通规则留在后方。 */
  test('hoist @import and @charset', async () => {
    const css = `.foo{color:red;}@import "bla";@charset "utf-8";.bar{color:green;}@import "baz";`
    const result = await hoistAtRules(css)
    expect(result).toBe(
      `@charset "utf-8";@import "bla";@import "baz";.foo{color:red;}.bar{color:green;}`,
    )
  })

  /** 场景：注释内和注释外各有 @import；验证目标：只提升真实规则，注释文本原样保留。 */
  test('dont hoist @import in comments', async () => {
    const css = `.foo{color:red;}/* @import "bla"; */@import "bar";`
    const result = await hoistAtRules(css)
    expect(result).toBe(`@import "bar";.foo{color:red;}/* @import "bla"; */`)
  })

  /** 场景：注释内和注释外各有 @charset；验证目标：只提升真实 charset，不解析注释内容。 */
  test('dont hoist @charset in comments', async () => {
    const css = `.foo{color:red;}/* @charset "utf-8"; */@charset "utf-8";`
    const result = await hoistAtRules(css)
    expect(result).toBe(
      `@charset "utf-8";.foo{color:red;}/* @charset "utf-8"; */`,
    )
  })

  /** 场景：多行注释包含伪 import/charset 且外部有真实规则；验证目标：只提升外部规则并保持注释块。 */
  test('dont hoist @import and @charset in comments', async () => {
    const css = `
.foo{color:red;}
/*
  @import "bla";
*/
@charset "utf-8";
/*
  @charset "utf-8";
  @import "bar";
*/
@import "baz";`
    const result = await hoistAtRules(css)
    expect(result).toMatchInlineSnapshot(`
      "@charset "utf-8";@import "baz";
      .foo{color:red;}
      /*
        @import "bla";
      */

      /*
        @charset "utf-8";
        @import "bar";
      */
      "
    `)
  })
})

/** 解析最小 client 环境并启动 cssPlugin，返回可独立调用的 transform 测试适配器。 */
async function createCssPluginTransform(inlineConfig: InlineConfig = {}) {
  const config = await resolveConfig(inlineConfig, 'serve')
  const environment = new PartialEnvironment('client', config)

  const { transform, buildStart } = cssPlugin(config)

  // @ts-expect-error buildStart is function
  await buildStart.call({})

  return {
    /** 用真实 CSS 插件上下文转换给定源码与模块 ID。 */
    async transform(code: string, id: string) {
      // @ts-expect-error transform.handler is function
      return await transform.handler.call(
        {
          /** 提供 transform 所需的空 watchFile 能力，使单元测试无需真实 watcher。 */
          addWatchFile() {
            return
          },
          environment,
        },
        code,
        id,
      )
    },
  }
}

/** esbuild 的 ES 年份/browser targets 应稳定转换为 Lightning CSS 版本位编码。 */
describe('convertTargets', () => {
  /** 场景：ES 年份与浏览器 target 输入；验证目标：convertTargets 只输出 Lightning CSS 支持的浏览器版本位编码。 */
  test('basic cases', () => {
    expect(convertTargets('es2018')).toStrictEqual({
      chrome: 4128768,
      edge: 5177344,
      firefox: 3801088,
      safari: 786432,
      ios_saf: 786432,
      opera: 3276800,
    })
    expect(convertTargets(['safari13.1', 'ios13', 'node14'])).toStrictEqual({
      ios_saf: 851968,
      safari: 852224,
    })
  })

  /** 场景：target 使用 es6 别名；验证目标：转换结果与 es2015 完全一致。 */
  test('supports es6 as an alias of es2015', () => {
    expect(convertTargets('es6')).toStrictEqual(convertTargets('es2015'))
  })
})

/**
 * 纯 CSS chunk 的空 JS import 必须从 ESM/CJS 输出删除；替换保持等长，并处理 minifier 逗号运算符链，
 * 防止删除 require 后改变相邻表达式语法。
 */
describe('getEmptyChunkReplacer', () => {
  /** 场景：ES chunk 含一个纯 CSS import；验证目标：该 import 替换为等长注释，前后 import 与行列位置不变。 */
  test('replaces import call', () => {
    const code = `\
import "some-module";
import "pure_css_chunk.js";
import "other-module";`

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'es')
    const replaced = replacer(code)
    expect(replaced.length).toBe(code.length)
    expect(replaced).toMatchInlineSnapshot(`
      "import "some-module";
      /* empty css             */
      import "other-module";"
    `)
  })

  /** 场景：三个 ES import 位于同一行；验证目标：只替换纯 CSS import 且输出长度保持一致。 */
  test('replaces import call without new lines', () => {
    const code = `import "some-module";import "pure_css_chunk.js";import "other-module";`

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'es')
    const replaced = replacer(code)
    expect(replaced.length).toBe(code.length)
    expect(replaced).toMatchInlineSnapshot(
      `"import "some-module";/* empty css             */import "other-module";"`,
    )
  })

  /** 场景：CJS chunk 单独一行 require 纯 CSS；验证目标：调用替换为等长空语句注释，其他 require 保留。 */
  test('replaces require call', () => {
    const code = `\
require("some-module");
require("pure_css_chunk.js");
require("other-module");`

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'cjs')
    const replaced = replacer(code)
    expect(replaced.length).toBe(code.length)
    expect(replaced).toMatchInlineSnapshot(`
      "require("some-module");
      ;/* empty css              */
      require("other-module");"
    `)
  })

  /** 场景：多个 CJS require 压缩在一行；验证目标：纯 CSS require 被等长替换且语句边界有效。 */
  test('replaces require call in minified code without new lines', () => {
    const code = `require("some-module");require("pure_css_chunk.js");require("other-module");`

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'cjs')
    const replaced = replacer(code)
    expect(replaced.length).toBe(code.length)
    expect(replaced).toMatchInlineSnapshot(
      `"require("some-module");;/* empty css              */require("other-module");"`,
    )
  })

  /** 场景：纯 CSS require 位于逗号运算符中间；验证目标：删除目标但保留两侧表达式与总长度。 */
  test('replaces require call in minified code that uses comma operator', () => {
    const code =
      'require("some-module"),require("pure_css_chunk.js"),require("other-module");'

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'cjs')
    const newCode = replacer(code)
    expect(newCode.length).toBe(code.length)
    expect(newCode).toMatchInlineSnapshot(
      `"require("some-module"),/* empty css               */require("other-module");"`,
    )
    // 替换后不能再残留纯 CSS chunk 文件名。
    expect(newCode).not.toContain('pure_css_chunk.js')
  })

  /** 场景：逗号链以纯 CSS require 开头；验证目标：替换后 console.log 成为合法首表达式且不残留文件名。 */
  test('replaces require call in minified code that uses comma operator 2', () => {
    const code = 'require("pure_css_chunk.js"),console.log();'
    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'cjs')
    const newCode = replacer(code)
    expect(newCode.length).toBe(code.length)
    expect(newCode).toMatchInlineSnapshot(
      `"/* empty css               */console.log();"`,
    )
    expect(newCode).not.toContain('pure_css_chunk.js')
  })

  /** 场景：逗号链后的下一语句是 const 赋值；验证目标：替换补回分号边界，避免两条语句粘连。 */
  test('replaces require call in minified code that uses comma operator followed by assignment', () => {
    const code =
      'require("some-module"),require("pure_css_chunk.js");const v=require("other-module");'

    const replacer = getEmptyChunkReplacer(['pure_css_chunk.js'], 'cjs')
    const newCode = replacer(code)
    expect(newCode.length).toBe(code.length)
    expect(newCode).toMatchInlineSnapshot(
      `"require("some-module");/* empty css               */const v=require("other-module");"`,
    )
    expect(newCode).not.toContain('pure_css_chunk.js')
  })
})

/** 对外 preprocessCSS API 应复用 PostCSS/Lightning CSS 主链，并保留 external URL 中 `$` 字面量。 */
describe('preprocessCSS', () => {
  /** 场景：默认 PostCSS 管线处理含本地 url() 的 CSS；验证目标：返回格式化代码并保留可继续解析的相对 URL。 */
  test('works', async () => {
    const resolvedConfig = await resolveConfig({ configFile: false }, 'serve')
    const result = await preprocessCSS(
      `\
.foo {
  color:red;
  background: url(./foo.png);
}`,
      'foo.css',
      resolvedConfig,
    )
    expect(result.code).toMatchInlineSnapshot(`
      ".foo {
        color:red;
        background: url(./foo.png);
      }"
    `)
  })

  /** 场景：preprocessCSS 选择 Lightning CSS；验证目标：返回规范 CSS，并为相对 URL 补引号而不改变路径。 */
  test('works with lightningcss', async () => {
    const resolvedConfig = await resolveConfig(
      {
        configFile: false,
        css: { transformer: 'lightningcss' },
      },
      'serve',
    )
    const result = await preprocessCSS(
      `\
.foo {
  color: red;
  background: url(./foo.png);
}`,
      'foo.css',
      resolvedConfig,
    )
    expect(result.code).toMatchInlineSnapshot(`
      ".foo {
        color: red;
        background: url("./foo.png");
      }
      "
    `)
  })

  /** 场景：Lightning CSS 处理外部 @import 且 query 含美元符号；验证目标：输出完整保留 x=$&y，字符串替换不解释 `$&`。 */
  test('lightningcss preserves $ in external @import url', async () => {
    const resolvedConfig = await resolveConfig(
      {
        configFile: false,
        css: { transformer: 'lightningcss' },
      },
      'serve',
    )
    const result = await preprocessCSS(
      `@import 'http://example.com/a.css?x=$&y';`,
      'foo.css',
      resolvedConfig,
    )
    expect(result.code).toContain('http://example.com/a.css?x=$&y')
  })
})

// Sass package importer 不读取 main 字段；见
// https://sass-lang.com/documentation/js-api/classes/nodepackageimporter/
describe('sass package resolution', () => {
  const fixtureRoot = path.resolve(dirname, 'fixtures/sass-package-resolution')
  const importer = path.resolve(fixtureRoot, 'entry.scss')

  /** 创建绑定 fixture importer 的 Sass resolver，专门检查包入口选择规则。 */
  async function getSassResolver() {
    const config = await resolveConfig(
      { configFile: false, root: fixtureRoot },
      'serve',
    )
    const environment = new PartialEnvironment('client', config)
    const resolvers = createCSSResolvers(config)
    return (id: string) => resolvers.sass(environment, id, importer)
  }

  /** 场景：Sass 包的 main 指向非入口且包根有 index.scss；验证目标：Sass resolver 忽略 main 并解析根 index.scss。 */
  test('resolves to index.scss at package root, ignoring main field', async () => {
    const resolve = await getSassResolver()
    const resolved = await resolve('sass-pkg-with-index')
    expect(resolved).toBe(
      normalizePath(
        path.resolve(
          fixtureRoot,
          'node_modules/sass-pkg-with-index/index.scss',
        ),
      ),
    )
  })
})

/** library CSS 命名优先级：cssFileName、fileName、package name。 */
describe('resolveLibCssFilename', () => {
  /** 场景：未配置库 CSS 名称且 package.json name 为 mylib；验证目标：输出名为 mylib.css。 */
  test('use name from package.json', () => {
    const filename = resolveLibCssFilename(
      {
        entry: 'mylib.js',
      },
      path.resolve(dirname, '../packages/name'),
    )
    expect(filename).toBe('mylib.css')
  })

  /** 场景：显式 cssFileName=style；验证目标：库样式输出名为 style.css。 */
  test('set cssFileName', () => {
    const filename = resolveLibCssFilename(
      {
        entry: 'mylib.js',
        cssFileName: 'style',
      },
      path.resolve(dirname, '../packages/noname'),
    )
    expect(filename).toBe('style.css')
  })

  /** 场景：未设 cssFileName 但 fileName=custom-name；验证目标：CSS 名称回退为 custom-name.css。 */
  test('use fileName if set', () => {
    const filename = resolveLibCssFilename(
      {
        entry: 'mylib.js',
        fileName: 'custom-name',
      },
      path.resolve(dirname, '../packages/name'),
    )
    expect(filename).toBe('custom-name.css')
  })

  /** 场景：数组式库入口搭配固定 fileName；验证目标：CSS 仍使用唯一 custom-name.css。 */
  test('use fileName if set and has array entry', () => {
    const filename = resolveLibCssFilename(
      {
        entry: ['mylib.js', 'mylib2.js'],
        fileName: 'custom-name',
      },
      path.resolve(dirname, '../packages/name'),
    )
    expect(filename).toBe('custom-name.css')
  })
})

/**
 * legacy CSS 注入必须位于 IIFE/UMD wrapper 内部、ES shebang 之后；多次注入保持顺序，不能破坏导出或
 * sourcemap 区域标记。
 */
describe('injectInlinedCSS', () => {
  /** 构建指定 CSS 模块并返回入口 chunk 中生成的样式注入代码。 */
  function getInlinedCSSInjectedCode(
    code: string,
    format: InternalModuleFormat,
  ) {
    const s = new MagicString(code)
    injectInlinedCSS(
      s,
      {
        /** 把构建错误重新抛出，确保辅助函数不会把 CSS 编译失败静默降级。 */
        error(e) {
          throw e
        },
      },
      code,
      format,
      'injectCSS();',
    )
    return s.toString()
  }

  /** 场景：ESM 来源生成无导出的 IIFE 且含 strict 指令；验证目标：CSS helper 插入 wrapper 内并紧跟 strict。 */
  test('should inject CSS for iife without exports from esm', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function() {

"use strict";

//#region src/index.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();

//#endregion
})();`,
      'iife',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function() {

      "use strict";injectCSS();

      //#region src/index.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();

      //#endregion
      })();"
    `)
  })

  /** 场景：CJS 来源生成无导出的 IIFE 且无 strict 指令；验证目标：helper 插入函数体起点。 */
  test('should inject helper for iife without exports from cjs', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function() {


//#region src/index.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();

//#endregion
})();`,
      'iife',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function() {injectCSS();


      //#region src/index.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();

      //#endregion
      })();"
    `)
  })

  /** 场景：IIFE factory 接收 exports 并写出命名导出；验证目标：helper 位于 factory 内且不破坏导出赋值。 */
  test('should inject helper for iife with exports', async () => {
    const result = getInlinedCSSInjectedCode(
      `var lib = (function(exports) {


//#region entry.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();
const foo = "foo";

//#endregion
exports.foo = foo;
return exports;
})({});`,
      'iife',
    )
    expect(result).toMatchInlineSnapshot(`
      "var lib = (function(exports) {injectCSS();


      //#region entry.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();
      const foo = "foo";

      //#endregion
      exports.foo = foo;
      return exports;
      })({});"
    `)
  })

  /** 场景：IIFE 写入嵌套全局名称；验证目标：helper 插入内层 factory，而不落到全局对象初始化之前。 */
  test('should inject helper for iife with nested name', async () => {
    const result = getInlinedCSSInjectedCode(
      `this.nested = this.nested || {};
this.nested.lib = (function(exports) {

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

//#region a.ts
	const foo = "foo";

//#endregion
exports.foo = foo;
return exports;
})({});`,
      'iife',
    )
    expect(result).toMatchInlineSnapshot(`
      "this.nested = this.nested || {};
      this.nested.lib = (function(exports) {injectCSS();

      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      //#region a.ts
      	const foo = "foo";

      //#endregion
      exports.foo = foo;
      return exports;
      })({});"
    `)
  })

  /** 场景：无导出 UMD 包装器调用 factory；验证目标：helper 插入 factory 函数体而非外层环境分支。 */
  test('should inject helper for umd without exports', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function(factory) {

  typeof define === 'function' && define.amd ? define([], factory) :
  factory();
})(function() {

//#region entry.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();

//#endregion
});`,
      'umd',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function(factory) {

        typeof define === 'function' && define.amd ? define([], factory) :
        factory();
      })(function() {injectCSS();

      //#region entry.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();

      //#endregion
      });"
    `)
  })

  /** 场景：UMD factory 接收 exports；验证目标：helper 位于 factory 起始且后续命名导出保持完整。 */
  test('should inject helper for umd with exports', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ?  factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory((global.lib = {})));
})(this, function(exports) {

//#region entry.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();
const foo = "foo";

//#endregion
exports.foo = foo;
});`,
      'umd',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function(global, factory) {
        typeof exports === 'object' && typeof module !== 'undefined' ?  factory(exports) :
        typeof define === 'function' && define.amd ? define(['exports'], factory) :
        (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory((global.lib = {})));
      })(this, function(exports) {injectCSS();

      //#region entry.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();
      const foo = "foo";

      //#endregion
      exports.foo = foo;
      });"
    `)
  })

  /** 场景：UMD 仅返回默认导出；验证目标：helper 插入 factory 内且 return 默认值不变。 */
  test('should inject helper for umd with only default export', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports =  factory() :
  typeof define === 'function' && define.amd ? define([], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, (global.lib = factory()));
})(this, function() {

//#region entry.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo");
})();
var index_default = "foo";

//#endregion
return index_default;
});`,
      'umd',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function(global, factory) {
        typeof exports === 'object' && typeof module !== 'undefined' ? module.exports =  factory() :
        typeof define === 'function' && define.amd ? define([], factory) :
        (global = typeof globalThis !== 'undefined' ? globalThis : global || self, (global.lib = factory()));
      })(this, function() {injectCSS();

      //#region entry.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo");
      })();
      var index_default = "foo";

      //#endregion
      return index_default;
      });"
    `)
  })

  /** 场景：UMD 把导出写入嵌套全局对象；验证目标：helper 插入 factory 内并保留嵌套赋值协议。 */
  test('should inject helper for umd with nested name', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ?  factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory((global.nested = global.nested || {},global.nested.lib = {})));
})(this, function(exports) {
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

//#region a.ts
	const foo = "foo";

//#endregion
exports.foo = foo;
});`,
      'umd',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function(global, factory) {
        typeof exports === 'object' && typeof module !== 'undefined' ?  factory(exports) :
        typeof define === 'function' && define.amd ? define(['exports'], factory) :
        (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory((global.nested = global.nested || {},global.nested.lib = {})));
      })(this, function(exports) {injectCSS();
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      //#region a.ts
      	const foo = "foo";

      //#endregion
      exports.foo = foo;
      });"
    `)
  })

  /** 场景：IIFE 源码包含多个 Rolldown helper 相关结构；验证目标：CSS helper 只插一次且位置仍在 strict 后。 */
  test('should inject multiple helpers', async () => {
    const result = getInlinedCSSInjectedCode(
      `(function() {

"use strict";

//#region src/index.js
(async () => {
	await new Promise((resolve) => setTimeout(resolve, 1e3));
	console.log("foo", { ..."foo" });
})();

//#endregion
})();`,
      'iife',
    )
    expect(result).toMatchInlineSnapshot(`
      "(function() {

      "use strict";injectCSS();

      //#region src/index.js
      (async () => {
      	await new Promise((resolve) => setTimeout(resolve, 1e3));
      	console.log("foo", { ..."foo" });
      })();

      //#endregion
      })();"
    `)
  })

  /** 场景：ES chunk 以正常换行 shebang 开头；验证目标：CSS helper 插在 shebang 下一行。 */
  test('should inject CSS after the shebang line for es', async () => {
    const result = getInlinedCSSInjectedCode(
      `#!/usr/bin/env node
console.log("foo");`,
      'es',
    )
    expect(result).toMatchInlineSnapshot(`
      "#!/usr/bin/env node
      injectCSS();console.log("foo");"
    `)
  })

  /** 场景：ES chunk 没有 shebang；验证目标：CSS helper 直接前置到首条语句。 */
  test('should inject CSS at the start for es without shebang', async () => {
    const result = getInlinedCSSInjectedCode(`console.log("foo");`, 'es')
    expect(result).toMatchInlineSnapshot(`"injectCSS();console.log("foo");"`)
  })

  /** 场景：ES chunk 只有无尾换行 shebang；验证目标：注入器先补换行，再把 helper 放到可执行的下一行。 */
  test('should inject CSS for es shebang without trailing newline', async () => {
    const result = getInlinedCSSInjectedCode(`#!/usr/bin/env node`, 'es')
    expect(result).toMatchInlineSnapshot(`
      "#!/usr/bin/env node
      injectCSS();"
    `)
  })
})
