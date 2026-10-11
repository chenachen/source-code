import { defineConfig } from 'vite'

/**
 * 创建 env 查询参数夹具插件；dev 导入 /@vite/env?foo，build 使用空 data JS，覆盖 #20997。
 *
 * 验证带查询参数的 env 导入仍能处理（#20997）。
 */
function testEnvQueryParamsPlugin() {
  let isBuild = true
  return {
    name: 'test-env-query-params',
    /** 记录最终 command，让后续 HTML 代理 JS 的占位符选择开发 env URL 或构建 data URI。 */
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    /** 只替换 index.html 代理代码中的占位符；保留字符串引号以形成可执行 import 地址。 */
    transform(code, id) {
      if (
        id.includes('index.html') &&
        code.includes('__VITE_ENV_WITH_QUERY__')
      ) {
        return code.replace(
          '__VITE_ENV_WITH_QUERY__',
          JSON.stringify(isBuild ? 'data:text/javascript,' : '/@vite/env?foo'),
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [testEnvQueryParamsPlugin()],
  define: {
    __EXP__: 'false',
    __STRING__: '"hello"',
    __NUMBER__: 123,
    __BOOLEAN__: true,
    __UNDEFINED__: undefined,
    __OBJ__: {
      foo: 1,
      bar: {
        baz: 2,
      },
      process: {
        env: {
          SOMEVAR: '"PROCESS MAY BE PROPERTY"',
        },
      },
    },
    'process.env.NODE_ENV': '"dev"',
    'process.env.SOMEVAR': '"SOMEVAR"',
    'process.env': {
      NODE_ENV: 'dev',
      SOMEVAR: 'SOMEVAR',
      OTHER: 'works',
    },
    $DOLLAR: 456,
    ÖUNICODE_LETTERɵ: 789,
    __VAR_NAME__: false,
    __STRINGIFIED_OBJ__: JSON.stringify({ foo: true }),
    'import.meta.env.SOME_IDENTIFIER': '__VITE_SOME_IDENTIFIER__',
  },
  environments: {
    client: {
      define: {
        __DEFINE_IN_ENVIRONMENT__: '"defined only in client"',
      },
    },
  },
})
