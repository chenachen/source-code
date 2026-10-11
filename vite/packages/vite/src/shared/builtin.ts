/**
 * 把字符串与正则 builtin 配置编译成高频匹配函数。
 * 精确字符串先走 Set，未命中时依次测试正则，供服务端解析与 Runner 客户端识别 builtin。
 * 字符串表在创建时固定；正则保留原对象，匹配时直接调用其 `test()`，不另做 ID 规范化。
 *
 * @param builtins - 环境允许交给宿主模块系统处理的精确 ID 或正则规则。
 * @returns 同步判定函数；命中任一规则即停止，不执行模块解析或加载。
 */
export function createIsBuiltin(
  builtins: (string | RegExp)[],
): (id: string) => boolean {
  const plainBuiltinsSet = new Set(
    builtins.filter((builtin) => typeof builtin === 'string'),
  )
  const regexBuiltins = builtins.filter(
    (builtin) => typeof builtin !== 'string',
  )

  return (id: string) =>
    plainBuiltinsSet.has(id) || regexBuiltins.some((regexp) => regexp.test(id))
}
