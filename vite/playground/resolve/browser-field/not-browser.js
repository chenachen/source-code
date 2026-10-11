/** 不应在浏览器路径执行的 Node fs require，作为 browser 替换未生效时的错误哨兵。 */
const fs = require('node:fs')
console.log('this should not run in the browser')
