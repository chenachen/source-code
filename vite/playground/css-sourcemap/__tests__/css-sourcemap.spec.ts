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

  /** 仅 dev 检查 linked.css：普通 dev 以 CSS Accept 请求原文件，确认无映射 URL；bundled dev 从 style 标签取 CSS，对照当前空 sources/mappings 的映射快照。 */
  test('linked css', async () => {
    if (isBundledDev) {
      // bundled dev 带映射，下面的普通 dev 分支不注入映射。
      const css = await getStyleTagContentIncluding('.linked ')
      expect(formatSourcemapForSnapshot(extractSourcemap(css), css))
        .toMatchInlineSnapshot(`
        SourceMap {
          content: {
            "mappings": "",
            "sources": [],
            "version": 3,
          },
          visualization: "https://evanw.github.io/source-map-visualization/#MjYALmxpbmtlZCB7CiAgY29sb3I6IHJlZDsKfQo0MAB7Im1hcHBpbmdzIjoiIiwic291cmNlcyI6W10sInZlcnNpb24iOjN9"
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
    if (isBundledDev) {
      // bundled dev 不按独立 CSS URL 返回该内容，因此读取注入的 style 标签。
      const css = await getStyleTagContentIncluding('.linked-with-import ')
      expect(formatSourcemapForSnapshot(extractSourcemap(css), css))
        .toMatchInlineSnapshot(`
          SourceMap {
            content: {
              "mappings": "AAAA;EACE,UAAU;AACZ;;ACAA;EACE,UAAU;AACZ",
              "sources": [
                "/root/be-imported.css",
                "/root/linked-with-import.css",
              ],
              "sourcesContent": [
                ".be-imported {
            color: red;
          }
          ",
                "@import '@/be-imported.css';

          .linked-with-import {
            color: red;
          }
          ",
              ],
              "version": 3,
            },
            visualization: "https://evanw.github.io/source-map-visualization/#NzAALmJlLWltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CgoubGlua2VkLXdpdGgtaW1wb3J0IHsKICBjb2xvcjogcmVkOwp9CjI2NgB7Im1hcHBpbmdzIjoiQUFBQTtFQUNFLFVBQVU7QUFDWjs7QUNBQTtFQUNFLFVBQVU7QUFDWiIsInNvdXJjZXMiOlsiL3Jvb3QvYmUtaW1wb3J0ZWQuY3NzIiwiL3Jvb3QvbGlua2VkLXdpdGgtaW1wb3J0LmNzcyJdLCJzb3VyY2VzQ29udGVudCI6WyIuYmUtaW1wb3J0ZWQge1xuICBjb2xvcjogcmVkO1xufVxuIiwiQGltcG9ydCAnQC9iZS1pbXBvcnRlZC5jc3MnO1xuXG4ubGlua2VkLXdpdGgtaW1wb3J0IHtcbiAgY29sb3I6IHJlZDtcbn1cbiJdLCJ2ZXJzaW9uIjozfQ=="
          }
        `)
      return
    }
    const res = await page.request.get(
      new URL('./linked-with-import.css', page.url()).href,
      {
        headers: {
          accept: 'text/css',
        },
      },
    )
    const css = await res.text()
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AAAA;EACE,UAAU;AACZ;;ACAA;EACE,UAAU;AACZ",
          "sources": [
            "be-imported.css",
            "linked-with-import.css",
          ],
          "sourcesContent": [
            ".be-imported {
        color: red;
      }
      ",
            "@import '@/be-imported.css';

      .linked-with-import {
        color: red;
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#NzAALmJlLWltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CgoubGlua2VkLXdpdGgtaW1wb3J0IHsKICBjb2xvcjogcmVkOwp9CjI1NAB7Im1hcHBpbmdzIjoiQUFBQTtFQUNFLFVBQVU7QUFDWjs7QUNBQTtFQUNFLFVBQVU7QUFDWiIsInNvdXJjZXMiOlsiYmUtaW1wb3J0ZWQuY3NzIiwibGlua2VkLXdpdGgtaW1wb3J0LmNzcyJdLCJzb3VyY2VzQ29udGVudCI6WyIuYmUtaW1wb3J0ZWQge1xuICBjb2xvcjogcmVkO1xufVxuIiwiQGltcG9ydCAnQC9iZS1pbXBvcnRlZC5jc3MnO1xuXG4ubGlua2VkLXdpdGgtaW1wb3J0IHtcbiAgY29sb3I6IHJlZDtcbn1cbiJdLCJ2ZXJzaW9uIjozfQ=="
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

  /** 仅 dev 从 style 标签读取被 JS 导入的 CSS，提取映射；普通 dev 对照完整来源与 mappings，bundled dev 对照目前已知缺口的空映射快照。 */
  test('imported css', async () => {
    const css = await getStyleTagContentIncluding('.imported ')
    const map = extractSourcemap(css)
    if (isBundledDev) {
      // 空 sources 的映射是当前已知缺口（vitejs/vite#23028）；
      // 修复后此处应与 Lightning CSS 对应场景一致。
      expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
        SourceMap {
          content: {
            "mappings": "",
            "sources": [],
            "version": 3,
          },
          visualization: "https://evanw.github.io/source-map-visualization/#MjgALmltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CjQwAHsibWFwcGluZ3MiOiIiLCJzb3VyY2VzIjpbXSwidmVyc2lvbiI6M30="
        }
      `)
      return
    }
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AAAA,CAAC,QAAQ,CAAC;AACV,CAAC,CAAC,KAAK,CAAC,CAAC,GAAG;AACZ;",
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
        visualization: "https://evanw.github.io/source-map-visualization/#MjgALmltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CjE3MwB7Im1hcHBpbmdzIjoiQUFBQSxDQUFDLFFBQVEsQ0FBQztBQUNWLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHO0FBQ1o7Iiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5jc3MiXSwic291cmNlc0NvbnRlbnQiOlsiLmltcG9ydGVkIHtcbiAgY29sb3I6IHJlZDtcbn1cbiJdLCJ2ZXJzaW9uIjozfQ=="
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
          "mappings": "AAAA;EACE,UAAU;AACZ;;ACAA;EACE,UAAU;AACZ",
          "sources": [
            "/root/be-imported.css",
            "/root/imported-with-import.css",
          ],
          "sourcesContent": [
            ".be-imported {
        color: red;
      }
      ",
            "@import '@/be-imported.css';

      .imported-with-import {
        color: red;
      }
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#NzIALmJlLWltcG9ydGVkIHsKICBjb2xvcjogcmVkOwp9CgouaW1wb3J0ZWQtd2l0aC1pbXBvcnQgewogIGNvbG9yOiByZWQ7Cn0KMjcwAHsibWFwcGluZ3MiOiJBQUFBO0VBQ0UsVUFBVTtBQUNaOztBQ0FBO0VBQ0UsVUFBVTtBQUNaIiwic291cmNlcyI6WyIvcm9vdC9iZS1pbXBvcnRlZC5jc3MiLCIvcm9vdC9pbXBvcnRlZC13aXRoLWltcG9ydC5jc3MiXSwic291cmNlc0NvbnRlbnQiOlsiLmJlLWltcG9ydGVkIHtcbiAgY29sb3I6IHJlZDtcbn1cbiIsIkBpbXBvcnQgJ0AvYmUtaW1wb3J0ZWQuY3NzJztcblxuLmltcG9ydGVkLXdpdGgtaW1wb3J0IHtcbiAgY29sb3I6IHJlZDtcbn1cbiJdLCJ2ZXJzaW9uIjozfQ=="
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
          "mappings": "AAGE;EACE,OCJM",
          "sourceRoot": "",
          "sources": [
            "/root/imported.sass",
            "/root/imported-nested.sass",
          ],
          "sourcesContent": [
            "@use "/imported-nested.sass"

      .imported
        &-sass
          color: imported-nested.$primary
      ",
            "$primary: red
      ",
          ],
          "version": 3,
        },
        visualization: "https://evanw.github.io/source-map-visualization/#MzMALmltcG9ydGVkLXNhc3MgewogIGNvbG9yOiByZWQ7Cn0KMjUyAHsibWFwcGluZ3MiOiJBQUdFO0VBQ0UsT0NKTSIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi9yb290L2ltcG9ydGVkLnNhc3MiLCIvcm9vdC9pbXBvcnRlZC1uZXN0ZWQuc2FzcyJdLCJzb3VyY2VzQ29udGVudCI6WyJAdXNlIFwiL2ltcG9ydGVkLW5lc3RlZC5zYXNzXCJcblxuLmltcG9ydGVkXG4gICYtc2Fzc1xuICAgIGNvbG9yOiBpbXBvcnRlZC1uZXN0ZWQuJHByaW1hcnlcbiIsIiRwcmltYXJ5OiByZWRcbiJdLCJ2ZXJzaW9uIjozfQ=="
      }
    `)
  })

  /** 仅 dev 按 CSS Modules 生成的类名查 style 标签，提取映射并对照 Sass Module 的源内容及原始位置。 */
  test('imported sass module', async () => {
    const css = await getStyleTagContentIncluding('._imported-sass-module_')
    const map = extractSourcemap(css)
    expect(formatSourcemapForSnapshot(map, css)).toMatchInlineSnapshot(`
      SourceMap {
        content: {
          "mappings": "AACE;EACE",
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
        visualization: "https://evanw.github.io/source-map-visualization/#NDkALl9pbXBvcnRlZC1zYXNzLW1vZHVsZV9yMXFjcF8xIHsKICBjb2xvcjogcmVkOwp9CjE0MwB7Im1hcHBpbmdzIjoiQUFDRTtFQUNFIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5tb2R1bGUuc2FzcyJdLCJzb3VyY2VzQ29udGVudCI6WyIuaW1wb3J0ZWRcbiAgJi1zYXNzLW1vZHVsZVxuICAgIGNvbG9yOiByZWRcbiJdLCJ2ZXJzaW9uIjozfQ=="
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
          "mappings": "AACE,SAAC;EACC",
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
        visualization: "https://evanw.github.io/source-map-visualization/#MzMALmltcG9ydGVkLWxlc3MgewogIGNvbG9yOiByZWQ7Cn0KMTUwAHsibWFwcGluZ3MiOiJBQUNFLFNBQUM7RUFDQyIsInNvdXJjZXMiOlsiL3Jvb3QvaW1wb3J0ZWQubGVzcyJdLCJzb3VyY2VzQ29udGVudCI6WyIuaW1wb3J0ZWQge1xuICAmLWxlc3Mge1xuICAgIGNvbG9yOiBAY29sb3I7XG4gIH1cbn1cbiJdLCJ2ZXJzaW9uIjozfQ=="
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
          "mappings": "AACE;EACE,OAAM,QAAN",
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
        visualization: "https://evanw.github.io/source-map-visualization/#MzkALmltcG9ydGVkLXN0eWx1cyB7CiAgY29sb3I6ICM4MDAwODA7Cn0KMTUxAHsibWFwcGluZ3MiOiJBQUNFO0VBQ0UsT0FBTSxRQUFOIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5zdHlsIl0sInNvdXJjZXNDb250ZW50IjpbIi5pbXBvcnRlZFxuICAmLXN0eWx1c1xuICAgIGNvbG9yIGJsdWUtcmVkLW1peGVkXG4iXSwidmVyc2lvbiI6M30="
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
          "mappings": "AAAA;EACE;AADe",
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
        visualization: "https://evanw.github.io/source-map-visualization/#MzUALmltcG9ydGVkLXN1Z2Fyc3MgewogIGNvbG9yOiByZWQKfQoxMjkAeyJtYXBwaW5ncyI6IkFBQUE7RUFDRTtBQURlIiwic291cmNlcyI6WyIvcm9vdC9pbXBvcnRlZC5zc3MiXSwic291cmNlc0NvbnRlbnQiOlsiLmltcG9ydGVkLXN1Z2Fyc3NcbiAgY29sb3I6IHJlZFxuIl0sInZlcnNpb24iOjN9"
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
