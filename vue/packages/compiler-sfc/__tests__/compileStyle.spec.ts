/**
 * SFC 样式编译场景：覆盖 scoped/deep/slotted/global/keyframes、CSS Modules、SCSS import
 * 依赖与 additionalData。
 */
import {
  type SFCStyleCompileOptions,
  compileStyle,
  compileStyleAsync,
} from '../src/compileStyle'
import path from 'node:path'

/**
 * 使用固定文件名和 scopeId 编译 scoped CSS；options 可覆盖默认值以测试指定分支。
 * 若返回 errors，先输出每条预处理/PostCSS 诊断再断言失败；成功时仅返回生成 CSS 供选择器断言。
 */
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
  // 分别编译 h1 与 .foo 简单选择器；scope 属性紧跟实际匹配节点，声明内容保留。
  test('simple selectors', () => {
    expect(compileScoped(`h1 { color: red; }`)).toMatch(
      `h1[data-v-test] { color: red;`,
    )
    expect(compileScoped(`.foo { color: red; }`)).toMatch(
      `.foo[data-v-test] { color: red;`,
    )
  })

  // 编译 h1 .foo 及 main 的 > * 原生嵌套；后代只在末端注入，嵌套父声明包进 & 规则，子规则分别处理。
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

  // h1 同时含声明和嵌套 .foo；父声明移入 &[scope]，子选择器独立带 scope。
  test('nesting selector', () => {
    expect(compileScoped(`h1 { color: red; .foo { color: red; } }`)).toMatch(
      `h1 {\n&[data-v-test] { color: red;\n}\n.foo[data-v-test] { color: red;`,
    )
  })

  // 父规则包含注释、media、声明及子规则；分离直属声明/注释，media 内声明也包进 &，避免作用域注入改变 nesting 层级。
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

  // 逗号连接后代与简单选择器；每个分支独立注入 scope，不把一支的注入点复用到另一支。
  test('multiple selectors', () => {
    expect(compileScoped(`h1 .foo, .bar, .baz { color: red; }`)).toMatch(
      `h1 .foo[data-v-test], .bar[data-v-test], .baz[data-v-test] { color: red;`,
    )
  })

  // 类选择器后接 :after；scope 放在伪类之前，保留伪类语义。
  test('pseudo class', () => {
    expect(compileScoped(`.foo:after { color: red; }`)).toMatch(
      `.foo[data-v-test]:after { color: red;`,
    )
  })

  // 只有 ::selection 伪元素；前置 scope 属性作为匹配主体，不能插进伪元素后面。
  test('pseudo element', () => {
    expect(compileScoped(`::selection { display: none; }`)).toMatch(
      '[data-v-test]::selection {',
    )
  })

  // 逗号后带空格的 ::selection 与 .abc；清理注入点附近空白，两支 scope 位置均合法。
  test('spaces before pseudo element', () => {
    const code = compileScoped(`.abc, ::selection { color: red; }`)
    expect(code).toMatch('.abc[data-v-test],')
    expect(code).toMatch('[data-v-test]::selection {')
  })

  // 覆盖 deep 两种函数名、后代、is/where/not/has 中的 deep 与多分支和嵌套规则；deep 前注入，内部取消普通 scope，分支必要时展开。
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

  // 覆盖 slotted 两种函数名、复合后代及局部前缀；插槽目标使用 -s 属性，外侧不再重复注入普通 scope。
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

  // 覆盖 global 两种函数名和含局部前缀的选择器；只保留 global 内部选择器，不注入 scope。
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

  // is/where 作为末端时递归给各参数注入；后方还有 div 时把 scope 放在 div，避免额外约束伪类参数。
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
  // .div 后接 where/is 的 hover 或 .foo:hover；scope 跟随复合选择器的 .div，伪类内容保持原样。
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

  // media 包含 .foo；进入 at-rule 的普通 rule 注入 scope，媒体条件保持。
  test('media query', () => {
    expect(compileScoped(`@media print { .foo { color: red }}`))
      .toMatchInlineSnapshot(`
      "@media print {
      .foo[data-v-test] { color: red
      }}"
    `)
  })

  // supports 包含 .foo；只改选择器，保留 supports 条件。
  test('supports query', () => {
    expect(compileScoped(`@supports(display: grid) { .foo { display: grid }}`))
      .toMatchInlineSnapshot(`
      "@supports(display: grid) {
      .foo[data-v-test] { display: grid
      }}"
    `)
  })

  // 普通与 webkit keyframes 有 color/opacity，多条 animation/animation-name 顺序不同；先重命名定义再回写已知名称，未定义 other 和帧选择器不变。
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
  // 逗号前带尾随空格；删掉注入点空白，scope 紧邻各类选择器。
  test('spaces after selector', () => {
    expect(compileScoped(`.foo , .bar { color: red; }`)).toMatchInlineSnapshot(`
      ".foo[data-v-test], .bar[data-v-test] { color: red;
      }"
    `)
  })

  // 废弃语法仍兼容编译并给出迁移警告，避免旧项目升级时静默改变样式。
  describe('deprecated syntax', () => {
    // 旧 ::v-deep 组合符有裸用与局部前缀两支；仍按深度规则转换，同时断言弃用警告。
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

    // 旧 >>> 组合符；兼容生成深度选择器并给出迁移警告。
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

    // 旧 /deep/ 组合符；与 >>> 使用相同兼容改写和弃用诊断。
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
  // 异步 CSS Modules 编译 red/green 与 global blue；结果映射只含两项局部类名，全局 blue 不进入 modules。
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

  // CSS Modules 配置 global 默认、自定义命名和 camelCaseOnly；显式 local foo-bar 映射为 fooBar，默认全局 baz-qux 不进入结果。
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

// 预处理器：验证 SCSS import 依赖与字符串/函数形式 additionalData。
describe('SFC style preprocessors', () => {
  // SCSS 从固定 fixture 路径导入 import.scss；dependencies 返回导入文件的完整路径，并排除当前样式文件。
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

  // additionalData 字符串定义 mixin，原样式调用它；字符串前置拼接后 SCSS 能正常编译，无错误。
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

  // additionalData 函数接收 source/filename 并仅返回 mixin；断言参数准确且结果无错误，此测试验证函数返回值替换全文而非自动拼接原样式。
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

  // 分别编译裸 *、* 后代、*.foo 与 .foo *；通配符按位置移除或保留，scope 选取真实可注入节点。
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
