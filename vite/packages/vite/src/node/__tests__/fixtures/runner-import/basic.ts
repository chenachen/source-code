/** runnerImport 夹具的类型形状，验证 TS 类型被剥离而导出值保持。 */
interface Test {
  /** 固定为 true 的字段，供导入结果和类型推断对照。 */
  field: true
}

/** 按 Test 类型导出的对象，运行结果应保留 field:true。 */
export const test: Test = {
  field: true,
}
