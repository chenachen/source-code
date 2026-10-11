/**
 * 模板 import 使用分析场景：从标签、指令、表达式、动态参数、ref 和 v-model 中收集标识符，
 * 避免 script setup 错删模板所需导入；同时忽略属性名、局部别名和纯类型位置。
 */
import { assertCode, compileSFCScript as compile } from '../utils'

// 非 inline 模式返回 setup 绑定对象。type-only import 不进入返回对象；TS 模式下，
// 值 import 是否返回由模板使用分析决定，避免暴露只用于类型或完全未用的导入。

// 导入 PascalCase/kebab-case/小写组件及仅作类型的 FooBar；模板标签决定 getter 返回集合，普通文本与大小写不匹配不计为使用。
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

// 导入 vMyDir 并在模板使用 v-my-dir；指令名还原为脚本绑定，非内联 setup 返回其 getter。
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

// 动态插槽/属性参数、模板字符串参数与同名 v-bind 简写读取导入；收集表达式根标识符，静态 unused 属性名不计入返回集合。
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
// class 条件表达式调用 bar，style 读取 baz；两项值导入均返回 getter，模板表达式使用不会被字符串分支掩盖。
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

// 插值使用 x/x$y，绑定使用 z，y 仅出现在字符串或 yy 子串；按标识符匹配，只返回三个实际读取的导入。
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
// JS 模板字符串插值读取 VAR/VAR3，VAR2 仅是文本；只返回插值中的导入，不能按整段字符串子串匹配。
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
// Last 是模板最后一个自闭合标签；遍历末尾节点仍能记录导入并与 FooBaz 一同返回。
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

// 模板包含 as、泛型调用、slot/v-for 类型注解与值 Baz；类型位置不计运行时导入，只返回 Baz 和本地 a/b。
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

// vuejs/vue#12591：含分号的 v-on 内联语句应能完成模板 import 分析，不抛解析错误。
// v-on 内联语句包含尾部分号；执行编译应正常完成，确认事件语句解析模式不会按单表达式误报。
test('v-on inline statement', () => {
  compile(`
  <script setup lang="ts">
    import { foo } from './foo'
  </script>
  <template>
    <div @click="$emit('update:a');"></div>
  </template>
  `)
})

// 静态 ref 指向 foo/bar，另有空 ref 和 Baz 组件；ref 名计作导入使用，空字符串不产生绑定。
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
// 模板读取 Foo.Bar.Baz；只有 Foo 是根值标识符，Bar/Baz 属性名不计作独立导入。
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

// v-bind 展开 Foo.Bar.Baz；spread 中同样只记录根导入 Foo，避免返回属性名对应的未用导入。
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

// 成员访问点号两边有空格；Babel 标识符遍历仍只收集 Foo，结果不依赖文本紧邻。
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
// namespace import Foo 用作 Foo.Bar 标签；组件解析记录根 Foo，setup 以 getter 暴露该模块绑定。
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

// 显式传 templateParseOptions:{} 编译 x 插值；初始模板分析 AST 可复用，仍返回 x getter。
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
// 导入 fooBar，在模板用 :foo-bar 同名简写；camelize 后识别实际脚本绑定，避免漏掉需要返回的导入。
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
