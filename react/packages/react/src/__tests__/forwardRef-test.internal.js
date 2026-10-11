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
    // 每例重置 React/noop renderer/Scheduler 模块，waitForAll 驱动并比对完整调度日志。
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /** 无 ref 的 forwardRef 元素渲染经 Wrapper 到 class Child，等待日志 123 完成；验证 ref=null 不妨碍 props 转发和渲染。 */
  it('should work without a ref to be forwarded', async () => {
    /** 记录 props.value 并返回 null 的 class 目标；ref 应指向实例，供转发与更新检查。 */
    class Child extends React.Component {
      /** 记录本次 props.value，不输出宿主节点，供调度日志和目标实例 ref 检查。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 把 props.forwardedRef 作为 Child 的真正 ref，其余 props spread 透传，连接 forwardRef render 与 class 实例。 */
    function Wrapper(props) {
      return <Child {...props} ref={props.forwardedRef} />;
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <Wrapper {...props} forwardedRef={ref} />
    ));

    ReactNoop.render(<RefForwardingComponent value={123} />);
    await waitForAll([123]);
  });

  /** 给 forwardRef 元素 object ref，Wrapper 转交 class Child；等待 123 后 ref.current instanceof Child，验证最终目标为 class 实例。 */
  it('should forward a ref for a single child', async () => {
    /** 记录 props.value 并返回 null 的 class 目标；ref 应指向实例，供转发与更新检查。 */
    class Child extends React.Component {
      /** 记录本次 props.value，不输出宿主节点，供调度日志和目标实例 ref 检查。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 把 props.forwardedRef 作为 Child 的真正 ref，其余 props spread 透传，连接 forwardRef render 与 class 实例。 */
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

  /** 在外层 div 的多兄弟间挂同样转发链，等待日志 123 后 object ref 仍指向 Child，验证兄弟结构不影响目标。 */
  it('should forward a ref for multiple children', async () => {
    /** 记录 props.value 并返回 null 的 class 目标；ref 应指向实例，供转发与更新检查。 */
    class Child extends React.Component {
      /** 记录本次 props.value，不输出宿主节点，供调度日志和目标实例 ref 检查。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 把 props.forwardedRef 作为 Child 的真正 ref，其余 props spread 透传，连接 forwardRef render 与 class 实例。 */
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

  /** 固定 callback ref 随 value=123→456 两次渲染，Child 每次记录新值、两次 ref 都为 Child且回调累计一次，验证同类目标复用与稳定 ref 不重附。没有单独保存旧 ref 作严格引用比较。 */
  it('should maintain child instance and ref through updates', async () => {
    /** 记录 props.value 并返回 null 的 class 目标；ref 应指向实例，供转发与更新检查。 */
    class Child extends React.Component {
      /** 把 props 交给基类，不建立额外状态；供更新时 class 目标复用的测试。 */
      constructor(props) {
        super(props);
      }
      /** 记录本次 props.value，不输出宿主节点，供调度日志和目标实例 ref 检查。 */
      render() {
        Scheduler.log(this.props.value);
        return null;
      }
    }

    /** 把 props.forwardedRef 作为 Child 的真正 ref，其余 props spread 透传，连接 forwardRef render 与 class 实例。 */
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

  /** 错误边界下 forwardRef 经 Wrapper 到 BadRender，初次与重试都抛 oops，随后 didCatch→fallback；等待完整日志且 ref.current=null，验证失败目标未提交 ref 且错误可穿过转发层。 */
  it('should not break lifecycle error handling', async () => {
    /** 通过 componentDidCatch 存 error 并转为 null fallback，供转发链 render 错误恢复。 */
    class ErrorBoundary extends React.Component {
      /** 初始 error=null，提交捕获错误后置为 Error 对象，决定 fallback。 */
      state = {error: null};
      /** 记录捕获阶段并 setState({error})，在提交错误恢复后安排 fallback render。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary.componentDidCatch');
        this.setState({error});
      }
      /** 无 error 时记录 try 并透传 children，有 error 时记录 catch 并返回 null；不吞第一次 render 抛错。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary.render: catch');
          return null;
        }
        Scheduler.log('ErrorBoundary.render: try');
        return this.props.children;
      }
    }

    /** 每次 render 都抛 oops 的 class 目标，证明 forwardRef 透明于错误边界。 */
    class BadRender extends React.Component {
      /** 先写 BadRender throw 日志再抛 oops，供初次/重试两段顺序断言。 */
      render() {
        Scheduler.log('BadRender throw');
        throw new Error('oops!');
      }
    }

    /** 记录 Wrapper，并把 forwardedRef 转为 BadRender ref；目标渲染失败时 ref 不应提交。 */
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

  /** 挂 App→Forward→Middle→Inner 时记录全链，随后直接 inst.setState({}) 只记录 Inner；验证深层 class 更新无需重新调用无自身更新的 forwardRef 祖先。 */
  it('should not re-run the render callback on a deep setState', async () => {
    let inst;

    /** 捕获自身到 inst 的深层 class，便于直接 setState 后观察祖先 bailout。 */
    class Inner extends React.Component {
      /** 记录 Inner，保存实例并输出带 forwardedRef 的 div；深层更新仅应再执行此 render。 */
      render() {
        Scheduler.log('Inner');
        inst = this;
        return <div ref={this.props.forwardedRef} />;
      }
    }

    /** 记录 Middle 并将所有 props 交给 Inner，供祖先跳过重渲染的日志检查。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <Inner {...props} />;
    }

    const Forward = React.forwardRef((props, ref) => {
      Scheduler.log('Forward');
      return <Middle {...props} forwardedRef={ref} />;
    });

    /** 记录 App 并返回 Forward，供挂载全链与深层 setState 只执行 Inner 的对照。 */
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
