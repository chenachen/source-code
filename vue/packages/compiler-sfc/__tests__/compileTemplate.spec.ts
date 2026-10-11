/**
 * SFC 模板编译场景：覆盖资产配置、Pug 预处理及诊断、SSR、source map、descriptor AST
 * 复用与自定义 compiler；字符串模板和 descriptor AST 分别使用各自的源码坐标。
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

// 编译含 render 插值的普通 DOM 模板；errors 为空、source 保持原值，生成可挂载的导出 render 函数。
test('should work', () => {
  const source = `<div><p>{{ render }}</p></div>`

  const result = compile({ filename: 'example.vue', source })

  expect(result.errors.length).toBe(0)
  expect(result.source).toBe(source)
  // 编译结果必须暴露 render 函数，供 SFC 运行时代码挂载。
  expect(result.code).toMatch(`export function render(`)
})

// #6807：style 注释出现在模板附近时，SFC/template tokenizer 不能把其内容误当模板语法。
// style 属性含块注释与行内注释；静态样式解析忽略注释并输出 width/height 对象，无模板错误。
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

// 从 Pug SFC 取出内容与 lang 后编译；预处理为 HTML 并正常通过模板编译。
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

// Pug 内容含公共缩进、空行及不同嵌套层级；去缩进后 HTML 层级与 result.source 精确符合预期。
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

// template 使用不存在的 unknownLang 预处理器；compileTemplate 返回一条 errors，不将缺包继续当 HTML 编译。
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

// 同一 foo.bar 资产分别使用 tags 包装、旧映射对象与 false；前两种生成 baz import，关闭选项不生成资源导入。
test('transform asset url options', () => {
  const input = { source: `<foo bar="~baz"/>`, filename: 'example.vue' }
  // 对象配置把 foo.bar 加入资产 URL 转换，生成 baz import。
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

  // false 关闭资产 URL 转换，foo.bar 不再生成 baz import。
  const { code: code3 } = compile({
    ...input,
    transformAssetUrls: false,
  })
  expect(code3).not.toMatch(`import _imports_0 from 'baz'\n`)
})

// 独立模板字符串含 foobar；map 保存块内容并把生成 foobar 位置回指同一模板的行列。
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

// v-if 的备用分支生成注释 vnode；该合成节点没有原模板位置，source map 查询的行/列/source 均为空。
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

// parse 的初始 descriptor AST 与字符串模板分别编译；代码相同，复用 AST 的 map 指向完整 SFC 而非仅块内容。
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
  // 复用 descriptor AST 后，map 保留完整 SFC 的 source 与节点坐标。
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

// SSR 编译传空 source 和 descriptor AST；仍生成与字符串输入相同的代码，foobar map 使用完整 SFC，证明实际消费 AST。
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
    source: '', // 空字符串迫使此用例实际消费 AST。
    ast: template.ast,
    ssr: true,
  })

  expect(map!.sources).toEqual([`example.vue`])
  // SSR 编译复用 descriptor AST，映射仍指向完整 SFC 中的 foobar。
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

// 传 descriptor AST 及回传 input 的自定义 compiler；自定义入口收到模板字符串，不复用默认 compiler 的 AST。
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

// 清空 AST children 并标 transformed；compileTemplate 从 ast.source 重解析，输出恢复为正常字符串编译结果。
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

// SSR 模式清空已转换 AST；使用 SSR compiler 重解析原 source，不能复用损坏的客户端转换状态。
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

// 模板含残缺 a[ 表达式与 v-model；errors 快照记录表达式编译诊断及其位置。
test('template errors', () => {
  const result = compile({
    filename: 'example.vue',
    source: `<div
      :bar="a[" v-model="baz"/>`,
  })
  expect(result.errors).toMatchSnapshot()
})

// Pug 属性字符串未闭合；预处理异常进入 errors，消息带 example.vue 的行号和具体缺括号原因。
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
// SSR 模板内两张不同资产，其中 bar 在组件插槽；同一 bar import 索引供 SSR 与 vnode 分支共享，防止索引错配。
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
// SSR picture/source srcset 与 img 引用资产，另有 router-link 插槽；快照核对服务端资源表达式和客户端备用分支，不做错误的 srcset 静态提升。
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
// input 同时含静态 blur 与动态事件名；快照检查事件对象合并，动态属性不会覆盖另一组监听。
test('dynamic v-on + static v-on should merged', () => {
  const source = `<input @blur="onBlur" @[validateEvent]="onValidateEvent">`

  const result = compile({ filename: 'example.vue', source })

  expect(result.code).toMatchSnapshot()
})

// #9853：Nuxt 测试发现的回归。#9729 的模板 import 使用检查会先调用 walkIdentifiers，
// 随后 compileTemplate 复用同一 AST 再遍历；局部作用域元数据必须可重复进入/退出，
// 否则函数参数 `t` 会在第二次遍历中被误加 `_ctx.`。复现条件：TS script setup、存在 import、
// 非 inlineTemplate，并复用 parse 阶段缓存的 AST。
// TS setup 的 import 使用分析先遍历 AST，再编译含 map 回调的模板；参数 t 仍是局部，不被重复遍历加 _ctx 前缀。
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

// TS setup 先做 import 分析，再 SSR 编译含解构 slot 参数的 AST；重复进入/退出作用域不应导致异常。
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
// 兼容模式模板用 new Date() 作为 filter 左侧；转换结果经 Babel 解析应合法，filter 重写不要求简单 Identifier。
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

// 内联模板把类型式 prop Foo 用作 Foo.Bar 组件；组件根访问由 __props 读取，保留成员 Bar 并核对快照。
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
