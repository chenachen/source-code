/** 保留在配置中的 TypeScript enum，检验兼容加载路径是否处理 TS 语法。 */
enum Mode {
  /** 默认数值 0 的开发模式成员，作为最终配置的 MODE 值。 */
  Dev,
  /** 默认数值 1 的生产模式成员，和 Dev 一起构成 enum 转换输入。 */
  Prod,
}

/** 带 number 类型断言的数值 1，作为配置 VALUE 的输入。 */
const value = 1 as number

export default {
  define: {
    __DIR__: JSON.stringify(__dirname),
    MODE: Mode.Dev,
    VALUE: value,
  },
}
