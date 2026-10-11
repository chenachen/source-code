/**
 * `.vue` 结构解析场景：切分 template/script/script setup/style/custom blocks，记录属性、位置、
 * source map、padding 与 slotted 状态，并诊断重复 block、无入口和 functional 用法。
 */
import { parse } from '../src'
import {
  ElementTypes,
  NodeTypes,
  baseCompile,
  createRoot,
} from '@vue/compiler-core'
import { SourceMapConsumer } from 'source-map-js'

describe('compiler:sfc', () => {
  // block source map：内容行列应回指完整 `.vue`，包括空行、缩进和 CRLF。
  describe('source map', () => {
    // SFC 前随机增加空行，包含普通/module/scoped style；分别消费三块 map，生成行加块偏移应等于完整 SFC 原行。
    test('style block', () => {
      // padding 决定 style 块内容前保留多少空行，以维持原文件行号。
      const padding = Math.round(Math.random() * 10)
      const src =
        `${'\n'.repeat(padding)}` +
        `<style>
.css {
color: red;
}
</style>

<style module>
.css-module {
color: red;
}
</style>

<style scoped>
.css-scoped {
color: red;
}
</style>

<style scoped>
.css-scoped-nested {
color: red;
.dummy {
color: green;
}
font-weight: bold;
}
</style>`
      const {
        descriptor: { styles },
      } = parse(src)

      expect(styles[0].map).not.toBeUndefined()
      const consumer = new SourceMapConsumer(styles[0].map!)
      const lineOffset =
        src.slice(0, src.indexOf(`<style>`)).split('\n').length - 1
      consumer.eachMapping(mapping => {
        expect(mapping.generatedLine + lineOffset).toBe(mapping.originalLine)
      })

      expect(styles[1].map).not.toBeUndefined()
      const consumer1 = new SourceMapConsumer(styles[1].map!)
      const lineOffset1 =
        src.slice(0, src.indexOf(`<style module>`)).split('\n').length - 1
      consumer1.eachMapping(mapping => {
        expect(mapping.generatedLine + lineOffset1).toBe(mapping.originalLine)
      })

      expect(styles[2].map).not.toBeUndefined()
      const consumer2 = new SourceMapConsumer(styles[2].map!)
      const lineOffset2 =
        src.slice(0, src.indexOf(`<style scoped>`)).split('\n').length - 1
      consumer2.eachMapping(mapping => {
        expect(mapping.generatedLine + lineOffset2).toBe(mapping.originalLine)
      })
    })

    // 普通 script 前加入随机空行；逐映射检查 originalLine-generatedLine 等于前置行数，确认块级 map 恢复整文件位置。
    test('script block', () => {
      // 在完整 SFC 前添加随机空行；普通 script block map 应补回这些行。
      const padding = Math.round(Math.random() * 10)
      const script = parse(
        `${'\n'.repeat(padding)}<script>\nconsole.log(1)\n }\n</script>\n`,
      ).descriptor.script

      expect(script!.map).not.toBeUndefined()

      const consumer = new SourceMapConsumer(script!.map!)
      consumer.eachMapping(mapping => {
        expect(mapping.originalLine! - mapping.generatedLine).toBe(padding)
      })
    })

    // Pug template 具有两列公共缩进和前置空行；去缩进后 map 仍恢复原行与两列偏移。
    test('template block with lang + indent', () => {
      // Pug 去除公共缩进后，map 应恢复 SFC 前置空行与删掉的两列缩进。
      const padding = Math.round(Math.random() * 10)
      const template = parse(
        `${'\n'.repeat(padding)}<template lang="pug">
  h1 foo
    div bar
    span baz
</template>\n`,
      ).descriptor.template!

      expect(template.map).not.toBeUndefined()

      const consumer = new SourceMapConsumer(template.map!)
      consumer.eachMapping(mapping => {
        expect(mapping.originalLine! - mapping.generatedLine).toBe(padding)
        expect(mapping.originalColumn! - mapping.generatedColumn).toBe(2)
      })
    })

    // 自定义 i18n 块前加随机空行；custom block map 应把内容行定位回完整 SFC。
    test('custom block', () => {
      const padding = Math.round(Math.random() * 10)
      const custom = parse(
        `${'\n'.repeat(padding)}<i18n>\n{\n  "greeting": "hello"\n}\n</i18n>\n`,
      ).descriptor.customBlocks[0]

      expect(custom!.map).not.toBeUndefined()

      const consumer = new SourceMapConsumer(custom!.map!)
      consumer.eachMapping(mapping => {
        expect(mapping.originalLine! - mapping.generatedLine).toBe(padding)
      })
    })
  })

  // 同一 SFC 分别用 false/true/line/space padding；template 保留原内容，其余块按注释行、空行或等长空格补齐前置位置。
  test('pad content', () => {
    const content = `
<template>
<div></div>
</template>
<script>
export default {}
</script>
<style>
h1 { color: red }
</style>
<i18n>
{ "greeting": "hello" }
</i18n>
`
    const padFalse = parse(content.trim(), { pad: false }).descriptor
    expect(padFalse.template!.content).toBe('\n<div></div>\n')
    expect(padFalse.script!.content).toBe('\nexport default {}\n')
    expect(padFalse.styles[0].content).toBe('\nh1 { color: red }\n')
    expect(padFalse.customBlocks[0].content).toBe('\n{ "greeting": "hello" }\n')

    const padTrue = parse(content.trim(), { pad: true }).descriptor
    expect(padTrue.script!.content).toBe(
      Array(3 + 1).join('//\n') + '\nexport default {}\n',
    )
    expect(padTrue.styles[0].content).toBe(
      Array(6 + 1).join('\n') + '\nh1 { color: red }\n',
    )
    expect(padTrue.customBlocks[0].content).toBe(
      Array(9 + 1).join('\n') + '\n{ "greeting": "hello" }\n',
    )

    const padLine = parse(content.trim(), { pad: 'line' }).descriptor
    expect(padLine.script!.content).toBe(
      Array(3 + 1).join('//\n') + '\nexport default {}\n',
    )
    expect(padLine.styles[0].content).toBe(
      Array(6 + 1).join('\n') + '\nh1 { color: red }\n',
    )
    expect(padLine.customBlocks[0].content).toBe(
      Array(9 + 1).join('\n') + '\n{ "greeting": "hello" }\n',
    )

    const padSpace = parse(content.trim(), { pad: 'space' }).descriptor
    expect(padSpace.script!.content).toBe(
      `<template>\n<div></div>\n</template>\n<script>`.replace(/./g, ' ') +
        '\nexport default {}\n',
    )
    expect(padSpace.styles[0].content).toBe(
      `<template>\n<div></div>\n</template>\n<script>\nexport default {}\n</script>\n<style>`.replace(
        /./g,
        ' ',
      ) + '\nh1 { color: red }\n',
    )
    expect(padSpace.customBlocks[0].content).toBe(
      `<template>\n<div></div>\n</template>\n<script>\nexport default {}\n</script>\n<style>\nh1 { color: red }\n</style>\n<i18n>`.replace(
        /./g,
        ' ',
      ) + '\n{ "greeting": "hello" }\n',
    )
  })

  // template 内含换行缩进与根级自闭合 div；content 与 loc 必须覆盖完整内层文本，不能把自闭合子标签当块结束。
  test('should parse correct range for root level self closing tag', () => {
    const content = `\n  <div/>\n`
    const { descriptor } = parse(`<template>${content}</template>`)
    expect(descriptor.template).toBeTruthy()
    expect(descriptor.template!.content).toBe(content)
    expect(descriptor.template!.loc).toMatchObject({
      start: { line: 1, column: 11, offset: 10 },
      end: {
        line: 3,
        column: 1,
        offset: 10 + content.length,
      },
    })
  })

  // 自闭合 template 无内容；保留模板块，起止位置同为标签后的空范围。
  test('should parse correct range for blocks with no content (self closing)', () => {
    const { descriptor } = parse(`<template/>`)
    expect(descriptor.template).toBeTruthy()
    expect(descriptor.template!.content).toBeFalsy()
    expect(descriptor.template!.loc).toMatchObject({
      start: { line: 1, column: 12, offset: 11 },
      end: { line: 1, column: 12, offset: 11 },
    })
  })

  // 显式空 template 开闭标签；保留模板块，起止均定位在内容起点。
  test('should parse correct range for blocks with no content (explicit)', () => {
    const { descriptor } = parse(`<template></template>`)
    expect(descriptor.template).toBeTruthy()
    expect(descriptor.template!.content).toBeFalsy()
    expect(descriptor.template!.loc).toMatchObject({
      start: { line: 1, column: 11, offset: 10 },
      end: { line: 1, column: 11, offset: 10 },
    })
  })

  // 分别输入自闭合或仅空白的 script/style/custom；默认 ignoreEmpty 跳过这些非模板块。
  test('should ignore other nodes with no content', () => {
    expect(parse(`<script/>`).descriptor.script).toBe(null)
    expect(parse(`<script> \n\t  </script>`).descriptor.script).toBe(null)
    expect(parse(`<style/>`).descriptor.styles.length).toBe(0)
    expect(parse(`<style> \n\t </style>`).descriptor.styles.length).toBe(0)
    expect(parse(`<custom/>`).descriptor.customBlocks.length).toBe(0)
    expect(
      parse(`<custom> \n\t </custom>`).descriptor.customBlocks.length,
    ).toBe(0)
  })

  // 空 script 带 src=com；外部资源入口不能因内容为空被忽略，attrs/src 和脚本块保留。
  test('handle empty nodes with src attribute', () => {
    const { descriptor } = parse(`<script src="com"/>`)
    expect(descriptor.script).toBeTruthy()
    expect(descriptor.script!.content).toBeFalsy()
    expect(descriptor.script!.attrs['src']).toBe('com')
  })

  // template 带外部 src；本地没有真实模板内容，因此 descriptor 不附初始模板 AST。
  test('should not expose ast on template node if has src import', () => {
    const { descriptor } = parse(`<template src="./foo.html"/>`)
    expect(descriptor.template!.ast).toBeUndefined()
  })

  // ignoreEmpty:false 同时解析空普通 script 与仅换行 setup；两个块均保留，并核对各自精确 loc。
  test('ignoreEmpty: false', () => {
    const { descriptor } = parse(
      `<script></script>\n<script setup>\n</script>`,
      {
        ignoreEmpty: false,
      },
    )
    expect(descriptor.script).toBeTruthy()
    expect(descriptor.script!.loc).toMatchObject({
      start: { line: 1, column: 9, offset: 8 },
      end: { line: 1, column: 9, offset: 8 },
    })

    expect(descriptor.scriptSetup).toBeTruthy()
    expect(descriptor.scriptSetup!.loc).toMatchObject({
      start: { line: 2, column: 15, offset: 32 },
      end: { line: 3, column: 1, offset: 33 },
    })
  })

  // 外层 template 含 v-if template 与多层 div；切块应保留完整嵌套内容，内部 template 不成为额外 SFC block。
  test('nested templates', () => {
    const content = `
    <template v-if="ok">ok</template>
    <div><div></div></div>
    `
    const { descriptor } = parse(`<template>${content}</template>`)
    expect(descriptor.template!.content).toBe(content)
  })

  // template 的 lang 是空字符串；按 HTML 解析并保留嵌套模板，不产生预处理语言切块错误。
  test('treat empty lang attribute as the html', () => {
    const content = `<div><template v-if="ok">ok</template></div>`
    const { descriptor, errors } = parse(
      `<template lang="">${content}</template>`,
    )
    expect(descriptor.template!.content).toBe(content)
    expect(errors.length).toBe(0)
  })

  // #1120：声明 Pug 等预处理语言的 template 内容要按纯文本切块，内部 `<` 不能交给 HTML parser。
  // Pug 内容包含比较运算小于号和 HTML 文本；作为单一原始文本节点保存，内部尖括号不交给 HTML tokenizer。
  test('template with preprocessor lang should be treated as plain text', () => {
    const content = `p(v-if="1 < 2") test <div/>`
    const { descriptor, errors } = parse(
      `<template lang="pug">` + content + `</template>`,
    )
    expect(errors.length).toBe(0)
    expect(descriptor.template!.content).toBe(content)
    // Pug 内容以一个原始文本节点保存，其中的 `<` 不触发 HTML 标签解析。
    expect(descriptor.template!.ast!.children.length).toBe(1)
  })

  // #2566：只有 SFC 顶层 template/script/style 的 lang 会切换原始文本；普通 div 的 lang 不会。
  // Pug template 内出现带 lang 的 div 文本；顶层预处理块仍完整读取，非 SFC 顶层元素属性不会另行切块。
  test('div lang should not be treated as plain text', () => {
    const { errors } = parse(`
    <template lang="pug">
      <div lang="">
        <div></div>
      </div>
    </template>
    `)
    expect(errors.length).toBe(0)
  })

  // 分别解析无样式、普通样式及两种 scoped slotted 写法；只有 scoped 原文命中 :slotted/::v-slotted 时 descriptor.slotted 为 true。
  test('slotted detection', async () => {
    expect(parse(`<template>hi</template>`).descriptor.slotted).toBe(false)
    expect(
      parse(`<template>hi</template><style>h1{color:red;}</style>`).descriptor
        .slotted,
    ).toBe(false)
    expect(
      parse(
        `<template>hi</template><style scoped>:slotted(h1){color:red;}</style>`,
      ).descriptor.slotted,
    ).toBe(true)
    expect(
      parse(
        `<template>hi</template><style scoped>::v-slotted(h1){color:red;}</style>`,
      ).descriptor.slotted,
    ).toBe(true)
  })

  // 输入缺少闭合标签的 template；parser 通过 errors 返回一条结构诊断，调用本身不抛出。
  test('error tolerance', () => {
    const { errors } = parse(`<template>`)
    expect(errors.length).toBe(1)
  })

  // 默认 compiler 解析无闭合 input 的 HTML template；DOM void-tag 规则使其合法。
  test('should parse as DOM by default', () => {
    const { errors } = parse(`<template><input></template>`)
    expect(errors.length).toBe(0)
  })

  // 自定义 parser 先经 onError 报 foo 再返回空 root；结果同时收集 foo 与缺少模板/脚本入口的结构错误。
  test('custom compiler', () => {
    const { errors } = parse(`<template><input></template>`, {
      compiler: {
        parse: (_, options) => {
          options.onError!(new Error('foo') as any)
          return createRoot([])
        },
        compile: baseCompile,
      },
    })
    expect(errors.length).toBe(2)
    // 自定义 parser 经 onError 上报 foo，parse 将它收进 errors。
    expect(errors[0].message).toBe('foo')
    // 覆盖根据自定义 parse 返回 root 生成的结构错误。
    expect(errors[1].message).toMatch('At least one')
  })

  // 自定义 foo block 含 <-& 等非 HTML 文本；原始内容保留且无模板语法错误。
  test('treat custom blocks as raw text', () => {
    const { errors, descriptor } = parse(
      `<template><input></template><foo> <-& </foo>`,
    )
    expect(errors.length).toBe(0)
    expect(descriptor.customBlocks[0].content).toBe(` <-& `)
  })

  // 相同 hello 标签分别传相反的 isCustomElement 函数；两次解析产生 ELEMENT/COMPONENT，选项进入缓存键以避免复用不兼容 AST。
  test('should accept parser options', () => {
    const { errors, descriptor } = parse(`<template><hello/></template>`, {
      templateParseOptions: {
        isCustomElement: t => t === 'hello',
      },
    })
    expect(errors.length).toBe(0)
    expect(descriptor.template!.ast!.children[0]).toMatchObject({
      type: NodeTypes.ELEMENT,
      tag: 'hello',
      tagType: ElementTypes.ELEMENT,
    })

    // 相同源码但解析选项不同，必须使缓存失效，不能复用不兼容的描述符。
    const { descriptor: d2 } = parse(`<template><hello/></template>`, {
      templateParseOptions: {
        isCustomElement: t => t !== 'hello',
      },
    })
    expect(d2.template!.ast!.children[0]).toMatchObject({
      type: NodeTypes.ELEMENT,
      tag: 'hello',
      tagType: ElementTypes.COMPONENT,
    })
  })

  // 结构诊断分组：重复 block、无入口和 functional 用法作为 errors 返回。
  describe('warnings', () => {
    /** 断言错误数组中至少有一条消息匹配目标诊断片段。 */
    function assertWarning(errors: Error[], msg: string) {
      expect(errors.some(e => e.message.match(msg))).toBe(true)
    }

    // SFC 中连续两个 template；错误数组报告单模板限制，结构诊断由 parse 返回。
    test('should only allow single template element', () => {
      assertWarning(
        parse(`<template><div/></template><template><div/></template>`).errors,
        `Single file component can contain only one <template> element`,
      )
    })

    // 连续两个普通 script；错误数组报告单普通脚本限制。
    test('should only allow single script element', () => {
      assertWarning(
        parse(`<script>console.log(1)</script><script>console.log(1)</script>`)
          .errors,
        `Single file component can contain only one <script> element`,
      )
    })

    // 连续两个 script setup；错误数组报告单 setup 限制。
    test('should only allow single script setup element', () => {
      assertWarning(
        parse(
          `<script setup>console.log(1)</script><script setup>console.log(1)</script>`,
        ).errors,
        `Single file component can contain only one <script setup> element`,
      )
    })

    // 同一 SFC 同时含普通 script 与 script setup；它们是两个独立槽位，不产生重复块错误。
    test('should not warn script & script setup', () => {
      expect(
        parse(
          `<script setup>console.log(1)</script><script>console.log(1)</script>`,
        ).errors.length,
      ).toBe(0)
    })

    // # 6676
    // 输入只有裸 JS 文本；没有 template/script 入口，errors 返回至少需要一个入口的诊断。
    test('should throw error if no <template> or <script> is present', () => {
      assertWarning(
        parse(`import { ref } from 'vue'`).errors,
        `At least one <template> or <script> is required in a single file component`,
      )
    })

    // template 带 functional 属性；errors 返回 Vue 3 不再支持该用法的迁移诊断。
    test('should throw error if template functional is given', () => {
      assertWarning(
        parse(`<template functional></template>`).errors,
        `<template functional> is no longer supported in Vue 3, since ` +
          `functional components no longer have significant performance ` +
          `difference from stateful ones. Just use a normal <template> ` +
          `instead.`,
      )
    })
  })
})
