// 声明合并必须加入精确的 strictImportMetaEnv 键，才能关闭任意环境字段索引。
import type { ExpectFalse, ExpectTrue } from '@type-challenges/utils'

/** 空选项基线：不应误启用 strictImportMetaEnv。 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TypeOptions1 {}
/** 包含受支持键的选项，应启用严格 ImportMetaEnv 类型。 */
interface TypeOptions2 {
  /** 键是否存在即为开关，属性值本身不参与判定。 */
  strictImportMetaEnv: unknown
}
/** 只包含无关键的选项，用于排除“任意扩展键都启用”的错误实现。 */
interface TypeOptions3 {
  /** Vite 不识别的声明合并键。 */
  unknownKey: unknown
}

/** 模拟 importMeta.d.ts 通过键存在性而非属性值判断类型选项是否启用。 */
type IsEnabled<Opts, Key extends string> = Key extends keyof Opts ? true : false

/** 验证空选项、合法键与无关键三种声明合并结果。 */
export type cases = [
  ExpectFalse<IsEnabled<TypeOptions1, 'strictImportMetaEnv'>>,
  ExpectTrue<IsEnabled<TypeOptions2, 'strictImportMetaEnv'>>,
  ExpectFalse<IsEnabled<TypeOptions3, 'strictImportMetaEnv'>>,
]

export {}
