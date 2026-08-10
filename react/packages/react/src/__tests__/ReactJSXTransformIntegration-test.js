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
let act;
let assertConsoleErrorDev;

// TODO：此模块历史上用于确认 JSX 转换输出；但 JSX 通常由 Babel 或 TypeScript 完成，
// 转换器本身并非 React runtime 的组成部分，因此这里实质是 Babel 转换集成测试。
// 可考虑删除，并优先在 ReactCreateElement-test 与 ReactJSXRuntime-test 中直接验证 runtime；
// 在迁移完成前，这些模块之间会保留部分重复覆盖。
describe('ReactJSXTransformIntegration', () => {
  let Component;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    Component = class extends React.Component {
      /** 渲染“ReactJSXTransformIntegration”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“sanity check: test environment is configured to compile JSX to the jsx() runtime”场景的唯一关键操作。
   * Then：断言 Babel JSX 转换与 React runtime 的集成契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('sanity check: test environment is configured to compile JSX to the jsx() runtime', async () => {
    /** 作为“sanity check: test environment is configured to compile JSX to the jsx() runtime”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function App() {
      return <div />;
    }
    const source = App.toString();
    if (__DEV__) {
      expect(source).toContain('jsxDEV(');
    } else {
      expect(source).toContain('jsx(');
    }
    expect(source).not.toContain('React.createElement');
  });

  /**
   * 场景：“returns a complete element according to spec”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('returns a complete element according to spec', () => {
    const element = <Component />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“allows a lower-case to be passed as the string type”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('allows a lower-case to be passed as the string type', () => {
    const element = <div />;
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“allows a string to be passed as the type”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('allows a string to be passed as the type', () => {
    const TagName = 'div';
    const element = <TagName />;
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“returns an immutable element”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('returns an immutable element', () => {
    const element = <Component />;
    if (__DEV__) {
      expect(() => (element.type = 'div')).toThrow();
    } else {
      expect(() => (element.type = 'div')).not.toThrow();
    }
  });

  /**
   * 场景：“does not reuse the object that is spread into props”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('does not reuse the object that is spread into props', () => {
    const config = {foo: 1};
    const element = <Component {...config} />;
    expect(element.props.foo).toBe(1);
    config.foo = 2;
    expect(element.props.foo).toBe(1);
  });

  /**
   * 场景：“extracts key from the rest of the props”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('extracts key from the rest of the props', () => {
    const element = <Component key="12" foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe('12');
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“does not extract ref from the rest of the props”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('does not extract ref from the rest of the props', () => {
    const ref = React.createRef();
    const element = <Component ref={ref} foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.ref).toBe(ref);
    assertConsoleErrorDev([
      'Accessing element.ref was removed in React 19. ref is now a ' +
        'regular prop. It will be removed from the JSX Element ' +
        'type in a future release.',
    ]);
    const expectation = {foo: '56', ref};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“coerces the key to a string”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('coerces the key to a string', () => {
    const element = <Component key={12} foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe('12');
    expect(element.ref).toBe(null);
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“merges JSX children onto the children prop”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('merges JSX children onto the children prop', () => {
    const a = 1;
    const element = <Component children="text">{a}</Component>;
    expect(element.props.children).toBe(a);
  });

  /**
   * 场景：“does not override children if no JSX children are provided”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('does not override children if no JSX children are provided', () => {
    const element = <Component children="text" />;
    expect(element.props.children).toBe('text');
  });

  /**
   * 场景：“overrides children if null is provided as a JSX child”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('overrides children if null is provided as a JSX child', () => {
    const element = <Component children="text">{null}</Component>;
    expect(element.props.children).toBe(null);
  });

  /**
   * 场景：“overrides children if undefined is provided as an argument”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('overrides children if undefined is provided as an argument', () => {
    const element = <Component children="text">{undefined}</Component>;
    expect(element.props.children).toBe(undefined);

    const element2 = React.cloneElement(
      <Component children="text" />,
      {},
      undefined,
    );
    expect(element2.props.children).toBe(undefined);
  });

  /**
   * 场景：“merges JSX children onto the children prop in an array”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('merges JSX children onto the children prop in an array', () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const element = (
      <Component>
        {a}
        {b}
        {c}
      </Component>
    );
    expect(element.props.children).toEqual([1, 2, 3]);
  });

  /**
   * 场景：“allows static methods to be called using the type property”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('allows static methods to be called using the type property', () => {
    /** 作为“allows static methods to be called using the type property”场景的组件夹具，隔离待验证的 React 行为。 */
    class StaticMethodComponent {
      /** 实现“allows static methods to be called using the type property”场景所需的“someStaticMethod”测试夹具行为。 */
      static someStaticMethod() {
        return 'someReturnValue';
      }
      /** 渲染“allows static methods to be called using the type property”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }

    const element = <StaticMethodComponent />;
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /**
   * 场景：“identifies valid elements”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('identifies valid elements', () => {
    expect(React.isValidElement(<div />)).toEqual(true);
    expect(React.isValidElement(<Component />)).toEqual(true);

    expect(React.isValidElement(null)).toEqual(false);
    expect(React.isValidElement(true)).toEqual(false);
    expect(React.isValidElement({})).toEqual(false);
    expect(React.isValidElement('string')).toEqual(false);
    expect(React.isValidElement(Component)).toEqual(false);
    expect(React.isValidElement({type: 'div', props: {}})).toEqual(false);
  });

  /**
   * 场景：“is indistinguishable from a plain object”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('is indistinguishable from a plain object', () => {
    const element = <div className="foo" />;
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /**
   * 场景：“should use default prop value when removing a prop”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('should use default prop value when removing a prop', async () => {
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component fruit="mango" ref={ref => (instance = ref)} />);
    });
    expect(instance.props.fruit).toBe('mango');

    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    expect(instance.props.fruit).toBe('persimmon');
  });

  /**
   * 场景：“should normalize props with default values”。
   * 机制：验证Babel JSX 转换与 React runtime 的集成契约，锁定可观察结果与失败边界。
   */
  it('should normalize props with default values', async () => {
    /** 作为“should normalize props with default values”场景的组件夹具，隔离待验证的 React 行为。 */
    class NormalizingComponent extends React.Component {
      /** 渲染“should normalize props with default values”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span>{this.props.prop}</span>;
      }
    }
    NormalizingComponent.defaultProps = {prop: 'testKey'};

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(
        <NormalizingComponent ref={current => (instance = current)} />,
      );
    });

    expect(instance.props.prop).toBe('testKey');

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let inst2;
    await act(() => {
      root.render(
        <NormalizingComponent prop={null} ref={current => (inst2 = current)} />,
      );
    });

    expect(inst2.props.prop).toBe(null);
  });
});
