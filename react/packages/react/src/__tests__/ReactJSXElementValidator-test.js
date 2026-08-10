/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// TODO：在 JSX 配合 Flow 时，这些动态警告最终应升级为静态错误。
let act;
let React;
let ReactDOMClient;
let assertConsoleErrorDev;

describe('ReactJSXElementValidator', () => {
  let Component;
  let RequiredPropComponent;

  beforeEach(() => {
    jest.resetModules();

    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    React = require('react');
    ReactDOMClient = require('react-dom/client');

    Component = class extends React.Component {
      /** 渲染“ReactJSXElementValidator”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    };

    RequiredPropComponent = class extends React.Component {
      /** 渲染“ReactJSXElementValidator”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span>{this.props.prop}</span>;
      }
    };
    RequiredPropComponent.displayName = 'RequiredPropComponent';
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“warns for keys for arrays of elements in children position”场景的唯一关键操作。
   * Then：断言 JSX 元素校验器的诊断与 key 校验边界 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('warns for keys for arrays of elements in children position', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{[<Component />, <Component />]}</Component>);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Component`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys for arrays of elements with owner info”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for arrays of elements with owner info', async () => {
    /** 作为“warns for keys for arrays of elements with owner info”场景的组件夹具，隔离待验证的 React 行为。 */
    class InnerComponent extends React.Component {
      /** 渲染“warns for keys for arrays of elements with owner info”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Component>{this.props.childSet}</Component>;
      }
    }

    /** 作为“warns for keys for arrays of elements with owner info”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentWrapper extends React.Component {
      /** 渲染“warns for keys for arrays of elements with owner info”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <InnerComponent childSet={[<Component />, <Component />]} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentWrapper />);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `Component`. ' +
        'It was passed a child from ComponentWrapper. See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentWrapper (at **)',
    ]);
  });

  /**
   * 场景：“warns for keys for iterables of elements in rest args”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('warns for keys for iterables of elements in rest args', async () => {
    const iterable = {
      /** 创建无 key JSX 子元素的迭代器入口，用于触发列表 key 诊断。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回无 key JSX 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {value: done ? undefined : <Component />, done: done};
          },
        };
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{iterable}</Component>);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Component`. It was passed a child from div. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 场景：“does not warn for arrays of elements with keys”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn for arrays of elements with keys', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <Component>
          {[<Component key="#1" />, <Component key="#2" />]}
        </Component>,
      );
    });
  });

  /**
   * 场景：“does not warn for iterable elements with keys”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn for iterable elements with keys', async () => {
    const iterable = {
      /** 创建带 key JSX 子元素的迭代器入口，用于验证合法 iterable 不产生警告。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回带稳定 key 的 JSX 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done ? undefined : <Component key={'#' + i} />,
              done: done,
            };
          },
        };
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{iterable}</Component>);
    });
  });

  /**
   * 场景：“does not warn for numeric keys in entry iterable as a child”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn for numeric keys in entry iterable as a child', async () => {
    const iterable = {
      /** 创建 entry iterable 入口，用数值 entry key 验证 map-like 子节点语义。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回 `[数值 key, 元素]` entry，并在两个 entry 后结束。 */
          next: function () {
            const done = ++i > 2;
            return {value: done ? undefined : [i, <Component />], done: done};
          },
        };
      },
    };
    iterable.entries = iterable['@@iterator'];

    // 此处只跳过构造阶段警告；真正进入渲染时仍必须报告无效类型。
    <Component>{iterable}</Component>;
  });

  /**
   * 场景：“does not warn when the element is directly as children”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn when the element is directly as children', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Component>
          <Component />
          <Component />
        </Component>,
      );
    });
  });

  /**
   * 场景：“does not warn when the child array contains non-elements”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn when the child array contains non-elements', () => {
    void (<Component>{[{}, {}]}</Component>);
  });

  /**
   * 场景：“should give context for errors in nested components.”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('should give context for errors in nested components.', async () => {
    /** 作为“should give context for errors in nested components.”场景的组件夹具，隔离待验证的 React 行为。 */
    class MyComp extends React.Component {
      /** 渲染“should give context for errors in nested components.”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return [<div />];
      }
    }
    /** 作为“should give context for errors in nested components.”场景的组件夹具，隔离待验证的 React 行为。 */
    class ParentComp extends React.Component {
      /** 渲染“should give context for errors in nested components.”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <MyComp />;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<ParentComp />);
    });
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
   * 场景：“warns for fragments with illegal attributes”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('warns for fragments with illegal attributes', async () => {
    /** 作为“warns for fragments with illegal attributes”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 渲染“warns for fragments with illegal attributes”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <React.Fragment a={1}>hello</React.Fragment>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
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
   * 场景：“warns for fragments with refs”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('warns for fragments with refs', async () => {
    /** 作为“warns for fragments with refs”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 渲染“warns for fragments with refs”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <React.Fragment
            ref={bar => {
              this.foo = bar;
            }}>
            hello
          </React.Fragment>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev(
      gate('enableFragmentRefs')
        ? []
        : [
            'Invalid prop `ref` supplied to `React.Fragment`.' +
              ' React.Fragment can only have `key` and `children` props.\n' +
              '    in Foo (at **)',
          ],
    );
  });

  /**
   * 场景：“does not warn for fragments of multiple elements without keys”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('does not warn for fragments of multiple elements without keys', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <>
          <span>1</span>
          <span>2</span>
        </>,
      );
    });
  });

  /**
   * 场景：“warns for fragments of multiple elements with same key”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
   */
  it('warns for fragments of multiple elements with same key', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <>
          <span key="a">1</span>
          <span key="a">2</span>
          <span key="b">3</span>
        </>,
      );
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `a`. ' +
        'Keys should be unique so that components maintain their identity across updates. ' +
        'Non-unique keys may cause children to be duplicated and/or omitted — ' +
        'the behavior is unsupported and could change in a future version.\n' +
        '    in span (at **)',
    ]);
  });

  /**
   * 场景：“does not call lazy initializers eagerly”。
   * 机制：验证JSX 元素校验器的诊断与 key 校验边界，锁定可观察结果与失败边界。
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
    <Lazy />;
    expect(didCall).toBe(false);
  });
});
