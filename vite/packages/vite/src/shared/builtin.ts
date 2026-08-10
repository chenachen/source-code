/**
 * 把字符串与正则 builtin 配置编译成高频匹配函数。
 * 精确字符串先走 Set，只有未命中时才依次测试正则，供 Runner 客户端快速 externalize。
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
