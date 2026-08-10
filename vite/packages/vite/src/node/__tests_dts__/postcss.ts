import type { Equal, ExpectTrue } from '@type-challenges/utils'
import type { Config as PostcssLoadConfig } from 'postcss-load-config'
import type { PostcssUserConfig } from '../index'

/** 编译期确认 Vite PostCSS 配置与 postcss-load-config 原生 Config 精确一致。 */
export type cases = [ExpectTrue<Equal<PostcssUserConfig, PostcssLoadConfig>>]

// 数组形式 plugins 是合法配置。
;({ plugins: [] }) satisfies PostcssUserConfig

// 对象形式 plugins、关闭 sourcemap 与 from 路径也应通过结构检查。
;({
  map: false,
  from: 'src/index.css',
  plugins: { 'postcss-preset-env': {} },
}) satisfies PostcssUserConfig

;({
  // @ts-expect-error --- `map` must be `string | false`, not a number
  map: 123,
}) satisfies PostcssUserConfig

export {}
