import { hello } from '@vitejs/cjs-external'

/** 调用外部包具名 hello 导出得到的 world 值，检验外部化后的 namespace 互操作。 */
export const result = hello()
