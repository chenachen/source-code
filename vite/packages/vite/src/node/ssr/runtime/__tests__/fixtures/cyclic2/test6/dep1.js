import { dep2 } from './dep2.js'
/** 互相读取尚在初始化的 dep1 绑定构造字符串，保留循环中的时序/TDZ 输入。 */
export const dep1 = 'dep1: ' + dep2
