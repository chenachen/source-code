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
  // 每例加载 renderer 和 act，act 将本例更新冲刷后再检查 DOM 与 render 次数。
  beforeEach(() => {
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
  });

  /**
   * 初始 props.text=['porcini']、state.type='mushrooms'；换数组会重渲染，原地改同一数组及写入浅相等 state 均保持旧 DOM。
   * 最后改变 type 才重渲染并读到数组中的 portobello；DOM 与计数同时验证 PureComponent 比较 props/state 字段引用，而不是深查数组内容。
   */
  it('should render', async () => {
    let renders = 0;
    /** 用 props 数组引用与独立 state 字段构造两类浅比较输入，render 次数用于区分跳过和真正重算。 */
    class Component extends React.PureComponent {
      /** 初始化与 text 无关的 type 字段，使后续相等/不等 state 更新可分别触发 bailout 或 render。 */
      constructor() {
        super();
        this.state = {type: 'mushrooms'};
      }
      /** 累计调用次数并读取 text[0]，让原地数组修改是否被重新读取可由 DOM 与计数交叉验证。 */
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

    // setState 会产生新状态对象，但每个字段仍浅相等；props.text 也沿用同一数组，因而跳过 render。
    await act(() => {
      componentRef.current.setState({type: 'mushrooms'});
    });
    expect(container.textContent).toBe('morel');
    expect(renders).toBe(2);

    // type 字段改变使状态不再浅相等；本轮重新 render，才读到之前原地修改的 text[0]。
    await act(() => {
      componentRef.current.setState({type: 'portobello mushrooms'});
    });
    expect(container.textContent).toBe('portobello');
    expect(renders).toBe(3);
  });

  /** PureComponent 显式提供始终 true 的 shouldComponentUpdate；同样 props 连续挂载/更新应 render 两次，同时开发构建提示改用 Component，验证自定义判定仍覆盖默认浅比较。 */
  it('can override shouldComponentUpdate', async () => {
    let renders = 0;
    /** 用自定义更新判定打破 PureComponent 的默认 bailout，render 计数观察该判定是否生效。 */
    class Component extends React.PureComponent {
      /** 只累计 render 次数，空 div 保证 DOM 内容差异不会参与更新判定。 */
      render() {
        renders++;
        return <div />;
      }
      /** 总是允许更新，专门检查自定义方法优先于 PureComponent 的默认浅比较。 */
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

  /** 挂载 PureComponent 子类并在 render 内检查 instanceof Component 与 PureComponent 均为 true；一次 render 计数确认断言实际位于执行过的组件路径中。 */
  it('extends React.Component', async () => {
    let renders = 0;
    /** 在实际挂载的实例上检查继承链，避免只观察类构造函数的静态属性。 */
    class Component extends React.PureComponent {
      /** 验证实例同时属于两级基类并累计执行次数，返回最小宿主输出以完成挂载。 */
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

  /** 挂载声明 shouldComponentUpdate 的 PureComponent 子类，开发构建应报不推荐组合的提示；本例只验证诊断，不通过后续更新断言自定义方法的调用次数。 */
  it('should warn when shouldComponentUpdate is defined on React.PureComponent', async () => {
    /** 构造 PureComponent 与自定义更新钩子共存的开发诊断输入。 */
    class PureComponent extends React.PureComponent {
      /** 显式声明始终允许更新的方法，使开发校验能发现与 PureComponent 预期用法的冲突。 */
      shouldComponentUpdate() {
        return true;
      }
      /** 返回最小 div 完成实例挂载，使校验针对真实 class Fiber 而不是未使用的类定义。 */
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
