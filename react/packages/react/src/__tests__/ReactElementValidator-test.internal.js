/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 注意：本文件原则上直接验证不经过 JSX 的经典 `React.createElement` 路径。
// TODO：该说明已部分过时，因为文件内仍有 JSX 用例；应将其迁为 `React.createElement`，
// 并确认 JSX runtime 测试中存在对应覆盖。

let React;
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

describe('ReactElementValidator', () => {
  let ComponentClass;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    ComponentClass = class extends React.Component {
      /** 渲染“ReactElementValidator”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement('div', null, this.props.children);
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“warns for keys for arrays of elements in rest args”场景的唯一关键操作。
   * Then：断言 经典元素校验器的诊断与容错边界 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('warns for keys for arrays of elements in rest args', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(
        React.createElement(ComponentClass, null, [
          React.createElement(ComponentClass),
          React.createElement(ComponentClass),
        ]),
      ),
    );
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentClass`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentClass (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys for arrays of elements with owner info”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for arrays of elements with owner info', async () => {
    /** 作为“warns for keys for arrays of elements with owner info”场景的组件夹具，隔离待验证的 React 行为。 */
    class InnerClass extends React.Component {
      /** 渲染“warns for keys for arrays of elements with owner info”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement(ComponentClass, null, this.props.childSet);
      }
    }

    /** 作为“warns for keys for arrays of elements with owner info”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentWrapper extends React.Component {
      /** 渲染“warns for keys for arrays of elements with owner info”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement(InnerClass, {
          childSet: [
            React.createElement(ComponentClass),
            React.createElement(ComponentClass),
          ],
        });
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(ComponentWrapper)));
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `ComponentClass`. ' +
        'It was passed a child from ComponentWrapper. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentWrapper (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys for arrays with no owner or parent info”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for arrays with no owner or parent info', async () => {
    /** 实现“warns for keys for arrays with no owner or parent info”场景所需的“Anonymous”测试夹具行为。 */
    function Anonymous({children}) {
      return <div>{children}</div>;
    }
    Object.defineProperty(Anonymous, 'name', {value: undefined});

    const divs = [<div />, <div />];

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<Anonymous>{divs}</Anonymous>));
    assertConsoleErrorDev([
      // owner stack 校验的直接父节点是 div，因此诊断栈应从该层开始。
      'Each child in a list should have a unique ' +
        '"key" prop.' +
        '\n\nCheck the top-level render call using <div>. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys for arrays of elements with no owner info”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for arrays of elements with no owner info', async () => {
    const divs = [<div />, <div />];

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => root.render(<div>{divs}</div>));
    assertConsoleErrorDev([
      'Each child in a list should have a unique ' +
        '"key" prop.' +
        '\n\nCheck the top-level render call using <div>. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys with component stack info”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for keys with component stack info', async () => {
    /** 作为“warns for keys with component stack info”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Component() {
      return <div>{[<div />, <div />]}</div>;
    }

    /** 实现“warns for keys with component stack info”场景所需的“Parent”测试夹具行为。 */
    function Parent(props) {
      return React.cloneElement(props.child);
    }

    /** 实现“warns for keys with component stack info”场景所需的“GrandParent”测试夹具行为。 */
    function GrandParent() {
      return <Parent child={<Component />} />;
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<GrandParent />));
    assertConsoleErrorDev([
      'Each child in a list should have a unique ' +
        '"key" prop.\n\nCheck the render method of `Component`. See ' +
        'https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)\n' +
        '    in GrandParent (at **)',
    ]);
  });

  /**
   * 场景：“does not warn for keys when passing children down”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warn for keys when passing children down', async () => {
    /** 作为“does not warn for keys when passing children down”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper(props) {
      return (
        <div>
          {props.children}
          <footer />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(
        <Wrapper>
          <span />
          <span />
        </Wrapper>,
      ),
    );
  });

  /**
   * 场景：“warns for keys for iterables of elements in rest args”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for iterables of elements in rest args', async () => {
    const iterable = {
      /** 创建无 key 子元素的迭代器入口，用于触发经典元素校验器的列表诊断。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回无 key 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done ? undefined : React.createElement(ComponentClass),
              done: done,
            };
          },
        };
      },
    };

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(React.createElement(ComponentClass, null, iterable)),
    );
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentClass`. It was passed a child from div. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentClass (at **)',
    ]);
  });

  /**
   * 场景：“does not warns for arrays of elements with keys”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warns for arrays of elements with keys', () => {
    React.createElement(ComponentClass, null, [
      React.createElement(ComponentClass, {key: '#1'}),
      React.createElement(ComponentClass, {key: '#2'}),
    ]);
  });

  /**
   * 场景：“does not warns for iterable elements with keys”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warns for iterable elements with keys', () => {
    const iterable = {
      /** 创建带 key 子元素的迭代器入口，用于验证合法 iterable 不产生警告。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回带稳定 key 的元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done
                ? undefined
                : React.createElement(ComponentClass, {key: '#' + i}),
              done: done,
            };
          },
        };
      },
    };

    React.createElement(ComponentClass, null, iterable);
  });

  /**
   * 场景：“does not warn when the element is directly in rest args”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warn when the element is directly in rest args', () => {
    React.createElement(
      ComponentClass,
      null,
      React.createElement(ComponentClass),
      React.createElement(ComponentClass),
    );
  });

  /**
   * 场景：“does not warn when the array contains a non-element”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warn when the array contains a non-element', () => {
    React.createElement(ComponentClass, null, [{}, {}]);
  });

  /**
   * 场景：“should give context for errors in nested components.”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('should give context for errors in nested components.', async () => {
    /** 实现“should give context for errors in nested components.”场景所需的“MyComp”测试夹具行为。 */
    function MyComp() {
      return [React.createElement('div')];
    }
    /** 实现“should give context for errors in nested components.”场景所需的“ParentComp”测试夹具行为。 */
    function ParentComp() {
      return React.createElement(MyComp);
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(ParentComp)));
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `ParentComp`. It was passed a child from MyComp. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)\n' +
        '    in MyComp (at **)\n' +
        '    in ParentComp (at **)',
    ]);
  });

  /**
   * 场景：“gives a helpful error when passing invalid types”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('gives a helpful error when passing invalid types', async () => {
    /** 实现“gives a helpful error when passing invalid types”场景所需的“Foo”测试夹具行为。 */
    function Foo() {}
    const errors = [];
    const root = ReactDOMClient.createRoot(document.createElement('div'), {
      /** 捕获“gives a helpful error when passing invalid types”场景预期产生的未处理错误，供后续断言核对。 */
      onUncaughtError(error) {
        errors.push(error.message);
      },
    });
    const cases = [
      [
        () => React.createElement(undefined),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: undefined. You likely forgot to export your ' +
          "component from the file it's defined in, or you might have mixed up " +
          'default and named imports.',
      ],
      [
        () => React.createElement(null),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: null.',
      ],
      [
        () => React.createElement(true),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: boolean.',
      ],
      [
        () => React.createElement({x: 17}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object.',
      ],
      [
        () => React.createElement({}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object. You likely forgot to export your ' +
          "component from the file it's defined in, or you might have mixed up " +
          'default and named imports.',
      ],
      [
        () => React.createElement(React.createElement('div')),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <div />. Did you accidentally export a JSX literal ' +
          'instead of a component?',
      ],
      [
        () => React.createElement(React.createElement(Foo)),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <Foo />. Did you accidentally export a JSX literal ' +
          'instead of a component?',
      ],
      [
        () =>
          React.createElement(
            React.createElement(React.createContext().Consumer),
          ),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <Context.Consumer />. Did you accidentally ' +
          'export a JSX literal instead of a component?',
      ],
      [
        () => React.createElement({$$typeof: 'non-react-thing'}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object.',
      ],
    ];
    for (let i = 0; i < cases.length; i++) {
      await act(async () => root.render(cases[i][0]()));
    }

    expect(errors).toEqual(
      __DEV__
        ? [
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: undefined. You likely forgot to export your ' +
              "component from the file it's defined in, or you might have mixed up " +
              'default and named imports.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: null.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: boolean.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object. You likely forgot to export your ' +
              "component from the file it's defined in, or you might have mixed up " +
              'default and named imports.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <div />. Did you accidentally export a JSX literal ' +
              'instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <Foo />. Did you accidentally export a JSX literal ' +
              'instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <Context.Consumer />. Did you accidentally ' +
              'export a JSX literal instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
          ]
        : [
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: undefined.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: null.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: boolean.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
          ],
    );

    // 同类问题已完成去重，不应再输出额外警告。
    React.createElement('div');
  });

  /**
   * 场景：“includes the owner name when passing null, undefined, boolean, or number”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('includes the owner name when passing null, undefined, boolean, or number', async () => {
    /** 实现“includes the owner name when passing null, undefined, boolean, or number”场景所需的“ParentComp”测试夹具行为。 */
    function ParentComp() {
      return React.createElement(null);
    }

    await expect(async () => {
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => root.render(React.createElement(ParentComp)));
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: null.' +
        (__DEV__ ? '\n\nCheck the render method of `ParentComp`.' : ''),
    );
  });

  /**
   * 场景：“warns for fragments with illegal attributes”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('warns for fragments with illegal attributes', async () => {
    /** 作为“warns for fragments with illegal attributes”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 渲染“warns for fragments with illegal attributes”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return React.createElement(React.Fragment, {a: 1}, '123');
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(Foo)));
    assertConsoleErrorDev([
      gate('enableFragmentRefs')
        ? 'Invalid prop `a` supplied to `React.Fragment`. React.Fragment ' +
          'can only have `key`, `ref`, and `children` props.\n' +
          '    in Foo (at **)'
        : 'Invalid prop `a` supplied to `React.Fragment`. React.Fragment ' +
          'can only have `key` and `children` props.\n' +
          '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“does not warn when using DOM node as children”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not warn when using DOM node as children', async () => {
    /** 作为“does not warn when using DOM node as children”场景的组件夹具，隔离待验证的 React 行为。 */
    class DOMContainer extends React.Component {
      /** 保存“does not warn when using DOM node as children”场景需要跨生命周期读取的实例或宿主节点引用。 */
      ref;
      /** 渲染“does not warn when using DOM node as children”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div ref={n => (this.ref = n)} />;
      }
      /** 记录“does not warn when using DOM node as children”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        this.ref.appendChild(this.props.children);
      }
    }

    const node = document.createElement('div');
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
    // 被篡改的原型链不能导致栈溢出或其他异常（#3883）。
      root.render(<DOMContainer>{node}</DOMContainer>);
    });
  });

  /**
   * 场景：“should not enumerate enumerable numbers (#4776)”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('should not enumerate enumerable numbers (#4776)', () => {
    /*eslint-disable no-extend-native */
    Number.prototype['@@iterator'] = function () {
      throw new Error('number iterator called');
    };
    /*eslint-enable no-extend-native */

    try {
      void (
        <div>
          {5}
          {12}
          {13}
        </div>
      );
    } finally {
      delete Number.prototype['@@iterator'];
    }
  });

  /**
   * 场景：“does not blow up with inlined children”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not blow up with inlined children', () => {
    // 不推荐这种会吞掉多类警告的做法，但校验器也不能因此崩溃。

    const child = {
      $$typeof: (<div />).$$typeof,
      type: 'span',
      key: null,
      ref: null,
      props: {},
      _owner: null,
    };

    void (<div>{[child]}</div>);
  });

  /**
   * 场景：“does not blow up on key warning with undefined type”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('does not blow up on key warning with undefined type', () => {
    const Foo = undefined;
    void (<Foo>{[<div />]}</Foo>);
  });

  /**
   * 场景：“does not call lazy initializers eagerly”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
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
    React.createElement(Lazy);
    expect(didCall).toBe(false);
  });

  /**
   * 场景：“__self and __source are treated as normal props”。
   * 机制：验证经典元素校验器的诊断与容错边界，锁定可观察结果与失败边界。
   */
  it('__self and __source are treated as normal props', async () => {
    // 经典 `React.createElement` 曾把这些数据作为 props 传递，因此它们过去是保留属性；
    // `jsxDEV()` runtime 则通过独立参数传递，现应把它们视为普通 props。
    /** 实现“__self and __source are treated as normal props”场景所需的“Child”测试夹具行为。 */
    function Child({__self, __source}) {
      return __self + __source;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    // 注意：Babel 转换会把直接出现的这些 props 视为语法错误，但 runtime 本身没有该限制。
    // 这里用 spread 绕过转换期检查，证明运行时会按普通 props 处理。
    const props = {
      __self: 'Hello ',
      __source: 'world!',
    };
    await act(() => root.render(<Child {...props} />));
    expect(container.textContent).toBe('Hello world!');
  });
});
