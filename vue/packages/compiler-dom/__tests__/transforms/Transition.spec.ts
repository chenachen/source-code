/**
 * 验证 `<Transition>` 对 v-if/v-for、空分支和多子节点的诊断，以及注释、空白的过滤。
 * 另检查单个 v-show 子元素生成 persisted 属性。
 */
import { compile } from '../../src'

describe('Transition multi children warnings', () => {
  /** 编译 Transition 模板，并按场景断言是否收到指定 children 诊断。 */
  function checkWarning(
    template: string,
    shouldWarn: boolean,
    message = `<Transition> expects exactly one child element or component.`,
  ) {
    const spy = vi.fn()
    compile(template.trim(), {
      hoistStatic: true,
      transformHoist: null,
      onError: err => {
        spy(err.message)
      },
    })

    if (shouldWarn) expect(spy).toHaveBeenCalledWith(message)
    else expect(spy).not.toHaveBeenCalled()
  }

  /**
   * 场景：Transition 直接包两个 div，经收集型 onError 编译，断言恰命中单子节点诊断，验证两个同时存在的过渡目标不合法。
   */
  test('warns if multiple children', () => {
    checkWarning(
      `
      <transition>
        <div>hey</div>
        <div>hey</div>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：Transition 唯一模板子节点带 v-for，转换后可能形成多个根；checkWarning 捕获并断言子节点诊断，验证不能以模板节点数一项推断运行时只有一个目标。
   */
  test('warns with v-for', () => {
    checkWarning(
      `
      <transition>
        <div v-for="i in items">hey</div>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：Transition 的 if/else 两支各含 v-for，编译后断言诊断，验证 hasMultipleChildren 会递归检查条件分支中的循环。
   */
  test('warns with multiple v-if + v-for', () => {
    checkWarning(
      `
      <transition>
        <div v-if="a" v-for="i in items">hey</div>
        <div v-else v-for="i in items">hey</div>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：Transition 内是空 template v-if，结构转换后的分支没有可渲染子节点，断言单目标诊断，验证空分支也不满足有效子节点计数。
   */
  test('warns with template v-if', () => {
    checkWarning(
      `
      <transition>
        <template v-if="ok"></template>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：if/else 的 template 都为空，编译后断言诊断，验证互斥分支并不自动满足每支一个过渡目标。
   */
  test('warns with multiple templates', () => {
    checkWarning(
      `
      <transition>
        <template v-if="a"></template>
        <template v-else></template>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：Transition 中两个独立 v-if div 并存，断言诊断，验证它们不是同一条互斥条件链。
   */
  test('warns if multiple children with v-if', () => {
    checkWarning(
      `
      <transition>
        <div v-if="one">hey</div>
        <div v-if="other">hey</div>
      </transition>
      `,
      true,
    )
  })

  /**
   * 场景：Transition 只有一个普通 div，收集编译错误后断言未调用回调，验证单个实际元素允许作为目标。
   */
  test('does not warn with regular element', () => {
    checkWarning(
      `
      <transition>
        <div>hey</div>
      </transition>
      `,
      false,
    )
  })

  /**
   * 场景：Transition 只有一个 v-if div，断言无诊断，验证一个条件分支仍只有一个可渲染元素。
   */
  test('does not warn with one single v-if', () => {
    checkWarning(
      `
      <transition>
        <div v-if="a">hey</div>
      </transition>
      `,
      false,
    )
  })

  /**
   * 场景：if/else-if/else 三支各有一个 div，断言无诊断，验证条件链按每支目标数检查而非把分支数当 children 数。
   */
  test('does not warn with v-if v-else-if v-else', () => {
    checkWarning(
      `
      <transition>
        <div v-if="a">hey</div>
        <div v-else-if="b">hey</div>
        <div v-else>hey</div>
      </transition>
      `,
      false,
    )
  })

  /**
   * 场景：if/else 两支各有一个 div，断言无诊断，验证互斥条件链可由一个 Transition 管理。
   */
  test('does not warn with v-if v-else', () => {
    checkWarning(
      `
      <transition>
        <div v-if="a">hey</div>
        <div v-else>hey</div>
      </transition>
      `,
      false,
    )
  })

  /**
   * 场景：div 前还有不换行空格 U+00A0，编译后断言多子节点诊断，验证该字符按真实文本保留，不能作为普通格式空白过滤。
   */
  test('non-breaking spaces are treated as normal text', () => {
    checkWarning(
      `
      <transition>
        \u00a0
        <div>foo</div>
      </transition>
      `,
      true,
    )
  })
})

/**
 * 场景：唯一 div 子节点带 v-show=ok，匹配生成快照中的 persisted 属性，验证 Transition 得到持久化节点协议。
 */
test('inject persisted when child has v-show', () => {
  expect(
    compile(`
    <transition>
      <div v-show="ok" />
    </transition>
    `).code,
  ).toMatchSnapshot()
})

/**
 * 场景：Transition 的条件分支间有注释，else 内还有普通 div 下的条件注释，匹配快照验证只过滤过渡目标层的注释，不递归删掉所有元素内容。
 */
test('the v-if/else-if/else branches in Transition should ignore comments', () => {
  expect(
    compile(`
    <transition>
      <div v-if="a">hey</div>
      <!-- this should be ignored -->
      <div v-else-if="b">hey</div>
      <!-- this should be ignored -->
      <div v-else>
        <p v-if="c"/>
        <!-- this should not be ignored -->
        <p v-else/>
      </div>
    </transition>
    `).code,
  ).toMatchSnapshot()
})

/**
 * 场景：开启 whitespace=preserve，Transition 直接包含注释、格式空白与一个 div，匹配快照验证目标检查仍过滤注释和纯空白。
 */
test('comments and preserved whitespace are ignored', () => {
  expect(
    compile(
      `
      <transition>
        <!-- foo --> <!-- bar -->
        <div>foo bar</div>
      </transition>
      `,
      {
        whitespace: 'preserve',
      },
    ).code,
  ).toMatchSnapshot()
})
