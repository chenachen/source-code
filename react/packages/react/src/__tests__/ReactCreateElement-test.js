/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let act;

let React;
let ReactDOMClient;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

// 注意：此模块验证旧版“经典”JSX runtime，即 `React.createElement`。
// 为避免 Babel 转换遮蔽被测入口，必须直接调用 `React.createElement`，不使用 JSX 语法。
describe('ReactCreateElement', () => {
  let ComponentClass;

  beforeEach(() => {
    jest.resetModules();

    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ComponentClass = class extends React.Component {
      /** 渲染“ReactCreateElement”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div');
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“returns a complete element according to spec”场景的唯一关键操作。
   * Then：断言 经典 createElement 运行时的元素构造契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('returns a complete element according to spec', () => {
    const element = React.createElement(ComponentClass);
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({});
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when `key` is being accessed on composite element', async () => {
    /** 作为“returns a complete element according to spec”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 渲染“returns a complete element according to spec”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div', null, this.props.key);
      }
    }
    /** 作为“returns a complete element according to spec”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 渲染“returns a complete element according to spec”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement(
          'div',
          null,
          React.createElement(Child, {key: '0'}),
          React.createElement(Child, {key: '1'}),
          React.createElement(Child, {key: '2'}),
        );
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Parent));
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
   * 场景：“当前测试”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('should warn when `key` is being accessed on a host element', () => {
    const element = React.createElement('div', {key: '3'});
    void element.props.key;
    assertConsoleErrorDev([
      'div: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)',
    ]);
  });

  /**
   * 场景：“allows a string to be passed as the type”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('allows a string to be passed as the type', () => {
    const element = React.createElement('div');
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({});
  });

  /**
   * 场景：“returns an immutable element”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('returns an immutable element', () => {
    const element = React.createElement(ComponentClass);
    if (__DEV__) {
      expect(() => (element.type = 'div')).toThrow();
    } else {
      expect(() => (element.type = 'div')).not.toThrow();
    }
  });

  /**
   * 场景：“does not reuse the original config object”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not reuse the original config object', () => {
    const config = {foo: 1};
    const element = React.createElement(ComponentClass, config);
    expect(element.props.foo).toBe(1);
    config.foo = 2;
    expect(element.props.foo).toBe(1);
  });

  /**
   * 场景：“does not fail if config has no prototype”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not fail if config has no prototype', () => {
    const config = Object.create(null, {foo: {value: 1, enumerable: true}});
    const element = React.createElement(ComponentClass, config);
    expect(element.props.foo).toBe(1);
  });

  /**
   * 场景：“extracts key from the rest of the props”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('extracts key from the rest of the props', () => {
    const element = React.createElement(ComponentClass, {
      key: '12',
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('12');
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /**
   * 场景：“does not extract ref from the rest of the props”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not extract ref from the rest of the props', () => {
    const ref = React.createRef();
    const element = React.createElement(ComponentClass, {
      key: '12',
      ref: ref,
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
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
   * 场景：“extracts null key”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('extracts null key', () => {
    const element = React.createElement(ComponentClass, {
      key: null,
      foo: '12',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('null');
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '12'});
  });

  /**
   * 场景：“ignores undefined key and ref”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('ignores undefined key and ref', () => {
    const props = {
      foo: '56',
      key: undefined,
      ref: undefined,
    };
    const element = React.createElement(ComponentClass, props);
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '56'});
  });

  /**
   * 场景：“ignores key and ref warning getters”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('ignores key and ref warning getters', () => {
    const elementA = React.createElement('div');
    const elementB = React.createElement('div', elementA.props);
    expect(elementB.key).toBe(null);
    expect(elementB.ref).toBe(null);
  });

  /**
   * 场景：“coerces the key to a string”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('coerces the key to a string', () => {
    const element = React.createElement(ComponentClass, {
      key: 12,
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('12');
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '56'});
  });

  /**
   * 场景：“preserves the owner on the element”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('preserves the owner on the element', async () => {
    let element;
    let instance;

    /** 作为“preserves the owner on the element”场景的组件夹具，隔离待验证的 React 行为。 */
    class Wrapper extends React.Component {
      /** 记录“preserves the owner on the element”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        instance = this;
      }
      /** 渲染“preserves the owner on the element”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        element = React.createElement(ComponentClass);
        return element;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(Wrapper)));
    if (__DEV__) {
      expect(element._owner.stateNode).toBe(instance);
    } else {
      expect('_owner' in element).toBe(false);
    }
  });

  /**
   * 场景：“merges an additional argument onto the children prop”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('merges an additional argument onto the children prop', () => {
    const a = 1;
    const element = React.createElement(
      ComponentClass,
      {
        children: 'text',
      },
      a,
    );
    expect(element.props.children).toBe(a);
  });

  /**
   * 场景：“does not override children if no rest args are provided”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not override children if no rest args are provided', () => {
    const element = React.createElement(ComponentClass, {
      children: 'text',
    });
    expect(element.props.children).toBe('text');
  });

  /**
   * 场景：“overrides children if null is provided as an argument”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('overrides children if null is provided as an argument', () => {
    const element = React.createElement(
      ComponentClass,
      {
        children: 'text',
      },
      null,
    );
    expect(element.props.children).toBe(null);
  });

  /**
   * 场景：“merges rest arguments onto the children prop in an array”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('merges rest arguments onto the children prop in an array', () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const element = React.createElement(ComponentClass, null, a, b, c);
    expect(element.props.children).toEqual([1, 2, 3]);
  });

  /**
   * 场景：“allows static methods to be called using the type property”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('allows static methods to be called using the type property', () => {
    /** 作为“allows static methods to be called using the type property”场景的组件夹具，隔离待验证的 React 行为。 */
    class StaticMethodComponentClass extends React.Component {
      /** 渲染“allows static methods to be called using the type property”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div');
      }
    }
    StaticMethodComponentClass.someStaticMethod = () => 'someReturnValue';

    const element = React.createElement(StaticMethodComponentClass);
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /**
   * 场景：“is indistinguishable from a plain object”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('is indistinguishable from a plain object', () => {
    const element = React.createElement('div', {className: 'foo'});
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /**
   * 场景：“should use default prop value when removing a prop”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('should use default prop value when removing a prop', async () => {
    /** 作为“should use default prop value when removing a prop”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should use default prop value when removing a prop”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('span');
      }
    }
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const ref = React.createRef();
    await act(() => {
      root.render(React.createElement(Component, {ref, fruit: 'mango'}));
    });
    const instance = ref.current;
    expect(instance.props.fruit).toBe('mango');

    await act(() => {
      root.render(React.createElement(Component));
    });
    expect(instance.props.fruit).toBe('persimmon');
  });

  /**
   * 场景：“should normalize props with default values”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('should normalize props with default values', async () => {
    let instance;
    /** 作为“should normalize props with default values”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 记录“should normalize props with default values”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        instance = this;
      }
      /** 渲染“should normalize props with default values”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('span', null, this.props.prop);
      }
    }
    Component.defaultProps = {prop: 'testKey'};

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Component));
    });
    expect(instance.props.prop).toBe('testKey');

    await act(() => {
      root.render(React.createElement(Component, {prop: null}));
    });
    expect(instance.props.prop).toBe(null);
  });

  /**
   * 场景：“throws when changing a prop (in dev) after element creation”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('throws when changing a prop (in dev) after element creation', async () => {
    /** 作为“throws when changing a prop (in dev) after element creation”场景的组件夹具，隔离待验证的 React 行为。 */
    class Outer extends React.Component {
      /** 渲染“throws when changing a prop (in dev) after element creation”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const el = React.createElement('div', {className: 'moo'});

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
      root.render(React.createElement(Outer, {color: 'orange'}));
    });
    if (__DEV__) {
      expect(container.firstChild.className).toBe('moo');
    } else {
      expect(container.firstChild.className).toBe('quack');
    }
  });

  /**
   * 场景：“throws when adding a prop (in dev) after element creation”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('throws when adding a prop (in dev) after element creation', async () => {
    const container = document.createElement('div');
    /** 作为“throws when adding a prop (in dev) after element creation”场景的组件夹具，隔离待验证的 React 行为。 */
    class Outer extends React.Component {
      /** 渲染“throws when adding a prop (in dev) after element creation”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        const el = React.createElement('div', null, this.props.sound);

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
      root.render(React.createElement(Outer));
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
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('does not warn for NaN props', async () => {
    let test;
    /** 作为“does not warn for NaN props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Test extends React.Component {
      /** 记录“does not warn for NaN props”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        test = this;
      }
      /** 渲染“does not warn for NaN props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div');
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Test, {value: +undefined}));
    });
    expect(test.props.value).toBeNaN();
  });

  /**
   * 场景：“warns if outdated JSX transform is detected”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('warns if outdated JSX transform is detected', async () => {
    // 检测到 `__self` 时发出警告，因为该字段只应由旧编译器转换注入。
    React.createElement('div', {className: 'foo', __self: this});
    assertConsoleWarnDev([
      'Your app (or one of its dependencies) is using an outdated JSX ' +
        'transform. Update to the modern JSX transform for ' +
        'faster performance: https://react.dev/link/new-jsx-transform',
    ]);

    // 该诊断只输出一次；后续元素应被去重，避免重复污染控制台。
    React.createElement('div', {className: 'foo', __self: this});
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证经典 createElement 运行时的元素构造契约，锁定可观察结果与失败边界。
   */
  it('do not warn about outdated JSX transform if `key` is present', () => {
    // 当静态 `key` 位于 spread 之后时，现代 JSX 转换会输出 `createElement` 而非 `jsx`。
    // 原因是 `jsx` 中 spread key 始终覆盖静态 key，而 `createElement` 会遵循属性出现顺序。
    //
    // 只要存在 `key` 属性便跳过该警告，避免把转换器有意选择的 `createElement` 路径误报为旧转换器。
    React.createElement('div', {key: 'foo', __self: this});
  });
});
