import { URL } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  extractSourcemap,
  formatSourcemapForSnapshot,
  isBuild,
  isBundled,
  isBundledDev,
  isServe,
  page,
  serverLogs,
} from '~utils'

/** 仅构建模式逐条检查服务器日志，确认没有 Sourcemap is likely to be incorrect 警告，覆盖 CSS 映射合并。 */
test.runIf(isBuild)('should not output sourcemap warning (#4939)', () => {
  serverLogs.forEach((log) => {
    expect(log).not.toMatch('Sourcemap is likely to be incorrect')
  })
})

describe.runIf(isServe)('serve', () => {
  /** 遍历当前页面 style 标签，返回第一份包含指定片段的文本；未命中时抛 Not found。
   * @param content 用于识别目标 CSS 的选择器片段。
   * @returns 命中的样式文本，含其 inline sourcemap。 */
  const getStyleTagContentIncluding = async (content: string) => {
    const styles = await page.$$('style')
    for (const style of styles) {
      const text = await style.textContent()
      if (text.includes(content)) {
        return text
      }
    }
    throw new Error('Not found')
  }

  /** 仅 dev 检查 linked.css：普通 dev 以 CSS Accept 请求原文件，确认无映射 URL；bundled dev 从 style 标签取 CSS 并对照含原来源的 Lightning CSS 映射快照。 */
  test('linked css', async () => {
    if (isBundledDev) {
      // bundled dev 带映射，下面的普通 dev 分支不注入映射。
      const css = await getStyleTagContentIncluding('.linked ')
      expect(formatSourcemapForSnapshot(extractSourcemap(css), css))
        .toMatchInlineSnapshot(`
        SourceMap {
          content: {
            "mappings": "AAAA",
            "sources": [
              "/root/linked.css",
            ],
            "sourcesContent": [
              ".linked {
          color: red;
        }
        ",
            ],
            "version": 3,
          },
          visualization: "https://evanw.github.io/source-map-visualization/#MjYALmxpbmtlZCB7CiAgY29sb3I6IHJlZDsKfQoxMTMAeyJtYXBwaW5ncyI6IkFBQUEiLCJzb3VyY2VzIjpbIi9yb290L2xpbmtlZC5jc3MiXSwic291cmNlc0NvbnRlbnQiOlsiLmxpbmtlZCB7XG4gIGNvbG9yOiByZWQ7XG59XG4iXSwidmVyc2lvbiI6M30="
        }
      `)
      return
    }
    const res = await page.request.get(
      new URL('./linked.css', page.url()).href,
      {
        headers: {
          accept: 'text/css',
        },
      },
    )
    const css = await res.text()
    // 普通 dev 中未改写的 CSS 不注入映射 URL。
    expect(css).not.toContain('sourceMappingURL')
  })

  /** 仅 dev 检查含 @import 的 linked CSS：普通 dev 请求 CSS，bundled dev 读取 style 标签；提取映射并逐项对照来源、源内容与合并 mappings 快照。 */
  test('linked css with import', async () => {
    let css: string
    if (isBundledDev) {
      // bundled dev 不按独立 CSS URL 返回该内容，因此读取注入的 style 标签。
      css = await getStyleTagContentIncluding('.linked-with-import ')
    } else {
      const res = await page.request.get(
        new URL('./linked-with-import.css', page.url()).href,
        {
          headers: {
            accept: 'text/css',
          },
        },
      )
      css = await res.text()
    }
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "ACAA;;;;ADEA",
          "sources": [
            "linked-with-import.css",
            "be-imported.css",
          ],
          "sourcesContent": [
            "@import '@/be-imported.css';

      .linked-with-import {
        color: red;
      }
      ",
            ".be-imported {
        color: red;
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#NzAALmJlLWltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CgoubGlua2VkLXdpdGgtaW1wb3J0IHsKICBjb2xvcjogcmVkOwp9CjIyNgB7Im1hcHBpbmdzIjoiQUNBQTs7OztBREVBIiwic291cmNlcyI6WyJsaW5rZWQtd2l0aC1pbXBvcnQuY3NzIiwiYmUtaW1wb3J0ZWQuY3NzIl0sInNvdXJjZXNDb250ZW50IjpbIkBpbXBvcnQgJ0AvYmUtaW1wb3J0ZWQuY3NzJztcblxuLmxpbmtlZC13aXRoLWltcG9ydCB7XG4gIGNvbG9yOiByZWQ7XG59XG4iLCIuYmUtaW1wb3J0ZWQge1xuICBjb2xvcjogcmVkO1xufVxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅普通 dev 以默认 Accept 请求 CSS 的 JS 包装模块，确认无行式 JS sourceMappingURL；CSS 字符串里的块式映射注释不受此断言限制。 */
  test.runIf(!isBundled)(
    'js .css request does not include sourcemap',
    async () => {
      const res = await page.request.get(
        new URL('./linked-with-import.css', page.url()).href,
      )
      const content = await res.text()
      // 响应是包装 CSS 的 JS 模块；JS 本身
      // 不带行式 JS 映射注释。JS 字符串中的 CSS 文本
      // 自己带有块式 CSS 映射注释，该注释
      // 可以保留。
      expect(content).not.toMatch('//# sourceMappingURL')
    },
  )

  /** 仅 dev 从 style 标签读取被 JS 导入的 CSS，提取映射并对照来源路径、源内容与 mappings；bundled dev 与普通 dev 的来源路径格式分别有快照。 */
  test('imported css', async () => {
    const css = await getStyleTagContentIncluding('.imported ')
    const map = extractSourcemap(css)
    if (isBundledDev) {
      expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
        SourceMap {
          content: {
            "mappings": "AAAA",
            "sources": [
              "/root/imported.css",
            ],
            "sourcesContent": [
              ".imported {
          color: red;
        }
        ",
            ],
            "version": 3,
          },
          visualization: "https://evanw.github.io/source-map-visualization/#MjgALmltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CjExNwB7Im1hcHBpbmdzIjoiQUFBQSIsInNvdXJjZXMiOlsiL3Jvb3QvaW1wb3J0ZWQuY3NzIl0sInNvdXJjZXNDb250ZW50IjpbIi5pbXBvcnRlZCB7XG4gIGNvbG9yOiByZWQ7XG59XG4iXSwidmVyc2lvbiI6M30="
        }
      `)
      return
    }
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AAAA",
          "sources": [
            "imported.css",
          ],
          "sourcesContent": [
            ".imported {
        color: red;
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MjgALmltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CjExMQB7Im1hcHBpbmdzIjoiQUFBQSIsInNvdXJjZXMiOlsiaW1wb3J0ZWQuY3NzIl0sInNvdXJjZXNDb250ZW50IjpbIi5pbXBvcnRlZCB7XG4gIGNvbG9yOiByZWQ7XG59XG4iXSwidmVyc2lvbiI6M30="
      }
    `)
  })

  /** 仅 dev 读取带 @import 的已注入 CSS，提取映射并对照两份源文件、sourcesContent 与合并 mappings 快照。 */
  test('imported css with import', async () => {
    const css = await getStyleTagContentIncluding('.imported-with-import ')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "ACAA;;;;ADEA",
          "sources": [
            "imported-with-import.css",
            "be-imported.css",
          ],
          "sourcesContent": [
            "@import '@/be-imported.css';

      .imported-with-import {
        color: red;
      }
      ",
            ".be-imported {
        color: red;
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#NzIALmJlLWltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CgouaW1wb3J0ZWQtd2l0aC1pbXBvcnQgewogIGNvbG9yOiByZWQ7Cn0KMjMwAHsibWFwcGluZ3MiOiJBQ0FBOzs7O0FERUEiLCJzb3VyY2VzIjpbImltcG9ydGVkLXdpdGgtaW1wb3J0LmNzcyIsImJlLWltcG9ydGVkLmNzcyJdLCJzb3VyY2VzQ29udGVudCI6WyJAaW1wb3J0ICdAL2JlLWltcG9ydGVkLmNzcyc7XG5cbi5pbXBvcnRlZC13aXRoLWltcG9ydCB7XG4gIGNvbG9yOiByZWQ7XG59XG4iLCIuYmUtaW1wb3J0ZWQge1xuICBjb2xvcjogcmVkO1xufVxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅 dev 读取由 Sass 编译并注入的 CSS，提取映射对照 sourcesContent 与 mappings；普通 CSS 套件保留嵌套 Sass 来源，Lightning CSS 快照只列主 Sass。 */
  test('imported sass', async () => {
    const css = await getStyleTagContentIncluding('.imported-sass ')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AAGE",
          "sources": [
            "/root/imported.sass",
          ],
          "sourcesContent": [
            "@use "/imported-nested.sass"

      .imported
        &-sass
          color: imported-nested.$primary
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MzMALmltcG9ydGVkLXNhc3MgewogIGNvbG9yOiByZWQ7Cn0KMTc5AHsibWFwcGluZ3MiOiJBQUdFIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5zYXNzIl0sInNvdXJjZXNDb250ZW50IjpbIkB1c2UgXCIvaW1wb3J0ZWQtbmVzdGVkLnNhc3NcIlxuXG4uaW1wb3J0ZWRcbiAgJi1zYXNzXG4gICAgY29sb3I6IGltcG9ydGVkLW5lc3RlZC4kcHJpbWFyeVxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅 dev 按 CSS Modules 生成的类名查 style 标签，提取映射并对照 Sass Module 的源内容及原始位置。 */
  test('imported sass module', async () => {
    const css = await getStyleTagContentIncluding('_imported-sass-module')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AACE",
          "sources": [
            "/root/imported.module.sass",
          ],
          "sourcesContent": [
            ".imported
        &-sass-module
          color: red
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#NDcALmhvUU10V19pbXBvcnRlZC1zYXNzLW1vZHVsZSB7CiAgY29sb3I6IHJlZDsKfQoxMzgAeyJtYXBwaW5ncyI6IkFBQ0UiLCJzb3VyY2VzIjpbIi9yb290L2ltcG9ydGVkLm1vZHVsZS5zYXNzIl0sInNvdXJjZXNDb250ZW50IjpbIi5pbXBvcnRlZFxuICAmLXNhc3MtbW9kdWxlXG4gICAgY29sb3I6IHJlZFxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅 dev 读取 Less 编译出的 style 标签，提取映射并对照 Less 的嵌套规则源内容及 mappings。 */
  test('imported less', async () => {
    const css = await getStyleTagContentIncluding('.imported-less ')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AACE",
          "sources": [
            "/root/imported.less",
          ],
          "sourcesContent": [
            ".imported {
        &-less {
          color: @color;
        }
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MzMALmltcG9ydGVkLWxlc3MgewogIGNvbG9yOiByZWQ7Cn0KMTQwAHsibWFwcGluZ3MiOiJBQUNFIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5sZXNzIl0sInNvdXJjZXNDb250ZW50IjpbIi5pbXBvcnRlZCB7XG4gICYtbGVzcyB7XG4gICAgY29sb3I6IEBjb2xvcjtcbiAgfVxufVxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅 dev 读取 Stylus 编译出的 style 标签，提取映射并对照颜色计算的源内容与 mappings 快照。 */
  test('imported stylus', async () => {
    const css = await getStyleTagContentIncluding('.imported-stylus ')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AACE",
          "sources": [
            "/root/imported.styl",
          ],
          "sourcesContent": [
            ".imported
        &-stylus
          color blue-red-mixed
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MzgALmltcG9ydGVkLXN0eWx1cyB7CiAgY29sb3I6IHB1cnBsZTsKfQoxMzYAeyJtYXBwaW5ncyI6IkFBQ0UiLCJzb3VyY2VzIjpbIi9yb290L2ltcG9ydGVkLnN0eWwiXSwic291cmNlc0NvbnRlbnQiOlsiLmltcG9ydGVkXG4gICYtc3R5bHVzXG4gICAgY29sb3IgYmx1ZS1yZWQtbWl4ZWRcbiJdLCJ2ZXJzaW9uIjozfQ=="
      }
    `)
  })

  /** 仅 dev 读取 SugarSS 转换出的 style 标签，提取映射并对照无花括号源语法及 mappings 快照。 */
  test('imported sugarss', async () => {
    const css = await getStyleTagContentIncluding('.imported-sugarss ')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AAAA",
          "sources": [
            "/root/imported.sss",
          ],
          "sourcesContent": [
            ".imported-sugarss
        color: red
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MzYALmltcG9ydGVkLXN1Z2Fyc3MgewogIGNvbG9yOiByZWQ7Cn0KMTE5AHsibWFwcGluZ3MiOiJBQUFBIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5zc3MiXSwic291cmNlc0NvbnRlbnQiOlsiLmltcG9ydGVkLXN1Z2Fyc3NcbiAgY29sb3I6IHJlZFxuIl0sInZlcnNpb24iOjN9"
      }
    `)
  })

  /** 仅 dev 逐条检查服务器日志，确认没有 CSS sourcemap 指向缺失源文件的警告。 */
  test('should not output missing source file warning', () => {
    serverLogs.forEach((log) => {
      expect(log).not.toMatch(/Sourcemap for .+ points to missing source files/)
    })
  })
})
