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
    test('should hoist and expose imports', () => {
      assertCode(
        compile(`<script setup>
          import { ref } from 'vue'
          import 'foo/css'
        </script>`).content,
      )
    })

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

    // #2740：宏调用出现在 import 之前也要识别；处理顺序不能假设所有 import 已先遍历。
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
      // const 但可能是 ref：通过 isRef 检查后才能赋值。
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
      // const 但可能是 ref：非 ref 分支不可重新赋值，因此忽略。
      expect(content).toMatch(`maybe.value++`)
      expect(content).toMatch(`--maybe.value`)
      // let：同时处理 ref 与普通值两种情况。
      expect(content).toMatch(`_isRef(lett) ? lett.value++ : lett++`)
      expect(content).toMatch(`_isRef(lett) ? --lett.value : --lett`)
      assertCode(content)
    })

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
      // const 但可能是 ref：非 ref 分支不可重新赋值，因此忽略。
      expect(content).toMatch(`[maybe.value] = val`)
      // let 的解构赋值按普通可变绑定处理，不直接替换整个 ref。
      expect(content).toMatch(`{ lett: lett } = val`)
      assertCode(content)
    })

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

    // #12682：script 与 script setup 合并后的 source map 要同时正确映射两块源码。
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
    test('hoist type declarations', () => {
      const { content } = compile(`
      <script setup lang="ts">
        export interface Foo {}
        type Bar = {}
      </script>`)
      assertCode(content)
    })

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
    /** 编译给定 setup 片段，并断言是否生成 async setup 与上下文恢复临时量。 */
    function assertAwaitDetection(code: string, shouldAsync = true) {
      const { content } = compile(`<script setup>${code}</script>`)
      if (shouldAsync) {
        expect(content).toMatch(`let __temp, __restore`)
      }
      expect(content).toMatch(`${shouldAsync ? `async ` : ``}setup(`)
      assertCode(content)
      return content
    }

    test('expression statement', () => {
      assertAwaitDetection(`await foo`)
    })

    test('variable', () => {
      assertAwaitDetection(`const a = 1 + (await foo)`)
    })

    test('ref', () => {
      assertAwaitDetection(`let a = ref(1 + (await foo))`)
    })

    // #4448：嵌套 await 每一层只做必要包装，不能重复破坏表达式求值顺序。
    test('nested await', () => {
      assertAwaitDetection(`await (await foo)`)
      assertAwaitDetection(`await ((await foo))`)
      assertAwaitDetection(`await (await (await foo))`)
    })

    // 前置分号用于避免生成代码与上一条语句发生 ASI 粘连。
    test('nested leading await in expression statement', () => {
      const code = assertAwaitDetection(`foo()\nawait 1 + await 2`)
      expect(code).toMatch(`foo()\n;(`)
    })

    // #4596：单行 if/while 后的 await 包装不能无条件前插分号，否则会切断控制语句 body。
    test('single line conditions', () => {
      const code = assertAwaitDetection(`if (false) await foo()`)
      expect(code).not.toMatch(`if (false) ;(`)
    })

    test('nested statements', () => {
      assertAwaitDetection(`if (ok) { await foo } else { await bar }`)
    })

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

    test('should ignore await inside functions', () => {
      // 函数声明中的类型参数。
      assertAwaitDetection(`async function foo() { await bar }`, false)
      // 函数表达式中的类型参数。
      assertAwaitDetection(`const foo = async () => { await bar }`, false)
      // 对象方法中的类型参数。
      assertAwaitDetection(`const obj = { async method() { await bar }}`, false)
      // 类方法中的类型参数。
      assertAwaitDetection(
        `const cls = class Foo { async method() { await bar }}`,
        false,
      )
    })
  })

  // 主流程错误：重复/冲突 block、lang 不一致、非法导出和 setup 限制。
  describe('errors', () => {
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

    const moduleErrorMsg = `cannot contain ES module exports`

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

    test('defineModel() referencing local var', () => {
      expect(() =>
        compile(`<script setup>
        let bar = 1
        defineModel({
          default: () => bar
        })
        </script>`),
      ).toThrow(`cannot reference locally declared variables`)

      // const 断言属于类型语法，应允许出现在模板表达式中。
      expect(() =>
        compile(`<script setup>
        const bar = 1
        defineModel({
          default: () => bar
        })
        </script>`),
      ).not.toThrow(`cannot reference locally declared variables`)

      // getter/setter 内的类型语法同样应被正确解析。
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

  // 自动组件名：由文件名推导 __name，同时尊重用户显式 name 和 index.vue 目录名。
  describe('auto name inference', () => {
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

  // parser 插件：根据 lang 自动启用 JSX/TS，并允许调用方增加或显式排除插件。
  describe('parser plugins', () => {
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

// 公开入口组合：覆盖自定义元素、FS、source map 和 descriptor 缓存等最终行为。
describe('compileScript', () => {
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
