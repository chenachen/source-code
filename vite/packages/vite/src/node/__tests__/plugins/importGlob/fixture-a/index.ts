// 当前测试目录的 package.json 没有 #types/importMeta 映射，遮蔽仓库根映射；直接导入声明文件。
import '../../../../../../types/importMeta'

/** glob 泛型的最小模块形状，供 Oxc 上游 TS 擦除与生成代码快照使用。 */
export interface ModuleType {
  /** 每个模块输出的身份标记，对应 eager import:name 的内容。 */
  name: string
}

/** lazy glob 返回命名空间加载工厂，作为其他 Object.keys/values 快照的基准。 */
export const basic = import.meta.glob<ModuleType>('./modules/*.ts')
/** 对 lazy glob 只取键，验证只生成路径对象而无需加载工厂。 */
// prettier-ignore
export const basicWithObjectKeys = Object.keys(import.meta.glob<ModuleType>('./modules/*.ts'))
/** 对 lazy glob 只取值，验证可省略路径键而保留加载工厂。 */
// prettier-ignore
export const basicWithObjectValues = Object.values(import.meta.glob<ModuleType>('./modules/*.ts'))

/** eager glob 静态导入所有命名空间，与 lazy 代码形态区分。 */
export const basicEager = import.meta.glob<ModuleType>('./modules/*.ts', {
  eager: true,
})
/** 对 eager glob 只取键，验证无需实际模块导入的键集合优化。 */
export const basicEagerWithObjectKeys = Object.keys(
  import.meta.glob<ModuleType>('./modules/*.ts', {
    eager: true,
  }),
)
/** 对 eager glob 只取值，验证静态导入保留但对象键可省略。 */
export const basicEagerWithObjectValues = Object.values(
  import.meta.glob<ModuleType>('./modules/*.ts', {
    eager: true,
  }),
)

/** 正模式配负模式排除 modules/index.ts，固定文件过滤集合。 */
export const ignore = import.meta.glob(['./modules/*.ts', '!**/index.ts'])
/** 过滤 index.ts 后仅取路径键，核对负模式与 keys 优化组合。 */
export const ignoreWithObjectKeys = Object.keys(
  import.meta.glob(['./modules/*.ts', '!**/index.ts']),
)
/** 过滤 index.ts 后仅取加载工厂，核对负模式与 values 优化组合。 */
export const ignoreWithObjectValues = Object.values(
  import.meta.glob(['./modules/*.ts', '!**/index.ts']),
)

/** eager 模式只导入 name 导出，快照应生成命名静态 import。 */
export const namedEager = import.meta.glob<string>('./modules/*.ts', {
  eager: true,
  import: 'name',
})
/** named eager glob 只取键，验证没有使用值时可以省略静态导入。 */
export const namedEagerWithObjectKeys = Object.keys(
  import.meta.glob<string>('./modules/*.ts', {
    eager: true,
    import: 'name',
  }),
)
/** named eager glob 只取值，核对命名导入和数组化结果。 */
export const namedEagerWithObjectValues = Object.values(
  import.meta.glob<string>('./modules/*.ts', {
    eager: true,
    import: 'name',
  }),
)

/** lazy 模式选 default，加载工厂应在 import 后提取 default。 */
export const namedDefault = import.meta.glob<string>('./modules/*.ts', {
  import: 'default',
})
/** lazy default glob 只取键，验证可省略加载工厂。 */
export const namedDefaultWithObjectKeys = Object.keys(
  import.meta.glob<string>('./modules/*.ts', {
    import: 'default',
  }),
)
/** lazy default glob 只取值，保留提取 default 的工厂。 */
export const namedDefaultWithObjectValues = Object.values(
  import.meta.glob<string>('./modules/*.ts', {
    import: 'default',
  }),
)

/** eager raw 查询配 default 导出并排除 index.ts，固定原始文本的静态导入协议。 */
export const eagerAs = import.meta.glob<ModuleType>(
  ['./modules/*.ts', '!**/index.ts'],
  { eager: true, query: '?raw', import: 'default' },
)

/** lazy raw 查询配完整 namespace 导入，核对资源 query 与 import:* 的组合。 */
export const rawImportModule = import.meta.glob(
  ['./modules/*.ts', '!**/index.ts'],
  { query: '?raw', import: '*' },
)

/** 同目录 glob 必须排除当前 importer；调用内注释含右括号，另行检验括号识别。 */
export const excludeSelf = import.meta.glob(
  './*.ts',
  // 测试注释中的右括号 ")" 不应截断 glob 调用。
  /*
   * 测试块注释中的右括号 ")" 不应截断 glob 调用。
   * */
)
/** 同目录 raw glob 也排除 importer，自身不能因资源 query 重新入选。 */
export const excludeSelfRaw = import.meta.glob('./*.ts', { query: '?raw' })

/** 字符串查询未带问号，验证 query 规范化与逐导入追加。 */
export const customQueryString = import.meta.glob('./*.ts', { query: 'custom' })

/** 对象 query 含字符串和布尔值，验证序列化成查询参数。 */
export const customQueryObject = import.meta.glob('./*.ts', {
  query: {
    foo: 'bar',
    raw: true,
  },
})

/** 跨上级目录的 URL 导入，固定相对路径与 default URL 导出。 */
export const parent = import.meta.glob('../../playground/src/*.ts', {
  query: '?url',
  import: 'default',
})

/** 根 pattern 与相对兄弟目录 pattern 混用，核对键与 import 路径各自基准。 */
export const rootMixedRelative = import.meta.glob(
  ['/*.ts', '../fixture-b/*.ts'],
  { query: '?url', import: 'default' },
)

/** 显式进入 fixture node_modules 的 page glob，核对静态共同根与依赖目录枚举。 */
export const cleverCwd1 = import.meta.glob(
  './node_modules/framework/**/*.page.js',
)

/** 两个目录和负 index 模式组合，核对共同 cwd 与过滤结果。 */
export const cleverCwd2 = import.meta.glob([
  './modules/*.ts',
  '../fixture-b/*.ts',
  '!**/index.ts',
])

/** 显式相对 base 改变匹配根及输出键的基准。 */
export const customBase = import.meta.glob('./**/*.ts', { base: './' })

/** 显式根相对 base 指向 fixture-b，核对相对 pattern 的搜索根。 */
export const customRootBase = import.meta.glob('./**/*.ts', {
  base: '/fixture-b',
})

/** 根 pattern 指向 fixture-b 而 base 指向 fixture-a，核对匹配范围与键基准可不同。 */
export const customBaseParent = import.meta.glob('/fixture-b/**/*.ts', {
  base: '/fixture-a',
})

/** eager 枚举显式 .foo 隐藏目录，验证该文件参与静态导入。 */
export const dotFolder = import.meta.glob('./.foo/*.ts', { eager: true })
