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
let Suspense;
let Activity;
let ViewTransition;
let ReactNoop;
let waitForAll;

/** 验证错误 component stack/owner stack 对用户组件、内建 Fiber 标签与重抛路径的名称保留和过滤规则。 */
describe('ReactFragment', () => {
  let didCatchErrors = [];
  let rootCaughtErrors = [];
  let SomethingThatErrors;
  let CatchingBoundary;
  let onCaughtError;

  /** 每例重建 Noop root、错误收集器和边界夹具，并清空两类栈记录数组。 */
  beforeEach(function () {
    jest.resetModules();

    React = require('react');
    Suspense = React.Suspense;
    Activity = React.Activity;
    ViewTransition = React.ViewTransition;
    ReactNoop = require('react-noop-renderer');
    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;

    didCatchErrors = [];
    rootCaughtErrors = [];

    /** 根级 caught error 回调：规范化 component stack，并在 DEV 同时采集当前 owner stack。 */
    onCaughtError = function (error, errorInfo) {
      rootCaughtErrors.push(
        error.message,
        normalizeCodeLocInfo(errorInfo.componentStack),
        React.captureOwnerStack
          ? normalizeCodeLocInfo(React.captureOwnerStack())
          : null,
      );
    };

    /** 始终抛出固定错误的函数组件，用于比较不同祖先 Fiber 的栈标签。 */
    SomethingThatErrors = () => {
      throw new Error('uh oh');
    };

    /** 捕获错误、记录边界收到的 component stack，并在恢复 render 中移除失败子树。 */
    // eslint-disable-next-line no-shadow
    CatchingBoundary = class CatchingBoundary extends React.Component {
      /** 初始化未出错状态；不使用外部状态，确保每例边界独立。 */
      constructor() {
        super();
        this.state = {};
      }

      /** 把任意子树错误映射为 errored 状态，触发恢复分支。 */
      static getDerivedStateFromError(error) {
        return {errored: true};
      }

      /** 保存错误消息及经位置归一化的 component stack。 */
      componentDidCatch(err, errInfo) {
        didCatchErrors.push(
          err.message,
          normalizeCodeLocInfo(errInfo.componentStack),
        );
      }

      /** 正常时渲染 children，捕获后返回 null。 */
      render() {
        if (this.state.errored) {
          return null;
        }
        return this.props.children;
      }
    };
  });

  /** 把期望组件名序列格式化为位置已归一化的 React component stack 字符串。 */
  function componentStack(components) {
    return components
      .map(component => `\n    in ${component} (at **)`)
      .join('');
  }

  /** 消除运行环境产生的真实源码位置，只保留稳定组件名，避免栈断言受行号影响。 */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(/\n +(?:at|in) ([^\(]+) [^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }

  /**
   * Given 内层边界在 getDerivedStateFromError 中重抛，外层边界最终捕获；When 叶组件失败；
   * Then component stack 保留完整祖先链，owner stack 仍保留创建 Foo/Bar 的所有者。
   * 验证机制：边界与 root 两路栈数组；对应 ReactFiberThrow、ReactFiberComponentStack 与 ReactOwnerStack。
   */
  it('retains component and owner stacks when rethrowing an error', async () => {
    /** 不恢复而原样重抛错误，验证重抛不会丢失已构建的栈元数据。 */
    class RethrowingBoundary extends React.Component {
      /** 原样抛出捕获错误，把处理权交给更外层边界。 */
      static getDerivedStateFromError(error) {
        throw error;
      }

      /** 未出错时透明返回 children。 */
      render() {
        return this.props.children;
      }
    }

    /** 创建重抛边界与 Bar，提供 owner stack 的上层所有者。 */
    function Foo() {
      return (
        <RethrowingBoundary>
          <Bar />
        </RethrowingBoundary>
      );
    }
    /** 创建失败叶组件，形成 owner stack 的直接所有者。 */
    function Bar() {
      return <SomethingThatErrors />;
    }

    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <Foo />
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'Bar',
        'RethrowingBoundary',
        'Foo',
        'CatchingBoundary',
      ]),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'Bar',
        'RethrowingBoundary',
        'Foo',
        'CatchingBoundary',
      ]),
      __DEV__ ? componentStack(['Bar', 'Foo']) : null,
    ]);
  });

  /**
   * Given 失败组件位于 Suspense 主内容；When render 错误被外层边界捕获；
   * Then component stack 显式包含内建 "Suspense" 标签。验证 ReactFiberComponentStack 的 Suspense 标签格式化。
   */
  it('includes built-in for Suspense', async () => {
    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <Suspense>
          <SomethingThatErrors />
        </Suspense>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack(['SomethingThatErrors', 'Suspense', 'CatchingBoundary']),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack(['SomethingThatErrors', 'Suspense', 'CatchingBoundary']),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given 主内容永久挂起且 fallback 自身抛错；When Suspense 切换到 fallback；
   * Then 栈使用 "Suspense Fallback" 标签区分错误来源。验证 fallback Fiber 的栈描述分支。
   */
  it('includes built-in for Suspense fallbacks', async () => {
    const SomethingThatSuspends = React.lazy(() => {
      return new Promise(() => {});
    });

    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <Suspense fallback={<SomethingThatErrors />}>
          <SomethingThatSuspends />
        </Suspense>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'Suspense Fallback',
        'CatchingBoundary',
      ]),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'Suspense Fallback',
        'CatchingBoundary',
      ]),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given 失败组件位于 Activity；When 外层边界捕获错误；Then component stack 包含 "Activity" 内建标签。
   * 验证 ReactFiberComponentStack 对 ActivityComponent Fiber tag 的名称映射。
   */
  it('includes built-in for Activity', async () => {
    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <Activity>
          <SomethingThatErrors />
        </Activity>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack(['SomethingThatErrors', 'Activity', 'CatchingBoundary']),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack(['SomethingThatErrors', 'Activity', 'CatchingBoundary']),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given ViewTransition Feature Flag 开启且其子树抛错；When 边界捕获；Then 栈包含 "ViewTransition" 标签。
   * 验证 ReactFiberComponentStack 的 ViewTransitionComponent 分支。
   */
  // @gate enableViewTransition
  it('includes built-in for ViewTransition', async () => {
    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <ViewTransition>
          <SomethingThatErrors />
        </ViewTransition>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'ViewTransition',
        'CatchingBoundary',
      ]),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'ViewTransition',
        'CatchingBoundary',
      ]),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given React.lazy 初始化器同步抛错；When lazy Fiber 展开；Then component stack 以 "Lazy" 表示包装层，owner stack 为空。
   * 验证 lazy 类型解析失败时的栈标签与 owner 边界。
   */
  it('includes built-in for Lazy', async () => {
    // Lazy 组件初始化器同步抛错。
    const LazyComponent = React.lazy(() => {
      throw new Error('uh oh');
    });

    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <LazyComponent />
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack(['Lazy', 'CatchingBoundary']),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack(['Lazy', 'CatchingBoundary']),
      __DEV__ ? '' : null, // 没有 owner stack。
    ]);
  });

  /**
   * Given SuspenseList 开启且直接子树失败；When 外层边界捕获；Then 栈包含 "SuspenseList" 内建标签。
   * 验证 ReactFiberComponentStack 对 SuspenseListComponent 的描述。
   */
  // @gate enableSuspenseList
  it('includes built-in for SuspenseList', async () => {
    const SuspenseList = React.unstable_SuspenseList;

    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <SuspenseList revealOrder="independent">
          <SomethingThatErrors />
        </SuspenseList>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'SuspenseList',
        'CatchingBoundary',
      ]),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        'SuspenseList',
        'CatchingBoundary',
      ]),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given 失败组件被透明 Fragment 包裹；When 生成错误栈；Then Fragment 不出现在用户可见 component stack。
   * 验证 Fragment Fiber 的透明栈语义，避免暴露无组件意义的结构节点。
   */
  it('does not include built-in for Fragment', async () => {
    ReactNoop.createRoot({
      onCaughtError,
    }).render(
      <CatchingBoundary>
        <>
          <SomethingThatErrors />
        </>
      </CatchingBoundary>,
    );
    await waitForAll([]);
    expect(didCatchErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        // Fragment 不应出现在栈中。
        'CatchingBoundary',
      ]),
    ]);
    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack([
        'SomethingThatErrors',
        // Fragment 不应出现在栈中。
        'CatchingBoundary',
      ]),
      __DEV__ ? componentStack(['SomethingThatErrors']) : null,
    ]);
  });

  /**
   * Given 环境临时缺少 Reflect.construct；When 类组件 render 抛错并走旧构造探测 fallback；
   * Then 仍捕获正确类名栈，且用于探测的 props throwing trap 完成清理。
   * 验证机制：root 栈与 prototype descriptor；对应 ReactFiberComponentStack 的类组件 fallback。
   */
  it('captures class component stacks via the no-Reflect.construct fallback', async () => {
    /** 在 render 中失败的类组件，用于触发无 Reflect.construct 的栈探测路径。 */
    class FailingClassComponent extends React.Component {
      /** 抛出固定错误，交由外层 CatchingBoundary 捕获。 */
      render() {
        throw new Error('uh oh');
      }
    }

    const root = ReactNoop.createRoot({onCaughtError});

    const originalReflectConstruct = Reflect.construct;
    delete Reflect.construct;

    try {
      root.render(
        <CatchingBoundary>
          <FailingClassComponent />
        </CatchingBoundary>,
      );
      await waitForAll([]);
    } finally {
      Object.defineProperty(Reflect, 'construct', {
        value: originalReflectConstruct,
      });
    }

    expect(rootCaughtErrors).toEqual([
      'uh oh',
      componentStack(['FailingClassComponent', 'CatchingBoundary']),
      __DEV__ ? componentStack(['FailingClassComponent']) : null,
    ]);

    // 用 props 属性安装的 throwing trap 必须在探测后恢复。
    expect(
      Object.getOwnPropertyDescriptor(FailingClassComponent.prototype, 'props'),
    ).toBeUndefined();
  });
});
