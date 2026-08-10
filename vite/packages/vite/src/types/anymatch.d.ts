/** Vite 内联的 anymatch 最小类型面，只保留文件监听配置实际使用的匹配能力。 */
export type AnymatchFn = (testString: string) => boolean
/** 单个文件匹配条件：glob 字符串、正则或谓词函数。 */
export type AnymatchPattern = string | RegExp | AnymatchFn
/** chokidar ignored 等选项接受单个条件或条件数组。 */
type AnymatchMatcher = AnymatchPattern | AnymatchPattern[]

export { AnymatchMatcher as Matcher }
