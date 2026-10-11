/** 运行时导入无效 exports 的包，将成功 namespace 或捕获的错误包装成 ok/data 返回值。 */
export async function test() {
  try {
    const result = await import('test-dep-invalid-exports')
    return { ok: true, data: result }
  } catch (e) {
    return { ok: false, data: e }
  }
}
