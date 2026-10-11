import { dep1 } from './dep1.js'
/** 互相读取尚在初始化的 dep2 绑定构造字符串，保留循环中的时序/TDZ 输入。 */
export const dep2 = 'dep2: ' + dep1
