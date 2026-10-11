import { Plugin } from 'vite'

/** 返回名为 test 的最小插件对象，供 runnerImport 加载配置时执行插件工厂。 */
export default function testPlugin(): Plugin {
  return {
    name: 'test',
  }
}
