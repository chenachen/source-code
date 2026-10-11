let React;
let ReactNoop;
let Scheduler;
let waitForAll;
let assertLog;
let ReactCache;
let Suspense;
let TextResource;
let act;

/** 覆盖默认批处理、布局提交、并发 Suspense 与 flushSync 嵌套时的事件边界。 */
describe('ReactBlockingMode', () => {
  /** 重置模块，创建以文本为 key 的可挂起资源，并绑定日志/计时器驱动工具。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    ReactCache = require('react-cache');
    Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    act = InternalTestUtils.act;

    TextResource = ReactCache.unstable_createResource(
      ([text, ms = 0]) => {
        return new Promise((resolve, reject) =>
          setTimeout(() => {
            Scheduler.log(`Promise resolved [${text}]`);
            resolve(text);
          }, ms),
        );
      },
      ([text, ms]) => text,
    );
  });

  /** 记录后直接返回文本，作为渲染与提交顺序的同步探针。 */
  function Text(props) {
    Scheduler.log(props.text);
    return props.text;
  }

  /** 读取 TextResource；未就绪时记录挂起、重新抛出 thenable，让 Suspense 捕获并切换回退。 */
  function AsyncText(props) {
    const text = props.text;
    // WHY：read 通过抛出 thenable 表达“尚未就绪”；这里必须原样重抛，不能吞掉挂起信号。
    try {
      TextResource.read([props.text, props.ms]);
      Scheduler.log(text);
      return props.text;
    } catch (promise) {
      if (typeof promise.then === 'function') {
        Scheduler.log(`Suspend! [${text}]`);
      } else {
        Scheduler.log(`Error! [${text}]`);
      }
      throw promise;
    }
  }

  /** Given–When–Then：Given 根收到三个普通更新但当前事件尚未让出执行权；When 等待调度器耗尽工作；Then提交前输出为空，下一事件一次完成 ABC。通过日志和宿主树验证默认批处理边界。 */
  it('updates flush without yielding in the next event', async () => {
    const root = ReactNoop.createRoot();

    root.render(
      <>
        <Text text="A" />
        <Text text="B" />
        <Text text="C" />
      </>,
    );

    // 当前事件尚未让出执行权，因此此时不应产生任何宿主输出。
    expect(root).toMatchRenderedOutput(null);

    await waitForAll(['A', 'B', 'C']);
    expect(root).toMatchRenderedOutput('ABC');
  });

  /** Given–When–Then：Given App 在布局 effect 中记录日志；When 根异步渲染后等待本轮工作完成；Then宿主文本与 layout effect 在同一提交序列出现。通过日志顺序验证布局阶段不会延后到被动任务。 */
  it('layout updates flush synchronously in same event', async () => {
    const {useLayoutEffect} = React;

    /** 安装布局 effect 并渲染 Hi，用日志确定宿主工作与布局阶段是否位于同一提交。 */
    function App() {
      useLayoutEffect(() => {
        Scheduler.log('Layout effect');
      });
      return <Text text="Hi" />;
    }

    const root = ReactNoop.createRoot();
    root.render(<App />);
    expect(root).toMatchRenderedOutput(null);
    assertLog([]);

    await waitForAll(['Hi', 'Layout effect']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given B 会挂起且 Suspense 有 Loading 回退；When 首次并发渲染并随后推进资源计时器；Then主树未挂载、回退立即提交，资源解决后才原子切换为 ABC。通过预热日志与宿主输出验证并发 Suspense 语义。 */
  it('uses proper Suspense semantics, not legacy ones', async () => {
    const root = ReactNoop.createRoot();
    root.render(
      <Suspense fallback={<Text text="Loading..." />}>
        <span>
          <Text text="A" />
        </span>
        <span>
          <AsyncText text="B" />
        </span>
        <span>
          <Text text="C" />
        </span>
      </Suspense>,
    );

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading...',
      // 预热被挂起的主树分支。
      'A',
      'Suspend! [B]',
      'C',
    ]);
    // Legacy 模式会把 A/B 挂载进隐藏主树；并发模式则不应挂载主树中的任何内容，
    // 只有回退分支需要立即提交。
    expect(root).toMatchRenderedOutput('Loading...');

    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [B]', 'A', 'B', 'C']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** Given–When–Then：Given 两个兄弟分别积压于 batchedUpdates，第二个更新嵌在 flushSync；When 同步范围结束；Then 退出这些嵌套调用后日志为 A1/B1，最终输出 A1B1。断言固定这一组合调用的结果，未在 flushSync 回调内部检查第一条更新。 */
  it('flushSync does not flush batched work', async () => {
    const {useState, forwardRef, useImperativeHandle} = React;
    const root = ReactNoop.createRoot();

    /** 暴露 setStep 的命令式句柄，使两个兄弟可在不同批处理边界中独立更新。 */
    const Foo = forwardRef(({label}, ref) => {
      const [step, setStep] = useState(0);
      useImperativeHandle(ref, () => ({setStep}));
      return <Text text={label + step} />;
    });

    const foo1 = React.createRef(null);
    const foo2 = React.createRef(null);
    root.render(
      <>
        <Foo label="A" ref={foo1} />
        <Foo label="B" ref={foo2} />
      </>,
    );

    await waitForAll(['A0', 'B0']);
    expect(root).toMatchRenderedOutput('A0B0');

    // 给第一个兄弟安排批处理更新，暂不主动冲刷。
    ReactNoop.batchedUpdates(() => foo1.current.setStep(1));

    // 在其冲刷前，于 flushSync 中更新第二个兄弟。
    ReactNoop.batchedUpdates(() =>
      ReactNoop.flushSync(() => {
        foo2.current.setStep(1);
      }),
    );

    // 退出嵌套边界后，再观察第一条更新与同步更新的最终批次。
    assertLog(['A1', 'B1']);
    expect(root).toMatchRenderedOutput('A1B1');
  });
});
