/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Equal, ExpectTrue } from '@type-challenges/utils'
import { mergeWithDefaults } from '../utils'

/** defaults 带 foo:number 而 value 缺少该键；合并类型应保留默认 foo，供 cases1 的编译期断言验证。 */
const useDefaultTypeForUndefined1 = mergeWithDefaults(
  {
    foo: 1,
  },
  {},
)

/** value 将 foo 扩宽为 `number | undefined` 时，undefined 分支仍由默认值消除。 */
const useDefaultTypeForUndefined2 = mergeWithDefaults(
  {
    foo: 1,
  },
  {
    foo: 2 as number | undefined,
  },
)

/** value 独有的 foo 键必须进入合并结果，而不能被 defaults 的空对象裁掉。 */
const includeKeyNotIncludedInDefault1 = mergeWithDefaults(
  {},
  {
    foo: 2,
  },
)

/** value 的联合类型应扩展默认键类型，得到 string 与 number 的联合。 */
const extendTypeWithValueType = mergeWithDefaults(
  {
    foo: 1,
  },
  {
    foo: 'string' as string | number,
  },
)

/** 两侧普通对象应递归合并，保留嵌套 bar 与 baz。 */
const plainObject = mergeWithDefaults({ foo: { bar: 1 } }, { foo: { baz: 2 } })

/** 数组不是普通对象，应整体替换并保留两侧数组元素类型的联合。 */
const nonPlainObject = mergeWithDefaults(
  { foo: ['foo'] },
  { foo: [0] as number[] | undefined },
)

/** 可选嵌套输入合并后应保证 foo 和 bar 可访问且不含 undefined。 */
const optionalNested = mergeWithDefaults({ foo: { bar: true } }, {
  /** value 侧可选的嵌套对象；存在时覆盖默认 foo。 */
  foo: { bar: false },
} as {
  /** 用可选 foo 模拟用户配置缺省整个嵌套段。 */
  foo?: {
    /** 用可选 bar 模拟用户只提供部分嵌套配置。 */
    bar?: boolean
  }
})

/** 编译期精确相等断言，防止工具类型在重构后丢键、过度收窄或产生 undefined。 */
export type cases1 = [
  ExpectTrue<Equal<typeof useDefaultTypeForUndefined1, {
    /** 默认值对象中的 foo 被推导为 number。 */
    foo: number
  }>>,
  ExpectTrue<Equal<typeof useDefaultTypeForUndefined2, {
    /** value 的 undefined 分支被默认值消除。 */
    foo: number
  }>>,
  ExpectTrue<Equal<typeof includeKeyNotIncludedInDefault1, {
    /** value 独有键仍进入结果。 */
    foo: number
  }>>,
  ExpectTrue<Equal<typeof extendTypeWithValueType, {
    /** 默认 number 与 value 的 string 联合共同保留。 */
    foo: string | number
  }>>,
  ExpectTrue<Equal<typeof plainObject, {
    /** 普通对象递归合并后的嵌套字段集合。 */
    foo: {
      /** 来自 defaults 的字段。 */
      bar: number;
      /** 来自 value 的字段。 */
      baz: number
    }
  }>>,
  ExpectTrue<Equal<typeof nonPlainObject, {
    /** 数组整体替换语义产生的元素类型联合。 */
    foo: string[] | number[]
  }>>,
  ExpectTrue<
    Equal<typeof optionalNested, {
      /** 无论 value 是否提供 foo，结果都保留一个确定的嵌套对象。 */
      foo: {
        /** value 存在时的布尔字段。 */
        bar: boolean
      } | {
        /** value 缺省时由 defaults 提供的布尔字段。 */
        bar: boolean
      }
    }>
  >,
]
