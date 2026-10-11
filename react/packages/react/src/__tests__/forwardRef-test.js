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
    // 每例重置 React/noop renderer，等待工具完整推进提交，隔离 forwardRef 创建期诊断去重。
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** forwardRef 把 object ref 转为 forwardedRef prop，子按 setRefOnDiv 切换给 div/span；两次提交 ref.current.type 从 div 变 span，验证目标切换更新引用。 */
  it('should update refs when switching between children', async () => {
    /** 根据 setRefOnDiv 把 forwardedRef 附到 div 或 span，保留另一个宿主节点用于观察 ref 切换。 */
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

  /** forwardRef render 返回 null，等待挂载完成后 object ref.current 仍 null，验证无目标的允许返回值。 */
  it('should support rendering null', async () => {
    const RefForwardingComponent = React.forwardRef((props, ref) => null);

    const ref = React.createRef();

    ReactNoop.render(<RefForwardingComponent ref={ref} />);
    await waitForAll([]);
    expect(ref.current).toBe(null);
  });

  /** 多兄弟结构中 forwardRef 返回 null，提交后其 object ref 仍 null，验证外层宿主兄弟不改变无目标引用。 */
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

  /** 分别给 forwardRef undefined/null/string 作为 render，创建后各断言参数类型诊断；不挂载这些无效描述，验证入口提醒。 */
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

  /** 不传参数调用 forwardRef，断言 render=undefined 诊断，验证省略实参边界。 */
  it('should warn if no render function is provided', () => {
    React.forwardRef();
    assertConsoleErrorDev([
      'forwardRef requires a render function but was given undefined.',
    ]);
  });

  /** render 函数有 defaultProps 属性，forwardRef 创建要求不支持该属性的诊断；本例不挂载，验证 render 描述元数据限制。 */
  it('should warn if the render function provided has defaultProps attributes', () => {
    /** 接收 props/ref 后返回 null，随后人为加 defaultProps，用于 forwardRef 创建期元数据诊断；参数不消费。 */
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

  /** 传无命名形参函数且通过 arguments[1] 取 ref，创建完成无预期诊断；验证 length=0 允许，不等于函数不能使用 ref。 */
  it('should not warn if the render function provided does not use any parameter', () => {
    // length=0 的具名 render 仍从 arguments[1] 取 ref；本例只校验创建期，不实际挂载。
    React.forwardRef(/** length=0，但仍从 arguments[1] 取转发 ref；供创建期 arity 允许值检查，不在本例挂载。 */ function arityOfZero() {
      return <div ref={arguments[1]} />;
    });
  });

  /** 传 length=1 的 render，创建要求提示遗漏 ref 形参；仅校验函数形参数量，不分析实际函数体是否使用 ref。 */
  it('should warn if the render function provided does not use the forwarded ref parameter', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfOne = props => <div {...props} />;

    React.forwardRef(arityOfOne);
    assertConsoleErrorDev([
      'forwardRef render functions accept exactly two parameters: props and ref. ' +
        'Did you forget to use the ref parameter?',
    ]);
  });

  /** 传 length=2 的 render 并把 ref 给 div，创建完成无预期诊断，验证标准形参数量。 */
  it('should not warn if the render function provided use exactly two parameters', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfTwo = (props, ref) => <div {...props} ref={ref} />;
    React.forwardRef(arityOfTwo);
  });

  /** 传 length=3 的 render，创建诊断额外参数将为 undefined；本例不实际调用该第三参数，验证入口 arity 检查。 */
  it('should warn if the render function provided expects to use more than two parameters', () => {
    /** 提供固定形参数量的 render 夹具，验证 forwardRef 的参数个数校验。 */
    const arityOfThree = (props, ref, x) => <div {...props} ref={ref} x={x} />;

    React.forwardRef(arityOfThree);
    assertConsoleErrorDev([
      'forwardRef render functions accept exactly two parameters: props and ref. ' +
        'Any additional parameter will be undefined.',
    ]);
  });

  /** 匿名 forwardRef render 返回无 key span 数组并挂载；key 诊断用 ForwardRef 兜底名，栈显示源位置，验证未命名 render 的调试标签。 */
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

  /** 具名 Inner render 返回无 key数组，挂载诊断上下文为 ForwardRef(Inner)、栈帧为 Inner，验证内函数名。 */
  it('should use the inner function name for the stack', async () => {
    // 具名 render 的 props/ref 本例未使用；只返回缺 key 数组以触发名称相关诊断。
    const RefForwardingComponent = React.forwardRef(/** 返回无 key span 数组的具名 render；props/ref 未使用，供诊断栈采用 Inner 名称。 */ function Inner(props, ref) {
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

  /** 箭头 fn 的 name 显式改为 Inner 后转发，挂载无 key 数组告警同样显示 Inner，验证名称属性而非函数语法来源。 */
  it('should use the inner name in the stack', async () => {
    /** 返回无 key span 数组的箭头 render；name 后改 Inner，props/ref 未用，供 owner 栈名称检查。 */
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

  /** 匿名 render 的外壳 displayName=Outer，挂载缺 key 数组告警上下文和栈帧均用 Outer，验证显示名传给匿名 render。 */
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

  /** render name=Inner、外壳 displayName=Outer，挂载缺 key 告警上下文用 Outer 而栈帧用 Inner，验证两种命名用途的优先级。 */
  it('should prefer the inner name to the outer displayName in the stack', async () => {
    /** 返回无 key span 数组的箭头 render；内部 name=Inner、外壳 displayName=Outer，供两类调试名称用途检查。 */
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

  /** 没有 memo 的 forwardRef 固定 ref 和 optional=foo 连渲两次，renderCount=1→2，验证它自身不按相同 props 自动浅比较跳过。 */
  it('should not bailout if forwardRef is not wrapped in memo', async () => {
    /** 将所有 props spread 到 div；本例用来计数未包 memo 的 forwardRef render，不把 forwardedRef 转为真正宿主 ref。 */
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

  /** memo(forwardRef) 同 props/ref 重渲染保持次数1；更换 ref 增至2且旧ref清空、新ref指div，再改optional增至3，验证 props和ref均影响跳过。 */
  it('should bailout if forwardRef is wrapped in memo', async () => {
    /** 把 props.forwardedRef 作为 div 的真实 ref，供 memo 在 ref 更换时清旧附新。 */
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

  /** 内 memo 比 a/b，外 memo 比 a/c；逐次改 b、c、a与ref，renderCount序列证明任一层可跳过。仅 c 改时外层继续、内层因 a/b 相同跳过；ref变更绕过比较并清旧附新。 */
  it('should custom memo comparisons to compose', async () => {
    /** 把 props.forwardedRef 作为 div 的真实 ref，供嵌套自定义比较与 ref 更新断言。 */
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

    // 外层比较 a/c 会因 c 变化继续进入内层；内层只比 a/b，二者相同则跳过实际 render。
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

  /** 把 memo 描述对象传给 forwardRef，创建要求建议 memo(forwardRef(...)) 的顺序诊断；不挂载此错误类型。 */
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
