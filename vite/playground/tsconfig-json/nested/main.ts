// @ts-nocheck
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NestedTypeOnlyClass } from './not-used-type'

/** nested 独立配置的基类，以 setter 日志观察派生字段采用赋值还是定义属性。 */
class NestedBase {
  /** 记录字段赋值经过继承 setter 的副作用；值本身不保存，供 useDefineForClassFields 测试区分。 */
  set data(value: string) {
    console.log('data setter in NestedBase')
  }
}
/** nested 独立配置的派生类，声明与基类 setter 同名的实例字段；当前 useDefineForClassFields=false。 */
class NestedDerived extends NestedBase {
  // 当前目录显式关闭 useDefineForClassFields；赋值初始化会触发基类 setter 日志。
  /** 以赋值初始化字段，当前 useDefineForClassFields=false 会调用继承的 setter。 */
  data = 10

  /** 只在类型位置引用导入类，验证未使用的值导入是否按该目录的 verbatimModuleSyntax 保留。 */
  foo?: NestedTypeOnlyClass
}

/** 实际实例化派生类以触发字段初始化，浏览器日志据此断言 setter 的调用或跳过。 */
const d = new NestedDerived()
