import { foo } from './importee.js'

/** 直接调用具名导入 foo 的结果，供无 this 绑定的调用语义断言。 */
export const result = foo()
