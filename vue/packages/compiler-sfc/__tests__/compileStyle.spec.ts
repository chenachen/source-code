/**
 * SFC 样式编译场景：覆盖 scoped 选择器重写、deep/slotted/global、keyframes、CSS Modules、
 * Sass/Less/Stylus 预处理、source map、依赖收集和 PostCSS 错误传播。
 */
import {
  type SFCStyleCompileOptions,
  compileStyle,
  compileStyleAsync,
} from '../src/compileStyle'
import path from 'node:path'

/** 使用固定文件名和 scopeId 编译 scoped CSS，并在测试失败前主动输出预处理错误。 */
export function compileScoped(
  source: string,
  options?: Partial<SFCStyleCompileOptions>,
): string {
  const res = compileStyle({
    source,
    filename: 'test.css',
    id: 'data-v-test',
    scoped: true,
    ...options,
  })
  if (res.errors.length) {
    res.errors.forEach(err => {
      console.error(err)
    })
    expect(res.errors.length).toBe(0)
  }
  return res.code
}

// scoped 主分组：验证选择器注入点，以及 deep/slotted/global/keyframes 的语义重写。
describe('SFC scoped CSS', () => {
  test('simple selectors', () => {
    expect(compileScoped(`h1 { color: red; }`)).toMatch(
      `h1[data-v-test] { color: red;`,
    )
    expect(compileScoped(`.foo { color: red; }`)).toMatch(
      `.foo[data-v-test] { color: red;`,
    )
  })

  test('descendent selector', () => {
    expect(compileScoped(`h1 .foo { color: red; }`)).toMatch(
      `h1 .foo[data-v-test] { color: red;`,
    )

    // #13387：原生 CSS nesting 的 `>` 子规则需分别注入 scope，不能把父规则拼成错误后代选择器。
    expect(
      compileScoped(`main {
  width: 100%;
  > * {
    max-width: 200px;
  }
}`),
    ).toMatchInlineSnapshot(`
      "main {
&[data-v-test] {
  width: 100%;
}
> *[data-v-test] {
    max-width: 200px;
}
}"`)
  })

  test('nesting selector', () => {
    expect(compileScoped(`h1 { color: red; .foo { color: red; } }`)).toMatch(
      `h1 {\n&[data-v-test] { color: red;\n}\n.foo[data-v-test] { color: red;`,
    )
  })

  test('nesting selector with atrule and comment', () => {
    expect(
      compileScoped(
        `h1 {
color: red;
/*background-color: pink;*/
@media only screen and (max-width: 800px) {
  background-color: green;
  .bar { color: white }
}
.foo { color: red; }
}`,
      ),
    ).toMatch(
      `h1 {
&[data-v-test] {
color: red
/*background-color: pink;*/
}
@media only screen and (max-width: 800px) {
&[data-v-test] {
  background-color: green
}
.bar[data-v-test] { color: white
}
}
.foo[data-v-test] { color: red;
}
}`,
    )
  })

  test('multiple selectors', () => {
    expect(compileScoped(`h1 .foo, .bar, .baz { color: red; }`)).toMatch(
      `h1 .foo[data-v-test], .bar[data-v-test], .baz[data-v-test] { color: red;`,
    )
  })

  test('pseudo class', () => {
    expect(compileScoped(`.foo:after { color: red; }`)).toMatch(
      `.foo[data-v-test]:after { color: red;`,
    )
  })

  test('pseudo element', () => {
    expect(compileScoped(`::selection { display: none; }`)).toMatch(
      '[data-v-test]::selection {',
    )
  })

  test('spaces before pseudo element', () => {
    const code = compileScoped(`.abc, ::selection { color: red; }`)
    expect(code).toMatch('.abc[data-v-test],')
    expect(code).toMatch('[data-v-test]::selection {')
  })

  test('::v-deep', () => {
    expect(compileScoped(`:deep(.foo) { color: red; }`)).toMatchInlineSnapshot(`
      "[data-v-test] .foo { color: red;
      }"
    `)
    expect(compileScoped(`::v-deep(.foo) { color: red; }`))
      .toMatchInlineSnapshot(`
      "[data-v-test] .foo { color: red;
      }"
    `)
    expect(compileScoped(`::v-deep(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      "[data-v-test] .foo .bar { color: red;
      }"
    `)
    expect(compileScoped(`.baz .qux ::v-deep(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".baz .qux[data-v-test] .foo .bar { color: red;
      }"
    `)
    expect(compileScoped(`:is(.foo :deep(.bar)) { color: red; }`))
      .toMatchInlineSnapshot(`
      ":is(.foo[data-v-test] .bar) { color: red;
      }"
    `)
    expect(compileScoped(`:where(.foo :deep(.bar)) { color: red; }`))
      .toMatchInlineSnapshot(`
      ":where(.foo[data-v-test] .bar) { color: red;
      }"
    `)
    expect(compileScoped(`:is(:deep(.foo)) .bar { color: red; }`))
      .toMatchInlineSnapshot(`
      ":is([data-v-test] .foo) .bar { color: red;
      }"
    `)
    expect(compileScoped(`:where(:deep(.foo)) .bar { color: red; }`))
      .toMatchInlineSnapshot(`
      ":where([data-v-test] .foo) .bar { color: red;
      }"
    `)
    expect(compileScoped(`:is(:deep(.foo), .bar) .baz { color: red; }`))
      .toMatchInlineSnapshot(`
      ":is([data-v-test] .foo) .baz, :is(.bar) .baz[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped(`:where(:deep(.foo), .bar) .baz { color: red; }`))
      .toMatchInlineSnapshot(`
      ":where([data-v-test] .foo) .baz, :where(.bar) .baz[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped(`:not(:deep(.foo)) .bar { color: red; }`))
      .toMatchInlineSnapshot(`
      ":not([data-v-test] .foo) .bar { color: red;
      }"
    `)
    expect(compileScoped(`:has(:deep(.foo)) .bar { color: red; }`))
      .toMatchInlineSnapshot(`
      ":has([data-v-test] .foo) .bar { color: red;
      }"
    `)
    expect(compileScoped(`:has(:deep(.foo), .bar) .baz { color: red; }`))
      .toMatchInlineSnapshot(`
      ":has([data-v-test] .foo) .baz, :has(.bar) .baz[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped(`:deep(.foo) { color: red; .bar { color: red; } }`))
      .toMatchInlineSnapshot(`
      "[data-v-test] .foo { color: red;
      .bar { color: red;
      }
      }"
    `)
  })

  test('::v-slotted', () => {
    expect(compileScoped(`:slotted(.foo) { color: red; }`))
      .toMatchInlineSnapshot(`
    ".foo[data-v-test-s] { color: red;
    }"
  `)
    expect(compileScoped(`::v-slotted(.foo) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".foo[data-v-test-s] { color: red;
      }"
    `)
    expect(compileScoped(`::v-slotted(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".foo .bar[data-v-test-s] { color: red;
      }"
    `)
    expect(compileScoped(`.baz .qux ::v-slotted(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".baz .qux .foo .bar[data-v-test-s] { color: red;
      }"
    `)
  })

  test('::v-global', () => {
    expect(compileScoped(`:global(.foo) { color: red; }`))
      .toMatchInlineSnapshot(`
    ".foo { color: red;
    }"
  `)
    expect(compileScoped(`::v-global(.foo) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".foo { color: red;
      }"
    `)
    expect(compileScoped(`::v-global(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".foo .bar { color: red;
      }"
    `)
    // :global() 会退出当前作用域选择器，因此其前面的局部选择器不会进入最终匹配。
    expect(compileScoped(`.baz .qux ::v-global(.foo .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ".foo .bar { color: red;
      }"
    `)
  })

  test(':is() and :where() with multiple selectors', () => {
    expect(compileScoped(`:is(.foo) { color: red; }`)).toMatchInlineSnapshot(`
      ":is(.foo[data-v-test]) { color: red;
      }"
    `)
    expect(compileScoped(`:where(.foo, .bar) { color: red; }`))
      .toMatchInlineSnapshot(`
      ":where(.foo[data-v-test], .bar[data-v-test]) { color: red;
      }"
    `)
    expect(compileScoped(`:is(.foo, .bar) div { color: red; }`))
      .toMatchInlineSnapshot(`
      ":is(.foo, .bar) div[data-v-test] { color: red;
      }"
    `)
  })

  // #10511：复合选择器中的 `:is()` / `:where()` 参数要在正确层级注入 scope，且兼容 :deep。
  test(':is() and :where() in compound selectors', () => {
    expect(
      compileScoped(`.div { color: red; } .div:where(:hover) { color: blue; }`),
    ).toMatchInlineSnapshot(`
      ".div[data-v-test] { color: red;
      }
      .div[data-v-test]:where(:hover) { color: blue;
      }"
    `)

    expect(
      compileScoped(`.div { color: red; } .div:is(:hover) { color: blue; }`),
    ).toMatchInlineSnapshot(`
      ".div[data-v-test] { color: red;
      }
      .div[data-v-test]:is(:hover) { color: blue;
      }"
    `)

    expect(
      compileScoped(
        `.div { color: red; } .div:where(.foo:hover) { color: blue; }`,
      ),
    ).toMatchInlineSnapshot(`
      ".div[data-v-test] { color: red;
      }
      .div[data-v-test]:where(.foo:hover) { color: blue;
      }"
    `)

    expect(
      compileScoped(
        `.div { color: red; } .div:is(.foo:hover) { color: blue; }`,
      ),
    ).toMatchInlineSnapshot(`
      ".div[data-v-test] { color: red;
      }
      .div[data-v-test]:is(.foo:hover) { color: blue;
      }"
    `)
  })

  test('media query', () => {
    expect(compileScoped(`@media print { .foo { color: red }}`))
      .toMatchInlineSnapshot(`
      "@media print {
      .foo[data-v-test] { color: red
      }}"
    `)
  })

  test('supports query', () => {
    expect(compileScoped(`@supports(display: grid) { .foo { display: grid }}`))
      .toMatchInlineSnapshot(`
      "@supports(display: grid) {
      .foo[data-v-test] { display: grid
      }}"
    `)
  })

  test('scoped keyframes', () => {
    const style = compileScoped(
      `
.anim {
  animation: color 5s infinite, other 5s;
}
.anim-2 {
  animation-name: color;
  animation-duration: 5s;
}
.anim-3 {
  animation: 5s color infinite, 5s other;
}
.anim-multiple {
  animation: color 5s infinite, opacity 2s;
}
.anim-multiple-2 {
  animation-name: color, opacity;
  animation-duration: 5s, 2s;
}

@keyframes color {
  from { color: red; }
  to { color: green; }
}
@-webkit-keyframes color {
  from { color: red; }
  to { color: green; }
}
@keyframes opacity {
  from { opacity: 0; }
  to { opacity: 1; }
}
@-webkit-keyframes opacity {
  from { opacity: 0; }
  to { opacity: 1; }
}
    `,
      { id: 'data-v-test' },
    )

    expect(style).toContain(
      `.anim[data-v-test] {\n  animation: color-test 5s infinite, other 5s;`,
    )
    expect(style).toContain(
      `.anim-2[data-v-test] {\n  animation-name: color-test`,
    )
    expect(style).toContain(
      `.anim-3[data-v-test] {\n  animation: 5s color-test infinite, 5s other;`,
    )
    expect(style).toContain(`@keyframes color-test {`)
    expect(style).toContain(`@-webkit-keyframes color-test {`)

    expect(style).toContain(
      `.anim-multiple[data-v-test] {\n  animation: color-test 5s infinite,opacity-test 2s;`,
    )
    expect(style).toContain(
      `.anim-multiple-2[data-v-test] {\n  animation-name: color-test,opacity-test;`,
    )
    expect(style).toContain(`@keyframes opacity-test {\nfrom { opacity: 0;`)
    expect(style).toContain(
      `@-webkit-keyframes opacity-test {\nfrom { opacity: 0;`,
    )
  })

  // vue-loader/#1370：逗号前后的尾随空格不能使 selector parser 生成错误 scope 注入位置。
  test('spaces after selector', () => {
    expect(compileScoped(`.foo , .bar { color: red; }`)).toMatchInlineSnapshot(`
      ".foo[data-v-test], .bar[data-v-test] { color: red;
      }"
    `)
  })

  // 废弃语法仍兼容编译并给出迁移警告，避免旧项目升级时静默改变样式。
  describe('deprecated syntax', () => {
    test('::v-deep as combinator', () => {
      expect(compileScoped(`::v-deep .foo { color: red; }`))
        .toMatchInlineSnapshot(`
        "[data-v-test] .foo { color: red;
        }"
      `)
      expect(compileScoped(`.bar ::v-deep .foo { color: red; }`))
        .toMatchInlineSnapshot(`
        ".bar[data-v-test] .foo { color: red;
        }"
      `)
      expect(
        `::v-deep usage as a combinator has been deprecated.`,
      ).toHaveBeenWarned()
    })

    test('>>> (deprecated syntax)', () => {
      const code = compileScoped(`>>> .foo { color: red; }`)
      expect(code).toMatchInlineSnapshot(`
        "[data-v-test] .foo { color: red;
        }"
      `)
      expect(
        `the >>> and /deep/ combinators have been deprecated.`,
      ).toHaveBeenWarned()
    })

    test('/deep/ (deprecated syntax)', () => {
      const code = compileScoped(`/deep/ .foo { color: red; }`)
      expect(code).toMatchInlineSnapshot(`
        "[data-v-test] .foo { color: red;
        }"
      `)
      expect(
        `the >>> and /deep/ combinators have been deprecated.`,
      ).toHaveBeenWarned()
    })
  })
})

// CSS Modules：只允许异步管线，核对局部类名 JSON 与用户配置透传。
describe('SFC CSS modules', () => {
  test('should include resulting classes object in result', async () => {
    const result = await compileStyleAsync({
      source: `.red { color: red }\n.green { color: green }\n:global(.blue) { color: blue }`,
      filename: `test.css`,
      id: 'test',
      modules: true,
    })
    expect(result.modules).toBeDefined()
    expect(result.modules!.red).toMatch('_red_')
    expect(result.modules!.green).toMatch('_green_')
    expect(result.modules!.blue).toBeUndefined()
  })

  test('postcss-modules options', async () => {
    const result = await compileStyleAsync({
      source: `:local(.foo-bar) { color: red }\n.baz-qux { color: green }`,
      filename: `test.css`,
      id: 'test',
      modules: true,
      modulesOptions: {
        scopeBehaviour: 'global',
        generateScopedName: `[name]__[local]__[hash:base64:5]`,
        localsConvention: 'camelCaseOnly',
      },
    })
    expect(result.modules).toBeDefined()
    expect(result.modules!.fooBar).toMatch('__foo-bar__')
    expect(result.modules!.bazQux).toBeUndefined()
  })
})

// 预处理器：分别验证 Sass/SCSS/Less/Stylus API、additionalData、依赖和 source map。
describe('SFC style preprocessors', () => {
  test('scss @import', () => {
    const res = compileStyle({
      source: `
        @import "./import.scss";
      `,
      filename: path.resolve(__dirname, './fixture/test.scss'),
      id: '',
      preprocessLang: 'scss',
    })

    expect([...res.dependencies]).toStrictEqual([
      path.join(__dirname, './fixture/import.scss'),
    ])
  })

  test('scss respect user-defined string options.additionalData', () => {
    const res = compileStyle({
      preprocessOptions: {
        additionalData: `
          @mixin square($size) {
            width: $size;
            height: $size;
          }`,
      },
      source: `
        .square {
          @include square(100px);
        }
      `,
      filename: path.resolve(__dirname, './fixture/test.scss'),
      id: '',
      preprocessLang: 'scss',
    })

    expect(res.errors.length).toBe(0)
  })

  test('scss respect user-defined function options.additionalData', () => {
    const source = `
        .square {
          @include square(100px);
        }
      `
    const filename = path.resolve(__dirname, './fixture/test.scss')
    const res = compileStyle({
      preprocessOptions: {
        additionalData: (s: string, f: string) => {
          expect(s).toBe(source)
          expect(f).toBe(filename)
          return `
          @mixin square($size) {
            width: $size;
            height: $size;
          }`
        },
      },
      source,
      filename,
      id: '',
      preprocessLang: 'scss',
    })

    expect(res.errors.length).toBe(0)
  })

  test('should mount scope on correct selector when have universal selector', () => {
    expect(compileScoped(`* { color: red; }`)).toMatchInlineSnapshot(`
      "[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped('* .foo { color: red; }')).toMatchInlineSnapshot(`
      ".foo[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped(`*.foo { color: red; }`)).toMatchInlineSnapshot(`
      ".foo[data-v-test] { color: red;
      }"
    `)
    expect(compileScoped(`.foo * { color: red; }`)).toMatchInlineSnapshot(`
      ".foo[data-v-test] * { color: red;
      }"
    `)
  })
})
