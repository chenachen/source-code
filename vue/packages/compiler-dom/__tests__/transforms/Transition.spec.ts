/**
 * `<Transition>` children 校验场景：忽略注释/空白后只允许一个可切换元素或组件，并覆盖
 * v-if/v-for、slot、KeepAlive 等编译后结构，确保只对确实无法过渡的多根内容警告。
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

test('inject persisted when child has v-show', () => {
  expect(
    compile(`
    <transition>
      <div v-show="ok" />
    </transition>
    `).code,
  ).toMatchSnapshot()
})

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
