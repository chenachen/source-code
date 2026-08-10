/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('forwardRef', () => {
  let React;
  let ReactNoop;
  let Scheduler;
  let waitForAll;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should work without a ref to be forwarded”场景的唯一关键操作。
   * Then：断言 forwardRef 进入 reconciler 后的引用转发与错误恢复契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should work without a ref to be forwarded', async () => {
    /** 作为“should work without a ref to be forwarded”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should work without a ref to be forwarded”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 作为“should work without a ref to be forwarded”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      return <Child {...props} ref={props.forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    ReactNoop.render(<RefForwardingComponent value={123} />);
    await waitForAll([123]);
  });

  /**
   * 场景：“should forward a ref for a single child”。
   * 机制：验证forwardRef 进入 reconciler 后的引用转发与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should forward a ref for a single child', async () => {
    /** 作为“should forward a ref for a single child”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should forward a ref for a single child”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 作为“should forward a ref for a single child”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      return <Child {...props} ref={props.forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} value={123} />);
    await waitForAll([123]);
    expect(ref.current instanceof Child).toBe(true);
  });

  /**
   * 场景：“should forward a ref for multiple children”。
   * 机制：验证forwardRef 进入 reconciler 后的引用转发与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should forward a ref for multiple children', async () => {
    /** 作为“should forward a ref for multiple children”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should forward a ref for multiple children”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 作为“should forward a ref for multiple children”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      return <Child {...props} ref={props.forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();

    ReactNoop.render(
      <div>
        <div />
        <RefForwardingComponent ref={ref} value={123} />
        <div />
      </div>,
    );
    await waitForAll([123]);
    expect(ref.current instanceof Child).toBe(true);
  });

  /**
   * 场景：“should maintain child instance and ref through updates”。
   * 机制：验证forwardRef 进入 reconciler 后的引用转发与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should maintain child instance and ref through updates', async () => {
    /** 作为“should maintain child instance and ref through updates”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 初始化“should maintain child instance and ref through updates”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
      }
      /** 渲染“should maintain child instance and ref through updates”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 作为“should maintain child instance and ref through updates”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      return <Child {...props} ref={props.forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    let setRefCount = 0;
    let ref;

    /** 接收转发后的 ref 值，证明引用最终指向目标实例。 */
    const setRef = r => {
      setRefCount++;
      ref = r;
    };

    ReactNoop.render(<RefForwardingComponent ref={setRef} value={123} />);
    await waitForAll([123]);
    expect(ref instanceof Child).toBe(true);
    expect(setRefCount).toBe(1);
    ReactNoop.render(<RefForwardingComponent ref={setRef} value={456} />);
    await waitForAll([456]);
    expect(ref instanceof Child).toBe(true);
    expect(setRefCount).toBe(1);
  });

  /**
   * 场景：“should not break lifecycle error handling”。
   * 机制：验证forwardRef 进入 reconciler 后的引用转发与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should not break lifecycle error handling', async () => {
    /** 作为“should not break lifecycle error handling”场景的组件夹具，隔离待验证的 React 行为。 */
    class ErrorBoundary extends React.Component {
      /** 保存“should not break lifecycle error handling”场景用于驱动更新或错误回退的组件状态。 */
      state = {error: null};
      /** 记录“should not break lifecycle error handling”场景捕获的渲染错误与组件栈。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary.componentDidCatch');
        this.setState({error});
      }
      /** 渲染“should not break lifecycle error handling”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary.render: catch');
          return null;
        }
        Scheduler.log('ErrorBoundary.render: try');
        return this.props.children;
      }
    }

    /** 作为“should not break lifecycle error handling”场景的组件夹具，隔离待验证的 React 行为。 */
    class BadRender extends React.Component {
      /** 渲染“should not break lifecycle error handling”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log('BadRender throw');
        throw new Error('oops!');
      }
    }

    /** 作为“should not break lifecycle error handling”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      const forwardedRef = props.forwardedRef;
      Scheduler.log('Wrapper');
      return <BadRender {...props} ref={forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();

    ReactNoop.render(
      <ErrorBoundary>
        <RefForwardingComponent ref={ref} />
      </ErrorBoundary>,
    );
    await waitForAll([
      'ErrorBoundary.render: try',
      'Wrapper',
      'BadRender throw',

    // React 会对首次失败的渲染再重试一次。
      'ErrorBoundary.render: try',
      'Wrapper',
      'BadRender throw',

    // 重试仍失败后才交给错误边界处理，避免把可恢复失败提前提交。
      'ErrorBoundary.componentDidCatch',
      'ErrorBoundary.render: catch',
    ]);
    expect(ref.current).toBe(null);
  });

  /**
   * 场景：“should not re-run the render callback on a deep setState”。
   * 机制：验证forwardRef 进入 reconciler 后的引用转发与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should not re-run the render callback on a deep setState', async () => {
    let inst;

    /** 作为“should not re-run the render callback on a deep setState”场景的组件夹具，隔离待验证的 React 行为。 */
    class Inner extends React.Component {
      /** 渲染“should not re-run the render callback on a deep setState”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.log('Inner');
        inst = this;
        return <div ref={this.props.forwardedRef} />;
      }
    }

    /** 作为“should not re-run the render callback on a deep setState”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <Inner {...props} />;
    }

    const Forward = React.forwardRef((props, ref) => {
      Scheduler.log('Forward');
      return <Middle {...props} forwardedRef={ref} />;
    });

    /** 作为“should not re-run the render callback on a deep setState”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function App() {
      Scheduler.log('App');
      return <Forward />;
    }

    ReactNoop.render(<App />);
    await waitForAll(['App', 'Forward', 'Middle', 'Inner']);

    inst.setState({});
    await waitForAll(['Inner']);
  });
});
