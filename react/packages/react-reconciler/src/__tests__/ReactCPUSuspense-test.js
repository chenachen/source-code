/* eslint-disable react/jsx-boolean-value */

let React;
let ReactNoop;
let Scheduler;
let act;
let Suspense;
let useState;
let textCache;

let readText;
let resolveText;
// let rejectText;

let assertLog;
let waitForPaint;

/** 验证实验性 CPU Suspense defer 在初挂载、更新、IO 挂起和嵌套边界中的分段提交。 */
describe('ReactSuspenseWithNoopRenderer', () => {
  /** 重置模块和文本状态机，绑定 paint 边界及日志工具；保留 rejectText 注释代码作为未启用错误路径。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Suspense = React.Suspense;
    useState = React.useState;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;

    textCache = new Map();

    /** 读取文本状态：pending 抛 promise、rejected 抛错误、resolved 返回；缺失时创建 pending 记录。 */
    readText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        // 状态机边界：只有 resolved 返回；其他状态必须通过抛出进入 Suspense/错误路径。
        switch (record.status) {
          case 'pending':
            throw record.promise;
          case 'rejected':
            throw Error('Failed to load: ' + text);
          case 'resolved':
            return text;
        }
      } else {
        let ping;
        const promise = new Promise(resolve => (ping = resolve));
        const newRecord = {
          status: 'pending',
          ping: ping,
          promise,
        };
        textCache.set(text, newRecord);
        throw promise;
      }
    };

    /** 解决 pending 文本并 ping 等待者；未读取过的文本直接建立 resolved 记录。 */
    resolveText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        if (record.status === 'pending') {
          record.ping();
          record.ping = null;
          record.status = 'resolved';
          record.promise = null;
        }
      } else {
        const newRecord = {
          ping: null,
          status: 'resolved',
          promise: null,
        };
        textCache.set(text, newRecord);
      }
    };

    // rejectText = text => {
    //   const record = textCache.get(text);
    //   if (record !== undefined) {
    //     if (record.status === 'pending') {
    //       Scheduler.log(`Promise rejected [${text}]`);
    //       record.ping();
    //       record.status = 'rejected';
    //       clearTimeout(record.promise._timer);
    //       record.promise = null;
    //     }
    //   } else {
    //     const newRecord = {
    //       ping: null,
    //       status: 'rejected',
    //       promise: null,
    //     };
    //     textCache.set(text, newRecord);
    //   }
    // };
  });

  /** 记录并返回同步文本，用于标记每次 CPU 分段提交。 */
  function Text(props) {
    Scheduler.log(props.text);
    return props.text;
  }

  /** 读取可挂起文本并记录结果；捕获仅用于区分 thenable/错误，随后必须原样重抛。 */
  function AsyncText(props) {
    const text = props.text;
    // WHY：readText 的 thenable 是 Suspense 控制信号，日志处理后不可吞掉。
    try {
      readText(text);
      Scheduler.log(text);
      return text;
    } catch (promise) {
      if (typeof promise.then === 'function') {
        Scheduler.log(`Suspend! [${text}]`);
      } else {
        Scheduler.log(`Error! [${text}]`);
      }
      throw promise;
    }
  }

  /** Given–When–Then：Given初次挂载中 defer Suspense 包含纯 CPU Inner；When推进到首次 paint；Then外层先以 Loading 提交，Inner 在独立提交中补齐。通过两次宿主快照验证 CPU Suspense 的初挂载分段。 */
  // @gate enableCPUSuspense
  it('skips CPU-bound trees on initial mount', async () => {
    /** 外层同步文本包裹 defer Inner，构造初挂载可先跳过的纯 CPU 子树。 */
    function App() {
      return (
        <>
          <Text text="Outer" />
          <div>
            <Suspense defer fallback={<Text text="Loading..." />}>
              <Text text="Inner" />
            </Suspense>
          </div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
      await waitForPaint(['Outer', 'Loading...']);
      expect(root).toMatchRenderedOutput(
        <>
          Outer
          <div>Loading...</div>
        </>,
      );
    });
    // Inner 内容在外层之后的独立提交中完成。
    assertLog(['Inner']);
    expect(root).toMatchRenderedOutput(
      <>
        Outer
        <div>Inner</div>
      </>,
    );
  });

  /** Given–When–Then：Given defer 边界已完成初挂载；When state 从 0 更新为 1；Then Outer 与 Inner[1] 在单次提交完成，不重新显示 Loading。通过日志验证 CPU defer 只作用于首次挂载。 */
  // @gate enableCPUSuspense
  it('does not skip CPU-bound trees during updates', async () => {
    let setCount;

    /** 持有 count 并在 defer 边界内渲染它，比较初挂载与后续 state 更新的提交策略。 */
    function App() {
      const [count, _setCount] = useState(0);
      setCount = _setCount;
      return (
        <>
          <Text text="Outer" />
          <div>
            <Suspense defer fallback={<Text text="Loading..." />}>
              <Text text={`Inner [${count}]`} />
            </Suspense>
          </div>
        </>
      );
    }

    // 初次挂载。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    // Inner 内容在外层之后的独立提交中完成。
    assertLog(['Outer', 'Loading...', 'Inner [0]']);
    expect(root).toMatchRenderedOutput(
      <>
        Outer
        <div>Inner [0]</div>
      </>,
    );

    // 已挂载后的更新。
    await act(() => {
      setCount(1);
    });
    // 整个更新在单次提交中完成。
    assertLog(['Outer', 'Inner [1]']);
    expect(root).toMatchRenderedOutput(
      <>
        Outer
        <div>Inner [1]</div>
      </>,
    );
  });

  /** Given–When–Then：Given defer 子树中的 AsyncText 真正抛出 thenable；When外层先提交、资源随后解决；Then Loading 保持到 ping 重试完成，之后切换 Inner。通过挂起/预热日志验证 CPU 延后与 IO Suspense 的组合。 */
  // @gate enableCPUSuspense
  it('suspend inside CPU-bound tree', async () => {
    /** 把真正可挂起的 AsyncText 放入 defer 边界，组合 CPU 延后与 IO 等待。 */
    function App() {
      return (
        <>
          <Text text="Outer" />
          <div>
            <Suspense defer fallback={<Text text="Loading..." />}>
              <AsyncText text="Inner" />
            </Suspense>
          </div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
      await waitForPaint(['Outer', 'Loading...']);
      expect(root).toMatchRenderedOutput(
        <>
          Outer
          <div>Loading...</div>
        </>,
      );
    });
    // Inner 仍因 IO 挂起，因此继续显示 fallback。
    assertLog([
      'Suspend! [Inner]',
      // 预热被挂起的主树。
      'Suspend! [Inner]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        Outer
        <div>Loading...</div>
      </>,
    );

    // 解决资源并完成主树渲染。
    await act(async () => {
      await resolveText('Inner');
    });
    assertLog(['Inner']);
    expect(root).toMatchRenderedOutput(
      <>
        Outer
        <div>Inner</div>
      </>,
    );
  });

  /** Given–When–Then：Given外层与内层两个 defer Suspense 嵌套；When初次挂载耗尽工作；Then A、Loading B、B、Loading C、C 按层级分别提交。通过日志顺序验证每层 CPU 边界独立分段。 */
  // @gate enableCPUSuspense
  it('nested CPU-bound trees', async () => {
    /** 嵌套两层 defer 边界和 A/B/C 标记，暴露逐层提交顺序。 */
    function App() {
      return (
        <>
          <Text text="A" />
          <div>
            <Suspense defer fallback={<Text text="Loading B..." />}>
              <Text text="B" />
              <div>
                <Suspense defer fallback={<Text text="Loading C..." />}>
                  <Text text="C" />
                </Suspense>
              </div>
            </Suspense>
          </div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    // 每一层 defer 边界分别提交。
    assertLog(['A', 'Loading B...', 'B', 'Loading C...', 'C']);
    expect(root).toMatchRenderedOutput(
      <>
        A
        <div>
          B<div>C</div>
        </div>
      </>,
    );
  });
});
