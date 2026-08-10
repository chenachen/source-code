let React;
let ReactNoop;
let Scheduler;
let act;
let Activity;
let useState;
let assertLog;

/** 覆盖 Activity 隐藏预渲染期间的错误隔离，以及边界转为可见后的错误上抛与恢复。 */
describe('Activity error handling', () => {
  /** 每例重置模块并重建 Noop renderer、Scheduler 与 Activity 引用，避免隐藏树状态跨测试泄漏。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Activity = React.Activity;
    useState = React.useState;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /** 记录文本组件的 render 次数，并把同一文本作为宿主输出，供日志与渲染树双重断言。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /**
   * Given 可见内容与包含抛错子树的 hidden Activity；When 先预渲染隐藏树，再切换为 visible；
   * Then 隐藏阶段错误不污染可见 UI，揭示阶段由外层 ErrorBoundary 捕获。
   * 验证机制：Scheduler render 日志与 Noop 输出树；对应 ReactFiberActivityComponent、ReactFiberThrow 与 ReactFiberBeginWork。
   */
  it(
    'errors inside a hidden Activity do not escape in the visible part ' +
      'of the UI',
    async () => {
      /** 捕获 Activity 揭示阶段重新抛出的错误，并把错误消息渲染为可观察 fallback。 */
      class ErrorBoundary extends React.Component {
        /** 保存最近一次捕获的错误；null 表示继续展示原 children。 */
        state = {error: null};
        /** 将 render 阶段错误同步折叠进边界状态，驱动下一次 fallback render。 */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /** 根据 error 状态在原 children 与错误提示之间切换。 */
        render() {
          if (this.state.error) {
            return (
              <Text text={`Caught an error: ${this.state.error.message}`} />
            );
          }
          return this.props.children;
        }
      }

      /** 始终抛出固定错误，模拟 hidden Activity 预渲染中的失败子树。 */
      function Throws() {
        throw new Error('Oops!');
      }

      // 暴露 state setter，供测试精确触发 hidden 到 visible 的边界切换。
      let setShowMore;
      /** 组合始终可见内容与受 showMore 控制的 Activity，用同一树验证错误隔离边界。 */
      function App({content, more}) {
        const [showMore, _setShowMore] = useState(false);
        setShowMore = _setShowMore;
        return (
          <>
            <div>{content}</div>
            <div>
              <ErrorBoundary>
                <Activity mode={showMore ? 'visible' : 'hidden'}>
                  {more}
                </Activity>
              </ErrorBoundary>
            </div>
          </>
        );
      }

      await act(() =>
        ReactNoop.render(
          <App content={<Text text="Visible" />} more={<Throws />} />,
        ),
      );

      // 初次渲染会在 hidden Activity 预渲染时抛错，但隐藏边界隔离该错误，可见 UI 不应感知。
      assertLog(['Visible']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div>Visible</div>
          <div />
        </>,
      );

      // Activity 揭示后错误进入可见树，并由外层 ErrorBoundary 捕获。
      await act(() => setShowMore(true));
      assertLog(['Caught an error: Oops!', 'Caught an error: Oops!']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div>Visible</div>
          <div>Caught an error: Oops!</div>
        </>,
      );
    },
  );
});
