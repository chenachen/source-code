// @ts-nocheck playground/tsconfig.json does not have decorators enabled
/** 返回空装饰器回调，供方法及参数同时使用，验证最近 tsconfig 的 experimentalDecorators 被扫描/转换读取。 */
function first() {
  return function (...args: any[]) {}
}

/** 带方法与参数装饰器的导出类，用于区分 experimentalDecorators 与标准装饰器语法。 */
export class Foo {
  /** 返回传入测试字符串；头部和参数装饰器本身不修改返回值，重点验证旧装饰器转换。 */
  @first()
  method(@first() test: string) {
    return test
  }
}
