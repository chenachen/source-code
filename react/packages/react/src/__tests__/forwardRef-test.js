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
  let waitForAll;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should update refs when switching between children”场景的唯一关键操作。
   * Then：断言 forwardRef 的 render 签名、默认属性与 memo 组合契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should update refs when switching between children', async () => {
    /** 作为“should update refs when switching between children”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function FunctionComponent({forwardedRef, setRefOnDiv}) {
      return (
        <section>
          <div ref={setRefOnDiv ? forwardedRef : null}>First</div>
          <span ref={setRefOnDiv ? null : forwardedRef}>Second</span>
        </section>
      );
    }

    const RefForwardingComponent = React.forwardRef((props, ref) => (
      <FunctionComponent {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} setRefOnDiv={true} />);
    await waitForAll([]);
    expect(ref.current.type).toBe('div');

    ReactNoop.render(<RefForwardingComponent ref={ref} setRefOnDiv={false} />);
    await waitForAll([]);
    expect(ref.current.type).toBe('span');
  });

  /**
   * 场景：“should support rendering null”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should support rendering null', async () => {
    const RefForwardingComponent = React.forwardRef((props, ref) => null);

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} />);
    await waitForAll([]);
    expect(ref.current).toBe(null);
  });

  /**
   * 场景：“should support rendering null for multiple children”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should support rendering null for multiple children', async () => {
    const RefForwardingComponent = React.forwardRef((props, ref) => null);

    const ref = React.createRef();

    ReactNoop.render(
      <div>
        <div />
        <RefForwardingComponent ref={ref} />
        <div />
      </div>,
    );
    await waitForAll([]);
    expect(ref.current).toBe(null);
  });

  /**
   * 场景：“should warn if not provided a callback during creation”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should warn if not provided a callback during creation', () => {
    React.forwardRef(undefined);
    assertConsoleErrorDev([
      'forwardRef requires a render function but was given undefined.',
    ]);

    React.forwardRef(null);
    assertConsoleErrorDev([
      'forwardRef requires a render function but was given null.',
    ]);

    React.forwardRef('foo');
    assertConsoleErrorDev([
      'forwardRef requires a render function but was given string.',
    ]);
  });

  /**
   * 场景：“should warn if no render function is provided”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should warn if no render function is provided', () => {
    React.forwardRef();
    assertConsoleErrorDev([
      'forwardRef requires a render function but was given undefined.',
    ]);
  });

  /**
   * 场景：“should warn if the render function provided has defaultProps attributes”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should warn if the render function provided has defaultProps attributes', () => {
    /** 实现“should warn if the render function provided has defaultProps attributes”场景所需的“renderWithDefaultProps”测试夹具行为。 */
    function renderWithDefaultProps(props, ref) {
      return null;
    }
    renderWithDefaultProps.defaultProps = {};

    React.forwardRef(renderWithDefaultProps);
    assertConsoleErrorDev([
      'forwardRef render functions do not support defaultProps. ' +
        'Did you accidentally pass a React component?',
    ]);
  });

  /**
   * 场景：“should not warn if the render function provided does not use any parameter”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should not warn if the render function provided does not use any parameter', () => {
    React.forwardRef(function arityOfZero() {
      return <div ref={arguments[1]} />;
    });
  });

  /**
   * 场景：“should warn if the render function provided does not use the forwarded ref parameter”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should warn if the render function provided does not use the forwarded ref parameter', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfOne = props => <div {...props} />;

    React.forwardRef(arityOfOne);
    assertConsoleErrorDev([
      'forwardRef render functions accept exactly two parameters: props and ref. ' +
        'Did you forget to use the ref parameter?',
    ]);
  });

  /**
   * 场景：“should not warn if the render function provided use exactly two parameters”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should not warn if the render function provided use exactly two parameters', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfTwo = (props, ref) => <div {...props} ref={ref} />;
    React.forwardRef(arityOfTwo);
  });

  /**
   * 场景：“should warn if the render function provided expects to use more than two parameters”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should warn if the render function provided expects to use more than two parameters', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfThree = (props, ref, x) => <div {...props} ref={ref} x={x} />;

    React.forwardRef(arityOfThree);
    assertConsoleErrorDev([
      'forwardRef render functions accept exactly two parameters: props and ref. ' +
        'Any additional parameter will be undefined.',
    ]);
  });

  /**
   * 场景：“should skip forwardRef in the stack if neither displayName nor name are present”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should skip forwardRef in the stack if neither displayName nor name are present', async () => {
    const RefForwardingComponent = React.forwardRef(function (props, ref) {
      return [<span />];
    });
    ReactNoop.render(
      <p>
        <RefForwardingComponent />
      </p>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the top-level render call using <ForwardRef>. It was passed a child from ForwardRef. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in **/forwardRef-test.js:**:** (at **)',
    ]);
  });

  /**
   * 场景：“should use the inner function name for the stack”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should use the inner function name for the stack', async () => {
    const RefForwardingComponent = React.forwardRef(function Inner(props, ref) {
      return [<span />];
    });
    ReactNoop.render(
      <p>
        <RefForwardingComponent />
      </p>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the top-level render call using <ForwardRef(Inner)>. It was passed a child from ForwardRef(Inner). ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Inner (at **)',
    ]);
  });

  /**
   * 场景：“should use the inner name in the stack”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should use the inner name in the stack', async () => {
    /** 作为“should use the inner name in the stack”场景的可观测回调，记录 React 传入的参数。 */
    const fn = (props, ref) => {
      return [<span />];
    };
    Object.defineProperty(fn, 'name', {value: 'Inner'});
    const RefForwardingComponent = React.forwardRef(fn);
    ReactNoop.render(
      <p>
        <RefForwardingComponent />
      </p>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the top-level render call using <ForwardRef(Inner)>. It was passed a child from ForwardRef(Inner). ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Inner (at **)',
    ]);
  });

  /**
   * 场景：“can use the outer displayName in the stack”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('can use the outer displayName in the stack', async () => {
    const RefForwardingComponent = React.forwardRef((props, ref) => {
      return [<span />];
    });
    RefForwardingComponent.displayName = 'Outer';
    ReactNoop.render(
      <p>
        <RefForwardingComponent />
      </p>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the top-level render call using <Outer>. It was passed a child from Outer. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Outer (at **)',
    ]);
  });

  /**
   * 场景：“should prefer the inner name to the outer displayName in the stack”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should prefer the inner name to the outer displayName in the stack', async () => {
    /** 作为“should prefer the inner name to the outer displayName in the stack”场景的可观测回调，记录 React 传入的参数。 */
    const fn = (props, ref) => {
      return [<span />];
    };
    Object.defineProperty(fn, 'name', {value: 'Inner'});
    const RefForwardingComponent = React.forwardRef(fn);
    RefForwardingComponent.displayName = 'Outer';
    ReactNoop.render(
      <p>
        <RefForwardingComponent />
      </p>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the top-level render call using <Outer>. It was passed a child from Outer. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Inner (at **)',
    ]);
  });

  /**
   * 场景：“should not bailout if forwardRef is not wrapped in memo”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should not bailout if forwardRef is not wrapped in memo', async () => {
    /** 作为“should not bailout if forwardRef is not wrapped in memo”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const Component = props => <div {...props} />;

    let renderCount = 0;

    const RefForwardingComponent = React.forwardRef((props, ref) => {
      renderCount++;
      return <Component {...props} forwardedRef={ref} />;
    });

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} optional="foo" />);
    await waitForAll([]);
    expect(renderCount).toBe(1);

    ReactNoop.render(<RefForwardingComponent ref={ref} optional="foo" />);
    await waitForAll([]);
    expect(renderCount).toBe(2);
  });

  /**
   * 场景：“should bailout if forwardRef is wrapped in memo”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should bailout if forwardRef is wrapped in memo', async () => {
    /** 作为“should bailout if forwardRef is wrapped in memo”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const Component = props => <div ref={props.forwardedRef} />;

    let renderCount = 0;

    const RefForwardingComponent = React.memo(
      React.forwardRef((props, ref) => {
        renderCount++;
        return <Component {...props} forwardedRef={ref} />;
      }),
    );

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} optional="foo" />);
    await waitForAll([]);
    expect(renderCount).toBe(1);

    expect(ref.current.type).toBe('div');

    ReactNoop.render(<RefForwardingComponent ref={ref} optional="foo" />);
    await waitForAll([]);
    expect(renderCount).toBe(1);

    const differentRef = React.createRef();

    ReactNoop.render(
      <RefForwardingComponent ref={differentRef} optional="foo" />,
    );
    await waitForAll([]);
    expect(renderCount).toBe(2);

    expect(ref.current).toBe(null);
    expect(differentRef.current.type).toBe('div');

    ReactNoop.render(<RefForwardingComponent ref={ref} optional="bar" />);
    await waitForAll([]);
    expect(renderCount).toBe(3);
  });

  /**
   * 场景：“should custom memo comparisons to compose”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('should custom memo comparisons to compose', async () => {
    /** 作为“should custom memo comparisons to compose”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const Component = props => <div ref={props.forwardedRef} />;

    let renderCount = 0;

    const RefForwardingComponent = React.memo(
      React.forwardRef((props, ref) => {
        renderCount++;
        return <Component {...props} forwardedRef={ref} />;
      }),
      (o, p) => o.a === p.a && o.b === p.b,
    );

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} a="0" b="0" c="1" />);
    await waitForAll([]);
    expect(renderCount).toBe(1);

    expect(ref.current.type).toBe('div');

    // `a` 或 `b` 任一变化都会使自定义比较返回不相等并重新渲染。
    ReactNoop.render(<RefForwardingComponent ref={ref} a="0" b="1" c="1" />);
    await waitForAll([]);
    expect(renderCount).toBe(2);

    // `c` 不参与比较，单独变化不会重新渲染。
    ReactNoop.render(<RefForwardingComponent ref={ref} a="0" b="1" c="2" />);
    await waitForAll([]);
    expect(renderCount).toBe(2);

    const ComposedMemo = React.memo(
      RefForwardingComponent,
      (o, p) => o.a === p.a && o.c === p.c,
    );

    ReactNoop.render(<ComposedMemo ref={ref} a="0" b="0" c="0" />);
    await waitForAll([]);
    expect(renderCount).toBe(3);

    // 新比较函数忽略 `b` 后，仅改变 `b` 不再触发更新。
    ReactNoop.render(<ComposedMemo ref={ref} a="0" b="1" c="0" />);
    await waitForAll([]);
    expect(renderCount).toBe(3);

    // `a` 参与新比较，因此同时改变 `a` 与 `c` 仍会更新。
    ReactNoop.render(<ComposedMemo ref={ref} a="2" b="2" c="2" />);
    await waitForAll([]);
    expect(renderCount).toBe(4);

    // 仅改变被忽略的 `c` 不会更新。
    ReactNoop.render(<ComposedMemo ref={ref} a="2" b="2" c="3" />);
    await waitForAll([]);
    expect(renderCount).toBe(4);

    // ref 身份变化必须绕过 props 比较并重新渲染，保证引用正确提交。
    const differentRef = React.createRef();

    ReactNoop.render(<ComposedMemo ref={differentRef} a="2" b="2" c="3" />);
    await waitForAll([]);
    expect(renderCount).toBe(5);

    expect(ref.current).toBe(null);
    expect(differentRef.current.type).toBe('div');
  });

  /**
   * 场景：“warns on forwardRef(memo(...))”。
   * 机制：验证forwardRef 的 render 签名、默认属性与 memo 组合契约，锁定可观察结果与失败边界。
   */
  it('warns on forwardRef(memo(...))', () => {
    React.forwardRef(
      React.memo((props, ref) => {
        return null;
      }),
    );
    assertConsoleErrorDev([
      'forwardRef requires a render function but received a `memo` ' +
        'component. Instead of forwardRef(memo(...)), use ' +
        'memo(forwardRef(...)).',
    ]);
  });
});
