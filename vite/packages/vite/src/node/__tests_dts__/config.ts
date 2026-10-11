/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Equal, ExpectTrue } from '@type-challenges/utils'
import {
  type UserConfig,
  type UserConfigExport,
  type UserConfigFn,
  type UserConfigFnObject,
  type UserConfigFnPromise,
  defineConfig,
} from '../config'
import { mergeConfig } from '../utils'

/** 对象输入的 defineConfig 重载保留 UserConfig，供 cases1 的精确类型断言比较。 */
const configObjectDefined = defineConfig({})
/** Promise 配置重载应保留 `Promise<UserConfig>`，供下方精确类型断言使用。 */
const configObjectPromiseDefined = defineConfig(Promise.resolve({}))
/** 同步配置函数重载应收窄为 `UserConfigFnObject`。 */
const configFnObjectDefined = defineConfig(() => ({}))
/** 异步配置函数重载应收窄为 `UserConfigFnPromise`。 */
const configFnPromiseDefined = defineConfig(async () => ({}))
/** 同步值与 Promise 联合返回的函数应归入通用 `UserConfigFn`。 */
const configFnDefined = defineConfig(() =>
  // TypeScript 要求 Promise 与非 Promise 两个分支都至少有一个属性，才能稳定推导联合。
  Math.random() > 0.5 ? { base: '' } : Promise.resolve({ base: '/' }),
)
/** 已经擦宽为 `UserConfigExport` 的输入不应被 defineConfig 再次收窄。 */
const configExportDefined = defineConfig({} as UserConfigExport)

/** 汇总 defineConfig 六种输入形态的编译期精确类型断言。 */
export type cases1 = [
  ExpectTrue<Equal<typeof configObjectDefined, UserConfig>>,
  ExpectTrue<Equal<typeof configObjectPromiseDefined, Promise<UserConfig>>>,
  ExpectTrue<Equal<typeof configFnObjectDefined, UserConfigFnObject>>,
  ExpectTrue<Equal<typeof configFnPromiseDefined, UserConfigFnPromise>>,
  ExpectTrue<Equal<typeof configFnDefined, UserConfigFn>>,
  ExpectTrue<Equal<typeof configExportDefined, UserConfigExport>>,
]

defineConfig({
  // 对象字面量接受合法项，并通过 excess-property checking 拒绝未知顶层项。
  base: '',
  build: {
    minify: 'oxc', // 对象重载应自动保留字符串字面量。
  },
  server: {
    proxy: {
      '/test': {
        /** 以 false 的上下文推导验证对象配置可直接写代理 bypass 回调。 */
        bypass: () => false,
      },
    },
  },
  // @ts-expect-error --- invalid option should error
  unknownProperty: 1,
})

// 同步函数的返回值约束嵌套字段；返回对象顶层多余字段不触发这组重载的检查。
defineConfig(() => ({
  base: '',
  build: {
    minify: 'oxc' as const, // 理想情况下函数重载也不应要求 as const。
  },
  server: {
    proxy: {
      '/test': {
        /** 显式保留 false 字面量，使同步函数返回的代理配置满足 bypass 返回类型。 */
        bypass: () => false as const,
      },
    },
  },
  unknownProperty: 1, // 当前无法捕获函数返回值的顶层未知项，作为预期限制留档。
}))

// @ts-expect-error --- nested invalid option `build.unknown` should error
defineConfig(() => ({
  base: '',
  build: {
    unknown: 1,
  },
}))

// 异步函数返回配置，与同步函数一样约束嵌套字段。
defineConfig(async () => ({
  base: '',
  build: {
    minify: 'oxc' as const, // 记录当前字面量推导限制。
  },
  server: {
    proxy: {
      '/test': {
        /** 显式保留 false 字面量，使异步函数返回的代理配置满足 bypass 返回类型。 */
        bypass: () => false as const,
      },
    },
  },
  unknownProperty: 1, // 当前无法捕获异步函数返回值的顶层未知项。
}))

// @ts-expect-error --- nested invalid option `build.unknown` should error
defineConfig(async () => ({
  base: '',
  build: {
    unknown: 1,
  },
}))

// mergeConfig 接受配置对象，不接受仍需执行的配置函数。
mergeConfig(defineConfig({}), defineConfig({}))
mergeConfig(
  // @ts-expect-error
  defineConfig(() => ({})),
  defineConfig({}),
)

export {}
