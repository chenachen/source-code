import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadEnv } from '../env'

/** 当前测试文件所在目录，用于定位同级的 `.env*` fixture。 */
const dirname = import.meta.dirname

describe('loadEnv', () => {
  /**
   * development 模式同时存在通用 `.env` 和 `.env.development`。
   *
   * 两个文件的 `VITE_` 变量会合并；`VITE_APP_BASE_URL` 对
   * `VITE_APP_BASE_ROUTE` 的引用会被展开；无关前缀不会暴露。
   */
  test('basic', () => {
    expect(loadEnv('development', join(dirname, './env')))
      .toMatchInlineSnapshot(`
        {
          "VITE_APP_BASE_ROUTE": "/",
          "VITE_APP_BASE_URL": "/",
          "VITE_ENV1": "ENV1",
          "VITE_ENV2": "ENV2",
          "VITE_ENV3": "ENV3",
        }
      `)
  })

  /**
   * 用户把客户端公开前缀从默认 `VITE_` 改成 `VVITE`。
   *
   * 只返回匹配自定义前缀的变量，原本的 `VITE_` 键不再自动公开。
   */
  test('specific prefix', () => {
    expect(loadEnv('development', join(dirname, './env'), 'VVITE'))
      .toMatchInlineSnapshot(`
        {
          "VVITE_A": "A",
          "VVITE_B": "B",
        }
      `)
  })

  /**
   * 通用 `.env` 定义 `/`，`.env.production` 为同名变量定义 `/app/`。
   *
   * mode 专属文件覆盖通用文件；变量展开使用覆盖后的最终值，因此
   * `VITE_APP_BASE_URL` 也得到 `/app/`。该行为对应环境文件优先级修复 #10113。
   */
  test('override', () => {
    expect(loadEnv('production', join(dirname, './env')))
      .toMatchInlineSnapshot(`
        {
          "VITE_APP_BASE_ROUTE": "/app/",
          "VITE_APP_BASE_URL": "/app/",
        }
      `)
  })

  /**
   * 通用文件中的变量引用另一个键，而 mode 文件覆盖该键并让它继续引用
   * `VITE_SOURCE`。
   *
   * Vite 先合并全部文件、再统一展开变量，所以跨文件引用最终都解析为
   * `source`，不会在读取通用文件时过早固定为 `/`。
   */
  test('override 2', () => {
    expect(loadEnv('development2', join(dirname, './env')))
      .toMatchInlineSnapshot(`
        {
          "VITE_APP_BASE_ROUTE": "source",
          "VITE_APP_BASE_URL": "source",
          "VITE_SOURCE": "source",
        }
      `)
  })

  /**
   * 普通 development 环境文件没有声明 `NODE_ENV`。
   *
   * loadEnv 不会凭 mode 猜测或写入 `VITE_USER_NODE_ENV`；mode 与
   * `NODE_ENV` 是两套概念。
   */
  test('VITE_USER_NODE_ENV', () => {
    loadEnv('development', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual(undefined)
  })

  /**
   * 进程以 production 启动构建，但 `.env.testing` 明确声明
   * `NODE_ENV=development`。
   *
   * 在变量展开前保存文件中的 development；进程已有的 production 不应改写
   * `VITE_USER_NODE_ENV`。这里检查暂存值，resolveConfig 是否采用它还取决于启动前有无显式 NODE_ENV。
   */
  test('VITE_USER_NODE_ENV for dev behaviour in build', () => {
    const _nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    loadEnv('testing', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual('development')
    process.env.NODE_ENV = _nodeEnv
  })

  /**
   * 调用 loadEnv 前，宿主进程已经设置 `VITE_USER_NODE_ENV=test`。
   *
   * `.env` 加载不能覆盖调用方显式设置的进程状态。
   */
  test('Already exists VITE_USER_NODE_ENV', () => {
    process.env.VITE_USER_NODE_ENV = 'test'
    loadEnv('development', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual('test')
  })

  /**
   * `.env.existing` 定义 `VITE_ENV_TEST_ENV=DOTENV`，shell/进程环境同时定义
   * 同名值 `EXIST`。
   *
   * 进程环境拥有最高优先级并覆盖文件值，符合临时命令
   * `VITE_ENV_TEST_ENV=EXIST vite` 的直觉（#10676）。快照中的
   * `VITE_USER_NODE_ENV` 来自上一用例设置的进程变量，也证明所有匹配前缀的进程值
   * 都会参与最终合并。
   */
  test('prioritize existing process.env', () => {
    process.env.VITE_ENV_TEST_ENV = 'EXIST'
    expect(loadEnv('existing', join(dirname, './env'))).toMatchInlineSnapshot(`
        {
          "VITE_APP_BASE_ROUTE": "/",
          "VITE_APP_BASE_URL": "/",
          "VITE_ENV_TEST_ENV": "EXIST",
          "VITE_USER_NODE_ENV": "test",
        }
      `)
  })
})
