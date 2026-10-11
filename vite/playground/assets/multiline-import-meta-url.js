/** 独立的多行 new URL 夹具；参数间空行用于验证 assetImportMetaUrlPlugin 的正则过滤仍命中该表达式。 */
export const multilineUrl = new URL(
  './nested/asset.png',

  import.meta.url,
)
