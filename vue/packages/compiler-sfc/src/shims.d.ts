/** 补齐 merge-source-map 缺失的 TypeScript 模块声明。 */
declare module 'merge-source-map' {
  /** 合并两层 source map，供样式预处理器把结果继续映射回原 SFC。 */
  export default function merge(oldMap: object, newMap: object): object
}
