/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let Profiler;
let React;
let ReactNoop;
let Scheduler;
let ReactFeatureFlags;
let ReactCache;
let Suspense;
let TextResource;
let textResourceShouldFail;
let waitForAll;
let assertLog;
let act;

/** 覆盖 Suspense 占位内容对隐藏节点、文本宿主上下文及 Profiler 时长的处理。 */
describe('ReactSuspensePlaceholder', () => {
  /**
   * 为每个场景重建可延迟或失败的文本资源，并开启 Profiler 计时。
   * 资源状态只在本用例内从 pending 单向进入 resolved 或 rejected。
   */
  beforeEach(() => {
    jest.resetModules();

    ReactFeatureFlags = require('shared/ReactFeatureFlags');

    ReactFeatureFlags.enableProfilerTimer = true;
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    ReactCache = require('react-cache');

    Profiler = React.Profiler;
    Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    act = InternalTestUtils.act;

    TextResource = ReactCache.unstable_createResource(
      ([text, ms = 0]) => {
        let listeners = null;
        let status = 'pending';
        let value = null;
        return {
          /**
           * 订阅资源完成结果；首次订阅启动计时器，后续订阅共享同一状态和监听队列。
           * 终态订阅会同步回放已解析的文本或错误，模拟标准 thenable 行为。
           */
          then(resolve, reject) {
            switch (status) {
              case 'pending': {
                if (listeners === null) {
                  listeners = [{resolve, reject}];
                  setTimeout(() => {
                    if (textResourceShouldFail) {
                      Scheduler.log(`Promise rejected [${text}]`);
                      status = 'rejected';
                      value = new Error('Failed to load: ' + text);
                      listeners.forEach(listener => listener.reject(value));
                    } else {
                      Scheduler.log(`Promise resolved [${text}]`);
                      status = 'resolved';
                      value = text;
                      listeners.forEach(listener => listener.resolve(value));
                    }
                  }, ms);
                } else {
                  listeners.push({resolve, reject});
                }
                break;
              }
              case 'resolved': {
                resolve(value);
                break;
              }
              case 'rejected': {
                reject(value);
                break;
              }
            }
          },
        };
      },
      ([text, ms]) => text,
    );
    textResourceShouldFail = false;
  });

  /** 推进模拟渲染耗时并记录文本，作为同步宿主输出与 Profiler 时长探针。 */
  function Text({fakeRenderDuration = 0, text = 'Text'}) {
    Scheduler.unstable_advanceTime(fakeRenderDuration);
    Scheduler.log(text);
    return text;
  }

  /**
   * 从共享文本资源读取内容；pending 时记录挂起，失败时记录错误并原样向 React 抛出。
   * `fakeRenderDuration` 使测试可精确核对 actualDuration 与 treeBaseDuration。
   */
  function AsyncText({fakeRenderDuration = 0, ms, text}) {
    Scheduler.unstable_advanceTime(fakeRenderDuration);
    try {
      TextResource.read([text, ms]);
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

  /**
   * 场景（Given–When–Then）：给定边界含显式 hidden 的 A、异步 B 和普通 C；当更新到 B2
   * 并超时显示回退；那么旧主树整体隐藏，B2 完成后 A 仍保持自身 hidden 属性。
   * 对应机制：Suspense Offscreen 占位树复用与宿主 hidden 标记合并。
   */
  it('times out children that are already hidden', async () => {
    /** 始终产出带 `hidden` 属性的宿主 span，用来区分业务隐藏和 Suspense 隐藏。 */
    class HiddenText extends React.PureComponent {
      /** 记录并返回显式隐藏文本节点。 */
      render() {
        const text = this.props.text;
        Scheduler.log(text);
        return <span hidden={true}>{text}</span>;
      }
    }

    /** 将显式隐藏 A、可挂起的中间文本和稳定 C 放入同一 Suspense 边界。 */
    function App(props) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <HiddenText text="A" />
          <span>
            <AsyncText ms={1000} text={props.middleText} />
          </span>
          <span>
            <Text text="C" />
          </span>
        </Suspense>
      );
    }

    // 初次挂载先提交回退，并在后台预热主树。
    ReactNoop.render(<App middleText="B" />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading...',
      // 后台预热主树。
      'A',
      'Suspend! [B]',
      'C',
    ]);
    expect(ReactNoop).toMatchRenderedOutput('Loading...');

    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [B]', 'A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );

    // 更新中间资源到尚未完成的 B2。
    ReactNoop.render(<App middleText="B2" />);
    await waitForAll([
      'Suspend! [B2]',
      'Loading...',
      // 后台预热主树。
      'Suspend! [B2]',
      'C',
    ]);

    // 更新超时后隐藏上一主树并显示回退。
    jest.advanceTimersByTime(750);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span hidden={true}>B</span>
        <span hidden={true}>C</span>
        Loading...
      </>,
    );

    // 完成 B2 的资源请求。
    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [B2]', 'B2', 'C']);

    // 提交最终更新；A 因自身 `hidden` 属性仍不可见。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>B2</span>
        <span>C</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定主树直接由文本节点 A/B/C 构成；当 B2 更新挂起并超时；
   * 那么回退替换文本占位，资源完成后恢复为 AB2C。对应机制：文本节点的隐藏与重新附着。
   */
  it('times out text nodes', async () => {
    /** 生成左右稳定文本夹住一个异步中间文本的边界。 */
    function App(props) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="A" />
          <AsyncText ms={1000} text={props.middleText} />
          <Text text="C" />
        </Suspense>
      );
    }

    // 初次挂载。
    ReactNoop.render(<App middleText="B" />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading...',
      // 后台预热主树。
      'A',
      'Suspend! [B]',
      'C',
    ]);

    expect(ReactNoop).not.toMatchRenderedOutput('ABC');

    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [B]', 'A', 'B', 'C']);
    expect(ReactNoop).toMatchRenderedOutput('ABC');

    // 更新到尚未完成的 B2。
    ReactNoop.render(<App middleText="B2" />);
    await waitForAll([
      'A',
      'Suspend! [B2]',
      'Loading...',
      // 后台预热主树。
      'A',
      'Suspend! [B2]',
      'C',
    ]);
    // 超时后只显示回退文本。
    jest.advanceTimersByTime(750);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('Loading...');

    // 完成异步文本。
    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [B2]', 'A', 'B2', 'C']);

    // 最终提交应恢复文本节点顺序并包含 B2。
    expect(ReactNoop).toMatchRenderedOutput('AB2C');
  });

  /**
   * 场景（Given–When–Then）：给定会把子文本转为大写的宿主上下文包裹 Suspense；当主树
   * 挂起、超时和恢复；那么 fallback 与最终文本始终继承 uppercase 上下文。
   * 对应机制：占位 Fiber 在回退/恢复路径上保存 HostContext。
   */
  it('preserves host context for text nodes', async () => {
    /** 在 uppercase 宿主上下文内渲染一个可更换异步中间文本的边界。 */
    function App(props) {
      return (
        // uppercase 是 Noop 渲染器的特殊宿主类型，会把后代文本转换为大写。
        <uppercase>
          <Suspense fallback={<Text text="Loading..." />}>
            <Text text="a" />
            <AsyncText ms={1000} text={props.middleText} />
            <Text text="c" />
          </Suspense>
        </uppercase>
      );
    }

    // 初次挂载。
    ReactNoop.render(<App middleText="b" />);

    await waitForAll([
      'a',
      'Suspend! [b]',
      'Loading...',
      // 后台预热主树。
      'a',
      'Suspend! [b]',
      'c',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(<uppercase>LOADING...</uppercase>);

    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [b]', 'a', 'b', 'c']);
    expect(ReactNoop).toMatchRenderedOutput(<uppercase>ABC</uppercase>);

    // 更新到新的异步文本。
    ReactNoop.render(<App middleText="b2" />);
    await waitForAll([
      'a',
      'Suspend! [b2]',
      'Loading...',
      'a',
      'Suspend! [b2]',
      'c',
    ]);
    // 更新超时后显示同一宿主上下文内的回退。
    jest.advanceTimersByTime(750);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<uppercase>LOADING...</uppercase>);

    // 完成异步资源。
    await act(() => jest.advanceTimersByTime(1000));
    assertLog(['Promise resolved [b2]', 'a', 'b2', 'c']);

    // 最终更新仍应受 uppercase 宿主上下文约束。
    expect(ReactNoop).toMatchRenderedOutput(<uppercase>AB2C</uppercase>);
  });

  /** 用人工推进的渲染耗时验证挂起前后 Profiler 的时长归属。 */
  describe('profiler durations', () => {
    let App;
    let onRender;

    /** 为每个计时场景创建固定成本的 fallback、挂起子树和 Profiler 回调。 */
    beforeEach(() => {
      // 参数顺序：id、phase、actualDuration、treeBaseDuration。
      onRender = jest.fn();

      /** 模拟耗时 10ms 的回退 UI。 */
      const Fallback = () => {
        Scheduler.log('Fallback');
        Scheduler.unstable_advanceTime(10);
        return 'Loading...';
      };

      /** 模拟自身耗时 2ms、异步文本耗时 1ms 的挂起分支。 */
      const Suspending = () => {
        Scheduler.log('Suspending');
        Scheduler.unstable_advanceTime(2);
        return <AsyncText ms={1000} text="Loaded" fakeRenderDuration={1} />;
      };

      /** 用 Profiler 包住可选挂起分支与指定成本的普通文本。 */
      App = ({shouldSuspend, text = 'Text', textRenderDuration = 5}) => {
        Scheduler.log('App');
        return (
          <Profiler id="root" onRender={onRender}>
            <Suspense fallback={<Fallback />}>
              {shouldSuspend && <Suspending />}
              <Text fakeRenderDuration={textRenderDuration} text={text} />
            </Suspense>
          </Profiler>
        );
      };
    });

    /** 验证初次挂载时回退树和被隐藏主树如何计入 Profiler。 */
    describe('when suspending during mount', () => {
      /**
       * 场景（Given–When–Then）：给定旧模式初次挂载耗时 8ms 的挂起主树和 10ms fallback；
       * 当先超时再完成资源；那么首次 actual/base 为 18/10，恢复提交为 1/8。
       * 验证机制：读取 `onRender` 的 actualDuration 与 treeBaseDuration 参数。
       */
      // @gate !disableLegacyMode && !disableLegacyMode
      it('properly accounts for base durations when a suspended times out in a legacy tree', async () => {
        ReactNoop.renderLegacySyncRoot(<App shouldSuspend={true} />);
        assertLog([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'Text',
          'Fallback',
        ]);
        expect(ReactNoop).toMatchRenderedOutput('Loading...');
        expect(onRender).toHaveBeenCalledTimes(1);

        // 初次挂载只显示 10ms 的 fallback；actualDuration 还要包含隐藏主树花费的 8ms。
        expect(onRender.mock.calls[0][2]).toBe(18);
        expect(onRender.mock.calls[0][3]).toBe(10);

        jest.advanceTimersByTime(1000);

        assertLog(['Promise resolved [Loaded]']);

        ReactNoop.flushSync();

        assertLog(['Loaded']);
        expect(ReactNoop).toMatchRenderedOutput('LoadedText');
        expect(onRender).toHaveBeenCalledTimes(2);

        // 资源恢复时 actualDuration 只含 AsyncText 重渲染的 1ms，treeBaseDuration 保留整树 8ms。
        expect(onRender.mock.calls[1][2]).toBe(1);
        expect(onRender.mock.calls[1][3]).toBe(8);
      });

      /**
       * 场景（Given–When–Then）：给定并发根初次挂载同一挂起树；当 fallback 提交且后台预热，
       * 随后资源完成；那么首次为 13/10，最终整棵主树为 8/8。
       * 验证机制：渲染日志限定阶段，再核对 Profiler 回调次数与两个时长字段。
       */
      it('properly accounts for base durations when a suspended times out in a concurrent tree', async () => {
        ReactNoop.render(<App shouldSuspend={true} />);

        await waitForAll([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'Fallback',
          // 后台预热主树。
          'Suspending',
          'Suspend! [Loaded]',
          'Text',
        ]);
        // 初次渲染立即提交 fallback；更新阶段的挂起由下方用例覆盖。
        expect(ReactNoop).toMatchRenderedOutput('Loading...');
        expect(onRender).toHaveBeenCalledTimes(
          gate('alwaysThrottleRetries') ? 1 : 2,
        );

        // treeBaseDuration 只含 10ms fallback，actualDuration 还包含已尝试的 3ms 隐藏主树。
        expect(onRender.mock.calls[0][2]).toBe(13);
        expect(onRender.mock.calls[0][3]).toBe(10);

        // 完成待处理资源并提交主树。
        await act(() => jest.advanceTimersByTime(1000));
        assertLog([
          'Promise resolved [Loaded]',
          'Suspending',
          'Loaded',
          'Text',
        ]);
        expect(ReactNoop).toMatchRenderedOutput('LoadedText');

        expect(onRender).toHaveBeenCalledTimes(3);

        // 恢复时两个时长都应包含 Suspending 与 AsyncText 所在整树的 8ms。
        expect(onRender.mock.calls[2][2]).toBe(8);
        expect(onRender.mock.calls[2][3]).toBe(8);
      });
    });

    /** 验证已提交主树更新挂起后，回退与恢复工作如何计入 Profiler。 */
    describe('when suspending during update', () => {
      /**
       * 场景（Given–When–Then）：给定旧模式先提交 5ms 文本，再两次更新到挂起主树；当回退
       * 超时并最终恢复；那么回退提交为 18/10，恢复只执行 1ms 但整树基准为 9ms。
       * 对应机制：旧模式 Suspense 更新的 Profiler 时长累积。
       */
      // @gate !disableLegacyMode && !disableLegacyMode
      it('properly accounts for base durations when a suspended times out in a legacy tree', async () => {
        ReactNoop.renderLegacySyncRoot(
          <App shouldSuspend={false} textRenderDuration={5} />,
        );
        assertLog(['App', 'Text']);
        expect(ReactNoop).toMatchRenderedOutput('Text');
        expect(onRender).toHaveBeenCalledTimes(1);

        // 初次挂载只渲染 Text，成本为 5ms。
        expect(onRender.mock.calls[0][2]).toBe(5);
        expect(onRender.mock.calls[0][3]).toBe(5);

        ReactNoop.render(<App shouldSuspend={true} textRenderDuration={5} />);
        assertLog([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'Text',
          'Fallback',
        ]);
        expect(ReactNoop).toMatchRenderedOutput('Loading...');
        expect(onRender).toHaveBeenCalledTimes(2);

        // 更新只显示 10ms fallback；actualDuration 另含隐藏挂起子树的 8ms，base 只保留回退。
        expect(onRender.mock.calls[1][2]).toBe(18);
        expect(onRender.mock.calls[1][3]).toBe(10);

        ReactNoop.renderLegacySyncRoot(
          <App shouldSuspend={true} text="New" textRenderDuration={6} />,
        );
        assertLog([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'New',
          'Fallback',
        ]);
        expect(ReactNoop).toMatchRenderedOutput('Loading...');
        expect(onRender).toHaveBeenCalledTimes(3);

        expect(onRender.mock.calls[1][2]).toBe(18);
        expect(onRender.mock.calls[1][3]).toBe(10);
        jest.advanceTimersByTime(1000);

        assertLog(['Promise resolved [Loaded]']);

        ReactNoop.flushSync();

        assertLog(['Loaded']);
        expect(ReactNoop).toMatchRenderedOutput('LoadedNew');
        expect(onRender).toHaveBeenCalledTimes(4);

        // 恢复时 actualDuration 只含 AsyncText 的 1ms，treeBaseDuration 包含更新后整树 9ms。
        expect(onRender.mock.calls[3][2]).toBe(1);
        expect(onRender.mock.calls[3][3]).toBe(9);
      });

      /**
       * 场景（Given–When–Then）：给定并发根已显示 5ms 文本，更新后主边界与兄弟边界都挂起；
       * 当 fallback 超时、再次更新并同时完成两个资源；那么回退计时排除未提交工作，最终
       * actualDuration 为 9ms。验证机制：阶段日志、回调次数和 feature gate 下的 base 值。
       */
      it('properly accounts for base durations when a suspended times out in a concurrent tree', async () => {
        /** 模拟更新阶段固定耗时 10ms 的回退 UI。 */
        const Fallback = () => {
          Scheduler.log('Fallback');
          Scheduler.unstable_advanceTime(10);
          return 'Loading...';
        };

        /** 模拟更新阶段自身 2ms 加异步文本 1ms 的挂起分支。 */
        const Suspending = () => {
          Scheduler.log('Suspending');
          Scheduler.unstable_advanceTime(2);
          return <AsyncText ms={1000} text="Loaded" fakeRenderDuration={1} />;
        };

        /** 重新定义应用以隔离并发更新场景中的 Profiler 树。 */
        App = ({shouldSuspend, text = 'Text', textRenderDuration = 5}) => {
          Scheduler.log('App');
          return (
            <Profiler id="root" onRender={onRender}>
              <Suspense fallback={<Fallback />}>
                {shouldSuspend && <Suspending />}
                <Text fakeRenderDuration={textRenderDuration} text={text} />
              </Suspense>
            </Profiler>
          );
        };

        ReactNoop.render(
          <>
            <App shouldSuspend={false} textRenderDuration={5} />
            <Suspense fallback={null} />
          </>,
        );

        await waitForAll(['App', 'Text']);
        expect(ReactNoop).toMatchRenderedOutput('Text');
        expect(onRender).toHaveBeenCalledTimes(1);

        // 初次挂载只渲染 Text，成本为 5ms。
        expect(onRender.mock.calls[0][2]).toBe(5);
        expect(onRender.mock.calls[0][3]).toBe(5);

        ReactNoop.render(
          <>
            <App shouldSuspend={true} textRenderDuration={5} />
            <Suspense fallback={null} />
          </>,
        );
        await waitForAll([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'Fallback',
          // 后台预热主树。
          'Suspending',
          'Suspend! [Loaded]',
          'Text',
        ]);
        // 挂起后显示 fallback。
        expect(ReactNoop).toMatchRenderedOutput('Loading...');
        expect(onRender).toHaveBeenCalledTimes(
          gate('alwaysThrottleRetries') ? 2 : 3,
        );

        jest.advanceTimersByTime(900);

        // actualDuration 包含 10ms fallback 与已部分渲染的 3ms 主树，base 只含 fallback。
        expect(onRender.mock.calls[1][2]).toBe(13);
        expect(onRender.mock.calls[1][3]).toBe(10);

        // 超时期间再次更新。为绕过“已经超时则避免再次挂起”的优化，增加另一个会挂起的兄弟边界，
        // 从而复现原测试关注的旧执行路径。
        ReactNoop.render(
          <>
            <App shouldSuspend={true} text="New" textRenderDuration={6} />
            <Suspense fallback={null}>
              <AsyncText ms={100} text="Sibling" fakeRenderDuration={1} />
            </Suspense>
          </>,
        );

        // TODO：这里只为推进到下一个 JND 时间桶；原因是 AsyncText 与 React 内部 Suspense
        // 共用计时器队列，后续应让测试辅助资源脱离该计时器。
        Scheduler.unstable_advanceTime(200);

        await waitForAll([
          'App',
          'Suspending',
          'Suspend! [Loaded]',
          'Fallback',
          'Suspend! [Sibling]',
          // 后台预热主树。
          'Suspending',
          'Suspend! [Loaded]',
          'New',
          'Suspend! [Sibling]',
        ]);
        expect(ReactNoop).toMatchRenderedOutput('Loading...');

        expect(onRender).toHaveBeenCalledTimes(
          gate('alwaysThrottleRetries') ? 4 : 5,
        );

        // 同时完成主资源和兄弟资源。
        await act(async () => {
          jest.advanceTimersByTime(100);
          assertLog([
            'Promise resolved [Loaded]',
            'Promise resolved [Sibling]',
          ]);
          await waitForAll(['Suspending', 'Loaded', 'New', 'Sibling']);
        });

        expect(onRender).toHaveBeenCalledTimes(
          gate('alwaysThrottleRetries') ? 5 : 6,
        );

        // 最终 actualDuration 包含 Text 6ms、Suspending 2ms 与 AsyncText 1ms。
        expect(onRender.mock.calls[4][2]).toBe(9);
        expect(onRender.mock.calls[4][3]).toBe(
          gate('alwaysThrottleRetries') ? 9 : 10,
        );
      });
    });
  });
});
