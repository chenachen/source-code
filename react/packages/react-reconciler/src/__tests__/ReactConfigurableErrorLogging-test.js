/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let Scheduler;
let container;
let act;

/** 执行回调并直接耗尽 Scheduler，不经过 act/waitForThrow 的错误拦截，以观察真实 root 错误回调。 */
async function fakeAct(cb) {
  // 此处故意不用 act/waitForThrow，因为测试目标正是生产式错误报告行为。
  await cb();
  Scheduler.unstable_flushAll();
}

/** 验证 createRoot 可配置的 onUncaughtError/onCaughtError 在 render、commit、回调自身失败及 act 下的路由。 */
describe('ReactConfigurableErrorLogging', () => {
  /** 每例重建 DOM root 容器与 Scheduler；DEV 额外取得真实 act，避免错误记录跨根泄漏。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    container = document.createElement('div');
    if (__DEV__) {
      act = React.act;
    }
  });

  /**
   * Given root 配置了 caught/uncaught 回调且组件 constructor 抛错；When begin phase 首次构造；
   * Then 只调用 onUncaughtError，并携带错误对象及完整组件栈。
   * 验证机制：回调收集数组；对应 ReactFiberErrorLogger 与 root uncaught error 路由。
   */
  it('should log errors that occur during the begin phase', async () => {
    /** 在 constructor 中失败，稳定命中 begin phase 错误路径。 */
    class ErrorThrowingComponent extends React.Component {
      /** 构造期抛出固定错误，render 正常分支不应到达。 */
      constructor(props) {
        super(props);
        throw new Error('constructor error');
      }
      /** 提供理论正常输出，用于证明错误源在 constructor 而非 render。 */
      render() {
        return <div />;
      }
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** 收集未被边界捕获的根错误及组件栈。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      /** 收集边界已捕获错误；本场景预期不会调用。 */
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });
    await fakeAct(() => {
      root.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([
      expect.objectContaining({
        message: 'constructor error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
      }),
    ]);
    expect(caughtErrors).toEqual([]);
  });

  /**
   * Given 组件 render 成功但 componentDidMount 抛错；When commit layout 生命周期；
   * Then 错误仍路由到 onUncaughtError，组件栈保留抛错组件及宿主祖先。
   * 验证机制：回调数组；对应 ReactFiberCommitEffects 与 ReactFiberErrorLogger。
   */
  it('should log errors that occur during the commit phase', async () => {
    /** 在 commit 生命周期抛错的类组件夹具。 */
    class ErrorThrowingComponent extends React.Component {
      /** mount 提交阶段抛出固定错误。 */
      componentDidMount() {
        throw new Error('componentDidMount error');
      }
      /** render 正常完成，使错误精确发生于 commit。 */
      render() {
        return <div />;
      }
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** 收集 commit 阶段未捕获错误。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      /** 收集已捕获错误；无边界时预期为空。 */
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });
    await fakeAct(() => {
      root.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([
      expect.objectContaining({
        message: 'componentDidMount error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
      }),
    ]);
    expect(caughtErrors).toEqual([]);
  });

  /**
   * Given render 错误由边界捕获，但 onCaughtError 自身再次抛错；When React 报告原错误；
   * Then 原错误只记录一次，回调错误异步重抛且不会递归进入日志回调。
   * 验证机制：caught/uncaught 数组与 timer 抛错；对应 ReactFiberErrorLogger 的回调隔离。
   */
  it('should ignore errors thrown in log method to prevent cycle', async () => {
    /** 通过 componentDidCatch 清空失败子树的传统错误边界。 */
    class ErrorBoundary extends React.Component {
      /** null 为正常态，非 null 表示已经捕获错误。 */
      state = {error: null};
      /** 捕获后更新状态，让失败子树从输出中移除。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 捕获前渲染 children，捕获后返回 null。 */
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    /** render 时始终失败的子组件。 */
    class ErrorThrowingComponent extends React.Component {
      /** 抛出原始 render error，供 onCaughtError 接收。 */
      render() {
        throw new Error('render error');
      }
    }

    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** 收集未捕获错误；边界存在时应保持为空。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      /** 先记录边界捕获信息，再故意抛错验证日志回调不会形成递归。 */
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
        throw new Error('onCaughtError error');
      },
    });

    const ref = React.createRef();

    await fakeAct(() => {
      root.render(
        <div>
          <ErrorBoundary ref={ref}>
            <span>
              <ErrorThrowingComponent />
            </span>
          </ErrorBoundary>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([]);
    expect(caughtErrors).toEqual([
      expect.objectContaining({
        message: 'render error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) ErrorBoundary(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
        errorBoundary: ref.current,
      }),
    ]);

    // caughtError 回调抛出的错误应以干净调用栈重新抛出。
    expect(() => {
      jest.runAllTimers();
    }).toThrow('onCaughtError error');
  });

  /**
   * Given DEV 真实 act 环境中的无边界 render 错误；When act 执行 root.render；
   * Then 错误由 act promise 拒绝传给测试，不调用 root 的错误日志回调。
   * 验证机制：rejects.toThrow 与空回调数组；对应 act 错误捕获通道和 ReactFiberErrorLogger 门控。
   */
  it('does not log errors when inside real act', async () => {
    /** 在 render 阶段抛错，验证 act 专用错误传递通道。 */
    function ErrorThrowingComponent() {
      throw new Error('render error');
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** 收集未捕获错误；真实 act 场景预期不会调用。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      /** 收集边界错误；本场景无边界且预期不会调用。 */
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });

    if (__DEV__) {
      global.IS_REACT_ACT_ENVIRONMENT = true;

      await expect(async () => {
        await act(() => {
          root.render(
            <div>
              <span>
                <ErrorThrowingComponent />
              </span>
            </div>,
          );
        });
      }).rejects.toThrow('render error');
    }

    expect(uncaughtErrors).toEqual([]);
    expect(caughtErrors).toEqual([]);
  });
});
