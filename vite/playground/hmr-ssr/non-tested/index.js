import { test } from './dep.js'

/** 尝试调用导入的 test 字符串；测试只 transform 此文件使其入图，未执行该函数或把它接入 runner 入口链。 */
function main() {
  test()
}

main()

import.meta.hot.accept('./dep.js')
