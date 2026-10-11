// @ts-nocheck
import '../nested/main'
import '../nested-with-extends/main'
import './decorator'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MainTypeOnlyClass } from './not-used-type'

/** 主目录的基类，以 setter 日志观察派生字段采用赋值还是定义属性。 */
class MainBase {
  /** 记录字段赋值经过继承 setter 的副作用；值本身不保存，供 useDefineForClassFields 测试区分。 */
  set data(value: string) {
    console.log('data setter in MainBase')
  }
}
/** 主目录的派生类，声明与基类 setter 同名的实例字段；当前 useDefineForClassFields=true。 */
class MainDerived extends MainBase {
  // 主配置启用 useDefineForClassFields；定义实例字段不触发继承 setter。
  /** 定义自有属性而不调用继承 setter，主 tsconfig 的 useDefineForClassFields=true。 */
  data = 10

  /** 只在类型位置引用导入类，验证未使用的值导入是否按该目录的 verbatimModuleSyntax 保留。 */
  foo?: MainTypeOnlyClass
}

/** 实际实例化派生类以触发字段初始化，浏览器日志据此断言 setter 的调用或跳过。 */
const d = new MainDerived()
