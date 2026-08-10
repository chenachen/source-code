/**
 * 模板 import 使用分析场景：从标签、指令、表达式、动态参数、ref 和 v-model 中收集标识符，
 * 避免 script setup 错删模板所需导入；同时忽略属性名、局部别名和纯类型位置。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

// 开发模式会把 setup() 中声明的绑定作为对象返回。TypeScript 的类型导入没有
// 运行时值，因此编译器必须结合模板中的实际使用情况，决定哪些导入需要返回。

test('components', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { FooBar, FooBaz, FooQux, foo } from './x'
    const fooBar: FooBar = 1
    </script>
    <template>
      <FooBaz></FooBaz>
      <foo-qux/>
      <foo/>
      FooBar
    </template>
    `)
  // FooBar：不能被普通文本或大小写不一致的名称误判为已使用。
  // FooBaz：以 PascalCase 组件形式使用。
  // FooQux：以 kebab-case 组件形式使用。
  // foo：以小写组件形式使用。
  expect(content).toMatch(
    `return { fooBar, get FooBaz() { return FooBaz }, ` +
      `get FooQux() { return FooQux }, get foo() { return foo } }`,
  )
  assertCode(content)
})

test('directive', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { vMyDir } from './x'
    </script>
    <template>
      <div v-my-dir></div>
    </template>
    `)
  expect(content).toMatch(`return { get vMyDir() { return vMyDir } }`)
  assertCode(content)
})

test('dynamic arguments', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { FooBar, foo, bar, unused, baz, msg } from './x'
    </script>
    <template>
      <FooBar #[foo.slotName] />
      <FooBar #unused />
      <div :[bar.attrName]="15"></div>
      <div unused="unused"></div>
      <div #[\`item:\${baz.key}\`]="{ value }"></div>
      <FooBar :msg />
    </template>
    `)
  expect(content).toMatch(
    `return { get FooBar() { return FooBar }, get foo() { return foo }, ` +
      `get bar() { return bar }, get baz() { return baz }, get msg() { return msg } }`,
  )
  assertCode(content)
})

// https://github.com/vuejs/core/issues/4599
test('attribute expressions', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { bar, baz } from './x'
    const cond = true
    </script>
    <template>
      <div :class="[cond ? '' : bar(), 'default']" :style="baz"></div>
    </template>
    `)
  expect(content).toMatch(
    `return { cond, get bar() { return bar }, get baz() { return baz } }`,
  )
  assertCode(content)
})

test('vue interpolations', () => {
  const { content } = compile(`
  <script setup lang="ts">
  import { x, y, z, x$y } from './x'
  </script>
  <template>
    <div :id="z + 'y'">{{ x }} {{ yy }} {{ x$y }}</div>
  </template>
  `)
  // x：用于插值，应判定为已使用。
  // y：不能因 {{ yy }} 或绑定表达式中的字符串 'y' 被误判为已使用。
  // #4274：导入名含 `$` 时不能直接拼进正则；使用分析必须按标识符字面值匹配。
  expect(content).toMatch(
    `return { get x() { return x }, get z() { return z }, get x$y() { return x$y } }`,
  )
  assertCode(content)
})

// #4340：模板 JS 的模板字符串插值会读取导入，扫描时不能把整段反引号内容当普通字符串跳过。
test('js template string interpolations', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { VAR, VAR2, VAR3 } from './x'
    </script>
    <template>
      {{ \`\${VAR}VAR2\${VAR3}\` }}
    </template>
    `)
  // VAR2 只出现在另一个标识符中，不能被子串匹配误判。
  expect(content).toMatch(
    `return { get VAR() { return VAR }, get VAR3() { return VAR3 } }`,
  )
  assertCode(content)
})

// 边界场景：组件恰好是模板中的最后一个标签。
test('last tag', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { FooBaz, Last } from './x'
    </script>
    <template>
      <FooBaz></FooBaz>
      <Last/>
    </template>
    `)
  expect(content).toMatch(
    `return { get FooBaz() { return FooBaz }, get Last() { return Last } }`,
  )
  assertCode(content)
})

test('TS annotations', () => {
  const { content } = compile(`
    <script setup lang="ts">
    import { Foo, Bar, Baz, Qux, Fred } from './x'
    const a = 1
    function b() {}
    </script>
    <template>
      {{ a as Foo }}
      {{ b<Bar>() }}
      {{ Baz }}
      <Comp v-slot="{ data }: Qux">{{ data }}</Comp>
      <div v-for="{ z = x as Qux } in list as Fred"/>
    </template>
    `)
  expect(content).toMatch(`return { a, b, get Baz() { return Baz } }`)
  assertCode(content)
})

// vuejs/vue#12591：v-on 内联语句中的调用参数属于模板读取，应保留对应导入。
test('v-on inline statement', () => {
  // 不完整模板也不应让导入使用情况检查抛错。
  compile(`
  <script setup lang="ts">
    import { foo } from './foo'
  </script>
  <template>
    <div @click="$emit('update:a');"></div>
  </template>
  `)
})

test('template ref', () => {
  const { content } = compile(`
    <script setup lang="ts">
      import { foo, bar, Baz } from './foo'
    </script>
    <template>
      <div ref="foo"></div>
      <div ref=""></div>
      <Baz ref="bar" />
    </template>
    `)
  expect(content).toMatch(
    'return { get foo() { return foo }, get bar() { return bar }, get Baz() { return Baz } }',
  )
  assertCode(content)
})

// https://github.com/nuxt/nuxt/issues/22416
test('property access', () => {
  const { content } = compile(`
    <script setup lang="ts">
      import { Foo, Bar, Baz } from './foo'
    </script>
    <template>
      <div>{{ Foo.Bar.Baz }}</div>
    </template>
    `)
  expect(content).toMatch('return { get Foo() { return Foo } }')
  assertCode(content)
})

test('spread operator', () => {
  const { content } = compile(`
    <script setup lang="ts">
      import { Foo, Bar, Baz } from './foo'
    </script>
    <template>
      <div v-bind="{ ...Foo.Bar.Baz }"></div>
    </template>
    `)
  expect(content).toMatch('return { get Foo() { return Foo } }')
  assertCode(content)
})

test('property access (whitespace)', () => {
  const { content } = compile(`
    <script setup lang="ts">
      import { Foo, Bar, Baz } from './foo'
    </script>
    <template>
      <div>{{ Foo . Bar . Baz }}</div>
    </template>
    `)
  expect(content).toMatch('return { get Foo() { return Foo } }')
  assertCode(content)
})

// #9974：`Foo.Bar` namespace/dot 组件标签应把根标识符 Foo 计为模板使用。
test('namespace / dot component usage', () => {
  const { content } = compile(`
    <script setup lang="ts">
      import * as Foo from './foo'
    </script>
    <template>
      <Foo.Bar />
    </template>
    `)
  expect(content).toMatch('return { get Foo() { return Foo } }')
  assertCode(content)
})

test('check when has explicit parse options', () => {
  const { content } = compile(
    `
    <script setup lang="ts">
      import { x } from './x'
    </script>
    <template>
      {{ x }}
    </template>
    `,
    undefined,
    { templateParseOptions: {} },
  )
  expect(content).toMatch('return { get x() { return x } }')
})

// #11745：kebab-case 的同名 v-bind 简写要还原 camelCase 脚本绑定，避免误删导入。
test('shorthand binding w/ kebab-case', () => {
  const { content } = compile(
    `
    <script setup lang="ts">
      import { fooBar } from "./foo.ts"
    </script>
    <template>
      <div :foo-bar></div>
    </template>
    `,
  )
  expect(content).toMatch('return { get fooBar() { return fooBar }')
})
