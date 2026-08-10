/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOM`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOM = require('react-dom');
/** `StrictMode`：保存当前测试场景复用的夹具、状态或回调。 */
const StrictMode = React.StrictMode;
/** `assertConsoleErrorDev`：保存当前测试场景复用的夹具、状态或回调。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('findDOMNode', () => {
  // @gate www && classic
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「findDOMNode should return null if passed null」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言直接覆盖 ReactDOMRootFB.findDOMNode 的 legacy 宿主实例查询。
   */
  it('findDOMNode should return null if passed null', () => {
    expect(ReactDOM.findDOMNode(null)).toBe(null);
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should find dom element」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should find dom element', () => {
    /** `MyNode`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyNode extends React.Component {
      /** `MyNode.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <span>Noise</span>
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const myNode = ReactDOM.render(<MyNode />, container);
    const myDiv = ReactDOM.findDOMNode(myNode);
    const mySameDiv = ReactDOM.findDOMNode(myDiv);
    expect(myDiv.tagName).toBe('DIV');
    expect(mySameDiv).toBe(myDiv);
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should find dom element after an update from null」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should find dom element after an update from null', () => {
    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({flag}) {
      if (flag) {
        return <span>A</span>;
      }
      return null;
    }
    /** `MyNode`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyNode extends React.Component {
      /** `MyNode.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Bar flag={this.props.flag} />;
      }
    }

    const container = document.createElement('div');

    const myNodeA = ReactDOM.render(<MyNode />, container);
    const a = ReactDOM.findDOMNode(myNodeA);
    expect(a).toBe(null);

    const myNodeB = ReactDOM.render(<MyNode flag={true} />, container);
    expect(myNodeA === myNodeB).toBe(true);

    const b = ReactDOM.findDOMNode(myNodeB);
    expect(b.tagName).toBe('SPAN');
  });

  // @gate www && classic
  /** 测试场景：验证「findDOMNode should reject random objects」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should reject random objects', () => {
    expect(function () {
      ReactDOM.findDOMNode({foo: 'bar'});
    }).toThrowError('Argument appears to not be a ReactComponent. Keys: foo');
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should reject unmounted objects with render func」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should reject unmounted objects with render func', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const inst = ReactDOM.render(<Foo />, container);
    ReactDOM.unmountComponentAtNode(container);

    expect(() => ReactDOM.findDOMNode(inst)).toThrowError(
      'Unable to find node on an unmounted component.',
    );
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should not throw an error when called within a component that is not mounted」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should not throw an error when called within a component that is not mounted', () => {
    /** `Bar`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Bar extends React.Component {
      /** `Bar.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        expect(ReactDOM.findDOMNode(this)).toBeNull();
      }

      /** `Bar.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    expect(() => {
      const container = document.createElement('div');
      ReactDOM.render(<Bar />, container);
    }).not.toThrow();
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should warn if used to find a host component inside StrictMode」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should warn if used to find a host component inside StrictMode', () => {
    let parent = undefined;
    let child = undefined;

    /** `ContainsStrictModeChild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ContainsStrictModeChild extends React.Component {
      /** `ContainsStrictModeChild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <StrictMode>
            <div ref={n => (child = n)} />
          </StrictMode>
        );
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <ContainsStrictModeChild ref={n => (parent = n)} />,
      container,
    );

    const match = ReactDOM.findDOMNode(parent);
    assertConsoleErrorDev([
      'findDOMNode is deprecated in StrictMode. ' +
        'findDOMNode was passed an instance of ContainsStrictModeChild which renders StrictMode children. ' +
        'Instead, add a ref directly to the element you want to reference. ' +
        'Learn more about using refs safely here: ' +
        'https://react.dev/link/strict-mode-find-node' +
        '\n    in div (at **)' +
        '\n    in ContainsStrictModeChild (at **)',
    ]);
    expect(match).toBe(child);
  });

  // @gate www && classic && !disableLegacyMode
  /** 测试场景：验证「findDOMNode should warn if passed a component that is inside StrictMode」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should warn if passed a component that is inside StrictMode', () => {
    let parent = undefined;
    let child = undefined;

    /** `IsInStrictMode`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class IsInStrictMode extends React.Component {
      /** `IsInStrictMode.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={n => (child = n)} />;
      }
    }

    const container = document.createElement('div');

    ReactDOM.render(
      <StrictMode>
        <IsInStrictMode ref={n => (parent = n)} />
      </StrictMode>,
      container,
    );

    const match = ReactDOM.findDOMNode(parent);
    assertConsoleErrorDev([
      'findDOMNode is deprecated in StrictMode. ' +
        'findDOMNode was passed an instance of IsInStrictMode which is inside StrictMode. ' +
        'Instead, add a ref directly to the element you want to reference. ' +
        'Learn more about using refs safely here: ' +
        'https://react.dev/link/strict-mode-find-node' +
        '\n    in div (at **)' +
        '\n    in IsInStrictMode (at **)',
    ]);
    expect(match).toBe(child);
  });
});
