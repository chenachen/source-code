/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let PropTypes;
let React;
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

/** `FunctionComponent`：封装当前用例复用的操作、回调或断言步骤。 */
function FunctionComponent(props) {
  return <div>{props.name}</div>;
}

describe('ReactFunctionComponent', () => {
  beforeEach(() => {
    jest.resetModules();
    PropTypes = require('prop-types');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should render stateless component」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should render stateless component', async () => {
    const el = document.createElement('div');

    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<FunctionComponent name="A" />);
    });

    expect(el.textContent).toBe('A');
  });

  /** 测试场景：验证「should update stateless component」描述的渲染、交互或错误处理结果。 */
  it('should update stateless component', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <FunctionComponent {...this.props} />;
      }
    }

    const el = document.createElement('div');

    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<Parent name="A" />);
    });
    expect(el.textContent).toBe('A');

    await act(() => {
      root.render(<Parent name="B" />);
    });
    expect(el.textContent).toBe('B');
  });

  /** 测试场景：验证「should unmount stateless component」描述的渲染、交互或错误处理结果。 */
  it('should unmount stateless component', async () => {
    const container = document.createElement('div');

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<FunctionComponent name="A" />);
    });
    expect(container.textContent).toBe('A');

    root.unmount();
    expect(container.textContent).toBe('');
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context thru stateless component」描述的渲染、交互或错误处理结果。 */
  it('should pass context thru stateless component', async () => {
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        test: PropTypes.string.isRequired,
      };

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.context.test}</div>;
      }
    }

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return <Child />;
    }

    /** `GrandParent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class GrandParent extends React.Component {
      /** `GrandParent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        test: PropTypes.string.isRequired,
      };

      /** `GrandParent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {test: this.props.test};
      }

      /** `GrandParent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Parent />;
      }
    }

    const el = document.createElement('div');

    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<GrandParent test="test" />);
    });

    assertConsoleErrorDev([
      'GrandParent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in GrandParent (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)\n' +
        '    in GrandParent (at **)',
    ]);

    expect(el.textContent).toBe('test');

    await act(() => {
      root.render(<GrandParent test="mest" />);
    });

    expect(el.textContent).toBe('mest');
  });

  /** 测试场景：验证「should warn for getDerivedStateFromProps on a function component」描述的渲染、交互或错误处理结果。 */
  it('should warn for getDerivedStateFromProps on a function component', async () => {
    /** `FunctionComponentWithChildContext`：封装当前用例复用的操作、回调或断言步骤。 */
    function FunctionComponentWithChildContext() {
      return null;
    }
    FunctionComponentWithChildContext.getDerivedStateFromProps = function () {};

    const container = document.createElement('div');

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<FunctionComponentWithChildContext />);
    });
    assertConsoleErrorDev([
      'FunctionComponentWithChildContext: Function ' +
        'components do not support getDerivedStateFromProps.\n' +
        '    in FunctionComponentWithChildContext (at **)',
    ]);
  });

  /** 测试场景：验证「should warn for childContextTypes on a function component」描述的渲染、交互或错误处理结果。 */
  it('should warn for childContextTypes on a function component', async () => {
    /** `FunctionComponentWithChildContext`：封装当前用例复用的操作、回调或断言步骤。 */
    function FunctionComponentWithChildContext(props) {
      return <div>{props.name}</div>;
    }

    FunctionComponentWithChildContext.childContextTypes = {
      foo: PropTypes.string,
    };

    const container = document.createElement('div');

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<FunctionComponentWithChildContext name="A" />);
    });
    assertConsoleErrorDev([
      'childContextTypes cannot ' +
        'be defined on a function component.\n' +
        '  FunctionComponentWithChildContext.childContextTypes = ...\n' +
        '    in FunctionComponentWithChildContext (at **)',
    ]);
  });

  /** 测试场景：验证「should not throw when stateless component returns undefined」描述的渲染、交互或错误处理结果。 */
  it('should not throw when stateless component returns undefined', async () => {
    /** `NotAComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function NotAComponent() {}
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(
          <div>
            <NotAComponent />
          </div>,
        );
      }),
    ).resolves.not.toThrowError();
  });

  /** 测试场景：验证「should use correct name in key warning」描述的渲染、交互或错误处理结果。 */
  it('should use correct name in key warning', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return <div>{[<span />]}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Child />);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n' +
        '\n' +
        'Check the render method of `Child`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)',
    ]);
  });

  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  /** 测试场景：验证「should receive context」描述的渲染、交互或错误处理结果。 */
  it('should receive context', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        lang: PropTypes.string,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {lang: 'en'};
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child />;
      }
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child(props, context) {
      return <div>{context.lang}</div>;
    }
    Child.contextTypes = {lang: PropTypes.string};

    const el = document.createElement('div');

    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<Parent />);
    });
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);
    expect(el.textContent).toBe('en');
  });

  /** 测试场景：验证「should work with arrow functions」描述的渲染、交互或错误处理结果。 */
  it('should work with arrow functions', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    let Child = function () {
      return <div />;
    };
    // 将创建一个新的绑定函数，该函数没有原型。 类似于一个原生箭头函数。
    Child = Child.bind(this);

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Child />);
      });
    }).not.toThrow();
  });

  /** 测试场景：验证「should allow simple functions to return null」描述的渲染、交互或错误处理结果。 */
  it('should allow simple functions to return null', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    const Child = function () {
      return null;
    };
    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Child />);
      });
    }).not.toThrow();
  });

  /** 测试场景：验证「should allow simple functions to return false」描述的渲染、交互或错误处理结果。 */
  it('should allow simple functions to return false', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return false;
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<Child />);
      }),
    ).resolves.not.toThrow();
  });
});
