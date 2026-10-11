import { describe, expect, test } from 'vitest'
import { parseAst } from 'rollup/parseAst'
import { workerImportMetaUrlPlugin } from '../../plugins/workerImportMetaUrl'
import { resolveConfig } from '../../config'
import { PartialEnvironment } from '../../baseEnvironment'

/** 创建最小开发环境，直接观察 Worker URL 识别插件的变换结果。 */
async function createWorkerImportMetaUrlPluginTransform() {
  const config = await resolveConfig({ configFile: false }, 'serve')
  const instance = workerImportMetaUrlPlugin(config)
  const environment = new PartialEnvironment('client', config)

  return async (code: string) => {
    // @ts-expect-error transform.handler should exist
    const result = await instance.transform.handler.call(
      { environment, parse: parseAst },
      code,
      'foo.ts',
    )
    return result?.code || result
  }
}

describe('workerImportMetaUrlPlugin', async () => {
  const transform = await createWorkerImportMetaUrlPluginTransform()

  /**
   * 场景：Worker / SharedWorker 未提供 options。
   * 机制：默认按 classic 生成 `worker_file&type=classic` 请求。
   * 验证目标：让后续 worker 插件知道应使用 importScripts 注入环境运行时。
   */
  test('without worker options', async () => {
    expect(
      await transform('new Worker(new URL("./worker.js", import.meta.url))'),
    ).toMatchInlineSnapshot(
      `"new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=classic", '' + import.meta.url))"`,
    )
  })

  /** 场景：SharedWorker 未提供 options；验证目标：URL 改写为 classic worker_file 请求并保留 SharedWorker 构造器。 */
  test('with shared worker', async () => {
    expect(
      await transform(
        'new SharedWorker(new URL("./worker.js", import.meta.url))',
      ),
    ).toMatchInlineSnapshot(
      `"new SharedWorker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=classic", '' + import.meta.url))"`,
    )
  })

  /**
   * 场景：options 的 type 可静态读取，其他字段允许使用表达式。
   * 机制：只提取影响编译方式的 type，原 options 文本完整保留。
   * 验证目标：正确区分 module/classic，同时不限制动态 name 等浏览器选项。
   */
  test('with static worker options and identifier properties', async () => {
    expect(
      await transform(
        'new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "worker1" })',
      ),
    ).toMatchInlineSnapshot(
      `"new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), { type: "module", name: "worker1" })"`,
    )
  })

  /** 场景：Worker options 用字符串键声明静态 module 与 name；验证目标：类型仍静态提取为 module，原 options 文本保留。 */
  test('with static worker options and literal properties', async () => {
    expect(
      await transform(
        'new Worker(new URL("./worker.js", import.meta.url), { "type": "module", "name": "worker1" })',
      ),
    ).toMatchInlineSnapshot(
      `"new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), { "type": "module", "name": "worker1" })"`,
    )
  })

  /** 场景：Worker name 是字符串拼接且未声明 type；验证目标：动态 name 被保留，URL 采用默认 classic。 */
  test('with dynamic name field in worker options', async () => {
    expect(
      await transform(
        'const id = 1; new Worker(new URL("./worker.js", import.meta.url), { name: "worker" + id })',
      ),
    ).toMatchInlineSnapshot(
      `"const id = 1; new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=classic", '' + import.meta.url), { name: "worker" + id })"`,
    )
  })

  /** 场景：Worker name 是模板插值且未声明 type；验证目标：插值原样保留，URL 采用 classic。 */
  test('with interpolated dynamic name field in worker options', async () => {
    expect(
      await transform(
        'const id = 1; new Worker(new URL("./worker.js", import.meta.url), { name: `worker-${id}` })',
      ),
    ).toMatchInlineSnapshot(
      `"const id = 1; new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=classic", '' + import.meta.url), { name: \`worker-\${id}\` })"`,
    )
  })

  /** 场景：动态 name 与静态 type=module 同时存在；验证目标：只静态提取 type，URL 标记 module 且 name 表达式不变。 */
  test('with dynamic name field and static type in worker options', async () => {
    expect(
      await transform(
        'const id = 1; new Worker(new URL("./worker.js", import.meta.url), { name: "worker" + id, type: "module" })',
      ),
    ).toMatchInlineSnapshot(
      `"const id = 1; new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), { name: "worker" + id, type: "module" })"`,
    )
  })

  /** 场景：模板插值 name 与静态 module type 同时存在；验证目标：URL 采用 module，动态模板保持原样。 */
  test('with interpolated dynamic name field and static type in worker options', async () => {
    expect(
      await transform(
        'const id = 1; new Worker(new URL("./worker.js", import.meta.url), { name: `worker-${id}`, type: "module" })',
      ),
    ).toMatchInlineSnapshot(
      `"const id = 1; new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), { name: \`worker-\${id}\`, type: "module" })"`,
    )
  })

  /** 场景：name 值包含函数调用括号且 type 静态；验证目标：闭括号查找不提前结束，仍提取 module。 */
  test('with parenthesis inside of worker options', async () => {
    expect(
      await transform(
        'const worker = new Worker(new URL("./worker.js", import.meta.url), { name: genName(), type: "module"})',
      ),
    ).toMatchInlineSnapshot(
      `"const worker = new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), { name: genName(), type: "module"})"`,
    )
  })

  /** 场景：Worker 构造器和 options 跨多行并带函数调用；验证目标：只改写 URL，周围多行代码与 module options 保持。 */
  test('with multi-line code and worker options', async () => {
    expect(
      await transform(`
const worker = new Worker(new URL("./worker.js", import.meta.url), {
    name: genName(),
    type: "module",
  },
)

worker.addEventListener('message', (ev) => text('.simple-worker-url', JSON.stringify(ev.data)))
`),
    ).toMatchInlineSnapshot(`
      "
      const worker = new Worker(new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url), {
          name: genName(),
          type: "module",
        },
      )

      worker.addEventListener('message', (ev) => text('.simple-worker-url', JSON.stringify(ev.data)))
      "
    `)
  })

  /**
   * 场景：options 与 Worker 调用存在尾逗号、注释、换行和内部括号。
   * 机制：先屏蔽注释/字面量，再扫描括号定位参数边界；需要时用 AST 提取 options.type。
   * 验证目标：只替换 URL 参数，不吞掉调用后的代码或改变原有 options。
   */
  test('trailing comma', async () => {
    expect(
      await transform(`
new Worker(
  new URL('./worker.js', import.meta.url),
  {
    type: 'module'
  }, // },
)
`),
    ).toMatchInlineSnapshot(`
      "
      new Worker(
        new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url),
        {
          type: 'module'
        }, // },
      )
      "
    `)
  })

  /**
   * 场景：type 无法静态确定，或对象展开可能在已解析 type 后覆盖它。
   * 验证目标：拒绝产生编译类型与浏览器运行类型不一致的 worker；用户可用
   * `@vite-ignore` 跳过静态 type 推断，URL 仍会被转换。
   */
  test('throws an error when non-static worker options are provided', async () => {
    await expect(
      transform(
        'new Worker(new URL("./worker.js", import.meta.url), myWorkerOptions)',
      ),
    ).rejects.toThrow(
      'Vite is unable to parse the worker options as the value is not static. To ignore this error, please use /* @vite-ignore */ in the worker options.',
    )
  })

  /** 场景：Worker 第二参数是字符串而非对象；验证目标：转换拒绝并报告实际类型 string。 */
  test('throws an error when worker options are not an object', async () => {
    await expect(
      transform(
        'new Worker(new URL("./worker.js", import.meta.url), "notAnObject")',
      ),
    ).rejects.toThrow('Expected worker options to be an object, got string')
  })

  /** 场景：options.type 使用变量简写；验证目标：静态提取拒绝非字面量并定位 type 属性。 */
  test('throws an error when non-literal type field in worker options', async () => {
    await expect(
      transform(
        'const type = "module"; new Worker(new URL("./worker.js", import.meta.url), { type })',
      ),
    ).rejects.toThrow(
      'Expected worker options type property to be a literal value.',
    )
  })

  /** 场景：options 只有对象展开且没有静态 type；验证目标：转换要求最后一次展开之后存在可证明的 type。 */
  test('throws an error when spread operator used without the type field', async () => {
    await expect(
      transform(
        'const options = { name: "worker1" }; new Worker(new URL("./worker.js", import.meta.url), { ...options })',
      ),
    ).rejects.toThrow(
      'Expected object spread to be used before the definition of the type property. Vite needs a static value for the type property to correctly infer it.',
    )
  })

  /** 场景：静态 type 后仍有对象展开可能覆盖它；验证目标：转换拒绝该顺序，避免错误推断 worker 类型。 */
  test('throws an error when spread operator used after definition of type field', async () => {
    await expect(
      transform(
        'const options = { name: "worker1" }; new Worker(new URL("./worker.js", import.meta.url), { type: "module", ...options })',
      ),
    ).rejects.toThrow(
      'Expected object spread to be used before the definition of the type property. Vite needs a static value for the type property to correctly infer it.',
    )
  })

  /** 场景：Worker 构造器的第一个参数含嵌套调用，嵌套调用后还有对象参数；验证目标：该对象不被误认成 Worker options。 */
  test('find closing parenthesis correctly', async () => {
    expect(
      await transform(
        `(() => { new Worker(new URL('./worker', import.meta.url)); repro({ test: "foo", }); })();`,
      ),
    ).toMatchInlineSnapshot(
      `"(() => { new Worker(new URL(/* @vite-ignore */ "/worker?worker_file&type=classic", '' + import.meta.url)); repro({ test: "foo", }); })();"`,
    )
    expect(
      await transform(
        `repro(new Worker(new URL('./worker', import.meta.url)), { type: "module" })`,
      ),
    ).toMatchInlineSnapshot(
      `"repro(new Worker(new URL(/* @vite-ignore */ "/worker?worker_file&type=classic", '' + import.meta.url)), { type: "module" })"`,
    )
  })

  /** 场景：多行 new URL 表达式自身带尾逗号并作为 Worker 参数；验证目标：外层 Worker options 仍被准确定位。 */
  test('with multi-line new URL and trailing comma', async () => {
    expect(
      await transform(`new Worker(
  new URL(
    "./worker.js",
    import.meta.url,
  )
)`),
    ).toMatchInlineSnapshot(`
      "new Worker(
        new URL(/* @vite-ignore */ "/worker.js?worker_file&type=classic", '' + import.meta.url)
      )"
    `)
  })

  /** 场景：new URL 跨多行且自身和 Worker 参数都有尾逗号；验证目标：正确找到两层闭括号并生成 module worker URL。 */
  test('with multi-line new URL, trailing comma, and worker options', async () => {
    expect(
      await transform(`const worker = new Worker(
  new URL(
    "./worker.js",
    import.meta.url,
  ),
  { type: "module" },
)`),
    ).toMatchInlineSnapshot(`
      "const worker = new Worker(
        new URL(/* @vite-ignore */ "/worker.js?worker_file&type=module", '' + import.meta.url),
        { type: "module" },
      )"
    `)
  })
})
