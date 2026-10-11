/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let waitForAll;
let uncaughtExceptionMock;

/** 直接执行更新并耗尽 Scheduler，不让 act/waitForThrow 拦截错误，以观察真实 uncaughtException/console 路由。 */
async function fakeAct(cb) {
  // 此处故意不用 act/waitForThrow，因为测试目标就是实际错误报告。
  await cb();
  Scheduler.unstable_flushAll();
}

/** 验证 Noop 并发根在 begin、commit、日志回调失败、内建 Offscreen 过滤及失败卸载时的错误报告。 */
describe('ReactIncrementalErrorLogging', () => {
  /** 每例重载 React、Noop、Scheduler 与调度等待工具。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  // 本文件不使用 assertConsoleDev() matcher，因为它会过滤掉测试正要观察的消息。
  let oldConsoleWarn;
  let oldConsoleError;
  /** 保存真实 console，实现 mock，并监听 uncaughtException；测试结束时必须成对恢复。 */
  beforeEach(() => {
    oldConsoleWarn = console.warn;
    oldConsoleError = console.error;
    console.warn = jest.fn();
    console.error = jest.fn();
    uncaughtExceptionMock = jest.fn();
    process.on('uncaughtException', uncaughtExceptionMock);
  });

  /** 恢复 console 与进程监听器并清空引用，防止错误观察器跨用例叠加。 */
  afterEach(() => {
    console.warn = oldConsoleWarn;
    console.error = oldConsoleError;
    process.off('uncaughtException', uncaughtExceptionMock);
    oldConsoleWarn = null;
    oldConsoleError = null;
    uncaughtExceptionMock = null;
  });

  /**
   * Given 类组件 constructor 在 begin phase 抛错；When Noop 并发根耗尽工作；
   * Then uncaughtException 收到一条 message 为 constructor error 的错误，DEV 另输出建议添加错误边界的警告。
   * 验证机制：process listener 与 console mock；对应 ReactFiberErrorLogger 的 uncaught root 路由。
   */
  it('should log errors that occur during the begin phase', async () => {
    /** 构造期失败的类组件，稳定命中 begin phase。 */
    class ErrorThrowingComponent extends React.Component {
      /** 立即抛出 constructor error，render 不应执行。 */
      constructor(props) {
        super(props);
        throw new Error('constructor error');
      }
      /** 理论正常输出，仅用于确认错误并非来自 render。 */
      render() {
        return <div />;
      }
    }
    await fakeAct(() => {
      ReactNoop.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });
    expect(uncaughtExceptionMock).toHaveBeenCalledTimes(1);
    expect(uncaughtExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'constructor error',
      }),
    );
    if (__DEV__) {
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('%s'),
        expect.stringContaining(
          'An error occurred in the <ErrorThrowingComponent> component.',
        ),
        expect.stringContaining(
          'Consider adding an error boundary to your tree ' +
            'to customize error handling behavior.',
        ),
        // expect.stringMatching(
        //  new RegExp(
        //    '\\s+(in|at) ErrorThrowingComponent'
        //  ),
        // ),
      );
    }
  });

  /**
   * Given render 成功而 componentDidMount 抛错；When commit layout 生命周期运行；
   * Then 错误同样上报 uncaughtException，DEV 警告指向失败组件。
   * 验证机制：进程与 console mock；对应 ReactFiberCommitEffects 的捕获及 ReactFiberErrorLogger。
   */
  it('should log errors that occur during the commit phase', async () => {
    /** commit mount 阶段失败的类组件夹具。 */
    class ErrorThrowingComponent extends React.Component {
      /** 在 layout commit 中抛出固定错误。 */
      componentDidMount() {
        throw new Error('componentDidMount error');
      }
      /** 正常完成 render，隔离 commit 错误来源。 */
      render() {
        return <div />;
      }
    }
    await fakeAct(() => {
      ReactNoop.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });
    expect(uncaughtExceptionMock).toHaveBeenCalledTimes(1);
    expect(uncaughtExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'componentDidMount error',
      }),
    );
    if (__DEV__) {
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('%s'),
        expect.stringContaining(
          'An error occurred in the <ErrorThrowingComponent> component.',
        ),
        expect.stringContaining(
          'Consider adding an error boundary to your tree ' +
            'to customize error handling behavior.',
        ),
        // expect.stringMatching(
        //   new RegExp(
        //     '\\s+(in|at) ErrorThrowingComponent'
        //   ),
        // ),
      );
    }
  });

  /**
   * Given render 错误由边界捕获，而 console.error mock 在记录时再次抛错；When React 报告原错误；
   * Then 日志只调用一次，日志错误随后独立重抛，不形成递归报告循环。
   * 验证机制：调用数组、console 参数与 timer 抛错；对应 ReactFiberErrorLogger 的日志回调隔离。
   */
  it('should ignore errors thrown in log method to prevent cycle', async () => {
    const logCapturedErrorCalls = [];
    console.error.mockImplementation(error => {
      // 模拟日志实现自身存在缺陷。
      logCapturedErrorCalls.push(error);
      throw new Error('logCapturedError error');
    });

    /** 捕获失败子树并在后续 render 移除它的传统错误边界。 */
    class ErrorBoundary extends React.Component {
      /** 保存捕获错误；null 表示正常渲染 children。 */
      state = {error: null};
      /** 捕获后安排状态更新，进入空 fallback。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 错误态返回 null，正常态透传 children。 */
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    /** render 时始终抛错的叶组件。 */
    class ErrorThrowingComponent extends React.Component {
      /** 抛出原始 render error。 */
      render() {
        throw new Error('render error');
      }
    }
    await fakeAct(() => {
      ReactNoop.render(
        <div>
          <ErrorBoundary>
            <span>
              <ErrorThrowingComponent />
            </span>
          </ErrorBoundary>
        </div>,
      );
    });
    expect(logCapturedErrorCalls.length).toBe(1);
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('%o'),
        expect.objectContaining({
          message: 'render error',
        }),
        expect.stringContaining(
          'The above error occurred in the <ErrorThrowingComponent> component.',
        ),
        expect.stringContaining(
          'React will try to recreate this component tree from scratch ' +
            'using the error boundary you provided, ErrorBoundary.',
        ),
        // expect.stringMatching(
        //   new RegExp(
        //     '\\s+(in|at) ErrorThrowingComponent'
        //   ),
        // ),
      );
    } else {
      expect(logCapturedErrorCalls[0]).toEqual(
        expect.objectContaining({
          message: 'render error',
        }),
      );
    }
    // logCapturedError 中抛出的错误应以干净调用栈重新抛出。
    expect(() => {
      jest.runAllTimers();
    }).toThrow('logCapturedError error');
  });

  /**
   * Given Suspense child 在 lazy reconciliation 阶段而非组件 render 中抛错；When 构建 Throw Fiber 的返回链；
   * Then 用户消息报告 Suspense，不暴露内部 Offscreen。
   * 验证机制：uncaught error 与完整 warning 参数；对应 ReactFiberComponentStack 的 Offscreen 跳过规则。
   */
  it('does not report internal Offscreen component for errors thrown during reconciliation inside Suspense', async () => {
    // Suspense child 在 reconciliation 阶段抛错时，Throw Fiber 的 .return 指向内部 Offscreen；
    // 错误报告应跳过该实现细节并继续上溯到 Suspense。
    const lazyChild = React.lazy(() => {
      throw new Error('lazy init error');
    });

    await fakeAct(() => {
      ReactNoop.render(
        <React.Suspense fallback={<div />}>{lazyChild}</React.Suspense>,
      );
    });
    expect(uncaughtExceptionMock).toHaveBeenCalledTimes(1);
    expect(uncaughtExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'lazy init error',
      }),
    );
    if (__DEV__) {
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn.mock.calls[0]).toEqual([
        '%s\n\n%s\n',
        'An error occurred in the <Suspense> component.',
        'Consider adding an error boundary to your tree to customize error handling behavior.\n' +
          'Visit https://react.dev/link/error-boundaries to learn more about error boundaries.',
      ]);
    }
  });

  /**
   * Given Activity 内的 lazy child 在 reconciliation 抛错；When 生成用户错误消息；
   * Then 报告 Activity 而非其内部 Offscreen 包装。
   * 验证机制：uncaughtException 与 warning 文本；对应 Activity 返回链的 Offscreen 过滤。
   */
  it('does not report internal Offscreen component for errors thrown during reconciliation inside Activity', async () => {
    // 与 Suspense 相同，Activity 也用内部 Offscreen 包裹 children；错误消息应显示 Activity，而非 Offscreen。
    const lazyChild = React.lazy(() => {
      throw new Error('lazy init error');
    });

    await fakeAct(() => {
      ReactNoop.render(
        <React.Activity mode="visible">{lazyChild}</React.Activity>,
      );
    });
    expect(uncaughtExceptionMock).toHaveBeenCalledTimes(1);
    expect(uncaughtExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'lazy init error',
      }),
    );
    if (__DEV__) {
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn.mock.calls[0]).toEqual([
        '%s\n\n%s\n',
        'An error occurred in the <Activity> component.',
        'Consider adding an error boundary to your tree to customize error handling behavior.\n' +
          'Visit https://react.dev/link/error-boundaries to learn more about error boundaries.',
      ]);
    }
  });

  /**
   * Given Foo 在 mount 后 setState，并于更新 render 抛错；When React 重试失败并卸载节点；
   * Then componentWillUnmount 观察到恢复前的 state 0，而非失败 work-in-progress 的 state 1。
   * 验证机制：Scheduler 生命周期日志；对应错误 unwind 时类实例字段恢复与 commit deletion。
   */
  it('resets instance variables before unmounting failed node', async () => {
    /** 捕获 Foo 更新错误并删除失败子树。 */
    class ErrorBoundary extends React.Component {
      /** 保存 Foo 的错误以驱动 null fallback。 */
      state = {error: null};
      /** 捕获更新错误并安排恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 捕获前渲染 Foo，捕获后移除它。 */
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    /** mount 后从 step 0 更新到 1，并在 step 1 render 抛错的实例恢复夹具。 */
    class Foo extends React.Component {
      /** 已提交 state 从 0 开始；失败更新尝试写入 1。 */
      state = {step: 0};
      /** 首次提交后安排导致失败的 step 1 更新。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** 记录卸载时实例 state，验证失败 WIP 字段已回滚。 */
      componentWillUnmount() {
        Scheduler.log('componentWillUnmount: ' + this.state.step);
      }
      /** 记录当前 step，并在更新态抛错。 */
      render() {
        Scheduler.log('render: ' + this.state.step);
        if (this.state.step > 0) {
          throw new Error('oops');
        }
        return null;
      }
    }

    ReactNoop.render(
      <ErrorBoundary>
        <Foo />
      </ErrorBoundary>,
    );
    await waitForAll(
      [
        'render: 0',

        'render: 1',

        // 正式处理错误前再重试一次。
        'render: 1',

        'componentWillUnmount: 0',
      ].filter(Boolean),
    );

    expect(console.error).toHaveBeenCalledTimes(1);
    if (__DEV__) {
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('%o'),
        expect.objectContaining({
          message: 'oops',
        }),
        expect.stringContaining(
          'The above error occurred in the <Foo> component.',
        ),
        expect.stringContaining(
          'React will try to recreate this component tree from scratch ' +
            'using the error boundary you provided, ErrorBoundary.',
        ),
        // expect.stringMatching(
        //   new RegExp('\\s+(in|at) Foo')
        // ),
      );
    } else {
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'oops',
        }),
      );
    }
  });
});
