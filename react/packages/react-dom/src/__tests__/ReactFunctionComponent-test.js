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

/** 把props.name输出div，作为挂载、props更新和卸载的共享函数叶节点。 */
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

  /** 函数组件将props.name渲染div，首次name=A；act后文本A，验证基本函数组件输出。 */
  it('should render stateless component', async () => {
    const el = document.createElement('div');

    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<FunctionComponent name="A" />);
    });

    expect(el.textContent).toBe('A');
  });

  /** 类Parent透传props给函数组件，同根先name=A再B；文本依次A/B，验证函数子级跟随类props更新。 */
  it('should update stateless component', async () => {

    /** 类包装层，把自身props透传给共享函数组件，验证类更新驱动函数重新输出。 */
    class Parent extends React.Component {

      /** 返回FunctionComponent并透传全部props，使name A/B抵达函数子级。 */
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

  /** 挂载name=A的函数组件后root.unmount；文本由A变空，验证函数组件子树卸载。 */
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

  /** 仅legacy context开关允许时，GrandParent提供test并穿过未消费Parent函数到Child类；首次test并有旧API诊断，更新为mest后文本跟随，验证旧上下文穿过函数边界。 */
  it('should pass context thru stateless component', async () => {

    /** 声明旧contextTypes的类叶节点，读取test并输出div。 */
    class Child extends React.Component {

      /** 旧test字符串校验映射，只在legacy context开启配置有效。 */
      static contextTypes = {
        test: PropTypes.string.isRequired,
      };

      /** 读取this.context.test作为文本，验证函数中间层不截断旧上下文。 */
      render() {
        return <div>{this.context.test}</div>;
      }
    }

    /** 不声明旧消费协议，直接返回Child，让旧上下文穿过普通函数。 */
    function Parent() {
      return <Child />;
    }

    /** 旧childContextTypes类提供者，以props.test提供可更新载荷。 */
    class GrandParent extends React.Component {

      /** 声明提供的test为必需字符串，建立旧协议类型映射。 */
      static childContextTypes = {
        test: PropTypes.string.isRequired,
      };

      /** 返回当前props.test供子树读取，后续props更新会改变载荷。 */
      getChildContext() {
        return {test: this.props.test};
      }

      /** 返回不消费上下文的Parent函数，构造跨函数传播路径。 */
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

  /** 函数组件返回null但被赋静态getDerivedStateFromProps；首次渲染应提示函数组件不支持该生命周期，验证静态字段诊断。 */
  it('should warn for getDerivedStateFromProps on a function component', async () => {

    /** 返回null的函数组件，故意附上不支持的静态getDerivedStateFromProps以触发诊断。 */
    function FunctionComponentWithChildContext() {
      return null;
    }
    /** 空静态生命周期，仅作为函数组件上不支持字段的输入，不应参与状态推导。 */
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

  /** 函数组件输出name=A并声明childContextTypes；首次应提示函数不能声明旧提供协议，验证函数与类提供者区别。 */
  it('should warn for childContextTypes on a function component', async () => {

    /** 把props.name输出div，故意声明旧childContextTypes以触发函数提供者诊断。 */
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

  /** 空函数返回undefined，作为div子级渲染；act应正常resolve，验证undefined函数结果属于空输出。 */
  it('should not throw when stateless component returns undefined', async () => {

    /** 空函数隐式返回undefined，验证组件空输出不要求显式return null。 */
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

  /** Child返回无key的span数组；DEV消息应把render owner标为Child并包含span/Child栈，验证函数组件名称用于列表诊断。 */
  it('should use correct name in key warning', async () => {

    /** 输出未带key的span数组，让列表诊断使用函数名Child标识owner。 */
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

  /** 仅两个legacy开关允许时，Parent类提供lang=en、函数Child按contextTypes消费第二参数；出现旧API诊断且文本en，验证旧函数上下文参数路径。 */
  it('should receive context', async () => {

    /** 旧类提供者输出Child，提供lang=en测试函数组件第二参数。 */
    class Parent extends React.Component {

      /** 旧lang字符串映射，声明Parent提供的数据类型。 */
      static childContextTypes = {
        lang: PropTypes.string,
      };

      /** 固定返回lang=en供旧函数消费者读取。 */
      getChildContext() {
        return {lang: 'en'};
      }

      /** 返回旧函数Child，不额外引入DOM包装。 */
      render() {
        return <Child />;
      }
    }

    /** 从第二参数context.lang输出div；只在旧函数上下文协议允许配置运行。 */
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

  /** 原普通函数Child输出div后通过bind去掉prototype，传入createRoot；外层not.toThrow检查调用无同步异常，覆盖可调用但无prototype的组件形状；本断言没有await返回的异步Promise完成。 */
  it('should work with arrow functions', async () => {

    /** 原普通函数输出空div，随后bind生成无prototype的可调用组件。 */
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

  /** 函数Child返回null，传入新根；外层not.toThrow检查调用无同步异常，覆盖空函数输出；本断言未等待异步Promise完成。 */
  it('should allow simple functions to return null', async () => {

    /** 函数显式返回null，作为允许空输出的输入。 */
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

  /** 函数Child返回false，act Promise应正常resolve，验证布尔false作为空组件输出。 */
  it('should allow simple functions to return false', async () => {

    /** 函数返回false，覆盖布尔空组件结果。 */
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
