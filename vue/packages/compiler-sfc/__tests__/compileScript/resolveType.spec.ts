/**
 * TypeScript 宏类型解析场景：展开接口/别名/泛型/联合/交叉/映射/工具类型和跨文件导入，
 * 推导 props/emits 运行时类型，并验证 tsconfig paths、namespace、缓存依赖及失败诊断。
 */
import { normalize } from 'node:path'
import type { Identifier } from '@babel/types'
import { type SFCScriptCompileOptions, parse } from '../../src'
import { ScriptCompileContext } from '../../src/script/context'
import {
  inferRuntimeType,
  invalidateTypeCache,
  recordImports,
  registerTS,
  resolveTypeElements,
} from '../../src/script/resolveType'
import { UNKNOWN_TYPE } from '../../src/script/utils'
import ts from 'typescript'

registerTS(() => ts)

describe('resolveType', () => {
  // 类型字面量含属性、方法、字符串/模板/数字键和两条调用签名；分别推导五项构造器并保留两条 calls。
  test('type literal', () => {
    const { props, calls } = resolve(`defineProps<{
      foo: number // property
      bar(): void // method
      'baz': string // string literal key
      [\`qux\`]: boolean // template literal key
      123: symbol // numeric literal key
      (e: 'foo'): void // call signature
      (e: 'bar'): void
    }>()`)
    expect(props).toStrictEqual({
      foo: ['Number'],
      bar: ['Function'],
      baz: ['String'],
      qux: ['Boolean'],
      123: ['Symbol'],
    })
    expect(calls?.length).toBe(2)
  })

  // 本地 Aliased 对象别名用作宏类型；沿类型表展开 foo，推导 Number。
  test('reference type', () => {
    expect(
      resolve(`
    type Aliased = { foo: number }
    defineProps<Aliased>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 导出的 Aliased 对象别名；导出包装不阻断本地引用展开。
  test('reference exported type', () => {
    expect(
      resolve(`
    export type Aliased = { foo: number }
    defineProps<Aliased>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 本地 interface Aliased 含 foo:number；解析成员表并推导 Number。
  test('reference interface', () => {
    expect(
      resolve(`
    interface Aliased { foo: number }
    defineProps<Aliased>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 导出 interface 用作宏类型；按本地符号表定位，结果与非导出形式相同。
  test('reference exported interface', () => {
    expect(
      resolve(`
    export interface Aliased { foo: number }
    defineProps<Aliased>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // interface 多级且多继承，包含方法和原始类型属性；合并所有父级与本地成员，分别推导 Function/Boolean/String/Number。
  test('reference interface extends', () => {
    expect(
      resolve(`
    export interface A { a(): void }
    export interface B extends A { b: boolean }
    interface C { c: string }
    interface Aliased extends B, C { foo: number }
    defineProps<Aliased>()
    `).props,
    ).toStrictEqual({
      a: ['Function'],
      b: ['Boolean'],
      c: ['String'],
      foo: ['Number'],
    })
  })

  // class Foo 作为字段类型；运行时类实例近似为 Object，无需展开类成员作为 props。
  test('reference class', () => {
    expect(
      resolve(`
    class Foo {}
    defineProps<{ foo: Foo }>()
    `).props,
    ).toStrictEqual({
      foo: ['Object'],
    })
  })

  // 宏类型直接是函数签名；结果 props 为空且 calls 保留一条，供 emits 类型消费。
  test('function type', () => {
    expect(
      resolve(`
    defineProps<(e: 'foo') => void>()
    `).calls?.length,
    ).toBe(1)
  })

  // Fn 别名指向函数签名；沿引用仍返回一条 calls。
  test('reference function type', () => {
    expect(
      resolve(`
    type Fn = (e: 'foo') => void
    defineProps<Fn>()
    `).calls?.length,
    ).toBe(1)
  })

  // 交叉 self/Foo/Bar/Baz 且 bar 重名；合并成员并去重构造器，bar 保留 String/Boolean，未知 self 为 Unknown。
  test('intersection type', () => {
    expect(
      resolve(`
    type Foo = { foo: number }
    type Bar = { bar: string }
    type Baz = { bar: string | boolean }
    defineProps<{ self: any } & Foo & Bar & Baz>()
    `).props,
    ).toStrictEqual({
      self: [UNKNOWN_TYPE],
      foo: ['Number'],
      // Bar 与 Baz 都声明了 bar，但 Baz['bar'] 的类型范围更宽；合并同名属性时
      // 应保留更宽的运行时类型，不能因遍历顺序丢失合法值。
      bar: ['String', 'Boolean'],
    })
  })

  // 交叉类型后项 Bar 标 @vue-ignore；忽略该节点，只提取前项 Foo。
  test('intersection type with ignore', () => {
    expect(
      resolve(`
    type Foo = { foo: number }
    type Bar = { bar: string }
    defineProps<Foo & /* @vue-ignore */ Bar>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 交叉首项 Foo 标 @vue-ignore；仍继续解析后项 Bar，不把整个交叉清空。
  test('leading intersection type with ignore', () => {
    expect(
      resolve(`
    type Foo = { foo: number }
    type Bar = { bar: boolean }
    defineProps</* @vue-ignore */ Foo & Bar>()
    `).props,
    ).toStrictEqual({
      bar: ['Boolean'],
    })
  })

  // 联合首项 Foo 标 @vue-ignore；跳过该项但保留 Bar 的 boolean 字段。
  test('leading union type with ignore', () => {
    expect(
      resolve(`
    type Foo = { foo: number }
    type Bar = { bar: boolean }
    defineProps</* @vue-ignore */ Foo | Bar>()
    `).props,
    ).toStrictEqual({
      bar: ['Boolean'],
    })
  })

  // 字段的类型引用标 @vue-ignore；字段仍存在，运行时类型退为 Unknown。
  test('TSPropertySignature with ignore', () => {
    expect(
      resolve(`
      type Foo = string
      defineProps<{ foo: /* @vue-ignore */ Foo }>()
    `).props,
    ).toStrictEqual({
      foo: ['Unknown'],
    })
  })

  // #7553：联合对象类型合并可见 prop 名，并合并同名 prop 的运行时类型。
  // CommonProps 交叉条件对象联合；收集合并可见字段，同名 color 去重为 String/Number，非共享 note 也保留。
  test('union type', () => {
    expect(
      resolve(`
    interface CommonProps {
      size?: 'xl' | 'l' | 'm' | 's' | 'xs'
    }

    type ConditionalProps =
      | {
          color: 'normal' | 'primary' | 'secondary'
          appearance: 'normal' | 'outline' | 'text'
        }
      | {
          color: number
          appearance: 'outline'
          note: string
        }

    defineProps<CommonProps & ConditionalProps>()
    `).props,
    ).toStrictEqual({
      size: ['String'],
      color: ['String', 'Number'],
      appearance: ['String'],
      note: ['String'],
    })
  })

  // mapped key 是两个有限联合的模板字面量；笛卡尔积生成四个公开键，每项值类型为 String。
  test('template string type', () => {
    expect(
      resolve(`
    type T = 'foo' | 'bar'
    type S = 'x' | 'y'
    defineProps<{
      [K in \`_\${T}_\${S}_\`]: string
    }>()
    `).props,
    ).toStrictEqual({
      _foo_x_: ['String'],
      _foo_y_: ['String'],
      _bar_x_: ['String'],
      _bar_y_: ['String'],
    })
  })

  // 映射键混合可选字段、Capitalize、Uppercase/Extract 与模板前缀；有限字符串展开得到全部预期键和值构造器。
  test('mapped types w/ string manipulation', () => {
    expect(
      resolve(`
    type T = 'foo' | 'bar'
    defineProps<{ [K in T]: string | number } & {
      [K in 'optional']?: boolean
    } & {
      [K in Capitalize<T>]: string
    } & {
      [K in Uppercase<Extract<T, 'foo'>>]: string
    } & {
      [K in \`x\${T}\`]: string
    }>()
    `).props,
    ).toStrictEqual({
      foo: ['String', 'Number'],
      bar: ['String', 'Number'],
      Foo: ['String'],
      Bar: ['String'],
      FOO: ['String'],
      xfoo: ['String'],
      xbar: ['String'],
      optional: ['Boolean'],
    })
  })

  // Partial 包住必填 foo/bar；复制签名后 optional 均为 true，避免污染原声明缓存。
  test('utility type: Partial', () => {
    expect(
      resolve(`
    type T = { foo: number, bar: string }
    defineProps<Partial<T>>()
    `).raw.props,
    ).toMatchObject({
      foo: {
        optional: true,
      },
      bar: {
        optional: true,
      },
    })
  })

  // Required 包住可选 foo/bar；复制签名后 optional 均为 false。
  test('utility type: Required', () => {
    expect(
      resolve(`
    type T = { foo?: number, bar?: string }
    defineProps<Required<T>>()
    `).raw.props,
    ).toMatchObject({
      foo: {
        optional: false,
      },
      bar: {
        optional: false,
      },
    })
  })

  // Pick 的键来自别名联合 foo|bar；只保留指定成员，排除 baz。
  test('utility type: Pick', () => {
    expect(
      resolve(`
    type T = { foo: number, bar: string, baz: boolean }
    type K = 'foo' | 'bar'
    defineProps<Pick<T, K>>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
      bar: ['String'],
    })
  })

  // Omit 删除键别名中的 foo/bar；结果只剩 baz:Boolean。
  test('utility type: Omit', () => {
    expect(
      resolve(`
    type T = { foo: number, bar: string, baz: boolean }
    type K = 'foo' | 'bar'
    defineProps<Omit<T, K>>()
    `).props,
    ).toStrictEqual({
      baz: ['Boolean'],
    })
  })

  // 泛型 Optional 组合 Omit、Partial 与 Pick；替换实参后两项 String 字段均保留，工具类型可嵌套展开。
  test('utility type: mapped type with Omit and Pick', () => {
    expect(
      resolve(`
      type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
      interface Test {
        foo: string;
        bar?: string;
      }
      type OptionalTest = Optional<Test, 'foo'>
      defineProps<OptionalTest>()
    `).props,
    ).toStrictEqual({
      foo: ['String'],
      bar: ['String'],
    })
  })

  // 字段类型是 ReadonlyArray<string>；只映射运行时容器 Array，不逐元素校验。
  test('utility type: ReadonlyArray', () => {
    expect(
      resolve(`
    defineProps<{ foo: ReadonlyArray<string> }>()
    `).props,
    ).toStrictEqual({
      foo: ['Array'],
    })
  })

  // ReadonlyMap 与 ReadonlySet 字段；按工具类型名称分别映射 Map/Set。
  test('utility type: ReadonlyMap & Readonly Set', () => {
    expect(
      resolve(`
    defineProps<{ foo: ReadonlyMap<string, unknown>, bar: ReadonlySet<string> }>()
    `).props,
    ).toStrictEqual({
      foo: ['Map'],
      bar: ['Set'],
    })
  })

  // 嵌套属性经 T['bar'] 与 S['nested'] 两级索引；选择成员类型后推导 foo:Number。
  test('indexed access type (literal)', () => {
    expect(
      resolve(`
    type T = { bar: number }
    type S = { nested: { foo: T['bar'] }}
    defineProps<S['nested']>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 索引键为 foo|bar，内部又用 T[string]；外层合并选中对象，string 索引近似所有已知字段类型。
  test('indexed access type (advanced)', () => {
    expect(
      resolve(`
    type K = 'foo' | 'bar'
    type T = { foo: string, bar: number }
    type S = { foo: { foo: T[string] }, bar: { bar: string } }
    defineProps<S[K]>()
    `).props,
    ).toStrictEqual({
      foo: ['String', 'Number'],
      bar: ['String'],
    })
  })

  // 数组、Array 泛型、普通元组与具名元组使用 [number]；展开元素并去重，保留各元素构造器顺序。
  test('indexed access type (number)', () => {
    expect(
      resolve(`
    type A = (string | number)[]
    type AA = Array<string>
    type T = [1, 'foo']
    type TT = [foo: 1, bar: 'foo']
    defineProps<{ foo: A[number], bar: AA[number], tuple: T[number], namedTuple: TT[number] }>()
    `).props,
    ).toStrictEqual({
      foo: ['String', 'Number'],
      bar: ['String'],
      tuple: ['Number', 'String'],
      namedTuple: ['Number', 'String'],
    })
  })

  // namespace Foo 局部 X 遮蔽文件级 X，内部导出 Bar.A 引用它；ownerScope 决定 foo 为 Number。
  test('namespace', () => {
    expect(
      resolve(`
      type X = string
      namespace Foo {
        type X = number
        export namespace Bar {
          export type A = {
            foo: X
          }
        }
      }
      defineProps<Foo.Bar.A>()
    `).props,
    ).toStrictEqual({
      foo: ['Number'],
    })
  })

  // 同名 interface 分两次声明 a/b，再通过索引读取；声明合并后两个属性均可解析。
  test('interface merging', () => {
    expect(
      resolve(`
      interface Foo {
        a: string
      }
      interface Foo {
        b: number
      }
      defineProps<{
        foo: Foo['a'],
        bar: Foo['b']
      }>()
    `).props,
    ).toStrictEqual({
      foo: ['String'],
      bar: ['Number'],
    })
  })

  // 同名 namespace 分别导出 A/B；模块 body 合并后两项具名类型都可访问。
  test('namespace merging', () => {
    expect(
      resolve(`
      namespace Foo {
        export type A = string
      }
      namespace Foo {
        export type B = number
      }
      defineProps<{
        foo: Foo.A,
        bar: Foo.B
      }>()
    `).props,
    ).toStrictEqual({
      foo: ['String'],
      bar: ['Number'],
    })
  })

  // namespace Foo 与 interface Foo 同名；namespace 附着到实体声明，既能访问 Foo.A 也能索引 Foo['b']。
  test('namespace merging with other types', () => {
    expect(
      resolve(`
      namespace Foo {
        export type A = string
      }
      interface Foo {
        b: number
      }
      defineProps<{
        foo: Foo.A,
        bar: Foo['b']
      }>()
    `).props,
    ).toStrictEqual({
      foo: ['String'],
      bar: ['Number'],
    })
  })

  // 同名 enum 两次声明数字/字符串成员；合并 members 后运行时类型为 Number/String。
  test('enum merging', () => {
    expect(
      resolve(`
      enum Foo {
        A = 1
      }
      enum Foo {
        B = 'hi'
      }
      defineProps<{
        foo: Foo
      }>()
    `).props,
    ).toStrictEqual({
      foo: ['Number', 'String'],
    })
  })

  // declare const a:string 用作 typeof a；从 declares 表取注解，推导 String。
  test('typeof', () => {
    expect(
      resolve(`
      declare const a: string
      defineProps<{ foo: typeof a }>()
    `).props,
    ).toStrictEqual({
      foo: ['String'],
    })
  })

  // readonly unknown[] 字段；operator 透传内部类型，容器仍为 Array。
  test('readonly', () => {
    expect(
      resolve(`
    defineProps<{ foo: readonly unknown[] }>()
    `).props,
    ).toStrictEqual({
      foo: ['Array'],
    })
  })

  // keyof 作用于导入对象、interface、typeof 对象/Set/Array；按键类别近似 String/Number，容器键走内建规则。
  test('keyof', () => {
    const files = {
      '/foo.ts': `export type IMP = { ${1}: 1 };`,
    }

    const { props } = resolve(
      `
      import { IMP } from './foo'
      interface Foo { foo: 1, ${1}: 1 }
      type Bar = { bar: 1 }
      declare const obj: Bar
      declare const set: Set<any>
      declare const arr: Array<any>

      defineProps<{
        imp: keyof IMP,
        foo: keyof Foo,
        bar: keyof Bar,
        obj: keyof typeof obj,
        set: keyof typeof set,
        arr: keyof typeof arr
      }>()
      `,
      files,
    )

    expect(props).toStrictEqual({
      imp: ['Number'],
      foo: ['String', 'Number'],
      bar: ['String'],
      obj: ['String'],
      set: ['String'],
      arr: ['String', 'Number'],
    })
  })

  // index signature 的键为 symbol/string/typeof number 与泛型 number；收集并去重键构造器，不能把索引值类型当键类型。
  test('keyof: index signature', () => {
    const { props } = resolve(
      `
      declare const num: number;
      interface Foo {
        [key: symbol]: 1
        [key: string]: 1
        [key: typeof num]: 1,
      }

      type Test<T> = T
      type Bar = {
        [key: string]: 1
        [key: Test<number>]: 1
      }

      defineProps<{
        foo: keyof Foo 
        bar: keyof Bar
      }>()
      `,
    )

    expect(props).toStrictEqual({
      foo: ['Symbol', 'String', 'Number'],
      bar: ['String', 'Number'],
    })
  })

  // #11129：`keyof (A & B)` 应取得交叉后双方 key，不能只读取第一个成员。
  // keyof 交叉对象和数字索引对象；运行时键范围合并为 String/Number。
  test('keyof: intersection type', () => {
    const { props } = resolve(`
    type A = { name: string }
    type B = A & { [key: number]: string }
    defineProps<{
      foo: keyof B
    }>()`)
    expect(props).toStrictEqual({
      foo: ['String', 'Number'],
    })
  })

  // keyof 联合对象与数字索引对象；实现按各分支键类别合并，结果为 String/Number 的近似。
  test('keyof: union type', () => {
    const { props } = resolve(`
    type A = { name: string }
    type B = A | { [key: number]: string }
    defineProps<{
      foo: keyof B
    }>()`)
    expect(props).toStrictEqual({
      foo: ['String', 'Number'],
    })
  })

  // keyof 包住 Record、keyof any、Partial/Required/Readonly、Pick/Extract；按各工具参数位置推导 Symbol/String/Number。
  test('keyof: utility type', () => {
    const { props } = resolve(
      `
      type Foo = Record<symbol | string, any>
      type Bar = { [key: string]: any }
      type AnyRecord = Record<keyof any, any>
      type Baz = { a: 1, ${1}: 2, b: 3}

      defineProps<{
        record: keyof Foo,
        anyRecord: keyof AnyRecord 
        partial: keyof Partial<Bar>,
        required: keyof Required<Bar>,
        readonly: keyof Readonly<Bar>,
        pick: keyof Pick<Baz, 'a' | 1>
        extract: keyof Extract<keyof Baz, 'a' | 1>
      }>()
      `,
    )

    expect(props).toStrictEqual({
      record: ['Symbol', 'String'],
      anyRecord: ['String', 'Number', 'Symbol'],
      partial: ['String'],
      required: ['String'],
      readonly: ['String'],
      pick: ['String', 'Number'],
      extract: ['String', 'Number'],
    })
  })

  // keyof 空 interface 继承链；没有可识别键，退化为 Unknown。
  test('keyof: fallback to Unknown', () => {
    const { props } = resolve(
      `
      interface Barr {}
      interface Bar extends Barr {}
      type Foo = keyof Bar
      defineProps<{ foo: Foo }>()
      `,
    )

    expect(props).toStrictEqual({
      foo: [UNKNOWN_TYPE],
    })
  })

  // keyof Type['deep'] 的唯一键是数字1；先解析索引再推导 Number 键类别。
  test('keyof: nested object with number', () => {
    const { props } = resolve(
      `
      interface Type {
        deep: {
          1: any
        }
      }

      defineProps<{
        route: keyof Type['deep']
      }>()`,
    )

    expect(props).toStrictEqual({
      route: ['Number'],
    })
  })

  // keyof Type['deep'] 的唯一键是 foo；索引成员的键类别为 String。
  test('keyof: nested object with string', () => {
    const { props } = resolve(
      `
      interface Type {
        deep: {
          foo: any
        }
      }

      defineProps<{
        route: keyof Type['deep']
      }>()`,
    )

    expect(props).toStrictEqual({
      route: ['String'],
    })
  })

  // 索引结果先赋给别名 Foo 再 keyof；沿中间别名仍推导 String。
  test('keyof: nested object with intermediate', () => {
    const { props } = resolve(
      `
      interface Type {
        deep: {
          foo: any
        }
      }

      type Foo = Type['deep']

      defineProps<{
        route: keyof Foo
      }>()`,
    )

    expect(props).toStrictEqual({
      route: ['String'],
    })
  })

  // Element Plus 风格运行时 props 类型包含构造器与泛型包装、required:true；ExtractPropTypes 反向得到 String/Boolean，bar 必填。
  test('ExtractPropTypes (element-plus)', () => {
    const { props, raw } = resolve(
      `
      import { ExtractPropTypes } from 'vue'
      declare const props: {
        foo: StringConstructor,
        bar: {
          type: import('foo').EpPropFinalized<BooleanConstructor>,
          required: true
        }
      }
      type Props = ExtractPropTypes<typeof props>
      defineProps<Props>()
    `,
    )
    expect(props).toStrictEqual({
      foo: ['String'],
      bar: ['Boolean'],
    })
    expect(raw.props.bar.optional).toBe(false)
  })

  // Ant Design 风格函数返回 props，结合 ReturnType、动态 import ExtractPropTypes 和 Partial；反向构造器/PropType 后得到两项原始类型。
  test('ExtractPropTypes (antd)', () => {
    const { props } = resolve(
      `
      declare const props: () => {
        foo: StringConstructor,
        bar: { type: PropType<boolean> }
      }
      type Props = Partial<import('vue').ExtractPropTypes<ReturnType<typeof props>>>
      defineProps<Props>()
    `,
    )
    expect(props).toStrictEqual({
      foo: ['String'],
      bar: ['Boolean'],
    })
  })

  // #11266：`declare function` 的返回类型标注可作为宏类型来源，需沿声明节点正确提取。
  // declare function 泛型返回 props 对象；ReturnType 沿声明返回注解展开，PropType<数组> 反推 Array。
  test('correctly parse type annotation for declared function', () => {
    const { props } = resolve(`
    import { ExtractPropTypes } from 'vue'
    interface UploadFile<T = any> {
      xhr?: T
    }
    declare function uploadProps<T = any>(): {
      fileList: {
        type: PropType<UploadFile<T>[]>
        default: UploadFile<T>[]
      }
    }
    type UploadProps = ExtractPropTypes<ReturnType<typeof uploadProps>>
    defineProps<UploadProps>()`)
    expect(props).toStrictEqual({
      fileList: ['Array'],
    })
  })

  // 泛型 Prettify 映射 T[K] 与空对象交叉，实参为字符串/模板联合；运行时近似包含 String 和 Object。
  test('TSMappedType with indexed access', () => {
    const { props } = resolve(
      `
      type Prettify<T> = { [K in keyof T]: T[K] } & {}
      type Side = 'top' | 'right' | 'bottom' | 'left'
      type AlignedPlacement = \`\${Side}-\${Alignment}\`
      type Alignment = 'start' | 'end'
      type Placement = Prettify<Side | AlignedPlacement>
      defineProps<{placement?: Placement}>()
    `,
    )
    expect(props).toStrictEqual({
      placement: ['String', 'Object'],
    })
  })

  // 类型别名：推导函数别名、联合/交叉和 Vue Ref 包装中的运行时类型。
  describe('type alias declaration', () => {
    // #13240：函数类型别名用于 prop 时应推导 Function，而非因没有对象 properties 报错。
    // 泛型函数别名与二级别名用于 prop；识别函数形状，两项均为 Function，不按对象 props 展开。
    test('function type', () => {
      expect(
        resolve(`
      type FunFoo<O> = (item: O) => boolean;
      type FunBar = FunFoo<number>;
      defineProps<{
        foo?: FunFoo<number>;
        bar?: FunBar;
      }>()
      `).props,
      ).toStrictEqual({
        foo: ['Function'],
        bar: ['Function'],
      })
    })

    // 泛型 Brand<T> 为 T & {}；替换 string 后保留 String/Object 的运行时交叉近似。
    test('with intersection type', () => {
      expect(
        resolve(`
      type Brand<T> = T & {};
      defineProps<{
        foo: Brand<string>;
      }>()
      `).props,
      ).toStrictEqual({
        foo: ['String', 'Object'],
      })
    })

    // 泛型 Wrapped<T> 为 T|symbol|number；替换 boolean 后按顺序生成三个构造器。
    test('with union type', () => {
      expect(
        resolve(`
        type Wrapped<T> = T | symbol | number
        defineProps<{foo?: Wrapped<boolean>}>()
      `).props,
      ).toStrictEqual({
        foo: ['Boolean', 'Symbol', 'Number'],
      })
    })

    // #14729：原始复现是 interface 继承链中的 `MaybeRef<T[]>`，应穿透包装推导 Array。
    // 外部 MaybeRef 来源不可解析，别名再经 interface 继承；名称兜底仍保留数组、Promise、Function，避免丢掉已知包装信息。
    test('MaybeRef wrapped array type in interface inheritance chain', () => {
      expect(
        resolve(`
        import type { MaybeRef } from 'unresolvable-pkg-xyz'
        type OptionItem = { label: string; value: string | number }
        type FormItemOptions<T = any, C = any> =
          | MaybeRef<OptionItem[]>
          | Promise<OptionItem[]>
          | ((row: T, context: C) => OptionItem[] | Promise<OptionItem[]>)
        interface ISelectable<T = any, C = any> {
          options?: FormItemOptions<T, C>
        }
        interface XSelectProps<T = any, C = any> extends ISelectable<T, C> {
          modelValue?: unknown
        }
        defineProps<XSelectProps>()
      `).props,
      ).toMatchObject({
        // 运行时类型中必须保留 Array，否则数组值会被 props 校验错误拒绝。
        options: expect.arrayContaining(['Array', 'Promise', 'Function']),
      })
    })

    // #14729：即使 Vue ref 包装类型的来源模块不可解析，联合中的已知 wrapper 仍可尽力推导。
    // 六种 Vue Ref 包装从未知模块导入；引用解析失败后按名称兜底，Ref 为 Object，MaybeRef/OrGetter 加实参及 Function。
    test('Vue ref wrapper types in union are inferred when source is unresolvable', () => {
      expect(
        resolve(`
        import type {
          MaybeRef,
          Ref,
          ShallowRef,
          ComputedRef,
          WritableComputedRef,
          MaybeRefOrGetter,
        } from 'unresolvable-pkg-xyz'
        defineProps<{
          a?: MaybeRef<string[]> | Promise<string[]> | (() => string[])
          b?: Ref<number>
          c?: ShallowRef<number>
          d?: ComputedRef<number>
          e?: WritableComputedRef<number>
          f?: MaybeRefOrGetter<boolean>
        }>()
      `).props,
      ).toStrictEqual({
        a: ['Object', 'Array', 'Promise', 'Function'],
        b: ['Object'],
        c: ['Object'],
        d: ['Object'],
        e: ['Object'],
        f: ['Object', 'Function', 'Boolean'],
      })
    })
  })

  // 泛型：验证实参在类型字面量、交叉、别名、接口和外部文件中的替换。
  describe('generics', () => {
    // 泛型 Props<T>=T，传对象字面量；在实例化作用域替换 T，展开 foo:String。
    test('generic with type literal', () => {
      expect(
        resolve(`
        type Props<T> = T
        defineProps<Props<{ foo: string }>>()
      `).props,
      ).toStrictEqual({
        foo: ['String'],
      })
    })

    // 泛型 Props<T,U> 交叉两实参与本地字段；替换后合并 foo/bar/baz 三项。
    test('generic used in intersection', () => {
      expect(
        resolve(`
        type Foo = { foo: string; }
        type Bar = { bar: number; }
        type Props<T,U> = T & U & { baz: boolean }
        defineProps<Props<Foo, Bar>>()
      `).props,
      ).toStrictEqual({
        foo: ['String'],
        bar: ['Number'],
        baz: ['Boolean'],
      })
    })

    // 多层泛型别名套 Readonly/Partial；逐层传递实参，最终展开原 Foo 的 String 字段。
    test('generic type /w generic type alias', () => {
      expect(
        resolve(`
        type Aliased<T> = Readonly<Partial<T>>
        type Props<T> = Aliased<T>
        type Foo = { foo: string; }
        defineProps<Props<Foo>>()
      `).props,
      ).toStrictEqual({
        foo: ['String'],
      })
    })

    // 泛型对象别名字段 foo:T；string 实参进入字段 ownerScope，运行时推导正确。
    test('generic type /w aliased type literal', () => {
      expect(
        resolve(`
        type Aliased<T> = { foo: T }
        defineProps<Aliased<string>>()
      `).props,
      ).toStrictEqual({
        foo: ['String'],
      })
    })

    // interface Props<T> 引用类型别名 Foo；先解析实际参数再替换成员 T，得到 String。
    test('generic type /w interface', () => {
      expect(
        resolve(`
        interface Props<T> {
          foo: T
        }
        type Foo = string
        defineProps<Props<Foo>>()
      `).props,
      ).toStrictEqual({
        foo: ['String'],
      })
    })

    // 从虚拟外部 foo.ts 导入 P<T>；实参 string 在外部声明作用域实例化，foo 仍为 String。
    test('generic from external-file', () => {
      const files = {
        '/foo.ts': 'export type P<T> = { foo: T }',
      }
      const { props } = resolve(
        `
        import { P } from './foo'
        defineProps<P<string>>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
      })
    })
  })

  // 外部类型：模块解析、re-export、namespace、tsconfig paths/references 与 HMR 依赖登记。
  describe('external type imports', () => {
    // 相对导入 TS 与 d.ts 具名再导出，声明文件含仅声明语法；正确解析两项 props，deps 记录两个类型文件。
    test('relative ts', () => {
      const files = {
        '/foo.ts': 'export type P = { foo: number }',
        '/bar.d.ts':
          'type X = { bar: string }; export { X as Y };' +
          // 验证解析器支持仅在 .d.ts 声明上下文中合法的语法。
          'export const baz: boolean',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo'
        import { Y as PP } from './bar'
        defineProps<P & PP>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // #10635：省略扩展名的相对导入必须尝试 `.tsx`，不能只查 `.ts`。
    // 省略扩展名导入 .tsx 文件与目录 index.tsx；扩展探测找到两者，props 与 deps 顺序正确。
    test('relative tsx', () => {
      const files = {
        '/foo.tsx': 'export type P = { foo: number }',
        '/bar/index.tsx': 'export type PP = { bar: string }',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo'
        import { PP } from './bar'
        defineProps<P & PP>()
        `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 仅 Windows 执行：盘符/反斜杠路径含同目录和父目录导入；props 合并三项、deps 经 normalize 比较，验证路径解析和依赖收集。
    test.runIf(process.platform === 'win32')('relative ts on Windows', () => {
      const files = {
        'C:\\Test\\FolderA\\foo.ts': 'export type P = { foo: number }',
        'C:\\Test\\FolderA\\bar.d.ts':
          'type X = { bar: string }; export { X as Y };' +
          // 验证解析器支持仅在 .d.ts 声明上下文中合法的语法。
          'export const baz: boolean',
        'C:\\Test\\FolderB\\buz.ts': 'export type Z = { buz: string }',
      }
      const { props, deps } = resolve(
        `
      import { P } from './foo'
      import { Y as PP } from './bar'
      import { Z as PPP } from '../FolderB/buz'
      defineProps<P & PP & PPP>()
    `,
        files,
        {},
        'C:\\Test\\FolderA\\Test.vue',
      )
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
        buz: ['String'],
      })
      expect(deps && [...deps].map(normalize)).toStrictEqual(
        Object.keys(files).map(normalize),
      )
    })

    // #8244：外部文件中的 Required<A> 在声明文件作用域中解析 A。
    // 外部 B=Required<A> 且 A 未导出；B 的 ownerScope 能读取文件本地 A，得到 Number。
    test('utility type in external file', () => {
      const files = {
        '/foo.ts': 'type A = { n?: number }; export type B = Required<A>',
      }
      const { props } = resolve(
        `
        import { B } from './foo'
        defineProps<B>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        n: ['Number'],
      })
    })

    // 分别导入普通 TS script 与 TSX setup 的 Vue 文件；提取各脚本类型并记录两个 .vue 依赖。
    test('relative vue', () => {
      const files = {
        '/foo.vue':
          '<script lang="ts">export type P = { foo: number }</script>',
        '/bar.vue':
          '<script setup lang="tsx">export type P = { bar: string }</script>',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo.vue'
        import { P as PP } from './bar.vue'
        defineProps<P & PP>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // foo.ts 导入嵌套 Vue 类型并交叉本地字段；递归跨文件解析，deps 收集两级路径。
    test('relative (chained)', () => {
      const files = {
        '/foo.ts': `import type { P as PP } from './nested/bar.vue'
          export type P = { foo: number } & PP`,
        '/nested/bar.vue':
          '<script setup lang="ts">export type P = { bar: string }</script>',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo'
        defineProps<P>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // foo.ts 把 bar.P 再导出为 PP，SFC 又别名为 P；沿再导出映射找到 String 并登记两级依赖。
    test('relative (chained, re-export)', () => {
      const files = {
        '/foo.ts': `export { P as PP } from './bar'`,
        '/bar.ts': 'export type P = { bar: string }',
      }
      const { props, deps } = resolve(
        `
        import { PP as P } from './foo'
        defineProps<P>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // foo.ts export * from bar；合并导出类型表后 P 可见，两文件均进入 deps。
    test('relative (chained, export *)', () => {
      const files = {
        '/foo.ts': `export * from './bar'`,
        '/bar.ts': 'export type P = { bar: string }',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo'
        defineProps<P>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 分别默认导出 interface 与别名标识符；default 类型映射解析两种形状并合并字段。
    test('relative (default export)', () => {
      const files = {
        '/foo.ts': `export default interface P { foo: string }`,
        '/bar.ts': `type X = { bar: string }; export default X`,
      }
      const { props, deps } = resolve(
        `
        import P from './foo'
        import X from './bar'
        defineProps<P & X>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 分别再导出原 default 与具名 PP as default；两个默认导入沿源模块解析，deps 去重共享 foo。
    test('relative (default re-export)', () => {
      const files = {
        '/bar.ts': `export { default } from './foo'`,
        '/foo.ts': `export default interface P { foo: string }; export interface PP { bar: number }`,
        '/baz.ts': `export { PP as default } from './foo'`,
      }
      const { props, deps } = resolve(
        `
        import P from './bar'
        import PP from './baz'
        defineProps<P & PP>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
        bar: ['Number'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // baz 从两个文件以 default as X/XX 再导出；内部导入键避免同名 default 冲突，字段与三项 deps 正确。
    test('relative (re-export /w same source type name)', () => {
      const files = {
        '/foo.ts': `export default interface P { foo: string }`,
        '/bar.ts': `export default interface PP { bar: number }`,
        '/baz.ts': `export { default as X } from './foo'; export { default as XX } from './bar'; `,
      }
      const { props, deps } = resolve(
        `import { X, XX } from './baz'
        defineProps<X & XX>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
        bar: ['Number'],
      })
      expect(deps && [...deps]).toStrictEqual(['/baz.ts', '/foo.ts', '/bar.ts'])
    })

    // 顶层及字段类型使用 import('./file').Type；动态类型导入沿相对模块解析并登记 foo/bar 两级依赖。
    test('relative (dynamic import)', () => {
      const files = {
        '/foo.ts': `export type P = { foo: string, bar: import('./bar').N }`,
        '/bar.ts': 'export type N = number',
      }
      const { props, deps } = resolve(
        `
        defineProps<import('./foo').P>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
        bar: ['Number'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 导入 interface 后索引可选 required；联合保留 Boolean/String/Unknown，未定义值不能误窄化。
    test('relative import with indexed access type', () => {
      const files = {
        '/foo.ts': `
          type Booleanish = boolean | 'true' | 'false';
          export interface InputHTMLAttributes {
            required?: Booleanish | undefined;
          }
        `,
      }
      const { props, deps } = resolve(
        `
        import { InputHTMLAttributes } from './foo.ts'
        type ImportedType = InputHTMLAttributes['required']
        defineProps<{
          required: ImportedType,
        }>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        required: ['Boolean', 'String', 'Unknown'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 索引字段所在 interface 继承无法展开的条件映射类型；字段运行时推导启用 extends 软失败，仍得到本地 required 的已知联合。
    test('relative import with indexed access type with unresolvable extends', () => {
      const files = {
        '/foo.ts': `
          type EventHandlers<E> = {
            [K in keyof E]?: E[K] extends (...args: any) => any 
            ? E[K] 
            : (payload: E[K]) => void;
          };
          export interface Events {
            onCopy: ClipboardEvent;
          }
          type Booleanish = boolean | 'true' | 'false';
          export interface InputHTMLAttributes extends EventHandlers<Events>{
            required?: Booleanish | undefined;
          }
        `,
      }
      const { props, deps } = resolve(
        `
        import { InputHTMLAttributes } from './foo.ts'
        type ImportedType = InputHTMLAttributes['required']
        defineProps<{
          required: ImportedType,
        }>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        required: ['Boolean', 'String', 'Unknown'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // #8339：类型导入写成 `.js` 扩展名时，TS 规则应回查对应 `.ts`/`.d.ts` 源文件。
    // d.ts 内类型导入用 .js 扩展名；扩展探测回查 bar.d.ts，得到字面量联合的 String 构造器。
    test('relative, .js import', () => {
      const files = {
        '/foo.d.ts':
          'import { PP } from "./bar.js"; export type P = { foo: PP }',
        '/bar.d.ts': 'export type PP = "foo" | "bar"',
      }
      const { props, deps } = resolve(
        `
        import { P } from './foo'
        defineProps<P>()
      `,
        files,
      )
      expect(props).toStrictEqual({
        foo: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // 虚拟 package.json types 与 tsconfig paths 分别解析 foo/bar；使用 TS resolver，只将实际类型文件加入 deps。
    test('ts module resolve', () => {
      const files = {
        '/node_modules/foo/package.json': JSON.stringify({
          types: 'index.d.ts',
        }),
        '/node_modules/foo/index.d.ts': 'export type P = { foo: number }',
        '/tsconfig.json': JSON.stringify({
          compilerOptions: {
            paths: {
              bar: ['./pp.ts'],
            },
          },
        }),
        '/pp.ts': 'export type PP = { bar: string }',
      }

      const { props, deps } = resolve(
        `
        import { P } from 'foo'
        import { PP } from 'bar'
        defineProps<P & PP>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual([
        '/node_modules/foo/index.d.ts',
        '/pp.ts',
      ])
    })

    // 根 tsconfig 引用 app、app extends web；子配置的 paths 生效，User 解析到 user.ts 并登记依赖。
    test('ts module resolve w/ project reference & extends', () => {
      const files = {
        '/tsconfig.json': JSON.stringify({
          references: [
            {
              path: './tsconfig.app.json',
            },
          ],
        }),
        '/tsconfig.app.json': JSON.stringify({
          include: ['**/*.ts', '**/*.vue'],
          extends: './tsconfig.web.json',
        }),
        '/tsconfig.web.json': JSON.stringify({
          compilerOptions: {
            composite: true,
            paths: {
              bar: ['./user.ts'],
            },
          },
        }),
        '/user.ts': 'export type User = { bar: string }',
      }

      const { props, deps } = resolve(
        `
        import { User } from 'bar'
        defineProps<User>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(['/user.ts'])
    })

    // #13484：project references、extends 与 `${configDir}` 组合时要选择正确 tsconfig 解析模块。
    // project reference、数组 extends 与 ${configDir} 同时出现；按最终项目目录展开 paths/include，定位 src/types.ts。
    test('ts module resolve w/ project reference & extends & ${configDir}', () => {
      const files = {
        '/tsconfig.json': JSON.stringify({
          files: [],
          references: [{ path: './tsconfig.app.json' }],
        }),
        '/tsconfig.app.json': JSON.stringify({
          extends: ['./tsconfigs/base.json'],
        }),
        '/tsconfigs/base.json': JSON.stringify({
          compilerOptions: {
            paths: {
              '@/*': ['${configDir}/src/*'],
            },
          },
          include: ['${configDir}/src/**/*.ts', '${configDir}/src/**/*.vue'],
        }),
        '/src/types.ts':
          'export type BaseProps = { foo?: string, bar?: string }',
      }

      const { props, deps } = resolve(
        `
        import { BaseProps } from '@/types.ts';
        defineProps<BaseProps>()
        `,
        files,
        {},
        '/src/components/Foo.vue',
      )

      expect(props).toStrictEqual({
        foo: ['String'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(['/src/types.ts'])
    })

    // references 指向 web、empty 和不存在目录；读取存在的项目配置并选择能解析 bar 的 web paths，忽略缺失引用。
    test('ts module resolve w/ project reference folder', () => {
      const files = {
        '/tsconfig.json': JSON.stringify({
          references: [
            {
              path: './web',
            },
            {
              path: './empty',
            },
            {
              path: './noexists-should-ignore',
            },
          ],
        }),
        '/web/tsconfig.json': JSON.stringify({
          include: ['../**/*.ts', '../**/*.vue'],
          compilerOptions: {
            composite: true,
            paths: {
              bar: ['../user.ts'],
            },
          },
        }),
        // 此引用项目不提供 bar 的 paths 映射；当前用例应选中前面的 web 配置。
        '/empty/tsconfig.json': JSON.stringify({
          compilerOptions: {
            composite: true,
          },
        }),
        '/user.ts': 'export type User = { bar: string }',
      }

      const { props, deps } = resolve(
        `
        import { User } from 'bar'
        defineProps<User>() 
        `,
        files,
      )

      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(['/user.ts'])
    })

    // #11382：循环 project references 必须通过 visited/cache 终止，且仍能找到已导出的类型。
    // 两份 tsconfig 互相 references；visited 终止循环，仍能用 web 的 paths 找到 User。
    test('ts module resolve circular project reference', () => {
      const files = {
        '/tsconfig.json': JSON.stringify({
          exclude: ['**/*.ts', '**/*.vue'],
          references: [
            {
              path: './tsconfig.web.json',
            },
          ],
        }),
        '/tsconfig.web.json': JSON.stringify({
          include: ['**/*.ts', '**/*.vue'],
          compilerOptions: {
            composite: true,
            paths: {
              user: ['./user.ts'],
            },
          },
          references: [
            {
              // 循环引用必须被检测并终止，不能无限递归解析。
              path: './tsconfig.json',
            },
          ],
        }),
        '/user.ts': 'export type User = { bar: string }',
      }

      const { props, deps } = resolve(
        `
        import { User } from 'user'
        defineProps<User>() 
        `,
        files,
      )

      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(['/user.ts'])
    })

    // tsconfig paths alias 指向 Foo.vue；文件系统适配 Vue 路径并解析其中 TS 类型，deps 保存真实 .vue。
    test('ts module resolve w/ path aliased vue file', () => {
      const files = {
        '/tsconfig.json': JSON.stringify({
          compilerOptions: {
            include: ['**/*.ts', '**/*.vue'],
            paths: {
              '@/*': ['./src/*'],
            },
          },
        }),
        '/src/Foo.vue':
          '<script lang="ts">export type P = { bar: string }</script>',
      }

      const { props, deps } = resolve(
        `
        import { P } from '@/Foo.vue'
        defineProps<P>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(['/src/Foo.vue'])
    })

    // globalTypeFiles 同时加载 ambient namespace 与带 export 的模块；后者只取 declare global 中的 PP，避免模块私有声明覆盖全局。
    test('global types', () => {
      const files = {
        // 普通环境声明位于文件自身的声明作用域中。
        '/app.d.ts':
          'declare namespace App { interface User { name: string } }',
        // 外部模块中只有 declare global 块会扩展全局作用域。
        '/global.d.ts': `
          declare type PP = { bar: number }
          declare global {
            type PP = { bar: string }
          }
          export {}
        `,
      }

      const { props, deps } = resolve(`defineProps<App.User & PP>()`, files, {
        globalTypeFiles: Object.keys(files),
      })

      expect(props).toStrictEqual({
        name: ['String'],
        bar: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual(Object.keys(files))
    })

    // declare global 内显式 export interface/type；两次解析各自名称，导出包装不妨碍登记全局类型。
    test('global types with named exports', () => {
      const files = {
        '/global.d.ts': `
          declare global {
            export interface ExportedInterface { foo: number }
            export type ExportedType = { bar: boolean }
          }
          export {}
        `,
      }

      const globalTypeFiles = { globalTypeFiles: Object.keys(files) }

      expect(
        resolve(`defineProps<ExportedInterface>()`, files, globalTypeFiles)
          .props,
      ).toStrictEqual({
        foo: ['Number'],
      })

      expect(
        resolve(`defineProps<ExportedType>()`, files, globalTypeFiles).props,
      ).toStrictEqual({
        bar: ['Boolean'],
      })
    })

    // declare global 分别具名再导出 Foo/Bar 与 export * Baz；每次只登记实际使用的源类型 deps，保留全局声明文件。
    test('global types with re-exports', () => {
      const files = {
        '/foo.ts': `export interface Foo { foo: number }`,
        '/bar.ts': `export interface Bar { bar: boolean }`,
        '/baz.ts': `export interface Baz { baz: string }`,
        '/global.d.ts': `
          declare global {
            export type { Foo } from './foo'
            export { Bar } from './bar'
            export * from './baz'
          }
          export {}
        `,
      }

      const globalTypeFiles = { globalTypeFiles: ['/global.d.ts'] }

      const fooRes = resolve(`defineProps<Foo>()`, files, globalTypeFiles)
      expect(fooRes.props).toStrictEqual({
        foo: ['Number'],
      })
      expect(fooRes.deps && [...fooRes.deps]).toStrictEqual([
        '/global.d.ts',
        '/foo.ts',
      ])

      const barRes = resolve(`defineProps<Bar>()`, files, globalTypeFiles)
      expect(barRes.props).toStrictEqual({
        bar: ['Boolean'],
      })
      expect(barRes.deps && [...barRes.deps]).toStrictEqual([
        '/global.d.ts',
        '/bar.ts',
      ])

      const bazRes = resolve(`defineProps<Baz>()`, files, globalTypeFiles)
      expect(bazRes.props).toStrictEqual({
        baz: ['String'],
      })
      expect(bazRes.deps && [...bazRes.deps]).toStrictEqual([
        '/global.d.ts',
        '/baz.ts',
      ])
    })

    // 全局 Foo 来自外部模块并引用该模块的 import Name；保留 ownerScope，不在 global 文件错误查找 Name。
    test('global types with re-exports preserve source-module scope', () => {
      const files = {
        '/types.ts': `export type Name = string`,
        '/foo.ts': `
          import type { Name } from './types'
          export interface Foo { name: Name }
        `,
        '/global.d.ts': `
          declare global {
            export type { Foo } from './foo'
          }
          export {}
        `,
      }

      expect(
        resolve(`defineProps<Foo>()`, files, {
          globalTypeFiles: ['/global.d.ts'],
        }).props,
      ).toStrictEqual({
        name: ['String'],
      })
    })

    // 全局再导出使用包目录相对路径，package.json types 指向 dist；解析目录声明入口并记录实际 index.d.ts。
    test('global types with re-exports from package directory', () => {
      const files = {
        '/node_modules/pkg/package.json': `{ "types": "dist/index.d.ts" }`,
        '/node_modules/pkg/dist/index.d.ts': `
          export interface PackageType { value: string }
        `,
        '/global.d.ts': `
          declare global {
            export type { PackageType } from './node_modules/pkg'
          }
          export {}
        `,
      }

      const { props, deps } = resolve(`defineProps<PackageType>()`, files, {
        globalTypeFiles: ['/global.d.ts'],
      })

      expect(props).toStrictEqual({
        value: ['String'],
      })
      expect(deps && [...deps]).toStrictEqual([
        '/global.d.ts',
        '/node_modules/pkg/dist/index.d.ts',
      ])
    })

    // 第一次解析全局 Foo 后第二次保留缓存，Foo extends Base 且字段引用 Name；两次 deps 均含 global/foo/base/types，缓存命中补登记 ownerScope。
    test('global types with re-exports track source deps after cache reuse', () => {
      const files = {
        '/base.ts': `export interface Base { age: number }`,
        '/types.ts': `export type Name = string`,
        '/foo.ts': `
          import type { Base } from './base'
          import type { Name } from './types'
          export interface Foo extends Base { name: Name }
        `,
        '/global.d.ts': `
          declare global {
            export type { Foo } from './foo'
          }
          export {}
        `,
      }
      const globalTypeFiles = { globalTypeFiles: ['/global.d.ts'] }
      const expectedDeps = ['/global.d.ts', '/foo.ts', '/base.ts', '/types.ts']

      const { deps: coldDeps } = resolve(
        `defineProps<Foo>()`,
        files,
        globalTypeFiles,
      )
      expect(coldDeps && [...coldDeps]).toStrictEqual(expectedDeps)

      const { deps } = resolve(
        `defineProps<Foo>()`,
        files,
        globalTypeFiles,
        '/Other.vue',
        false,
      )

      expect(deps && [...deps]).toStrictEqual(expectedDeps)
    })

    // ambient App.Data 与 App.Data.Listings 分别声明类型且相互引用；合并嵌套 namespace，字段推导 String/Object。
    test('global types with ambient references', () => {
      const files = {
        // globalTypeFiles 加载 ambient namespace，并解析嵌套 namespace 中的类型引用。
        '/backend.d.ts': `
          declare namespace App.Data {
            export type AircraftData = {
              id: string
              manufacturer: App.Data.Listings.ManufacturerData
            }
          }
          declare namespace App.Data.Listings {
            export type ManufacturerData = {
              id: string
            }
          }
        `,
      }

      const { props } = resolve(`defineProps<App.Data.AircraftData>()`, files, {
        globalTypeFiles: Object.keys(files),
      })

      expect(props).toStrictEqual({
        id: ['String'],
        manufacturer: ['Object'],
      })
    })

    // declare global 的 Options 对象再索引 code；全局符号解析后展开 selected:Boolean。
    test('declare global with indexed access type', () => {
      const files = {
        '/global.d.ts': `
          declare global {
            type Options = {
              code: {
                selected: boolean
              }
            }
          }`,
      }
      const { props } = resolve(`defineProps<Options["code"]>()`, files, {
        globalTypeFiles: Object.keys(files),
      })

      expect(props).toStrictEqual({
        selected: ['Boolean'],
      })
    })

    // 同一 d.ts 列为 globalTypeFiles 且含顶层模块导出 Foo；显式模块 import 仍可读取 Foo，模块与全局 scope 缓存隔离。
    test('global type file with top-level exports is also importable', () => {
      const files = {
        '/globalTypes.d.ts': `export interface Foo { bar: string }`,
      }
      const { props, deps } = resolve(
        `
        import type { Foo } from './globalTypes'
        defineProps<Foo>()
        `,
        files,
        { globalTypeFiles: ['/globalTypes.d.ts'] },
      )
      expect(props).toStrictEqual({
        bar: ['String'],
      })
      expect(deps && [...deps]).toContain('/globalTypes.d.ts')
    })

    // 先以未知全局类型触发全局 scope 缓存，再保留缓存从同一文件显式导入 Foo；第一次错误只用于预热，第二次应得到 String，验证全局与模块缓存隔离。
    test(
      'global type file with top-level exports is importable ' +
        'after global-scope load',
      () => {
        const files = {
          '/globalTypes.d.ts': `export interface Foo { bar: string }`,
        }
        // 第一次编译故意引用未知名称，使解析回退到全局作用域，并以 `asGlobal=true`
        // 加载、缓存 `/globalTypes.d.ts`。这模拟开发服务器中的实际顺序：一个 SFC
        // 先触发全局类型加载，另一个 SFC 随后从同一文件导入类型。第一次编译虽会因
        // 未知引用失败，但抛错前已产生缓存；这里用于验证该缓存不会污染后续模块解析。
        try {
          resolve(
            `defineProps<UnknownGlobal>()`,
            files,
            { globalTypeFiles: ['/globalTypes.d.ts'] },
            '/PrimeGlobal.vue',
          )
        } catch {}

        const { props, deps } = resolve(
          `
          import type { Foo } from './globalTypes'
          defineProps<Foo>()
          `,
          files,
          { globalTypeFiles: ['/globalTypes.d.ts'] },
          '/Importer.vue',
          false /* 保留前次全局作用域缓存 */,
        )
        expect(props).toStrictEqual({
          bar: ['String'],
        })
        expect(deps && [...deps]).toContain('/globalTypes.d.ts')
      },
    )

    // #9871：同一泛型声明以不同实参使用时不能复用首个展开缓存，否则 prop 类型会串线。
    // 同一外部 Foo<T> 先用 string 后保留缓存用 number；泛型展开不能复用首个实参结果，value 两次分别为 String/Number。
    test('shared generics with different args', () => {
      const files = {
        '/foo.ts': `export interface Foo<T> { value: T }`,
      }
      const { props } = resolve(
        `import type { Foo } from './foo'
        defineProps<Foo<string>>()`,
        files,
        undefined,
        `/One.vue`,
      )
      expect(props).toStrictEqual({
        value: ['String'],
      })
      const { props: props2 } = resolve(
        `import type { Foo } from './foo'
        defineProps<Foo<number>>()`,
        files,
        undefined,
        `/Two.vue`,
        false /* 保留外部泛型声明缓存 */,
      )
      expect(props2).toStrictEqual({
        value: ['Number'],
      })
    })
  })

  // 失败诊断：不支持的语法、无法解析的模块/类型和 extends 软失败边界。
  describe('errors', () => {
    // 宏顶层引用不存在 X；结构展开必须得到属性集合，故抛 Unresolvable type reference。
    test('failed type reference', () => {
      expect(() => resolve(`defineProps<X>()`)).toThrow(
        `Unresolvable type reference`,
      )
    })

    // 类型字面量采用动态 [Foo] 键；无法生成固定 prop 名，抛 unsupported computed key。
    test('unsupported computed keys', () => {
      expect(() => resolve(`defineProps<{ [Foo]: string }>()`)).toThrow(
        `Unsupported computed key in type referenced by a macro`,
      )
    })

    // 宏类型是无法解析的 X[K]；索引对象/键无法有限展开，抛 unsupported index type。
    test('unsupported index type', () => {
      expect(() => resolve(`defineProps<X[K]>()`)).toThrow(
        `Unsupported type when resolving index type`,
      )
    })

    // 相对导入 ./foo 不存在而作为宏顶层类型；文件解析失败给出具体 source 诊断。
    test('failed import source resolve', () => {
      expect(() =>
        resolve(`import { X } from './foo'; defineProps<X>()`),
      ).toThrow(`Failed to resolve import source "./foo"`)
    })

    // 字段类型分别为未知 T、T['bar'] 和未知模块 P；运行时构造器推导是软失败路径，三个分支均不阻断结构展开。
    test('should not error on unresolved type when inferring runtime type', () => {
      expect(() => resolve(`defineProps<{ foo: T }>()`)).not.toThrow()
      expect(() => resolve(`defineProps<{ foo: T['bar'] }>()`)).not.toThrow()
      expect(() =>
        resolve(`
        import type P from 'unknown'
        defineProps<{ foo: P }>()
      `),
      ).not.toThrow()
    })

    // interface 顶层 extends 未知 Base；结构解析拒绝缺失父级并提示 @vue-ignore。
    test('error against failed extends', () => {
      expect(() =>
        resolve(`
        import type Base from 'unknown'
        interface Props extends Base {}
        defineProps<Props>()
      `),
      ).toThrow(`@vue-ignore`)
    })

    // 未知 Base 的 extends 标 @vue-ignore；跳过父级且保留本地 foo:String，不再抛 extends 错误。
    test('allow ignoring failed extends', () => {
      let res: any

      expect(
        () =>
          (res = resolve(`
        import type Base from 'unknown'
        interface Props extends /*@vue-ignore*/ Base {
          foo: string
        }
        defineProps<Props>()
      `)),
      ).not.toThrow(`@vue-ignore`)

      expect(res.props).toStrictEqual({
        foo: ['String'],
      })
    })
  })

  // 模板字面量作为 mapped key 时，展开有限插值集合并生成属性名。
  describe('template literals', () => {
    // mapped key 用 a|b 并 as 模板后缀；实例化每个 K，得到 a_foo/b_foo 两个 String 字段。
    test('mapped types with string type', () => {
      expect(
        resolve(`
      type X = 'a' | 'b'
      defineProps<{[K in X as \`\${K}_foo\`]: string}>()
      `).props,
      ).toStrictEqual({
        a_foo: ['String'],
        b_foo: ['String'],
      })
    })

    // #10962：映射类型的 key/value 依赖泛型参数时，应在实例化作用域完成替换后再展开属性。
    // 泛型 BreakpointFactory 的前缀与值类型都来自实参；Capitalize 作用于每个断点，生成 colsSm/Md/Lg:Number。
    test('mapped types with generic parameters', () => {
      const { props } = resolve(`
      type Breakpoints = 'sm' | 'md' | 'lg'
      type BreakpointFactory<T extends string, V> = {
        [K in Breakpoints as \`\${T}\${Capitalize<K>}\`]: V
      }
      type ColsBreakpoints = BreakpointFactory<'cols', number>
      defineProps<ColsBreakpoints>()
      `)
      expect(props).toStrictEqual({
        colsSm: ['Number'],
        colsMd: ['Number'],
        colsLg: ['Number'],
      })
    })

    // Vue/CSS 资源旁有 .d.vue.ts/.d.css.ts 声明；优先使用任意扩展声明文件，得到 Number/String。
    test('allowArbitraryExtensions', () => {
      const files = {
        '/foo.d.vue.ts': 'export type Foo = number;',
        '/foo.vue': '<template><div /></template>',
        '/bar.d.css.ts': 'export type Bar = string;',
        '/bar.css': ':root { --color: red; }',
      }

      const { props } = resolve(
        `
        import { Foo } from './foo.vue'
        import { Bar } from './bar.css'
        defineProps<{ foo: Foo; bar: Bar }>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
      })
    })

    // https://github.com/vuejs/router/issues/2611
    // mjs/jsx/cjs 模块旁提供 d.mts/d.ts/d.cts；按扩展映射找声明而非解析运行时 JS，四项 props 构造器正确。
    test('modular js extension', () => {
      const files = {
        '/mts.mjs': 'export {}',
        '/mts.d.mts': 'export type LinkProps = { activeClass: string }',
        '/tsx.jsx': 'export {}',
        '/tsx.d.ts': 'export type Foo = number',
        '/mtsTyped.mjs': 'export {}',
        '/mtsTyped.d.ts': 'export type Bar = string',
        '/cts.cjs': 'module.exports = {}',
        '/cts.d.cts': `export type Baz = boolean`,
      }

      let props!: Record<string, string[]>
      expect(() => {
        props = resolve(
          `
        import type { LinkProps } from './mts.mjs'
        import { Foo } from './tsx.jsx'
        import { Bar } from './mtsTyped.mjs'
        import type { Baz } from './cts.cjs'
        defineProps<LinkProps & { foo: Foo; bar: Bar; baz: Baz }>()
        `,
          files,
        ).props
      }).not.toThrow()
      expect(props).not.toBe(undefined)
      expect(props).toStrictEqual({
        foo: ['Number'],
        bar: ['String'],
        baz: ['Boolean'],
        activeClass: ['String'],
      })
    })

    // .mjs 同时有 .ts 和 .mts 候选；模块类别专用 .mts 优先，value 为 String。
    test('prefer .mts over .ts for .mjs import', () => {
      const files = {
        '/foo.mjs': 'export {}',
        '/foo.ts': 'export type Foo = number',
        '/foo.mts': 'export type Foo = string',
      }

      const { props } = resolve(
        `
        import type { Foo } from './foo.mjs'
        defineProps<{ value: Foo }>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        value: ['String'],
      })
    })

    //  .mjs 同时有 .d.ts 与 .d.mts；优先 .d.mts，value 为 String。
    test('prefer .d.mts over .d.ts for .mjs import', () => {
      const files = {
        '/foo.mjs': 'export {}',
        '/foo.d.ts': 'export type Foo = number',
        '/foo.d.mts': 'export type Foo = string',
      }

      const { props } = resolve(
        `
        import type { Foo } from './foo.mjs'
        defineProps<{ value: Foo }>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        value: ['String'],
      })
    })

    //  .cjs 同时有 .d.ts 与 .d.cts；优先 .d.cts，value 为 Boolean。
    test('prefer .d.cts over .d.ts for .cjs import', () => {
      const files = {
        '/foo.cjs': 'module.exports = {}',
        '/foo.d.ts': 'export type Foo = number',
        '/foo.d.cts': 'export type Foo = boolean',
      }

      const { props } = resolve(
        `
        import type { Foo } from './foo.cjs'
        defineProps<{ value: Foo }>()
        `,
        files,
      )

      expect(props).toStrictEqual({
        value: ['Boolean'],
      })
    })
  })
})

/**
 * 用虚拟文件系统建立 ScriptCompileContext，解析代码中的 defineProps 类型并返回推导结果。
 * invalidateCache 默认隔离用例；显式关闭时用于验证跨次编译的模块/全局作用域缓存。
 */
function resolve(
  code: string,
  files: Record<string, string> = {},
  options?: Partial<SFCScriptCompileOptions>,
  sourceFileName: string = '/Test.vue',
  invalidateCache = true,
) {
  const { descriptor } = parse(`<script setup lang="ts">\n${code}\n</script>`, {
    filename: sourceFileName,
  })
  const ctx = new ScriptCompileContext(descriptor, {
    id: 'test',
    fs: {
      /** 在用例虚拟文件表中按原路径或平台规范化路径检查存在性。 */
      fileExists(file) {
        return !!(files[file] ?? files[normalize(file)])
      },
      /** 从用例虚拟文件表读取类型源码。 */
      readFile(file) {
        return files[file] ?? files[normalize(file)]
      },
    },
    ...options,
  })

  if (invalidateCache) {
    for (const file in files) {
      invalidateTypeCache(file)
    }
  }

  // 正常流程由 compileScript() 收集 ctx.userImports；本测试直接调用底层解析逻辑，
  // 因此必须手动登记导入，才能还原真实编译上下文。
  ctx.userImports = recordImports(ctx.scriptSetupAst!.body) as any

  let target: any
  for (const s of ctx.scriptSetupAst!.body) {
    if (
      s.type === 'ExpressionStatement' &&
      s.expression.type === 'CallExpression' &&
      (s.expression.callee as Identifier).name === 'defineProps'
    ) {
      target = s.expression.typeParameters!.params[0]
    }
  }
  const raw = resolveTypeElements(ctx, target)
  const props: Record<string, string[]> = {}
  for (const key in raw.props) {
    props[key] = inferRuntimeType(ctx, raw.props[key])
  }
  return {
    props,
    calls: raw.calls,
    deps: ctx.deps,
    raw,
  }
}
