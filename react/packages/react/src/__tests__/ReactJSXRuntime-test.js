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
let JSXRuntime;
let JSXDEVRuntime;
let act;
let assertConsoleErrorDev;

// 注意：测试应优先直接调用 JSXRuntime，确保断言针对 runtime 行为，
// 而不是测试配置中 Babel 转换生成的中间代码。
describe('ReactJSXRuntime', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    JSXRuntime = require('react/jsx-runtime');
    JSXDEVRuntime = require('react/jsx-dev-runtime');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“allows static methods to be called using the type property”场景的唯一关键操作。
   * Then：断言 自动 JSX runtime 的 props、key 与元素构造契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('allows static methods to be called using the type property', () => {
    /** 作为“allows static methods to be called using the type property”场景的组件夹具，隔离待验证的 React 行为。 */
    class StaticMethodComponentClass extends React.Component {
      /** 渲染“allows static methods to be called using the type property”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    StaticMethodComponentClass.someStaticMethod = () => 'someReturnValue';

    const element = JSXRuntime.jsx(StaticMethodComponentClass, {});
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /**
   * 场景：“is indistinguishable from a plain object”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('is indistinguishable from a plain object', () => {
    const element = JSXRuntime.jsx('div', {className: 'foo'});
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /**
   * 场景：“should use default prop value when removing a prop”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should use default prop value when removing a prop', async () => {
    /** 作为“should use default prop value when removing a prop”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should use default prop value when removing a prop”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('span', {children: [this.props.fruit]});
      }
    }
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Component, {fruit: 'mango'}));
    });
    expect(container.firstChild.textContent).toBe('mango');

    await act(() => {
      root.render(JSXRuntime.jsx(Component, {}));
    });
    expect(container.firstChild.textContent).toBe('persimmon');
  });

  /**
   * 场景：“should normalize props with default values”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should normalize props with default values', async () => {
    /** 作为“should normalize props with default values”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should normalize props with default values”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('span', {children: this.props.prop});
      }
    }
    Component.defaultProps = {prop: 'testKey'};

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Component, {
          /** 捕获首次渲染的 class 实例，供默认 props 断言读取。 */
          ref: current => (instance = current)
        }),
      );
    });

    expect(instance.props.prop).toBe('testKey');

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let inst2;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Component, {
          prop: null,
          /** 捕获显式 null props 场景的实例，证明默认值不会覆盖 null。 */
          ref: current => (inst2 = current),
        }),
      );
    });

    expect(inst2.props.prop).toBe(null);
  });

  /**
   * 场景：“throws when changing a prop (in dev) after element creation”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('throws when changing a prop (in dev) after element creation', async () => {
    /** 作为“throws when changing a prop (in dev) after element creation”场景的组件夹具，隔离待验证的 React 行为。 */
    class Outer extends React.Component {
      /** 渲染“throws when changing a prop (in dev) after element creation”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const el = JSXRuntime.jsx('div', {className: 'moo'});

        if (__DEV__) {
          expect(function () {
            el.props.className = 'quack';
          }).toThrow();
          expect(el.props.className).toBe('moo');
        } else {
          el.props.className = 'quack';
          expect(el.props.className).toBe('quack');
        }

        return el;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Outer, {color: 'orange'}));
    });

    const outer = container.firstChild;
    if (__DEV__) {
      expect(outer.className).toBe('moo');
    } else {
      expect(outer.className).toBe('quack');
    }
  });

  /**
   * 场景：“throws when adding a prop (in dev) after element creation”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('throws when adding a prop (in dev) after element creation', async () => {
    const container = document.createElement('div');
    /** 作为“throws when adding a prop (in dev) after element creation”场景的组件夹具，隔离待验证的 React 行为。 */
    class Outer extends React.Component {
      /** 渲染“throws when adding a prop (in dev) after element creation”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const el = JSXRuntime.jsx('div', {children: this.props.sound});

        if (__DEV__) {
          expect(function () {
            el.props.className = 'quack';
          }).toThrow();
          expect(el.props.className).toBe(undefined);
        } else {
          el.props.className = 'quack';
          expect(el.props.className).toBe('quack');
        }

        return el;
      }
    }
    Outer.defaultProps = {sound: 'meow'};
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Outer, {}));
    });
    expect(container.firstChild.textContent).toBe('meow');
    if (__DEV__) {
      expect(container.firstChild.className).toBe('');
    } else {
      expect(container.firstChild.className).toBe('quack');
    }
  });

  /**
   * 场景：“does not warn for NaN props”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not warn for NaN props', async () => {
    /** 作为“does not warn for NaN props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Test extends React.Component {
      /** 渲染“does not warn for NaN props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let test;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Test, {
          value: +undefined,
          /** 捕获宿主测试组件实例，供 NaN props 断言读取。 */
          ref: current => (test = current),
        }),
      );
    });

    expect(test.props.value).toBeNaN();
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when `key` is being accessed on composite element', async () => {
    const container = document.createElement('div');
    /** 作为“does not warn for NaN props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“does not warn for NaN props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {children: this.props.key});
      }
    }
    /** 作为“does not warn for NaN props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“does not warn for NaN props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsxs('div', {
          children: [
            JSXRuntime.jsx(Child, {}, '0'),
            JSXRuntime.jsx(Child, {}, '1'),
            JSXRuntime.jsx(Child, {}, '2'),
          ],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'Child: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)\n' +
        '    in Parent (at **)',
    ]);
  });

  /**
   * 场景：“warns when a jsxs is passed something that is not an array”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('warns when a jsxs is passed something that is not an array', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsxs('div', {children: 'foo'}, null));
    });
    assertConsoleErrorDev([
      'React.jsx: Static children should always be an array. ' +
        'You are likely explicitly calling React.jsxs or React.jsxDEV. ' +
        'Use the Babel transform instead.',
    ]);
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when `key` is being accessed on a host element', () => {
    const element = JSXRuntime.jsxs('div', {}, '3');
    void element.props.key;
    assertConsoleErrorDev([
      'div: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)',
    ]);
  });

  /**
   * 场景：“should warn when unkeyed children are passed to jsx”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when unkeyed children are passed to jsx', async () => {
    const container = document.createElement('div');

    /** 作为“should warn when unkeyed children are passed to jsx”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should warn when unkeyed children are passed to jsx”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 作为“should warn when unkeyed children are passed to jsx”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should warn when unkeyed children are passed to jsx”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {
          children: [
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
          ],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Parent`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in Parent (at **)',
    ]);
  });

  /**
   * 场景：“should warn when keys are passed as part of props”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when keys are passed as part of props', async () => {
    const container = document.createElement('div');
    /** 作为“should warn when keys are passed as part of props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should warn when keys are passed as part of props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 作为“should warn when keys are passed as part of props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should warn when keys are passed as part of props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {
          children: [JSXRuntime.jsx(Child, {key: '0', prop: 'hi'})],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'A props object containing a "key" prop is being spread into JSX:\n' +
        '  let props = {key: someKey, prop: ...};\n' +
        '  <Child {...props} />\n' +
        'React keys must be passed directly to JSX without using spread:\n' +
        '  let props = {prop: ...};\n' +
        '  <Child key={someKey} {...props} />\n' +
        '    in Parent (at **)',
    ]);
  });

  /**
   * 场景：“should not warn when unkeyed children are passed to jsxs”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('should not warn when unkeyed children are passed to jsxs', async () => {
    const container = document.createElement('div');
    /** 作为“should not warn when unkeyed children are passed to jsxs”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“should not warn when unkeyed children are passed to jsxs”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 作为“should not warn when unkeyed children are passed to jsxs”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“should not warn when unkeyed children are passed to jsxs”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return JSXRuntime.jsxs('div', {
          children: [
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
          ],
        });
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });

    // lazy 初始化器不得在元素构造阶段执行，因此此操作不应抛错。
    expect(true).toBe(true);
  });

  /**
   * 场景：“does not call lazy initializers eagerly”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not call lazy initializers eagerly', () => {
    let didCall = false;
    const Lazy = React.lazy(() => {
      didCall = true;
      return {
        /** 模拟 thenable 的订阅入口，用于验证 React 对异步值的处理边界。 */
        then() {}
      };
    });
    if (__DEV__) {
      JSXDEVRuntime.jsxDEV(Lazy, {});
    } else {
      JSXRuntime.jsx(Lazy, {});
    }
    expect(didCall).toBe(false);
  });

  /**
   * 场景：“does not clone props object if key and ref is not spread”。
   * 机制：验证自动 JSX runtime 的 props、key 与元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not clone props object if key and ref is not spread', async () => {
    const config = {
      foo: 'foo',
      bar: 'bar',
    };

    const element = __DEV__
      ? JSXDEVRuntime.jsxDEV('div', config)
      : JSXRuntime.jsx('div', config);
    expect(Object.is(element.props, config)).toBe(true);

    const configWithKey = {
      foo: 'foo',
      bar: 'bar',
    // 只有通过 spread 传入的 key 会走该分支；静态 key 会作为独立参数传给 `jsx()` runtime。
      key: 'key',
    };

    const elementWithSpreadKey = __DEV__
      ? JSXDEVRuntime.jsxDEV('div', configWithKey)
      : JSXRuntime.jsx('div', configWithKey);
    assertConsoleErrorDev([
      'A props object containing a "key" prop is being spread into JSX:\n' +
        '  let props = {key: someKey, foo: ..., bar: ...};\n' +
        '  <div {...props} />\n' +
        'React keys must be passed directly to JSX without using spread:\n' +
        '  let props = {foo: ..., bar: ...};\n' +
        '  <div key={someKey} {...props} />',
    ]);
    expect(elementWithSpreadKey.props).not.toBe(configWithKey);
  });
});
