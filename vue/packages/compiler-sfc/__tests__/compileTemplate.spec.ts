/**
 * SFC 模板编译场景：组合资产 URL、预处理器、scoped/slotted、SSR、source map、缓存 AST 与
 * 自定义 compiler，验证错误位置能从预处理/局部 template 正确映射回 `.vue` 文件。
 */
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js'
import { parse as babelParse } from '@babel/parser'
import {
  type SFCTemplateCompileOptions,
  compileTemplate,
} from '../src/compileTemplate'
import { type SFCTemplateBlock, parse } from '../src/parse'
import { compileScript } from '../src'
import { getPositionInCode } from './utils'

/** 为 template 单测补固定空 id，再调用公开 compileTemplate。 */
function compile(opts: Omit<SFCTemplateCompileOptions, 'id'>) {
  return compileTemplate({
    ...opts,
    id: '',
  })
}

test('should work', () => {
  const source = `<div><p>{{ render }}</p></div>`

  const result = compile({ filename: 'example.vue', source })

  expect(result.errors.length).toBe(0)
  expect(result.source).toBe(source)
  // 编译结果必须暴露 render 函数，供 SFC 运行时代码挂载。
  expect(result.code).toMatch(`export function render(`)
})

// #6807：style 注释出现在模板附近时，SFC/template tokenizer 不能把其内容误当模板语法。
test('should work with style comment', () => {
  const source = `
  <div style="
    /* nothing */
    width: 300px;
    height: 100px/* nothing */
    ">{{ render }}</div>
  `

  const result = compile({ filename: 'example.vue', source })
  expect(result.errors.length).toBe(0)
  expect(result.source).toBe(source)
  expect(result.code).toMatch(`{"width":"300px","height":"100px"}`)
})

test('preprocess pug', () => {
  const template = parse(
    `
<template lang="pug">
body
  h1 Pug Examples
  div.container
    p Cool Pug example!
</template>
`,
    { filename: 'example.vue', sourceMap: true },
  ).descriptor.template as SFCTemplateBlock

  const result = compile({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang,
  })

  expect(result.errors.length).toBe(0)
})

test('preprocess pug with indents and blank lines', () => {
  const template = parse(
    `
<template lang="pug">
  body
    h1 The next line contains four spaces.

    div.container
      p The next line is empty.
    p This is the last line.
</template>
`,
    { filename: 'example.vue', sourceMap: true },
  ).descriptor.template as SFCTemplateBlock

  const result = compile({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang,
  })

  expect(result.errors.length).toBe(0)
  expect(result.source).toBe(
    '<body><h1>The next line contains four spaces.</h1><div class="container"><p>The next line is empty.</p></div><p>This is the last line.</p></body>',
  )
})

test('warn missing preprocessor', () => {
  const template = parse(`<template lang="unknownLang">hi</template>\n`, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template as SFCTemplateBlock

  const result = compile({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang,
  })

  expect(result.errors.length).toBe(1)
})

test('transform asset url options', () => {
  const input = { source: `<foo bar="~baz"/>`, filename: 'example.vue' }
  // 对象形式：仅指定的标签会按自定义元素处理。
  const { code: code1 } = compile({
    ...input,
    transformAssetUrls: {
      tags: { foo: ['bar'] },
    },
  })
  expect(code1).toMatch(`import _imports_0 from 'baz'\n`)

  // 兼容旧对象形式：直接把标签配置放在选项对象中。
  const { code: code2 } = compile({
    ...input,
    transformAssetUrls: {
      foo: ['bar'],
    },
  })
  expect(code2).toMatch(`import _imports_0 from 'baz'\n`)

  // false 表示显式关闭自定义元素识别。
  const { code: code3 } = compile({
    ...input,
    transformAssetUrls: false,
  })
  expect(code3).not.toMatch(`import _imports_0 from 'baz'\n`)
})

test('source map', () => {
  const template = parse(
    `
<template>
  <div><p>{{ foobar }}</p></div>
</template>
`,
    { filename: 'example.vue', sourceMap: true },
  ).descriptor.template!

  const { code, map } = compile({
    filename: 'example.vue',
    source: template.content,
  })

  expect(map!.sources).toEqual([`example.vue`])
  expect(map!.sourcesContent).toEqual([template.content])

  const consumer = new SourceMapConsumer(map as RawSourceMap)
  expect(
    consumer.originalPositionFor(getPositionInCode(code, 'foobar')),
  ).toMatchObject(getPositionInCode(template.content, `foobar`))
})

test('source map: v-if generated comment should not have original position', () => {
  const template = parse(
    `
      <template>
        <div v-if="true"></div>
      </template>
    `,
    { filename: 'example.vue', sourceMap: true },
  ).descriptor.template!

  const { code, map } = compile({
    filename: 'example.vue',
    source: template.content,
  })

  expect(map!.sources).toEqual([`example.vue`])
  expect(map!.sourcesContent).toEqual([template.content])

  const consumer = new SourceMapConsumer(map as RawSourceMap)
  const commentNode = code.match(/_createCommentVNode\("v-if", true\)/)
  expect(commentNode).not.toBeNull()
  const commentPosition = getPositionInCode(code, commentNode![0])
  const originalPosition = consumer.originalPositionFor(commentPosition)
  // 自动生成的注释节点不属于原模板，因此 source map 不应把它映射回源码。
  expect(originalPosition.column).toBeNull()
  expect(originalPosition.line).toBeNull()
  expect(originalPosition.source).toBeNull()
})

test('should work w/ AST from descriptor', () => {
  const source = `
  <template>
    <div><p>{{ foobar }}</p></div>
  </template>
  `
  const template = parse(source, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template!

  expect(template.ast!.source).toBe(source)

  const { code, map } = compile({
    filename: 'example.vue',
    source: template.content,
    ast: template.ast,
  })

  expect(map!.sources).toEqual([`example.vue`])
  // 复用 SFC 解析阶段的 AST 编译模板时，节点位置信息仍基于整个 SFC，
  // 因而 source map 必须正确扣除 template 块在文件中的偏移。
  expect(map!.sourcesContent).toEqual([source])

  const consumer = new SourceMapConsumer(map as RawSourceMap)
  expect(
    consumer.originalPositionFor(getPositionInCode(code, 'foobar')),
  ).toMatchObject(getPositionInCode(source, `foobar`))

  expect(code).toBe(
    compile({
      filename: 'example.vue',
      source: template.content,
    }).code,
  )
})

test('should work w/ AST from descriptor in SSR mode', () => {
  const source = `
  <template>
    <div><p>{{ foobar }}</p></div>
  </template>
  `
  const template = parse(source, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template!

  expect(template.ast!.source).toBe(source)

  const { code, map } = compile({
    filename: 'example.vue',
    source: '', // make sure it's actually using the AST instead of source
    ast: template.ast,
    ssr: true,
  })

  expect(map!.sources).toEqual([`example.vue`])
  // 复用 SFC 解析得到的 AST 时，source 指向完整 SFC；这里验证带预处理器时
  // 仍能把生成代码映射到 template 块中的正确位置。
  expect(map!.sourcesContent).toEqual([source])

  const consumer = new SourceMapConsumer(map as RawSourceMap)
  expect(
    consumer.originalPositionFor(getPositionInCode(code, 'foobar')),
  ).toMatchObject(getPositionInCode(source, `foobar`))

  expect(code).toBe(
    compile({
      filename: 'example.vue',
      source: template.content,
      ssr: true,
    }).code,
  )
})

test('should not reuse AST if using custom compiler', () => {
  const source = `
  <template>
    <div><p>{{ foobar }}</p></div>
  </template>
  `
  const template = parse(source, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template!

  const { code } = compile({
    filename: 'example.vue',
    source: template.content,
    ast: template.ast,
    compiler: {
      parse: () => null as any,
      // @ts-expect-error
      compile: input => ({ code: input }),
    },
  })

  // 真正需要验证的是：自定义编译器收到的 `input` 必须是模板源码字符串，
  // 不能把默认编译器可复用的 AST 直接传给它。
  expect(code).toBe(template.content)
})

test('should force re-parse on already transformed AST', () => {
  const source = `
  <template>
    <div><p>{{ foobar }}</p></div>
  </template>
  `
  const template = parse(source, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template!

  // 故意清空已解析 AST；若错误复用它，后续将无法生成正确代码。
  template.ast!.children = []
  template.ast!.transformed = true

  const { code } = compile({
    filename: 'example.vue',
    source: '',
    ast: template.ast,
  })

  expect(code).toBe(
    compile({
      filename: 'example.vue',
      source: template.content,
    }).code,
  )
})

test('should force re-parse with correct compiler in SSR mode', () => {
  const source = `
  <template>
    <div><p>{{ foobar }}</p></div>
  </template>
  `
  const template = parse(source, {
    filename: 'example.vue',
    sourceMap: true,
  }).descriptor.template!

  // 故意清空已解析 AST；若错误复用它，后续将无法生成正确代码。
  template.ast!.children = []
  template.ast!.transformed = true

  const { code } = compile({
    filename: 'example.vue',
    source: '',
    ast: template.ast,
    ssr: true,
  })

  expect(code).toBe(
    compile({
      filename: 'example.vue',
      source: template.content,
      ssr: true,
    }).code,
  )
})

test('template errors', () => {
  const result = compile({
    filename: 'example.vue',
    source: `<div
      :bar="a[" v-model="baz"/>`,
  })
  expect(result.errors).toMatchSnapshot()
})

test('preprocessor errors', () => {
  const template = parse(
    `
<template lang="pug">
  div(class='class)
</template>
`,
    { filename: 'example.vue', sourceMap: true },
  ).descriptor.template as SFCTemplateBlock

  const result = compile({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang,
  })

  expect(result.errors.length).toBe(1)
  const message = result.errors[0].toString()
  expect(message).toMatch(`Error: example.vue:3:1`)
  expect(message).toMatch(
    `The end of the string reached with no closing bracket ) found.`,
  )
})

// #3447：同一资产被多个属性引用时，生成的 import 表达式应去重且索引稳定。
test('should generate the correct imports expression', () => {
  const { code } = compile({
    filename: 'example.vue',
    source: `
      <img src="./foo.svg"/>
      <Comp>
        <img src="./bar.svg"/>
      </Comp>
    `,
    ssr: true,
  })
  expect(code).toMatch(`_ssrRenderAttr(\"src\", _imports_1)`)
  expect(code).toMatch(`_createVNode(\"img\", { src: _imports_1 })`)
})

// #3874：SSR 模式不能把 srcset URL 静态提升为客户端资产表达式，否则服务端导入形状错误。
test('should not hoist srcset URLs in SSR mode', () => {
  const { code } = compile({
    filename: 'example.vue',
    source: `
    <picture>
      <source srcset="./img/foo.svg"/>
      <img src="./img/foo.svg"/>
    </picture>
    <router-link>
      <picture>
        <source srcset="./img/bar.svg"/>
        <img src="./img/bar.svg"/>
      </picture>
    </router-link>
    `,
    ssr: true,
  })
  expect(code).toMatchSnapshot()
})

// #6742：静态与动态事件名同时存在时必须通过 mergeProps 合并，不能让后一项覆盖前一项。
test('dynamic v-on + static v-on should merged', () => {
  const source = `<input @blur="onBlur" @[validateEvent]="onValidateEvent">`

  const result = compile({ filename: 'example.vue', source })

  expect(result.code).toMatchSnapshot()
})

// #9853：Nuxt 测试发现的回归。#9729 的模板 import 使用检查会先调用 walkIdentifiers，
// 随后 compileTemplate 复用同一 AST 再遍历；局部作用域元数据必须可重复进入/退出，
// 否则函数参数 `t` 会在第二次遍历中被误加 `_ctx.`。复现条件：TS script setup、存在 import、
// 非 inlineTemplate，并复用 parse 阶段缓存的 AST。
test('prefixing edge case for reused AST', () => {
  const src = `
  <script setup lang="ts">
    import { Foo } from './foo'
  </script>
  <template>
    {{ list.map((t, index) => ({ t: t })) }}
  </template>
  `
  const { descriptor } = parse(src)
  // compileScript 先触发 importUsageCheck，刻意让同一 AST 经历第一次标识符遍历。
  compileScript(descriptor, { id: 'xxx' })
  const { code } = compileTemplate({
    id: 'xxx',
    filename: 'test.vue',
    ast: descriptor.template!.ast,
    source: descriptor.template!.content,
  })
  expect(code).not.toMatch(`_ctx.t`)
})

test('prefixing edge case for reused AST ssr mode', () => {
  const src = `
  <script setup lang="ts">
    import { Foo } from './foo'
  </script>
  <template>
    <Bar>
      <template #option="{ foo }"></template>
    </Bar>
  </template>
  `
  const { descriptor } = parse(src)
  // compileScript 会触发模板导入使用情况检查，这里验证两条编译链可以协同工作。
  compileScript(descriptor, { id: 'xxx' })
  expect(() =>
    compileTemplate({
      id: 'xxx',
      filename: 'test.vue',
      ast: descriptor.template!.ast,
      source: descriptor.template!.content,
      ssr: true,
    }),
  ).not.toThrowError()
})

// #10852：兼容 filter 语法左侧可以是非标识符表达式，重写时不能假设存在简单名称。
test('non-identifier expression in legacy filter syntax', () => {
  const src = `
  <template>
    <div>
      Today is
      {{ new Date() | formatDate }}
    </div>
  </template>
  `

  const { descriptor } = parse(src)
  const compilationResult = compileTemplate({
    id: 'xxx',
    filename: 'test.vue',
    ast: descriptor.template!.ast,
    source: descriptor.template!.content,
    ssr: false,
    compilerOptions: {
      compatConfig: {
        MODE: 2,
      },
    },
  })

  expect(() => {
    babelParse(compilationResult.code, { sourceType: 'module' })
  }).not.toThrow()
})

test('prefixing props edge case in inline mode', () => {
  const src = `
  <script setup lang="ts">
    defineProps<{ Foo: { Bar: unknown } }>()
  </script>
  <template>
    <Foo.Bar/>
  </template>
  `
  const { descriptor } = parse(src)
  const { content } = compileScript(descriptor, {
    id: 'xxx',
    inlineTemplate: true,
  })

  expect(content).toMatchSnapshot()
  expect(content).toMatch(`__props["Foo"]).Bar`)
})
