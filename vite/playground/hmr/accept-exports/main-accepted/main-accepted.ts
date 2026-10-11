import def, { a } from './target'
import { x } from './callback'

// 保留导入绑定让图分析看到使用关系，但此分支不执行，避免增加本组输出日志。
if (0 > 1) console.log(x)

console.log(`>>>>>> ${a} ${def}`)
