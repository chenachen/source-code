import lodash from 'lodash'

/** 用 lodash.partition 按奇偶分组的数组，检验配置跨目录 TS 依赖与外部包导入。 */
export const array = lodash.partition([1, 2, 3, 4], (n) => n % 2)
