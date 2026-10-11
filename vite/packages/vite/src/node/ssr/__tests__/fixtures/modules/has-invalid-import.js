import { foo } from './non-existent.js'

/** 入口的 hello 导出；此前静态导入缺失文件，使 SSR 加载先报依赖解析错误。 */
export const hello = 'world'
