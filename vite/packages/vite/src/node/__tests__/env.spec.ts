import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadEnv } from '../env'

/** 当前测试文件所在目录，用于定位同级的 `.env*` fixture。 */
const dirname = import.meta.dirname

describe('loadEnv', () => {
  /**
   * 场景：development 模式同时存在通用 `.env` 和 `.env.development`。
   *
   * 验证目标：两个文件的 `VITE_` 变量会合并；`VITE_APP_BASE_URL` 对
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
   * 场景：用户把客户端公开前缀从默认 `VITE_` 改成 `VVITE`。
   *
   * 验证目标：只返回匹配自定义前缀的变量，原本的 `VITE_` 键不再自动公开。
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
   * 场景：通用 `.env` 定义 `/`，`.env.production` 为同名变量定义 `/app/`。
   *
   * 验证目标：mode 专属文件覆盖通用文件；变量展开使用覆盖后的最终值，因此
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
   * 场景：通用文件中的变量引用另一个键，而 mode 文件覆盖该键并让它继续引用
   * `VITE_SOURCE`。
   *
   * 验证目标：Vite 先合并全部文件、再统一展开变量，所以跨文件引用最终都解析为
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
   * 场景：普通 development 环境文件没有声明 `NODE_ENV`。
   *
   * 验证目标：loadEnv 不会凭 mode 猜测或写入 `VITE_USER_NODE_ENV`；mode 与
   * `NODE_ENV` 是两套概念。
   */
  test('VITE_USER_NODE_ENV', () => {
    loadEnv('development', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual(undefined)
  })

  /**
   * 场景：进程以 production 启动构建，但 `.env.testing` 明确声明
   * `NODE_ENV=development`。
   *
   * 验证目标：在变量展开前把文件值保存到 `VITE_USER_NODE_ENV`，使后续配置阶段
   * 能启用开发行为；避免进程已有 NODE_ENV 抢先覆盖文件值（#11309）。
   */
  test('VITE_USER_NODE_ENV for dev behaviour in build', () => {
    const _nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    loadEnv('testing', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual('development')
    process.env.NODE_ENV = _nodeEnv
  })

  /**
   * 场景：调用 loadEnv 前，宿主进程已经设置 `VITE_USER_NODE_ENV=test`。
   *
   * 验证目标：`.env` 加载不能覆盖调用方显式设置的进程状态。
   */
  test('Already exists VITE_USER_NODE_ENV', () => {
    process.env.VITE_USER_NODE_ENV = 'test'
    loadEnv('development', join(dirname, './env'))
    expect(process.env.VITE_USER_NODE_ENV).toEqual('test')
  })

  /**
   * 场景：`.env.existing` 定义 `VITE_ENV_TEST_ENV=DOTENV`，shell/进程环境同时定义
   * 同名值 `EXIST`。
   *
   * 验证目标：进程环境拥有最高优先级并覆盖文件值，符合临时命令
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
