/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Equal, ExpectTrue } from '@type-challenges/utils'
import type { ImportGlobFunction } from '#types/importGlob'

/**
 * 类型用例桩：组合 eager/lazy、已知/未知 query 与旧版 as 选项，验证返回值
 * 是立即模块值还是 Promise 工厂，并验证 raw/url/worker 能收窄为具体资源类型。
 */
const importGlobFunction: ImportGlobFunction = () => ({})

/** eager 且无资源查询时应直接返回模块值映射。 */
const importGlobEagerReturn = importGlobFunction('', {
  eager: true,
})

/** lazy 且无资源查询时应返回 Promise 工厂映射。 */
const importGlobNonEagerReturn = importGlobFunction('', {
  eager: false,
})

/** eager 配合已知 `?raw` 查询时，模块值应收窄为字符串。 */
const importGlobEagerReturnWithKnownQuery = importGlobFunction('', {
  eager: true,
  query: '?raw',
})

/** lazy 配合已知 `?raw` 查询时，工厂结果应收窄为字符串 Promise。 */
const importGlobNonEagerReturnWithKnownQuery = importGlobFunction('', {
  eager: false,
  query: '?raw',
})

/** eager 配合未知查询时无法推导资源类型，应保留 unknown。 */
const importGlobEagerReturnWithUnknownQuery = importGlobFunction('', {
  eager: true,
  query: '?unknown',
})

/** lazy 配合未知查询时，Promise 的载荷类型应保留 unknown。 */
const importGlobNonEagerReturnWithUnknownQuery = importGlobFunction('', {
  eager: false,
  query: '?unknown',
})

/** 旧版 eager `as: 'url'` 应映射为字符串 URL。 */
const importGlobEagerReturnWithKnownAs = importGlobFunction('', {
  eager: true,
  as: 'url',
})

/** 旧版 lazy `as: 'url'` 应映射为字符串 URL 的 Promise 工厂。 */
const importGlobNonEagerReturnWithKnownAs = importGlobFunction('', {
  eager: false,
  as: 'url',
})

/** 旧版 eager `as: 'worker'` 应直接返回 Worker 实例映射。 */
const importGlobEagerReturnWithWorkerAs = importGlobFunction('', {
  eager: true,
  as: 'worker',
})

/** 旧版 lazy `as: 'worker'` 应返回 Worker Promise 工厂映射。 */
const importGlobNonEagerReturnWithWorkerAs = importGlobFunction('', {
  eager: false,
  as: 'worker',
})

/** 编译期断言：每个调用结果必须与 ImportGlobFunction 重载约定精确相等。 */
export type cases = [
  ExpectTrue<Equal<typeof importGlobEagerReturn, Record<string, unknown>>>,
  ExpectTrue<
    Equal<
      typeof importGlobNonEagerReturn,
      Record<string, () => Promise<unknown>>
    >
  >,
  ExpectTrue<
    Equal<typeof importGlobEagerReturnWithKnownQuery, Record<string, string>>
  >,
  ExpectTrue<
    Equal<
      typeof importGlobNonEagerReturnWithKnownQuery,
      Record<string, () => Promise<string>>
    >
  >,
  ExpectTrue<
    Equal<typeof importGlobEagerReturnWithUnknownQuery, Record<string, unknown>>
  >,
  ExpectTrue<
    Equal<
      typeof importGlobNonEagerReturnWithUnknownQuery,
      Record<string, () => Promise<unknown>>
    >
  >,
  ExpectTrue<
    Equal<typeof importGlobEagerReturnWithKnownAs, Record<string, string>>
  >,
  ExpectTrue<
    Equal<
      typeof importGlobNonEagerReturnWithKnownAs,
      Record<string, () => Promise<string>>
    >
  >,
  ExpectTrue<
    Equal<typeof importGlobEagerReturnWithWorkerAs, Record<string, Worker>>
  >,
  ExpectTrue<
    Equal<
      typeof importGlobNonEagerReturnWithWorkerAs,
      Record<string, () => Promise<Worker>>
    >
  >,
]

export {}
