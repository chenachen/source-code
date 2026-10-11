import type { Plugin } from 'vite'

/** 插件拼接的预计算 inline map 注释文本；映射对应未改写的 foo-with-sourcemap.js，字面量本身由快照消费。 */
export const commentSourceMap = [
  '// default boundary sourcemap with magic-string',
  '//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHIn0=',
].join('\n')

/** 创建只追加 inline map 注释的插件，验证已有 input map 的模块不再生成重复 fallback map。 */
export default function transformFooWithInlineSourceMap(): Plugin {
  return {
    name: 'transform-foo-with-inline-sourcemap',
    /** 匹配 foo-with-sourcemap.js 后追加固定 map 文本，返回字符串而非 map 对象以触发输入注释提取。 */
    transform(code, id) {
      if (id.includes('foo-with-sourcemap.js')) {
        return `${code}${commentSourceMap}`
      }
    },
  }
}
