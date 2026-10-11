/**
 * CSS `v-bind()` 场景：从 style 提取表达式、生成稳定变量名、PostCSS 改写和 useCssVars 注入，
 * 覆盖开发/生产、转义/嵌套括号、重复表达式去重、注释忽略及 SSR 跳过客户端注入。
 */
import { compileStyle, parse } from '../src'
import { assertCode, compileSFCScript, mockId } from './utils'

describe('CSS vars injection', () => {
  // 普通 script 的样式读取 color 与 font.size；生成 useCssVars，键中的点号转义，值表达式通过 _ctx 读取。
  test('generating correct code for nested paths', () => {
    const { content } = compileSFCScript(
      `<script>const a = 1</script>\n` +
        `<style>div{
          color: v-bind(color);
          font-size: v-bind('font.size');
        }</style>`,
    )
    expect(content).toMatch(`_useCssVars(_ctx => ({
  "${mockId}-color": (_ctx.color),
  "${mockId}-font\\.size": (_ctx.font.size)
})`)
    assertCode(content)
  })

  // 普通 script setup 返回 ref size；绑定分析记录来源，但注入函数通过组件代理 _ctx.size 获取解包后的值。
  test('w/ normal <script> binding analysis', () => {
    const { content } = compileSFCScript(
      `<script>
      export default {
        setup() {
          return {
            size: ref('100px')
          }
        }
      }
      </script>\n` +
        `<style>
          div {
            font-size: v-bind(size);
          }
        </style>`,
    )
    expect(content).toMatch(`_useCssVars(_ctx => ({
  "${mockId}-size": (_ctx.size)
})`)
    expect(content).toMatch(`import { useCssVars as _useCssVars } from 'vue'`)
    assertCode(content)
  })

  // script setup 同时有字面量 color、ref size 与 prop foo；CSS 注入分别直接读取、.value 和 __props，并引入所需 helper。
  test('w/ <script setup> binding analysis', () => {
    const { content } = compileSFCScript(
      `<script setup>
        import { defineProps, ref } from 'vue'
        const color = 'red'
        const size = ref('10px')
        defineProps({
          foo: String
        })
        </script>\n` +
        `<style>
          div {
            color: v-bind(color);
            font-size: v-bind(size);
            border: v-bind(foo);
          }
        </style>`,
    )
    // 这里同时覆盖三类可在 CSS 变量表达式中直接引用的绑定：
    // 1. 局部 const 绑定；
    // 2. 已知由 Vue ref() 创建的局部绑定；
    // 3. 已由编译器分析出的 props 绑定。
    expect(content).toMatch(`_useCssVars(_ctx => ({
  "${mockId}-color": (color),
  "${mockId}-size": (size.value),
  "${mockId}-foo": (__props.foo)
})`)
    expect(content).toMatch(
      `import { useCssVars as _useCssVars, unref as _unref } from 'vue'`,
    )
    assertCode(content)
  })

  // CSS 声明用 v-bind 读取点路径、希腊/中文/日文标识符；PostCSS 转成同一规则的 var(--name)，只转义 CSS 名所需字符。
  test('should rewrite CSS vars in compileStyle', () => {
    const { code } = compileStyle({
      source: `.foo {
        color: v-bind(color);
        font-size: v-bind('font.size');

        font-weight: v-bind(_φ);
        font-size: v-bind(1-字号);
        font-family: v-bind(フォント);
      }`,
      filename: 'test.css',
      id: 'data-v-test',
    })
    expect(code).toMatchInlineSnapshot(`
      ".foo {
              color: var(--test-color);
              font-size: var(--test-font\\.size);

              font-weight: var(--test-_φ);
              font-size: var(--test-1-字号);
              font-family: var(--test-フォント);
      }"
    `)
  })

  // 相同表达式分别编译生产脚本与样式；两端采用相同 hash key，useCssVars 键与 var 引用一致。
  test('prod mode', () => {
    const { content } = compileSFCScript(
      `<script>const a = 1</script>\n` +
        `<style>div{
          color: v-bind(color);
          font-size: v-bind('font.size');
        }</style>`,
      { isProd: true },
    )
    expect(content).toMatch(`_useCssVars(_ctx => ({
  "v4003f1a6": (_ctx.color),
  "v41b6490a": (_ctx.font.size)
}))}`)

    const { code } = compileStyle({
      source: `.foo {
        color: v-bind(color);
        font-size: v-bind('font.size');
      }`,
      filename: 'test.css',
      id: mockId,
      isProd: true,
    })
    expect(code).toMatchInlineSnapshot(`
      ".foo {
              color: var(--v4003f1a6);
              font-size: var(--v41b6490a);
      }"
    `)
  })

  // JS 代码生成：按 bindingMetadata 前缀表达式，并只在存在变量时注入 useCssVars。
  describe('codegen', () => {
    // 普通 script 无默认导出但样式有变量；补组件对象并包装 setup，assertCode 检查生成模块。
    test('<script> w/ no default export', () => {
      assertCode(
        compileSFCScript(
          `<script>const a = 1</script>\n` +
            `<style>div{ color: v-bind(color); }</style>`,
        ).content,
      )
    })

    // 普通 script 已有 setup 默认导出；重写组件主变量并包装原 setup 注入 CSS 变量，输出通过语法与快照检查。
    test('<script> w/ default export', () => {
      assertCode(
        compileSFCScript(
          `<script>export default { setup() {} }</script>\n` +
            `<style>div{ color: v-bind(color); }</style>`,
        ).content,
      )
    })

    // 普通 script 注释中也含 export default；只重写真实默认导出，注释不影响 CSS 注入入口。
    test('<script> w/ default export in strings/comments', () => {
      assertCode(
        compileSFCScript(
          `<script>
          // export default {}
          export default {}
        </script>\n` + `<style>div{ color: v-bind(color); }</style>`,
        ).content,
      )
    })

    // script setup 定义 color 且 style 读取；在 setup 内生成 useCssVars 并直接访问局部绑定。
    test('w/ <script setup>', () => {
      assertCode(
        compileSFCScript(
          `<script setup>const color = 'red'</script>\n` +
            `<style>div{ color: v-bind(color); }</style>`,
        ).content,
      )
    })

    // #4185：注释中的 `v-bind(...)` 只是示例文本，不能生成 CSS 变量或 useCssVars 代码。
    // 样式注释中含 color 的 v-bind，实际声明读取 width；只注入 width，注释中的表达式不参与提取。
    test('should ignore comments', () => {
      const { content } = compileSFCScript(
        `<script setup>const color = 'red';const width = 100</script>\n` +
          `<style>
            /* comment **/
            div{ /* color: v-bind(color); */ width:20; }
            div{ width: v-bind(width); }
            /* comment */
          </style>`,
      )

      expect(content).not.toMatch(`"${mockId}-color": (color)`)
      expect(content).toMatch(`"${mockId}-width": (width)`)
      assertCode(content)
    })

    // 同一个 color 在两条规则中重复使用；表达式列表去重，注入对象仅有一个 color 键。
    test('w/ <script setup> using the same var multiple times', () => {
      const { content } = compileSFCScript(
        `<script setup>
        const color = 'red'
        </script>\n` +
          `<style>
          div {
            color: v-bind(color);
          }
          p {
            color: v-bind(color);
          }
        </style>`,
      )
      // 即使同一个变量在样式中出现两次，也只能注入一次 color 声明。
      expect(content).toMatch(`_useCssVars(_ctx => ({
  "${mockId}-color": (color)
})`)
      assertCode(content)
    })

    // CSS 的 calc、引号、空格与多层括号包住算术表达式；扫描完整表达式、去重同值写法，JS 端对 let 使用 unref，键按完整表达式转义。
    test('should work with w/ complex expression', () => {
      const { content } = compileSFCScript(
        `<script setup>
        let a = 100
        let b = 200
        let foo = 300
        </script>\n` +
          `<style>
          p{
            width: calc(v-bind(foo) - 3px);
            height: calc(v-bind('foo') - 3px);
            top: calc(v-bind(foo + 'px') - 3px);
          }
          div {
            color: v-bind((a + b) / 2 + 'px' );
          }
          div {
            color: v-bind    ((a + b) / 2 + 'px' );
          }
          p {
            color: v-bind(((a + b)) / (2 * a));
          }
        </style>`,
      )
      expect(content).toMatch(`_useCssVars(_ctx => ({
  "${mockId}-foo": (_unref(foo)),
  "${mockId}-foo\\ \\+\\ \\'px\\'": (_unref(foo) + 'px'),
  "${mockId}-\\(a\\ \\+\\ b\\)\\ \\/\\ 2\\ \\+\\ \\'px\\'": ((_unref(a) + _unref(b)) / 2 + 'px'),
  "${mockId}-\\(\\(a\\ \\+\\ b\\)\\)\\ \\/\\ \\(2\\ \\*\\ a\\)": (((_unref(a) + _unref(b))) / (2 * _unref(a)))
}))`)
      assertCode(content)
    })

    // #6022：CSS 外层 v-bind 括号完整时，parse 仍提取引号中残缺的 JS 表达式，不执行 JS 语法校验。
    // v-bind 外层闭合但字符串内 JS 表达式残缺；parse 仅提取文本，cssVars 保存残缺表达式与 xxx，不提前做 JS 语法校验。
    test('should be able to parse incomplete expressions', () => {
      const {
        descriptor: { cssVars },
      } = parse(
        `<script setup>let xxx = 1</script>
        <style scoped>
        label {
          font-weight: v-bind("count.toString(");
          font-weight: v-bind(xxx);
        }
        </style>`,
      )
      expect(cssVars).toMatchObject([`count.toString(`, `xxx`])
    })

    // #7759：`</script><style>` 之间没有空格时仍要正确切块，不能把 style 内容并入脚本。
    // setup 使用 ref 别名、后接 style 读取 background；切块与绑定分析协作生成 unref CSS 注入，模板块间文本不影响脚本生成。
    test('It should correctly parse the case where there is no space after the script tag', () => {
      const { content } = compileSFCScript(
        `<script setup>import { ref as _ref } from 'vue';
                let background = _ref('red')
             </script>
             <style>
             label {
               background: v-bind(background);
             }
             </style>`,
      )
      expect(content).toMatch(
        `export default {\n  setup(__props, { expose: __expose }) {\n  __expose();\n\n_useCssVars(_ctx => ({\n  "xxxxxxxx-background": (_unref(background))\n}))`,
      )
    })

    // SSR 由服务端模板转换另行注入变量，script setup 不应重复生成客户端 useCssVars。
    describe('skip codegen in SSR', () => {
      // SSR 配置且内联 setup 模板，样式读取 size；script 不生成客户端 useCssVars。
      test('script setup, inline', () => {
        const { content } = compileSFCScript(
          `<script setup>
          let size = 1
          </script>\n` +
            `<style>
              div {
                font-size: v-bind(size);
              }
            </style>`,
          {
            inlineTemplate: true,
            templateOptions: {
              ssr: true,
            },
          },
        )
        expect(content).not.toMatch(`_useCssVars`)
      })

      // #6926：SSR 且非内联模板时也不应在 setup 注入客户端 useCssVars。
      // SSR 配置且非内联 setup 模板；同样跳过客户端 useCssVars，避免与服务端变量注入重复。
      test('script, non-inline', () => {
        const { content } = compileSFCScript(
          `<script setup>
          let size = 1
          </script>\n` +
            `<style>
              div {
                font-size: v-bind(size);
              }
            </style>`,
          {
            inlineTemplate: false,
            templateOptions: {
              ssr: true,
            },
          },
        )
        expect(content).not.toMatch(`_useCssVars`)
      })

      // SSR 配置普通 script 返回 size；普通脚本路径也跳过客户端 CSS 变量 helper。
      test('normal script', () => {
        const { content } = compileSFCScript(
          `<script>
          export default {
            setup() {
              return {
                size: ref('100px')
              }
            }
          }
          </script>\n` +
            `<style>
              div {
                font-size: v-bind(size);
              }
            </style>`,
          {
            templateOptions: {
              ssr: true,
            },
          },
        )
        expect(content).not.toMatch(`_useCssVars`)
      })
    })
  })
})
