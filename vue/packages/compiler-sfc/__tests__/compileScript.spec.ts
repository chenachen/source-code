/**
 * SFC 脚本主流程场景：覆盖普通 script 与 script setup 合并、导入/导出、绑定分类、TS、
 * top-level await、内联模板、source map 和生成组件选项；issue 用例验证宏与复杂语法组合。
 */
import { vi } from 'vitest'
import { BindingTypes } from '@vue/compiler-core'
import {
  assertCode,
  compileSFCScript as compile,
  getPositionInCode,
  mockId,
} from './utils'
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js'
import { compileScript, compileTemplate, parse } from '../src'
import { templateAnalysisCache } from '../src/script/importUsageCheck'

vi.mock('../src/warn', () => ({
  warn: vi.fn(),
  warnOnce: vi.fn(),
}))

import { warnOnce } from '../src/warn'

/** 类型化后的 warnOnce mock，用于断言单次迁移警告且不污染测试输出。 */
const warnOnceMock = vi.mocked(warnOnce)

describe('SFC compile <script setup>', () => {
  // 显式 lang=js 的 setup 声明 a/b；生成返回对象暴露两项，输出经 Babel 与快照校验。
  test('should compile JS syntax', () => {
    const { content } = compile(`
      <script setup lang='js'>
      const a = 1
      const b = 2
      </script>
    `)
    expect(content).toMatch(`return { a, b }`)
    assertCode(content)
  })

  // 普通 script 与 setup 均有 import、let、const、函数和类；返回可变绑定 getter/setter及导入 getter，并逐项核对绑定类别。
  test('should expose top level declarations', () => {
    const { content, bindings } = compile(`
      <script setup>
      import { x } from './x'
      let a = 1
      const b = 2
      function c() {}
      class d {}
      </script>

      <script>
      import { xx } from './x'
      let aa = 1
      const bb = 2
      function cc() {}
      class dd {}
      </script>
      `)
    expect(content).toMatch(
      `return { get aa() { return aa }, set aa(v) { aa = v }, ` +
        `bb, cc, dd, get a() { return a }, set a(v) { a = v }, b, c, d, ` +
        `get xx() { return xx }, get x() { return x } }`,
    )
    expect(bindings).toStrictEqual({
      x: BindingTypes.SETUP_MAYBE_REF,
      a: BindingTypes.SETUP_LET,
      b: BindingTypes.SETUP_CONST,
      c: BindingTypes.SETUP_CONST,
      d: BindingTypes.SETUP_CONST,
      xx: BindingTypes.SETUP_MAYBE_REF,
      aa: BindingTypes.SETUP_LET,
      bb: BindingTypes.LITERAL_CONST,
      cc: BindingTypes.SETUP_CONST,
      dd: BindingTypes.SETUP_CONST,
    })
    assertCode(content)
  })

  // 常量对象解构含别名、动态键与多层 pattern；递归登记实际局部 foo/bar/baz/y/z 为 MAYBE_REF 并返回，属性名不作局部绑定。
  test('binding analysis for destructure', () => {
    const { content, bindings } = compile(`
      <script setup>
      const { foo, b: bar, ['x' + 'y']: baz, x: { y, zz: { z }}} = {}
      </script>
      `)
    expect(content).toMatch('return { foo, bar, baz, y, z }')
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_MAYBE_REF,
      bar: BindingTypes.SETUP_MAYBE_REF,
      baz: BindingTypes.SETUP_MAYBE_REF,
      y: BindingTypes.SETUP_MAYBE_REF,
      z: BindingTypes.SETUP_MAYBE_REF,
    })
    assertCode(content)
  })

  // 非内联模板以 v-model 写 const reactive name；分析模板后降级为 let/SETUP_LET，发一条迁移警告并核对输出。
  test('demote const reactive binding to let when used in v-model', () => {
    warnOnceMock.mockClear()
    const { content, bindings } = compile(`
      <script setup>
      import { reactive } from 'vue'
      const name = reactive({ first: 'john', last: 'doe' })
      </script>

      <template>
        <MyComponent v-model="name" />
      </template>
    `)

    expect(content).toMatch(
      `let name = reactive({ first: 'john', last: 'doe' })`,
    )
    expect(bindings!.name).toBe(BindingTypes.SETUP_LET)
    expect(warnOnceMock).toHaveBeenCalledTimes(1)
    expect(warnOnceMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '`v-model` cannot update a `const` reactive binding',
      ),
    )
    assertCode(content)
  })

  // 内联模板同样写 const reactive name；降级先于模板生成，得到可赋值绑定和一次警告。
  test('demote const reactive binding to let when used in v-model (inlineTemplate)', () => {
    warnOnceMock.mockClear()
    const { content, bindings } = compile(
      `
      <script setup>
      import { reactive } from 'vue'
      const name = reactive({ first: 'john', last: 'doe' })
      </script>

      <template>
        <MyComponent v-model="name" />
      </template>
      `,
      { inlineTemplate: true },
    )

    expect(content).toMatch(
      `let name = reactive({ first: 'john', last: 'doe' })`,
    )
    expect(bindings!.name).toBe(BindingTypes.SETUP_LET)
    expect(warnOnceMock).toHaveBeenCalledTimes(1)
    expect(warnOnceMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '`v-model` cannot update a `const` reactive binding',
      ),
    )
    assertCode(content)
  })

  // 内联 input v-model 指向字面量 const foo；不可更新的常量绑定被模板转换器拒绝。
  test('v-model should error on literal const bindings', () => {
    expect(() =>
      compile(
        `
        <script setup>
        const foo = 1
        </script>
        <template>
          <input v-model="foo" />
        </template>
        `,
        { inlineTemplate: true },
      ),
    ).toThrow('v-model cannot be used on a const binding')
  })

  // 双 script 合并：验证默认导出、import、类型、lang 与 setup 签名能安全合并。
  describe('<script> and <script setup> co-usage', () => {
    // 普通 script 在前，包含具名与默认导出，setup 在后调用 import；合并输出通过语法和快照检查。
    test('script first', () => {
      const { content } = compile(`
      <script>
      export const n = 1

      export default {}
      </script>
      <script setup>
      import { x } from './x'
      x()
      </script>
      `)
      assertCode(content)
    })

    // setup 在前而普通 script 在后；移动 import 与普通模块声明后仍生成合法组件。
    test('script setup first', () => {
      const { content } = compile(`
      <script setup>
      import { x } from './x'
      x()
      </script>
      <script>
      export const n = 1
      export default {}
      </script>
      `)
      assertCode(content)
    })

    // #7805：合并两个 script 时保持用户原有有/无分号风格，避免 MagicString 插入造成 ASI 变化。
    // setup 混合无分号语句、带分号宏赋值与 IIFE；宏改写保留原分号风格，避免后续括号语句被 ASI 粘连。
    test('keep original semi style', () => {
      const { content } = compile(`
        <script setup>
        console.log('test')
        const props = defineProps(['item']);
        const emit = defineEmits(['change']);
        (function () {})()
        </script>
      `)
      assertCode(content)

      expect(content).toMatch(`console.log('test')`)
      expect(content).toMatch(`const props = __props;`)
      expect(content).toMatch(`const emit = __emit;`)
      expect(content).toMatch(`(function () {})()`)
    })

    // setup 在前，普通 script 用 def as default；从具名导出提取默认值并合并 setup，输出可解析。
    test('script setup first, named default export', () => {
      const { content } = compile(`
      <script setup>
      import { x } from './x'
      x()
      </script>
      <script>
      export const n = 1
      const def = {}
      export { def as default }
      </script>
      `)
      assertCode(content)
    })

    // #4395：script setup 位于普通 script 前且同为 TS 时，默认导出重写和 import 合并仍应正确。
    // 两个 TS 脚本且 setup 在前；生成 __default__ 必须先于对象 spread 使用，避免暂时性死区。
    test('script setup first, lang="ts", script block content export default', () => {
      const { content } = compile(`
      <script setup lang="ts">
      import { x } from './x'
      x()
      </script>
      <script lang="ts">
      export default {
        name: "test"
      }
      </script>
      `)
      // __default__ 必须先声明再被组件选项合并代码引用，避免暂时性死区错误。
      expect(content).toMatch(/const __default__[\S\s]*\.\.\.__default__/m)
      assertCode(content)
    })

    // 默认导出周围空白/注释不应破坏 MagicString 的精确替换范围。
    describe('spaces in ExportDefaultDeclaration node', () => {
      // #4371：`export default` 与声明之间存在大量空白/换行时，重写范围仍必须精确。
      // 普通默认对象的 export/default 之间大量空白换行；AST 原始范围驱动替换，生成模块仍合法。
      test('with many spaces and newline', () => {
        // 复现输入刻意保留复杂空白，验证生成代码仍能通过语法解析。
        const { content } = compile(`
        <script>
        export const n = 1
        export        default
        {
          some:'option'
        }
        </script>
        <script setup>
        import { x } from './x'
        x()
        </script>
        `)
        assertCode(content)
      })

      // export default 后直接紧邻左花括号；无额外空白也能精确替换默认导出前缀。
      test('with minimal spaces', () => {
        const { content } = compile(`
        <script>
        export const n = 1
        export default{
          some:'option'
        }
        </script>
        <script setup>
        import { x } from './x'
        x()
        </script>
        `)
        assertCode(content)
      })
    })

    // 普通默认导出是 fn() 调用，setup 有执行语句；保留模块调用表达式并合并生成组件。
    test('export call expression as default', () => {
      const { content } = compile(`
      <script>
      function fn() {
        return "hello, world";
      }
      export default fn();
      </script>

      <script setup>
      console.log('foo')
      </script>
      `)
      assertCode(content)
    })
  })

  // import 分组：去重、冲突检测、类型导入、模板使用保留和运行时 helper 别名。
  describe('imports', () => {
    // setup 导入 Vue ref 与副作用 CSS；import 移到模块层，副作用导入保留，输出符合快照。
    test('should hoist and expose imports', () => {
      assertCode(
        compile(`<script setup>
          import { ref } from 'vue'
          import 'foo/css'
        </script>`).content,
      )
    })

    // import a 后附行注释，随后 import b；移动范围连同注释保留，不把注释误粘到其他语句。
    test('should extract comment for import or type declarations', () => {
      assertCode(
        compile(`
        <script setup>
        import a from 'a' // comment
        import b from 'b'
        </script>
        `).content,
      )
    })

    // #2740：导入、顶层宏调用和后续 ref 声明应能共同编译。
    // Vue import 后顶层调用 defineProps/defineEmits，再声明 ref；删除宏语句并正确生成两组选项和 ref 绑定。
    test('should allow defineProps/Emit at the start of imports', () => {
      assertCode(
        compile(`<script setup>
      import { ref } from 'vue'
      defineProps(['foo'])
      defineEmits(['bar'])
      const r = ref(0)
      </script>`).content,
      )
    })

    // 用户导入 useCssVars/ref，同时 CSS 注入需要同名 helper；生成独立 helper 别名，保留用户 import，避免符号冲突。
    test('dedupe between user & helper', () => {
      const { content } = compile(
        `
      <script setup>
      import { useCssVars, ref } from 'vue'
      const msg = ref()
      </script>

      <style>
      .foo {
        color: v-bind(msg)
      }
      </style>
      `,
      )
      assertCode(content)
      expect(content).toMatch(
        `import { useCssVars as _useCssVars, unref as _unref } from 'vue'`,
      )
      expect(content).toMatch(`import { useCssVars, ref } from 'vue'`)
    })

    // 自定义 [[ ]] 分隔符先分析 import、再转换 AST，清空分析缓存后重编 script；按原解析选项重建分析 AST，cachedMsg getter 仍返回。
    test('should re-analyze a transformed template after cache invalidation', () => {
      const delimiters: [string, string] = ['[[', ']]']
      const { descriptor } = parse(
        `
        <script setup lang="ts">
        import { cachedMsg } from './cachedMsg'
        </script>
        <template><p>[[ cachedMsg ]]</p></template>
        `,
        { templateParseOptions: { delimiters } },
      )

      const templateOptions = { compilerOptions: { delimiters } }
      compileScript(descriptor, { id: mockId, templateOptions })
      expect(templateAnalysisCache.has(descriptor.template!.content)).toBe(true)

      compileTemplate({
        filename: 'example.vue',
        id: mockId,
        source: descriptor.template!.content,
        ast: descriptor.template!.ast,
        compilerOptions: { delimiters },
      })
      expect(descriptor.template!.ast!.transformed).toBe(true)

      templateAnalysisCache.clear()
      expect(templateAnalysisCache.has(descriptor.template!.content)).toBe(
        false,
      )

      const { content } = compileScript(descriptor, {
        id: mockId,
        templateOptions,
      })
      expect(content).toMatch(`return { get cachedMsg() { return cachedMsg } }`)
    })

    // 普通 script/setup 导入完全相同 x；合并时只保留一条 import，setup 中 x 的使用仍有效。
    test('import dedupe between <script> and <script setup>', () => {
      const { content } = compile(`
        <script>
        import { x } from './x'
        </script>
        <script setup>
        import { x } from './x'
        x()
        </script>
        `)
      assertCode(content)
      expect(content.indexOf(`import { x }`)).toEqual(
        content.lastIndexOf(`import { x }`),
      )
    })

    // 从非 vue 模块导入同名 ref/reactive 不能套用 Vue API 的绑定类型推断。
    describe('import ref/reactive function from other place', () => {
      // 从普通模块导入名为 ref/reactive 的函数；不得按 Vue API 推断，调用结果和导入均归 MAYBE_REF。
      test('import directly', () => {
        const { bindings } = compile(`
        <script setup>
          import { ref, reactive } from './foo'

          const foo = ref(1)
          const bar = reactive(1)
        </script>
      `)
        expect(bindings).toStrictEqual({
          ref: BindingTypes.SETUP_MAYBE_REF,
          reactive: BindingTypes.SETUP_MAYBE_REF,
          foo: BindingTypes.SETUP_MAYBE_REF,
          bar: BindingTypes.SETUP_MAYBE_REF,
        })
      })

      // 普通模块 ref/reactive 使用导入别名，而初始化调用裸 ref/reactive；无法证明是 Vue API，结果仍是 MAYBE_REF。
      test('import w/ alias', () => {
        const { bindings } = compile(`
        <script setup>
          import { ref as _ref, reactive as _reactive } from './foo'

          const foo = ref(1)
          const bar = reactive(1)
        </script>
      `)
        expect(bindings).toStrictEqual({
          _reactive: BindingTypes.SETUP_MAYBE_REF,
          _ref: BindingTypes.SETUP_MAYBE_REF,
          foo: BindingTypes.SETUP_MAYBE_REF,
          bar: BindingTypes.SETUP_MAYBE_REF,
        })
      })

      // 先调用 x 再写 Vue reactive as x import；提前收集 import 别名，使调用结果识别为响应式常量。
      test('aliased usage before import site', () => {
        const { bindings } = compile(`
        <script setup>
          const bar = x(1)
          import { reactive as x } from 'vue'
        </script>
      `)
        expect(bindings).toStrictEqual({
          bar: BindingTypes.SETUP_REACTIVE_CONST,
          x: BindingTypes.SETUP_CONST,
        })
      })
    })

    // 两个脚本用字符串模块导出名 emoji 并绑定 foo；按原始导出名去重，foo 保持 MAYBE_REF，生成语法合法。
    test('should support module string names syntax', () => {
      const { content, bindings } = compile(`
      <script>
        import { "😏" as foo } from './foo'
      </script>
      <script setup>
        import { "😏" as foo } from './foo'
      </script>
    `)
      assertCode(content)
      expect(bindings).toStrictEqual({
        foo: BindingTypes.SETUP_MAYBE_REF,
      })
    })
  })

  // 内联模板：render 函数直接闭包 setup 绑定，验证模板选项、SSR 和 import 使用分析。
  describe('inlineTemplate mode', () => {
    // 内联模板同时读取 ref count 和静态节点；render 闭包直接由 setup 返回，helper/静态提升位置正确，未使用显式 expose 时不额外注入。
    test('should work', () => {
      const { content } = compile(
        `
        <script setup>
        import { ref } from 'vue'
        const count = ref(0)
        </script>
        <template>
          <div>{{ count }}</div>
          <div>static</div>
        </template>
        `,
        { inlineTemplate: true },
      )
      // 通过快照确认辅助函数导入和静态提升代码处在正确位置。
      assertCode(content)
      // 内联模板模式本就不会暴露 setup 返回值，无需额外调用 expose()。
      expect(content).not.toMatch(`expose()`)
    })

    // 内联模式脚本显式 expose count；保留 expose 上下文参数并改写显式调用，即使不生成返回对象。
    test('with defineExpose()', () => {
      const { content } = compile(
        `
        <script setup>
        const count = ref(0)
        defineExpose({ count })
        </script>
        `,
        { inlineTemplate: true },
      )
      assertCode(content)
      expect(content).toMatch(`setup(__props, { expose: __expose })`)
      expect(content).toMatch(`expose({ count })`)
    })

    // 导入两项 .vue 默认组件与自定义指令；内联标签直接读取稳定组件绑定，指令经 unref，kebab-case 标签映射到 PascalCase。
    test('referencing scope components and directives', () => {
      const { content } = compile(
        `
        <script setup>
        import ChildComp from './Child.vue'
        import SomeOtherComp from './Other.vue'
        import vMyDir from './my-dir'
        </script>
        <template>
          <div v-my-dir></div>
          <ChildComp/>
          <some-other-comp/>
        </template>
        `,
        { inlineTemplate: true },
      )
      expect(content).toMatch('[_unref(vMyDir)]')
      expect(content).toMatch('_createVNode(ChildComp)')
      // kebab-case 标签也应匹配到对应的 PascalCase 组件导入。
      expect(content).toMatch('_createVNode(SomeOtherComp)')
      assertCode(content)
    })

    // 内联模板混合 Vue ref、.vue 默认/具名导入、普通导入、namespace、对象、未知调用、let 与函数；分别核对直接访问、.value、unref 和稳定事件绑定。
    test('avoid unref() when necessary', () => {
      // 同时覆盖函数、常量与组件导入三种模板绑定。
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        import Foo, { bar } from './Foo.vue'
        import other from './util'
        import * as tree from './tree'
        const count = ref(0)
        const constant = {}
        const maybe = foo()
        let lett = 1
        function fn() {}
        </script>
        <template>
          <Foo>{{ bar }}</Foo>
          <div @click="fn">{{ count }} {{ constant }} {{ maybe }} {{ lett }} {{ other }}</div>
          {{ tree.foo() }}
        </template>
        `,
        { inlineTemplate: true },
      )
      // 从 `.vue` 默认导入的组件绑定可直接传给 createVNode，无需 unref。
      expect(content).toMatch(`createVNode(Foo,`)
      // #2699：`.vue` 的具名导入可能是 ref，模板使用时必须走 unref。
      expect(content).toMatch(`unref(bar)`)
      // 其他无法静态确定值类别的导入同样要安全 unref。
      expect(content).toMatch(`unref(other)`)
      // 常量字面量不可能是 ref，无需 unref。
      expect(content).not.toMatch(`unref(constant)`)
      // 已知为 ref 的绑定可直接读取 .value。
      expect(content).toMatch(`count.value`)
      // 可能为 ref 的 const 绑定需通过 unref() 读取。
      expect(content).toMatch(`unref(maybe)`)
      // let 绑定可能在 ref 与普通值之间变化，读取时需调用 unref()。
      expect(content).toMatch(`unref(lett)`)
      // 命名空间导入不是 ref，无需 unref；这样也不会破坏 tree-shaking。
      expect(content).toMatch(`tree.foo()`)
      // 函数声明不是 ref，无需 unref。
      expect(content).toMatch(`{ onClick: fn }`)
      // 常量函数引用稳定，不应因它生成动态 patch flag。
      expect(content).not.toMatch(`PROPS`)
      assertCode(content)
    })

    // input v-model 分别写已知 ref、MAYBE_REF const 与 let；生成 .value、isRef 后仅写 ref、isRef 双分支赋值。
    test('v-model codegen', () => {
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        const count = ref(0)
        const maybe = foo()
        let lett = 1
        </script>
        <template>
          <input v-model="count">
          <input v-model="maybe">
          <input v-model="lett">
        </template>
        `,
        { inlineTemplate: true },
      )
      // 已知为 const ref：写入 .value。
      expect(content).toMatch(`(count).value = $event`)
      // const 但可能是 ref：仅在确为 ref 时赋值，否则保持不变。
      expect(content).toMatch(`_isRef(maybe) ? (maybe).value = $event : null`)
      // let：同时处理 ref 与普通值两种情况。
      expect(content).toMatch(
        `_isRef(lett) ? (lett).value = $event : lett = $event`,
      )
      assertCode(content)
    })

    // v-model 表达式含前后换行，ref 未从 Vue 导入；按 MAYBE_REF 路径生成 isRef 保护，换行不破坏目标提取。
    test('v-model w/ newlines codegen', () => {
      const { content } = compile(
        `<script setup>
        const count = ref(0)
        </script>
        <template>
          <input v-model="
          count
          ">
        </template>
        `,
        { inlineTemplate: true },
      )
      expect(content).toMatch(`_isRef(count) ? (count).value = $event : null`)
      assertCode(content)
    })

    // data 返回 foo，setup 另有 ref；内联 v-model 写 data foo，不能误用 setup ref 的 isRef 赋值路径。
    test('v-model should not generate ref assignment code for non-setup bindings', () => {
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        const count = ref(0)
        </script>
        <script>
        export default {
          data() { return { foo: 123 } }
        }
        </script>
        <template>
          <input v-model="foo">
        </template>
        `,
        { inlineTemplate: true },
      )
      expect(content).not.toMatch(`_isRef(foo)`)
    })

    // 内联事件包含赋值、复合赋值和多层函数作用域；REF/MAYBE_REF 写 .value，LET 走 isRef 双分支，右值按局部可见性加前缀。
    test('template assignment expression codegen', () => {
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        const count = ref(0)
        const maybe = foo()
        let lett = 1
        let v = ref(1)
        </script>
        <template>
          <div @click="count = 1"/>
          <div @click="maybe = count"/>
          <div @click="lett = count"/>
          <div @click="v += 1"/>
          <div @click="v -= 1"/>
          <div @click="() => {
              let a = '' + lett
              v = a
           }"/>
           <div @click="() => {
              // nested scopes
              (()=>{
                let x = a
                (()=>{
                  let z = x
                  let z2 = z
                })
                let lz = z
              })
              v = a
           }"/>
        </template>
        `,
        { inlineTemplate: true },
      )
      // 已知为 const ref：写入 .value。
      expect(content).toMatch(`count.value = 1`)
      // maybe-ref 的普通赋值直接写 .value；此处不生成 isRef 分支。
      expect(content).toMatch(`maybe.value = count.value`)
      // let：同时处理 ref 与普通值两种情况。
      expect(content).toMatch(
        `_isRef(lett) ? lett.value = count.value : lett = count.value`,
      )
      expect(content).toMatch(`_isRef(v) ? v.value += 1 : v += 1`)
      expect(content).toMatch(`_isRef(v) ? v.value -= 1 : v -= 1`)
      expect(content).toMatch(`_isRef(v) ? v.value = a : v = a`)
      expect(content).toMatch(`_isRef(v) ? v.value = _ctx.a : v = _ctx.a`)
      assertCode(content)
    })

    // 内联事件前后缀更新分别作用于 REF、MAYBE_REF、LET；前两者更新 .value，let 保留 isRef 分支及更新形式。
    test('template update expression codegen', () => {
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        const count = ref(0)
        const maybe = foo()
        let lett = 1
        </script>
        <template>
          <div @click="count++"/>
          <div @click="--count"/>
          <div @click="maybe++"/>
          <div @click="--maybe"/>
          <div @click="lett++"/>
          <div @click="--lett"/>
        </template>
        `,
        { inlineTemplate: true },
      )
      // 已知为 const ref：写入 .value。
      expect(content).toMatch(`count.value++`)
      expect(content).toMatch(`--count.value`)
      // maybe-ref 的更新表达式直接作用于 .value；此处不生成条件分支。
      expect(content).toMatch(`maybe.value++`)
      expect(content).toMatch(`--maybe.value`)
      // let：同时处理 ref 与普通值两种情况。
      expect(content).toMatch(`_isRef(lett) ? lett.value++ : lett++`)
      expect(content).toMatch(`_isRef(lett) ? --lett.value : --lett`)
      assertCode(content)
    })

    // 对象/数组解构赋值分别写 REF、MAYBE_REF 与 LET；前两者目标改 .value，let 仍是普通绑定，没有 isRef 分支。
    test('template destructure assignment codegen', () => {
      const { content } = compile(
        `<script setup>
        import { ref } from 'vue'
        const val = {}
        const count = ref(0)
        const maybe = foo()
        let lett = 1
        </script>
        <template>
          <div @click="({ count } = val)"/>
          <div @click="[maybe] = val"/>
          <div @click="({ lett } = val)"/>
        </template>
        `,
        { inlineTemplate: true },
      )
      // 已知为 const ref：写入 .value。
      expect(content).toMatch(`({ count: count.value } = val)`)
      // maybe-ref 的解构赋值目标改为 .value；此处不生成 isRef 分支。
      expect(content).toMatch(`[maybe.value] = val`)
      // let 的解构赋值按普通可变绑定处理，不直接替换整个 ref。
      expect(content).toMatch(`{ lett: lett } = val`)
      assertCode(content)
    })

    // SSR 内联模板读取 ref 与多种 CSS 表达式；生成 ssrInlineRender/SSR 参数和服务端 CSS vars，跳过客户端 useCssVars。
    test('ssr codegen', () => {
      const { content } = compile(
        `
        <script setup>
        import { ref } from 'vue'
        const count = ref(0)
        const style = { color: 'red' }
        const height = ref(0)
        </script>
        <template>
          <div>{{ count }}</div>
          <div>static</div>
        </template>
        <style>
        div { color: v-bind(count) }
        span { color: v-bind(style.color) }
        span { color: v-bind(height + "px") }
        </style>
        `,
        {
          inlineTemplate: true,
          templateOptions: {
            ssr: true,
          },
        },
      )
      expect(content).toMatch(`\n  __ssrInlineRender: true,\n`)
      expect(content).toMatch(`return (_ctx, _push`)
      expect(content).toMatch(`ssrInterpolate`)
      expect(content).not.toMatch(`useCssVars`)
      expect(content).toMatch(`":--${mockId}-count": (count.value)`)
      expect(content).toMatch(`":--${mockId}-style\\\\.color": (style.color)`)
      expect(content).toMatch(
        `":--${mockId}-height\\\\ \\\\+\\\\ \\\\\\"px\\\\\\"": (height.value + "px")`,
      )
      assertCode(content)
    })

    // 非内联 TS 模板 v-for 的解构别名被括号包围；模板分析应解析成功，编译调用不抛错。
    test('the v-for wrapped in parentheses can be correctly parsed & inline is false', () => {
      expect(() =>
        compile(
          `
        <script setup lang="ts">
        import { ref } from 'vue'
        const stacks = ref([])
        </script>
        <template>
            <div v-for="({ file: efile }) of stacks"></div>
        </template>
        `,
          {
            inlineTemplate: false,
          },
        ),
      ).not.toThrowError()
    })

    // 普通 import Foo 在内联模板被 new 和 new Foo.Bar 使用；先 unref 构造器并加括号，确保 new 的语法与访问优先级正确。
    test('unref + new expression', () => {
      const { content } = compile(
        `
        <script setup>
        import Foo from './foo'
        </script>
        <template>
          <div>{{ new Foo() }}</div>
          <div>{{ new Foo.Bar() }}</div>
        </template>
        `,
        { inlineTemplate: true },
      )
      expect(content).toMatch(`new (_unref(Foo))()`)
      expect(content).toMatch(`new (_unref(Foo)).Bar()`)
      assertCode(content)
    })

    // #12682：内联模板后，脚本变量与模板表达式的生成位置都应映射回原 SFC。
    // 内联模板含 throw new Error，脚本有 count；生成 map 分别把脚本变量与模板 Error 回指完整 SFC。
    test('source map', () => {
      const source = `
      <script setup>
        const count = ref(0)
      </script>
      <template>
        <button @click="throw new Error(\`msg\`);"></button>
      </template>
      `
      const { content, map } = compile(source, { inlineTemplate: true })
      expect(map).not.toBeUndefined()
      const consumer = new SourceMapConsumer(map as RawSourceMap)
      expect(
        consumer.originalPositionFor(getPositionInCode(content, 'count')),
      ).toMatchObject(getPositionInCode(source, `count`))
      expect(
        consumer.originalPositionFor(getPositionInCode(content, 'Error')),
      ).toMatchObject(getPositionInCode(source, `Error`))
    })
  })

  // TypeScript：擦除/保留类型语法、生成运行时 props/emits，并保持泛型 setup 支持。
  describe('with TypeScript', () => {
    // setup 含导出 interface 与本地 type alias；纯类型声明移到模块层，输出保留 TS 语法并通过校验。
    test('hoist type declarations', () => {
      const { content } = compile(`
      <script setup lang="ts">
        export interface Foo {}
        type Bar = {}
      </script>`)
      assertCode(content)
    })

    // setup 的数字 enum；静态成员可提升且登记 LITERAL_CONST，输出保持运行时 enum。
    test('runtime Enum', () => {
      const { content, bindings } = compile(
        `<script setup lang="ts">
        enum Foo { A = 123 }
        </script>`,
      )
      assertCode(content)
      expect(bindings).toStrictEqual({
        Foo: BindingTypes.LITERAL_CONST,
      })
    })

    // 普通 script 含导出/const/普通字符串 enum，setup 含数字 enum；四项静态 enum 均登记 LITERAL_CONST。
    test('runtime Enum in normal script', () => {
      const { content, bindings } = compile(
        `<script lang="ts">
          export enum D { D = "D" }
          const enum C { C = "C" }
          enum B { B = "B" }
        </script>
        <script setup lang="ts">
        enum Foo { A = 123 }
        </script>`,
      )
      assertCode(content)
      expect(bindings).toStrictEqual({
        D: BindingTypes.LITERAL_CONST,
        C: BindingTypes.LITERAL_CONST,
        B: BindingTypes.LITERAL_CONST,
        Foo: BindingTypes.LITERAL_CONST,
      })
    })

    // 开启 hoistStatic 编译 const enum；静态枚举按字面量常量分类并保持合法 TS 输出。
    test('const Enum', () => {
      const { content, bindings } = compile(
        `<script setup lang="ts">
        const enum Foo { A = 123 }
        </script>`,
        { hoistStatic: true },
      )
      assertCode(content)
      expect(bindings).toStrictEqual({
        Foo: BindingTypes.LITERAL_CONST,
      })
    })

    // type-only import 与混合 type/value specifier；Foo/Bar 不进入返回对象，值 Baz 以 getter 返回。
    test('import type', () => {
      const { content } = compile(
        `<script setup lang="ts">
        import type { Foo } from './main.ts'
        import { type Bar, Baz } from './main.ts'
        </script>`,
      )
      expect(content).toMatch(`return { get Baz() { return Baz } }`)
      assertCode(content)
    })

    // setup 带 generic 属性并声明类型别名；宏编译保留合法 TS 模块，generic 属性不当作脚本正文解析。
    test('with generic attribute', () => {
      const { content } = compile(`
      <script setup lang="ts" generic="T extends Record<string,string>">
        type Bar = {}
      </script>`)
      assertCode(content)
    })
  })

  // 顶层 await：插入 withAsyncContext 恢复组件实例，同时忽略函数内部 await。
  describe('async/await detection', () => {
    /**
     * 编译 await 片段，正分支明确检查 async setup 与恢复临时量；负分支的字符串断言
     * 只检查 setup 入口，是否额外出现 async/临时量由 assertCode 的完整输出快照约束。
     */
    function assertAwaitDetection(code: string, shouldAsync = true) {
      const { content } = compile(`<script setup>${code}</script>`)
      if (shouldAsync) {
        expect(content).toMatch(`let __temp, __restore`)
      }
      expect(content).toMatch(`${shouldAsync ? `async ` : ``}setup(`)
      assertCode(content)
      return content
    }

    // 顶层表达式 await foo；生成 async setup、__temp/__restore 与上下文恢复包装。
    test('expression statement', () => {
      assertAwaitDetection(`await foo`)
    })

    // 变量初始化中嵌套 await；保留表达式值，同时把 setup 变为 async 并生成恢复临时量。
    test('variable', () => {
      assertAwaitDetection(`const a = 1 + (await foo)`)
    })

    // ref 调用参数中包含 await；递归发现顶层 await 并保留调用/算术求值结构。
    test('ref', () => {
      assertAwaitDetection(`let a = ref(1 + (await foo))`)
    })

    // #4448：嵌套 await 每一层只做必要包装，不能重复破坏表达式求值顺序。
    // 分别输入两种括号及三层嵌套 await；逐层生成恢复包装，输出语法与快照验证嵌套求值顺序。
    test('nested await', () => {
      assertAwaitDetection(`await (await foo)`)
      assertAwaitDetection(`await ((await foo))`)
      assertAwaitDetection(`await (await (await foo))`)
    })

    // 前置分号用于避免生成代码与上一条语句发生 ASI 粘连。
    // foo() 后换行接含两个 await 的表达式语句；包装前补分号，避免与上一调用发生 ASI 粘连。
    test('nested leading await in expression statement', () => {
      const code = assertAwaitDetection(`foo()\nawait 1 + await 2`)
      expect(code).toMatch(`foo()\n;(`)
    })

    // #4596：单行 if/while 后的 await 包装不能无条件前插分号，否则会切断控制语句 body。
    // 单行 if(false) 后接 await；不在 body 前插分号，避免把 await 变成无条件执行语句。
    test('single line conditions', () => {
      const code = assertAwaitDetection(`if (false) await foo()`)
      expect(code).not.toMatch(`if (false) ;(`)
    })

    // if/else 两个块各有顶层 await；两分支均转换，并生成一个 async setup。
    test('nested statements', () => {
      assertAwaitDetection(`if (ok) { await foo } else { await bar }`)
    })

    // 多层 if/else-if 中混合连续和相加 await；递归扫描各控制块但不改变分支结构。
    test('multiple `if` nested statements', () => {
      assertAwaitDetection(`if (ok) {
        let a = 'foo'
        await 0 + await 1
        await 2
      } else if (a) {
        await 10
        if (b) {
          await 0 + await 1
        } else {
          let a = 'foo'
          await 2
        }
        if (b) {
          await 3
          await 4
        }
      } else {
        await 5
      }`)
    })

    // 多层 while/if 中含多个 await；控制流内部仍属 setup 顶层执行，全部包装并校验语法。
    test('multiple `if while` nested statements', () => {
      assertAwaitDetection(`if (ok) {
        while (d) {
          await 5
        }
        while (d) {
          await 5
          await 6
          if (c) {
            let f = 10
            10 + await 7
          } else {
            await 8
            await 9
          }
        }
      }`)
    })

    // if 内两个 for-of 循环各含 await；循环保留，循环体 await 使 setup 变为 async。
    test('multiple `if for` nested statements', () => {
      assertAwaitDetection(`if (ok) {
        for (let a of [1,2,3]) {
          await a
        }
        for (let a of [1,2,3]) {
          await a
          await a
        }
      }`)
    })

    // 函数声明、箭头函数、对象方法与类方法各自含 await；四条分支均不把外层 setup 标 async，函数边界阻断扫描。
    test('should ignore await inside functions', () => {
      // 函数声明内部的 await 不应使外层 setup 变为 async。
      assertAwaitDetection(`async function foo() { await bar }`, false)
      // 箭头函数内部的 await 不应使外层 setup 变为 async。
      assertAwaitDetection(`const foo = async () => { await bar }`, false)
      // 对象方法内部的 await 不应使外层 setup 变为 async。
      assertAwaitDetection(`const obj = { async method() { await bar }}`, false)
      // 类方法内部的 await 不应使外层 setup 变为 async。
      assertAwaitDetection(
        `const cls = class Foo { async method() { await bar }}`,
        false,
      )
    })
  })

  // 主流程错误：重复/冲突 block、lang 不一致、非法导出和 setup 限制。
  describe('errors', () => {
    // 分别组合缺省 JS/TS 与 TS/TSX 两块；语言一致性检查先于 Babel 解析，均返回专门 lang 错误而非 JSX 误解析。
    test('<script> and <script setup> must have same lang', () => {
      expect(() =>
        compile(`<script>foo()</script><script setup lang="ts">bar()</script>`),
      ).toThrow(`<script> and <script setup> must have the same language type`)

      // #13193：必须先诊断两个 script 的 lang 不一致，不能先用错误 parser 解析 JSX 而抛无关错误。
      expect(() =>
        compile(
          `<script lang="ts">const a = 1</script><script setup lang="tsx">const Comp = () => <p>test</p></script>`,
        ),
      ).toThrow(`<script> and <script setup> must have the same language type`)
    })

    /** 三种 setup 值导出场景共用的诊断片段；不限制源码位置和额外错误说明。 */
    const moduleErrorMsg = `cannot contain ES module exports`

    // setup 分别包含变量导出、export * 与 as default 值导出；均拒绝非类型 ES module export。
    test('non-type named exports', () => {
      expect(() =>
        compile(`<script setup>
        export const a = 1
        </script>`),
      ).toThrow(moduleErrorMsg)

      expect(() =>
        compile(`<script setup>
        export * from './foo'
        </script>`),
      ).toThrow(moduleErrorMsg)

      expect(() =>
        compile(`<script setup>
          const bar = 1
          export { bar as default }
        </script>`),
      ).toThrow(moduleErrorMsg)
    })

    // props 默认函数与 emits 数组捕获 setup let 时抛错；同样引用普通 script 模块常量时允许，按绑定作用域区别。
    test('defineProps/Emit() referencing local var', () => {
      expect(() =>
        compile(`<script setup>
        let bar = 1
        defineProps({
          foo: {
            default: () => bar
          }
        })
        </script>`),
      ).toThrow(`cannot reference locally declared variables`)

      expect(() =>
        compile(`<script setup>
        let bar = 'hello'
        defineEmits([bar])
        </script>`),
      ).toThrow(`cannot reference locally declared variables`)

      // #4644：宏提升参数可以引用普通 `<script>` 的模块级绑定，它并非 setup 局部实例状态。
      expect(() =>
        compile(`
        <script>const bar = 1</script>
        <script setup>
        defineProps({
          foo: {
            default: () => bar
          }
        })
        </script>`),
      ).not.toThrow(`cannot reference locally declared variables`)
    })

    // 宏默认函数/事件验证器的参数 bar 遮蔽 setup 同名变量；局部参数可合法引用，作用域检查不得误判。
    test('should allow defineProps/Emit() referencing scope var', () => {
      assertCode(
        compile(`<script setup>
          const bar = 1
          defineProps({
            foo: {
              default: bar => bar + 1
            }
          })
          defineEmits({
            foo: bar => bar > 1
          })
        </script>`).content,
      )
    })

    // props 默认函数与 emits 验证器捕获导入 bar；import 已在模块层，允许作为提升选项依赖。
    test('should allow defineProps/Emit() referencing imported binding', () => {
      assertCode(
        compile(`<script setup>
        import { bar } from './bar'
        defineProps({
          foo: {
            default: () => bar
          }
        })
        defineEmits({
          foo: () => bar > 1
        })
        </script>`).content,
      )
    })

    // defineModel default 捕获 let 时拒绝、捕获可提升字面量 const 时允许；get/set 留在 setup，可捕获 let，三条边界分别验证。
    test('defineModel() referencing local var', () => {
      expect(() =>
        compile(`<script setup>
        let bar = 1
        defineModel({
          default: () => bar
        })
        </script>`),
      ).toThrow(`cannot reference locally declared variables`)

      // 字面量 const 可提升到模块作用域，defineModel 的 default 可以引用它。
      expect(() =>
        compile(`<script setup>
        const bar = 1
        defineModel({
          default: () => bar
        })
        </script>`),
      ).not.toThrow(`cannot reference locally declared variables`)

      // get/set 留在 setup 内，允许捕获 setup 局部绑定。
      expect(() =>
        compile(`<script setup>
        let bar = 1
        defineModel({
          get: () => bar,
          set: () => bar
        })
        </script>`),
      ).not.toThrow(`cannot reference locally declared variables`)
    })
  })
})

// 普通 script 绑定分析：从 Options API 与导出对象提取模板可见名称。
describe('SFC analyze <script> bindings', () => {
  // 普通 TS script 含 Options 装饰器及默认类；Babel 插件正确解析并返回 scriptAst。
  it('can parse decorators syntax in typescript block', () => {
    const { scriptAst } = compile(`
      <script lang="ts">
        import { Options, Vue } from 'vue-class-component';
        @Options({
          components: {
            HelloWorld,
          },
          props: ['foo', 'bar']
        })
        export default class Home extends Vue {}
      </script>
    `)

    expect(scriptAst).toBeDefined()
  })

  // 普通选项对象以数组声明 props；两键登记 PROPS，非枚举 __isScriptSetup 标记为 false。
  it('recognizes props array declaration', () => {
    const { bindings } = compile(`
      <script>
        export default {
          props: ['foo', 'bar']
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
    })
    expect(bindings!.__isScriptSetup).toBe(false)
  })

  // 普通 props 对象包含构造器、嵌套选项、null 与构造器数组；只收集静态键，均登记 PROPS。
  it('recognizes props object declaration', () => {
    const { bindings } = compile(`
      <script>
        export default {
          props: {
            foo: String,
            bar: {
              type: String,
            },
            baz: null,
            qux: [String, Number]
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.PROPS,
      bar: BindingTypes.PROPS,
      baz: BindingTypes.PROPS,
      qux: BindingTypes.PROPS,
    })
    expect(bindings!.__isScriptSetup).toBe(false)
  })

  // 普通 setup 返回含显式与简写属性的对象；返回键都归 MAYBE_REF，而非按初始化值进一步猜测。
  it('recognizes setup return', () => {
    const { bindings } = compile(`
      <script>
        const bar = 2
        export default {
          setup() {
            return {
              foo: 1,
              bar
            }
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_MAYBE_REF,
      bar: BindingTypes.SETUP_MAYBE_REF,
    })
    expect(bindings!.__isScriptSetup).toBe(false)
  })

  // 普通 script 导出字符串字面量常量，setup 读取；模块绑定登记 LITERAL_CONST。
  it('recognizes exported vars', () => {
    const { bindings } = compile(`
      <script>
        export const foo = 2
      </script>
      <script setup>
        console.log(foo)
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.LITERAL_CONST,
    })
  })

  // 普通 async setup 返回对象；返回键分析不受 async 修饰影响，均归 MAYBE_REF。
  it('recognizes async setup return', () => {
    const { bindings } = compile(`
      <script>
        const bar = 2
        export default {
          async setup() {
            return {
              foo: 1,
              bar
            }
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.SETUP_MAYBE_REF,
      bar: BindingTypes.SETUP_MAYBE_REF,
    })
    expect(bindings!.__isScriptSetup).toBe(false)
  })

  // data 返回显式/简写对象属性；两键登记 DATA，供模板从 data 路径读取。
  it('recognizes data return', () => {
    const { bindings } = compile(`
      <script>
        const bar = 2
        export default {
          data() {
            return {
              foo: null,
              bar
            }
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.DATA,
      bar: BindingTypes.DATA,
    })
  })

  // methods 对象含 foo 方法；静态键登记 OPTIONS。
  it('recognizes methods', () => {
    const { bindings } = compile(`
      <script>
        export default {
          methods: {
            foo() {}
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({ foo: BindingTypes.OPTIONS })
  })

  // computed 同时包含方法式与 get/set 对象式；收集 foo/bar 两个公开键，均归 OPTIONS。
  it('recognizes computeds', () => {
    const { bindings } = compile(`
      <script>
        export default {
          computed: {
            foo() {},
            bar: {
              get() {},
              set() {},
            }
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.OPTIONS,
      bar: BindingTypes.OPTIONS,
    })
  })

  // inject 数组声明 foo/bar；公开注入名登记 OPTIONS。
  it('recognizes injections array declaration', () => {
    const { bindings } = compile(`
      <script>
        export default {
          inject: ['foo', 'bar']
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.OPTIONS,
      bar: BindingTypes.OPTIONS,
    })
  })

  // inject 对象声明 foo/bar；对象式与数组式同样登记公开键。
  it('recognizes injections object declaration', () => {
    const { bindings } = compile(`
      <script>
        export default {
          inject: {
            foo: {},
            bar: {},
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.OPTIONS,
      bar: BindingTypes.OPTIONS,
    })
  })

  // 单个普通组件混合 inject/props/setup/data/methods/computed；逐项核对 OPTIONS/PROPS/MAYBE_REF/DATA，保持来源分类。
  it('works for mixed bindings', () => {
    const { bindings } = compile(`
      <script>
        export default {
          inject: ['foo'],
          props: {
            bar: String,
          },
          setup() {
            return {
              baz: null,
            }
          },
          data() {
            return {
              qux: null
            }
          },
          methods: {
            quux() {}
          },
          computed: {
            quuz() {}
          }
        }
      </script>
    `)
    expect(bindings).toStrictEqual({
      foo: BindingTypes.OPTIONS,
      bar: BindingTypes.PROPS,
      baz: BindingTypes.SETUP_MAYBE_REF,
      qux: BindingTypes.DATA,
      quux: BindingTypes.OPTIONS,
      quuz: BindingTypes.OPTIONS,
    })
  })

  // setup 含 Vue ref 别名、let、字面量 const、const/let 解构及 props；逐项核对 REF/LET/LITERAL_CONST/MAYBE_REF/PROPS。
  it('works for script setup', () => {
    const { bindings } = compile(`
      <script setup>
      import { ref as r } from 'vue'
      defineProps({
        foo: String
      })

      const a = r(1)
      let b = 2
      const c = 3
      const { d } = someFoo()
      let { e } = someBar()
      </script>
    `)

    expect(bindings).toStrictEqual({
      r: BindingTypes.SETUP_CONST,
      a: BindingTypes.SETUP_REF,
      b: BindingTypes.SETUP_LET,
      c: BindingTypes.LITERAL_CONST,
      d: BindingTypes.SETUP_MAYBE_REF,
      e: BindingTypes.SETUP_LET,
      foo: BindingTypes.PROPS,
    })
  })

  // 自动组件名：由文件名推导 __name；普通 script 显式提供 name 时不注入。
  describe('auto name inference', () => {
    // 文件名 FooBar.vue 且未显式 name；生成 __name:FooBar，输出通过语法和快照检查。
    test('basic', () => {
      const { content } = compile(
        `<script setup>const a = 1</script>
        <template>{{ a }}</template>`,
        undefined,
        {
          filename: 'FooBar.vue',
        },
      )
      expect(content).toMatch(`export default {
  __name: 'FooBar'`)
      assertCode(content)
    })

    // 普通默认对象显式 name:Baz，文件名 FooBar.vue；保留 Baz，不再注入同文件名的 name。
    test('do not overwrite manual name (object)', () => {
      const { content } = compile(
        `<script>
        export default {
          name: 'Baz'
        }
        </script>
        <script setup>const a = 1</script>
        <template>{{ a }}</template>`,
        undefined,
        {
          filename: 'FooBar.vue',
        },
      )
      expect(content).not.toMatch(`name: 'FooBar'`)
      expect(content).toMatch(`name: 'Baz'`)
      assertCode(content)
    })

    // 普通默认导出为 defineComponent({name:Baz})；调用首参静态 name 同样阻止自动命名。
    test('do not overwrite manual name (call)', () => {
      const { content } = compile(
        `<script>
        import { defineComponent } from 'vue'
        export default defineComponent({
          name: 'Baz'
        })
        </script>
        <script setup>const a = 1</script>
        <template>{{ a }}</template>`,
        undefined,
        {
          filename: 'FooBar.vue',
        },
      )
      expect(content).not.toMatch(`name: 'FooBar'`)
      expect(content).toMatch(`name: 'Baz'`)
      assertCode(content)
    })
  })
})

// genDefaultAs：把最终组件选项写入指定变量，供自定义元素/SSR 等上层工具继续组合。
describe('SFC genDefaultAs', () => {
  // 只有普通 script，设置 genDefaultAs=_sfc_；默认导出改为该变量，供调用者后续组合。
  test('normal <script> only', () => {
    const { content } = compile(
      `<script>
      export default {}
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(`const _sfc_ = {}`)
    assertCode(content)
  })

  // 普通 script 叠加 CSS vars 并指定 genDefaultAs；直接使用指定主变量注入 CSS，不额外生成 __default__ 或默认导出。
  test('normal <script> w/ cssVars', () => {
    const { content } = compile(
      `<script>
      export default {}
      </script>
      <style>
      .foo { color: v-bind(x) }
      </style>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).not.toMatch('__default__')
    expect(content).toMatch(`const _sfc_ = {}`)
    assertCode(content)
  })

  // 普通 script/setup 合并并指定 genDefaultAs；Object.assign 结果赋给 _sfc_，普通 __default__ 仍作为合并来源。
  test('<script> + <script setup>', () => {
    const { content } = compile(
      `<script>
      export default {}
      </script>
      <script setup>
      const a = 1
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(
      `const _sfc_ = /*@__PURE__*/Object.assign(__default__`,
    )
    assertCode(content)
  })

  // 重复覆盖双 script 与 genDefaultAs 同一输入；再次核对 Object.assign 目标变量及快照，本例无额外独立分支。
  test('<script> + <script setup>', () => {
    const { content } = compile(
      `<script>
      export default {}
      </script>
      <script setup>
      const a = 1
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(
      `const _sfc_ = /*@__PURE__*/Object.assign(__default__`,
    )
    assertCode(content)
  })

  // 只有 JS setup 且指定 genDefaultAs；生成组件对象绑定 _sfc_，不输出 export default。
  test('<script setup> only', () => {
    const { content } = compile(
      `<script setup>
      const a = 1
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(`const _sfc_ = {\n  setup`)
    assertCode(content)
  })

  // 只有 TS setup 且指定 genDefaultAs；生成 defineComponent 调用绑定 _sfc_。
  test('<script setup> only w/ ts', () => {
    const { content } = compile(
      `<script setup lang="ts">
      const a = 1
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(`const _sfc_ = /*@__PURE__*/_defineComponent(`)
    assertCode(content)
  })

  // 双 TS script 且指定 genDefaultAs；defineComponent 对象 spread 普通 __default__ 后加入 setup，结果赋给指定变量。
  test('<script> + <script setup> w/ ts', () => {
    const { content } = compile(
      `<script lang="ts">
      export default {}
      </script>
      <script setup lang="ts">
      const a = 1
      </script>`,
      {
        genDefaultAs: '_sfc_',
      },
    )
    expect(content).not.toMatch('export default')
    expect(content).toMatch(
      `const _sfc_ = /*@__PURE__*/_defineComponent({\n  ...__default__`,
    )
    assertCode(content)
  })

  // toRef getter 读取 defineProps 的 foo；props 归响应式常量，toRef 返回值归 SETUP_REF，Vue API 别名表驱动分类。
  test('binding type for edge cases', () => {
    const { bindings } = compile(
      `<script setup lang="ts">
      import { toRef } from 'vue'
      const props = defineProps<{foo: string}>()
      const foo = toRef(() => props.foo)
      </script>`,
    )
    expect(bindings).toStrictEqual({
      toRef: BindingTypes.SETUP_CONST,
      props: BindingTypes.SETUP_REACTIVE_CONST,
      foo: BindingTypes.SETUP_REF,
    })
  })

  // 默认支持 import attributes；用户可配置插件接受已弃用的 assert 语法。
  describe('parser plugins', () => {
    // 默认插件接受 import with 属性但拒绝旧 assert；分别检查成功输出与抛错，表明 parser 默认语法边界。
    test('import attributes', () => {
      const { content } = compile(`
        <script setup>
        import { foo } from './foo.js' with { type: 'foobar' }
        </script>
      `)
      assertCode(content)

      expect(() =>
        compile(`
      <script setup>
        import { foo } from './foo.js' assert { type: 'foobar' }
        </script>`),
      ).toThrow()
    })

    // 用户 importAttributes 插件打开 deprecatedAssertSyntax；旧 assert 导入可编译并通过输出校验。
    test('import attributes (user override for deprecated syntax)', () => {
      const { content } = compile(
        `
        <script setup>
        import { foo } from './foo.js' assert { type: 'foobar' }
        </script>
      `,
        {
          babelParserPlugins: [
            ['importAttributes', { deprecatedAssertSyntax: true }],
          ],
        },
      )
      assertCode(content)
    })
  })
})

// 验证 runtimeModuleName 改变 helper 来源，以及未知脚本语言原样返回。
describe('compileScript', () => {
  // 顶层 await 需要 withAsyncContext，runtimeModuleName 改为 npm:vue；helper 从指定模块导入并保持恢复代码。
  test('should care about runtimeModuleName', () => {
    const { content } = compile(
      `
      <script setup>
        await Promise.resolve(1)
      </script>
      `,
      {
        templateOptions: {
          compilerOptions: {
            runtimeModuleName: 'npm:vue',
          },
        },
      },
    )
    expect(content).toMatch(
      `import { withAsyncContext as _withAsyncContext } from "npm:vue"\n`,
    )
    assertCode(content)
  })

  // 普通 script 的 lang=coffee；返回原 CoffeeScript 内容与 lang，不产生 Babel scriptAst。
  test('should not compile unrecognized language', () => {
    const { content, lang, scriptAst } = compile(
      `<script lang="coffee">
      export default
        data: ->
          myVal: 0
      </script>`,
    )
    expect(content).toMatch(`export default
        data: ->
          myVal: 0`)
    expect(lang).toBe('coffee')
    expect(scriptAst).not.toBeDefined()
  })
})
