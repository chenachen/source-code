/** ESM helper 将兼容加载器注入的 __dirname 序列化，供 CJS 配置的 require 路径核对。 */
export const dir = JSON.stringify(__dirname)
