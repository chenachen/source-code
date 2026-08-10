let React;
let ReactNoop;
let Scheduler;
let startTransition;
let useState;
let useEffect;
let act;
let assertLog;
let waitFor;
let waitForPaint;

/** 验证 render 期间到达的交错更新会延后到独立轮次，并在转移回主队列后保持正确先后顺序。 */
describe('ReactInterleavedUpdates', () => {
  /** 重置根、Hook 绑定与调度断言工具，防止交错队列状态跨用例泄漏。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    startTransition = React.startTransition;
    useState = React.useState;
    useEffect = React.useEffect;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /** 记录并返回文本，使分片渲染与最终提交可在同一日志中观察。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given 三个 Child 的 transition 渲染只完成第一个；When 渲染中再次给全部 Child 安排 transition 更新；Then 当前轮仍提交 111，新更新另起一轮提交 222。通过分片 Scheduler 日志与宿主输出验证 enqueueInterleavedUpdates 的快照隔离。 */
  it('update during an interleaved event is not processed during the current render', async () => {
    const updaters = [];

    /** 保存自身 setState 到共享列表，使测试能在同一事件内批量制造跨 Fiber 的交错更新。 */
    function Child() {
      const [state, setState] = useState(0);
      useEffect(() => {
        updaters.push(setState);
      }, []);
      return <Text text={state} />;
    }

    /** 遍历已挂载 Child 的 setter，将同一 value 安排到每条 Hook 更新队列。 */
    function updateChildren(value) {
      for (let i = 0; i < updaters.length; i++) {
        const setState = updaters[i];
        setState(value);
      }
    }

    const root = ReactNoop.createRoot();

    await act(() => {
      root.render(
        <>
          <Child />
          <Child />
          <Child />
        </>,
      );
    });
    assertLog([0, 0, 0]);
    expect(root).toMatchRenderedOutput('000');

    await act(async () => {
      React.startTransition(() => {
        updateChildren(1);
      });
      // 只部分渲染子节点：先完成第一个。
      await waitFor([1]);

      // 在交错事件中给每个子节点安排一次更新，
      // 包括本轮尚未渲染到的后两个。
      React.startTransition(() => {
        updateChildren(2);
      });

      // 当前渲染应继续使用原快照，不能吸收新进入的交错更新。
      await waitForPaint([1, 1]);
      expect(root).toMatchRenderedOutput('111');
    });
    // 交错更新随后在独立的一轮渲染中提交。
    assertLog([2, 2, 2]);
    expect(root).toMatchRenderedOutput('222');
  });

  /** Given step=1 渲染中交错加入 step=2，提交后再加入 step=3；When 交错队列转移回主更新队列；Then最终 step=3 胜出且不会被旧交错更新覆盖。通过三段文本日志验证 #24350 的队列拼接顺序。 */
  it('regression for #24350: does not add to main update queue until interleaved update queue has been cleared', async () => {
    let setStep;
    /** 暴露 step setter并渲染三段标记，用部分日志定位并发渲染暂停点。 */
    function App() {
      const [step, _setState] = useState(0);
      setStep = _setState;
      return (
        <>
          <Text text={'A' + step} />
          <Text text={'B' + step} />
          <Text text={'C' + step} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A0', 'B0', 'C0']);
    expect(root).toMatchRenderedOutput('A0B0C0');

    await act(async () => {
      // 启动第一轮 transition 渲染。
      startTransition(() => {
        setStep(1);
      });
      await waitFor(['A1', 'B1']);

      // 安排交错更新；它会先进入专用队列。
      startTransition(() => {
        setStep(2);
      });

      // 完成第一轮更新的渲染与提交。
      await waitForPaint(['C1']);

      // 再安排一次更新。回归缺陷中，它曾被误判为普通的非交错更新，
      // 并被插入主更新队列，
      // 排在尚未转移的交错更新之前。
      startTransition(() => {
        setStep(3);
      });
    });
    // 按更新队列顺序，最后写入的 step=3 必须胜出。
    assertLog(['A3', 'B3', 'C3']);
    expect(root).toMatchRenderedOutput('A3B3C3');
  });
});
