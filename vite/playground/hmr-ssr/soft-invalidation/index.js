import { foo } from './child'

/** 把插件转换次数与依赖值拼到输出，用于区别依赖变动时软失效复用与自身变动时重新转换。 */
// @ts-expect-error global
export const msg = `soft-invalidation/index.js is transformed ${__TRANSFORM_COUNT__} times. child is ${foo}`
