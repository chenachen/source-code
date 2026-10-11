let React;
let ReactNoop;
let Scheduler;
let ContinuousEventPriority;
let startTransition;
let useState;
let useEffect;
let act;
let waitFor;
let waitForPaint;
let assertLog;

/** 验证同步、默认、闲置、连续事件与 transition 之间的 lane 继承和抢占关系。 */
describe('ReactUpdatePriority', () => {
  /** 重置根和 Hook/API 引用，并绑定可按 paint 边界推进的调度断言工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    ContinuousEventPriority =
      require('react-reconciler/constants').ContinuousEventPriority;
    startTransition = React.startTransition;
    useState = React.useState;
    useEffect = React.useEffect;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;
  });

  /** 记录并返回文本，将每个 lane 实际渲染到的状态暴露给断言。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given–When–Then：Given 根用 flushSync 同步挂载 App，而 mount effect 内再 setState；When 同步范围结束并进入被动 effect；Then同步提交只包含 state=1，effect 更新随后以默认优先级提交 state=2。通过分段日志验证被动阶段不会继承触发它的同步优先级。 */
  it('setState inside passive effect triggered by sync update should have default priority', async () => {
    const root = ReactNoop.createRoot();

    /** 挂载时在被动 effect 内把 state 从 1 更新为 2，用于观察同步触发源与 effect 更新优先级的切断。 */
    function App() {
      const [state, setState] = useState(1);
      useEffect(() => {
        setState(2);
      }, []);
      return <Text text={state} />;
    }

    await act(() => {
      ReactNoop.flushSync(() => {
        root.render(<App />);
      });
      // 当前断言只观察到初始渲染；effect 安排的 state 更新尚未提交。
      assertLog([1]);
    });
    assertLog([2]);
  });

  /** Given–When–Then：Given idle 根更新产生的被动 effect 安排 idleState=2，同时另有默认优先级 defaultState=2；When 按 feature flag 对应的被动阶段让出点推进；Then默认更新先提交，idle 更新最后补齐。通过逐次 waitForPaint 日志验证 effect 更新继承 idle 事件优先级。 */
  it('setState inside passive effect triggered by idle update should have idle priority', async () => {
    const root = ReactNoop.createRoot();

    let setDefaultState;
    /** 分别持有 idle/default 状态，并暴露默认 setter，让两种优先级可在同一被动阶段竞争。 */
    function App() {
      const [idleState, setIdleState] = useState(1);
      const [defaultState, _setDefaultState] = useState(1);
      setDefaultState = _setDefaultState;
      useEffect(() => {
        Scheduler.log('Idle update');
        setIdleState(2);
      }, []);
      return <Text text={`Idle: ${idleState}, Default: ${defaultState}`} />;
    }

    await act(async () => {
      ReactNoop.idleUpdates(() => {
        root.render(<App />);
      });
      // 当前断言只观察到初始渲染；effect 安排的 state 更新尚未提交。
      await waitForPaint(['Idle: 1, Default: 1']);

      // 另安排一次默认优先级更新，与闲置更新形成竞争。
      setDefaultState(2);

      if (gate(flags => flags.enableYieldingBeforePassive)) {
        // 默认优先级高于闲置更新，因此先获得渲染机会。
        await waitForPaint([
          // 被动 effect 已安排闲置更新。
          'Idle update',
        ]);
        await waitForPaint([
          // 默认更新先提交，不能夹带闲置更新。
          'Idle: 1, Default: 2',
        ]);
      } else {
        // 默认优先级高于闲置更新，因此先获得渲染机会。
        await waitForPaint([
          // 被动 effect 已安排闲置更新。
          'Idle update',

          // 默认更新先提交，不能夹带闲置更新。
          'Idle: 1, Default: 2',
        ]);
      }
    });
    // 最后一轮才冲刷闲置更新。
    assertLog(['Idle: 2, Default: 2']);
  });

  /** Given transition 正分片渲染 counter=2；When 连续事件优先级插入 isHidden=true；Then隐藏更新抢占并提交，transition 重放后 App 仍返回 hidden 文本。通过 A2 后两次 hidden 日志与最终输出验证 lane 抢占，后一次渲染仍处理状态队列而不改变可见内容。 */
  it('continuous updates should interrupt transitions', async () => {
    const root = ReactNoop.createRoot();

    let setCounter;
    let setIsHidden;
    /** 暴露 counter 与隐藏 setter；可见时分三段渲染，便于在第一段后插入连续事件更新。 */
    function App() {
      const [counter, _setCounter] = useState(1);
      const [isHidden, _setIsHidden] = useState(false);
      setCounter = _setCounter;
      setIsHidden = _setIsHidden;
      if (isHidden) {
        return <Text text={'(hidden)'} />;
      }
      return (
        <>
          <Text text={'A' + counter} />
          <Text text={'B' + counter} />
          <Text text={'C' + counter} />
        </>
      );
    }

    await act(() => {
      root.render(<App />);
    });
    assertLog(['A1', 'B1', 'C1']);
    expect(root).toMatchRenderedOutput('A1B1C1');

    await act(async () => {
      startTransition(() => {
        setCounter(2);
      });
      await waitFor(['A2']);
      ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () => {
        setIsHidden(true);
      });
    });
    assertLog([
      // 隐藏更新具有连续事件优先级，应抢占
      // 正在进行的 transition。
      '(hidden)',
      // transition 恢复时仍执行 App 并处理 counter 更新；isHidden 已为 true，输出继续为 hidden。
      '(hidden)',
    ]);
    expect(root).toMatchRenderedOutput('(hidden)');
  });
});
