/**
 * compiler-core 集成场景：串联 parse、transform、codegen，确认 source map 和关键编译选项
 * 在完整管线中协同工作，而不只验证某个独立转换器。
 */
import { baseCompile as compile } from '../src'
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js'

describe('compiler: integration tests', () => {
  const source = `
<div id="foo" :class="bar.baz">
  {{ world.burn() }}
  <div v-if="ok">yes</div>
  <template v-else>no</template>
  <div v-for="(value, index) in list"><span>{{ value + index }}</span></div>
</div>
`.trim()

  /** source map 断言使用的生成位置或原始位置；行号从 1 开始，列号从 0 开始。 */
  interface Pos {
    /** 生成代码中的行号。 */
    line: number
    /** 生成代码中的列号。 */
    column: number
    /** source map 预期恢复出的原标识符名。 */
    name?: string
  }

  /** 在生成代码中定位 token，换算成 source-map consumer 使用的行列。 */
  function getPositionInCode(
    code: string,
    token: string,
    expectName: string | boolean = false,
  ): Pos {
    const generatedOffset = code.indexOf(token)
    let line = 1
    let lastNewLinePos = -1
    for (let i = 0; i < generatedOffset; i++) {
      if (code.charCodeAt(i) === 10 /* 换行符字符码 */) {
        line++
        lastNewLinePos = i
      }
    }
    const res: Pos = {
      line,
      column:
        lastNewLinePos === -1
          ? generatedOffset
          : generatedOffset - lastNewLinePos - 1,
    }
    if (expectName) {
      res.name = typeof expectName === 'string' ? expectName : token
    }
    return res
  }

  test('function mode', () => {
    const { code, map } = compile(source, {
      sourceMap: true,
      filename: `foo.vue`,
    })

    expect(code).toMatchSnapshot()
    expect(map!.sources).toEqual([`foo.vue`])
    expect(map!.sourcesContent).toEqual([source])

    const consumer = new SourceMapConsumer(map as RawSourceMap)

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `id`)),
    ).toMatchObject(getPositionInCode(source, `id`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `"foo"`)),
    ).toMatchObject(getPositionInCode(source, `"foo"`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `class:`)),
    ).toMatchObject(getPositionInCode(source, `class=`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `bar`)),
    ).toMatchObject(getPositionInCode(source, `bar`))

    // 未开启 prefixIdentifiers 时，复合表达式内部标识符映射到最近的父表达式范围。
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `baz`)),
    ).toMatchObject(getPositionInCode(source, `bar`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `world`)),
    ).toMatchObject(getPositionInCode(source, `world`))

    // 因此查询内部调用也应回到父插值表达式，而非缺失映射。
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `burn()`)),
    ).toMatchObject(getPositionInCode(source, `world`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `ok`)),
    ).toMatchObject(getPositionInCode(source, `ok`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `list`)),
    ).toMatchObject(getPositionInCode(source, `list`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value`)),
    ).toMatchObject(getPositionInCode(source, `value`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `index`)),
    ).toMatchObject(getPositionInCode(source, `index`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value + index`)),
    ).toMatchObject(getPositionInCode(source, `value + index`))
  })

  test('function mode w/ prefixIdentifiers: true', () => {
    const { code, map } = compile(source, {
      sourceMap: true,
      filename: `foo.vue`,
      prefixIdentifiers: true,
    })

    expect(code).toMatchSnapshot()
    expect(map!.sources).toEqual([`foo.vue`])
    expect(map!.sourcesContent).toEqual([source])

    const consumer = new SourceMapConsumer(map as RawSourceMap)

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `id`)),
    ).toMatchObject(getPositionInCode(source, `id`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `"foo"`)),
    ).toMatchObject(getPositionInCode(source, `"foo"`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `class:`)),
    ).toMatchObject(getPositionInCode(source, `class=`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `bar`)),
    ).toMatchObject(getPositionInCode(source, `bar`))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `_ctx.bar`, `bar`)),
    ).toMatchObject(getPositionInCode(source, `bar`, true))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `baz`)),
    ).toMatchObject(getPositionInCode(source, `baz`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `world`, true)),
    ).toMatchObject(getPositionInCode(source, `world`, `world`))
    expect(
      consumer.originalPositionFor(
        getPositionInCode(code, `_ctx.world`, `world`),
      ),
    ).toMatchObject(getPositionInCode(source, `world`, `world`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `burn()`)),
    ).toMatchObject(getPositionInCode(source, `burn()`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `ok`)),
    ).toMatchObject(getPositionInCode(source, `ok`))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `_ctx.ok`, `ok`)),
    ).toMatchObject(getPositionInCode(source, `ok`, true))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `list`)),
    ).toMatchObject(getPositionInCode(source, `list`))
    expect(
      consumer.originalPositionFor(
        getPositionInCode(code, `_ctx.list`, `list`),
      ),
    ).toMatchObject(getPositionInCode(source, `list`, true))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value`)),
    ).toMatchObject(getPositionInCode(source, `value`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `index`)),
    ).toMatchObject(getPositionInCode(source, `index`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value + index`)),
    ).toMatchObject(getPositionInCode(source, `value + index`))
  })

  test('module mode', () => {
    const { code, map } = compile(source, {
      mode: 'module',
      sourceMap: true,
      filename: `foo.vue`,
    })

    expect(code).toMatchSnapshot()
    expect(map!.sources).toEqual([`foo.vue`])
    expect(map!.sourcesContent).toEqual([source])

    const consumer = new SourceMapConsumer(map as RawSourceMap)

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `id`)),
    ).toMatchObject(getPositionInCode(source, `id`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `"foo"`)),
    ).toMatchObject(getPositionInCode(source, `"foo"`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `class:`)),
    ).toMatchObject(getPositionInCode(source, `class=`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `bar`)),
    ).toMatchObject(getPositionInCode(source, `bar`))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `_ctx.bar`, `bar`)),
    ).toMatchObject(getPositionInCode(source, `bar`, true))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `baz`)),
    ).toMatchObject(getPositionInCode(source, `baz`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `world`, true)),
    ).toMatchObject(getPositionInCode(source, `world`, `world`))
    expect(
      consumer.originalPositionFor(
        getPositionInCode(code, `_ctx.world`, `world`),
      ),
    ).toMatchObject(getPositionInCode(source, `world`, `world`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `burn()`)),
    ).toMatchObject(getPositionInCode(source, `burn()`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `ok`)),
    ).toMatchObject(getPositionInCode(source, `ok`))
    expect(
      consumer.originalPositionFor(getPositionInCode(code, `_ctx.ok`, `ok`)),
    ).toMatchObject(getPositionInCode(source, `ok`, true))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `list`)),
    ).toMatchObject(getPositionInCode(source, `list`))
    expect(
      consumer.originalPositionFor(
        getPositionInCode(code, `_ctx.list`, `list`),
      ),
    ).toMatchObject(getPositionInCode(source, `list`, true))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value`)),
    ).toMatchObject(getPositionInCode(source, `value`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `index`)),
    ).toMatchObject(getPositionInCode(source, `index`))

    expect(
      consumer.originalPositionFor(getPositionInCode(code, `value + index`)),
    ).toMatchObject(getPositionInCode(source, `value + index`))
  })
})
