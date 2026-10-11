/** 初始默认导出的可重赋值 class 绑定，静态 f 最初返回 0。 */
export default class C {
  /** 当前 class 的静态函数，返回 0，用于观测 class 绑定重赋值。 */
  static f = () => 0
}

C = class {
  /** 当前 class 的静态函数，返回 1，用于观测 class 绑定重赋值。 */
  static f = () => 1
}

C = class {
  /** 当前 class 的静态函数，返回 2，用于观测 class 绑定重赋值。 */
  static f = () => 2
}

/** 将函数或 class 绑定再次替换为返回 3 的实现，供导入端再次读取。 */
export function update() {
  C = class {
    /** 当前 class 的静态函数，返回 3，用于观测 class 绑定重赋值。 */
    static f = () => 3
  }
}
