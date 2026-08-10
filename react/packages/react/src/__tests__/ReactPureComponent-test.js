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
let assertConsoleErrorDev;
let React;
let ReactDOMClient;

describe('ReactPureComponent', () => {
  beforeEach(() => {
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should render”场景的唯一关键操作。
   * Then：断言 PureComponent 的浅比较与更新跳过契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should render', async () => {
    let renders = 0;
    /** 作为“should render”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.PureComponent {
      /** 初始化“should render”场景所需的实例状态与观测记录。 */
      constructor() {
        super();
        this.state = {type: 'mushrooms'};
      }
      /** 渲染“should render”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renders++;
        return <div>{this.props.text[0]}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let text;
    const componentRef = React.createRef();

    text = ['porcini'];
    await act(() => {
      root.render(<Component ref={componentRef} text={text} />);
    });
    expect(container.textContent).toBe('porcini');
    expect(renders).toBe(1);

    text = ['morel'];
    await act(() => {
      root.render(<Component ref={componentRef} text={text} />);
    });
    expect(container.textContent).toBe('morel');
    expect(renders).toBe(2);

    text[0] = 'portobello';
    await act(() => {
      root.render(<Component ref={componentRef} text={text} />);
    });
    expect(container.textContent).toBe('morel');
    expect(renders).toBe(2);

    // 状态引用未变化时，PureComponent 的浅比较会跳过重新渲染。
    await act(() => {
      componentRef.current.setState({type: 'mushrooms'});
    });
    expect(container.textContent).toBe('morel');
    expect(renders).toBe(2);

    // 状态引用变化后必须重新渲染，证明跳过更新并非永久缓存。
    await act(() => {
      componentRef.current.setState({type: 'portobello mushrooms'});
    });
    expect(container.textContent).toBe('portobello');
    expect(renders).toBe(3);
  });

  /**
   * 场景：“can override shouldComponentUpdate”。
   * 机制：验证PureComponent 的浅比较与更新跳过契约，锁定可观察结果与失败边界。
   */
  it('can override shouldComponentUpdate', async () => {
    let renders = 0;
    /** 作为“can override shouldComponentUpdate”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.PureComponent {
      /** 渲染“can override shouldComponentUpdate”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renders++;
        return <div />;
      }
      /** 决定“can override shouldComponentUpdate”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate() {
        return true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Component has a method called shouldComponentUpdate(). ' +
        'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
        'Please extend React.Component if shouldComponentUpdate is used.\n' +
        '    in Component (at **)',
    ]);
    await act(() => {
      root.render(<Component />);
    });
    expect(renders).toBe(2);
  });

  /**
   * 场景：“extends React.Component”。
   * 机制：验证PureComponent 的浅比较与更新跳过契约，锁定可观察结果与失败边界。
   */
  it('extends React.Component', async () => {
    let renders = 0;
    /** 作为“extends React.Component”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.PureComponent {
      /** 渲染“extends React.Component”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        expect(this instanceof React.Component).toBe(true);
        expect(this instanceof React.PureComponent).toBe(true);
        renders++;
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });
    expect(renders).toBe(1);
  });

  /**
   * 场景：“should warn when shouldComponentUpdate is defined on React.PureComponent”。
   * 机制：验证PureComponent 的浅比较与更新跳过契约，锁定可观察结果与失败边界。
   */
  it('should warn when shouldComponentUpdate is defined on React.PureComponent', async () => {
    /** 作为“should warn when shouldComponentUpdate is defined on React.PureComponent”场景的组件夹具，隔离待验证的 React 行为。 */
    class PureComponent extends React.PureComponent {
      /** 决定“should warn when shouldComponentUpdate is defined on React.PureComponent”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate() {
        return true;
      }
      /** 渲染“should warn when shouldComponentUpdate is defined on React.PureComponent”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<PureComponent />);
    });
    assertConsoleErrorDev([
      'PureComponent has a method called shouldComponentUpdate(). ' +
        'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
        'Please extend React.Component if shouldComponentUpdate is used.\n' +
        '    in PureComponent (at **)',
    ]);
  });
});
