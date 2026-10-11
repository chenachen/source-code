import { testExcluded } from '@vitejs/test-package-e-excluded'

/** 通过 included 子依赖再次调用 excluded 包，检验两条导入路径共享实例。 */
export function testIncluded() {
  return testExcluded()
}
