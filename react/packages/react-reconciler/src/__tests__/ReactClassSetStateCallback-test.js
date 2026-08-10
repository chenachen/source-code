let React;
let ReactNoop;
let Scheduler;
let act;
let assertLog;

/** 验证并发更新重基线时，类组件 setState 完成回调仍与所属更新一一对应且不会重复执行。 */
describe('ReactClassSetStateCallback', () => {
  /** 重置模块和调度日志，确保每个回调次数断言不受前序根或队列影响。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /** 在返回文本前写入 Scheduler 日志，用于同时观察渲染次序与最终值。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given transition 更新携带 Callback 1，随后同步更新携带 Callback 2；When 同步提交迫使低优先级更新重基线；Then 两个回调各执行一次，且低优先级回调仅在自身更新最终提交后执行。通过完整 Scheduler 日志验证 ReactFiberClassUpdateQueue 的回调克隆与提交去重。 */
  it('regression: setState callback (2nd arg) should only fire once, even after a rebase', async () => {
    let app;
    /** 暴露实例并以 step 驱动文本，作为类更新队列和回调列表的测试载体。 */
    class App extends React.Component {
      /** 当前已提交的步骤；0 为初始值，1/2 分别来自 transition 与同步更新。 */
      state = {step: 0};
      /** 保存实例引用并输出当前 step，使测试能够从外部交错安排两种优先级更新。 */
      render() {
        app = this;
        return <Text text={this.state.step} />;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog([0]);

    await act(() => {
      React.startTransition(() => {
        app.setState({step: 1}, () => Scheduler.log('Callback 1'));
      });
      ReactNoop.flushSync(() => {
        app.setState({step: 2}, () => Scheduler.log('Callback 2'));
      });
    });
    assertLog([2, 'Callback 2', 2, 'Callback 1']);
  });
});
