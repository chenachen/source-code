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
let ReactDOM;
let ReactDOMClient;
let act;

describe('EnterLeaveEventPlugin', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    // 将根容器挂到body，供iframe所属窗口和跨根/portal的DOM传播路径使用。
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /** iframe内根节点注册onMouseLeave，派发mouseout relatedTarget=iframe.contentWindow；收集事件target为节点、relatedTarget为该窗口，验证采用目标文档所属window。 */
  it('should set onMouseLeave relatedTarget properly in iframe', async () => {
    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    iframeDocument.write(
      '<!DOCTYPE html><html><head></head><body><div></div></body></html>',
    );
    iframeDocument.close();

    const leaveEvents = [];
    const root = ReactDOMClient.createRoot(
      iframeDocument.body.getElementsByTagName('div')[0],
    );
    await act(() => {
      root.render(
        <div
          onMouseLeave={e => {
            e.persist();
            leaveEvents.push(e);
          }}
        />,
      );
    });
    const node = iframeDocument.body.getElementsByTagName('div')[0].firstChild;
    await act(() => {
      node.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: iframe.contentWindow,
        }),
      );
    });

    expect(leaveEvents.length).toBe(1);
    expect(leaveEvents[0].target).toBe(node);
    expect(leaveEvents[0].relatedTarget).toBe(iframe.contentWindow);
  });

  /** iframe内节点注册onMouseEnter，派发mouseover且relatedTarget=null；事件target为节点、relatedTarget补为iframe窗口，验证外部进入的默认window属于目标文档。 */
  it('should set onMouseEnter relatedTarget properly in iframe', async () => {
    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    iframeDocument.write(
      '<!DOCTYPE html><html><head></head><body><div></div></body></html>',
    );
    iframeDocument.close();

    const enterEvents = [];
    const root = ReactDOMClient.createRoot(
      iframeDocument.body.getElementsByTagName('div')[0],
    );
    await act(() => {
      root.render(
        <div
          onMouseEnter={e => {
            e.persist();
            enterEvents.push(e);
          }}
        />,
      );
    });
    const node = iframeDocument.body.getElementsByTagName('div')[0].firstChild;
    await act(() => {
      node.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: null,
        }),
      );
    });

    expect(enterEvents.length).toBe(1);
    expect(enterEvents[0].target).toBe(node);
    expect(enterEvents[0].relatedTarget).toBe(iframe.contentWindow);
  });

  // 针对 https://github.com/facebook/react/issues/10906 的回归测试。
  /** Parent先不显示child再更新显示，随后父节点mouseout指向child；child enter一次、parent零次，验证更新后找到共同祖先且只分发进入差集。 */
  it('should find the common parent after updates', async () => {
    let parentEnterCalls = 0;
    let childEnterCalls = 0;
    let parent = null;

    /** 父宿主注册enter计数并按showChild控制子级，验证更新后共同祖先判定。 */
    class Parent extends React.Component {
      /** 保存父DOM引用并按props显示child，两级enter计数各自独立。 */
      render() {
        return (
          <div
            onMouseEnter={() => parentEnterCalls++}
            ref={node => (parent = node)}>
            {this.props.showChild && (
              <div onMouseEnter={() => childEnterCalls++} />
            )}
          </div>
        );
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent showChild={true} />);
    });

    // 从父组件进入子组件。
    await act(() => {
      parent.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: parent.firstChild,
        }),
      );
    });

    // 进入子组件时，应该在子组件上触发事件，而不是在父组件上。
    expect(childEnterCalls).toBe(1);
    expect(parentEnterCalls).toBe(0);
  });

  // https://github.com/facebook/react/issues/16763. 测试
  // @gate !disableLegacyMode
  /** 仅legacy开启时，Parent.componentDidMount在自身div中建立嵌套legacy根，子组件挂载后从兄弟派mouseout到监听节点；enter仅一次，验证两层根路由不重复提取。 */
  it('should call mouseEnter once from sibling rendered inside a rendered component in legacy roots', async () => {
    const mockFn = jest.fn();

    /** legacy外根的类包装，挂载后在parentEl创建内根。 */
    class Parent extends React.Component {
      /** 初始化parentEl ref，作为嵌套legacy根容器。 */
      constructor(props) {
        super(props);
        this.parentEl = React.createRef();
      }

      /** 在已提交父div里同步建立MouseEnterDetect legacy根，构造嵌套容器路由。 */
      componentDidMount() {
        ReactDOM.render(<MouseEnterDetect />, this.parentEl.current);
      }

      /** 输出仅带parentEl的div，为内根提供容器。 */
      render() {
        return <div ref={this.parentEl} />;
      }
    }

    /** 内根输出两个相邻div并在挂载后模拟从兄弟进入监听节点。 */
    class MouseEnterDetect extends React.Component {
      /** 初始化firstEl/siblingEl ref用于设置准确mouseout目标与relatedTarget。 */
      constructor(props) {
        super(props);
        this.firstEl = React.createRef();
        this.siblingEl = React.createRef();
      }

      /** 从第二div派mouseout指向第一div，验证两根监听下合成enter仅一次。 */
      componentDidMount() {
        this.siblingEl.current.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: this.firstEl.current,
          }),
        );
      }

      /** 输出第一div的onMouseEnter与无监听兄弟，建立最短兄弟移动场景。 */
      render() {
        return (
          <React.Fragment>
            <div ref={this.firstEl} onMouseEnter={mockFn} />
            <div ref={this.siblingEl} />
          </React.Fragment>
        );
      }
    }

    await act(() => {
      ReactDOM.render(<Parent />, container);
    });
    expect(mockFn.mock.calls.length).toBe(1);
  });

  // @gate !disableLegacyMode
  /** 仅legacy开启时，内层根div手工append无Fiber节点，再从该节点mouseout到React兄弟；enter一次，验证未跟踪target可向上找到有效宿主Fiber。 */
  it('should call mouseEnter when pressing a non tracked React node in legacy root', async () => {
    const mockFn = jest.fn();

    /** legacy外根包装，挂载后在自身div建立内根并容纳非React节点移动场景。 */
    class Parent extends React.Component {
      /** 初始化parentEl ref供componentDidMount创建内根。 */
      constructor(props) {
        super(props);
        this.parentEl = React.createRef();
      }

      /** 在父div中render MouseEnterDetect，形成两层legacy根。 */
      componentDidMount() {
        ReactDOM.render(<MouseEnterDetect />, this.parentEl.current);
      }

      /** 输出内根容器div并记录ref。 */
      render() {
        return <div ref={this.parentEl} />;
      }
    }

    /** 内根输出div/child，并在提交后手工插入无Fiber节点再派事件。 */
    class MouseEnterDetect extends React.Component {
      /** 初始化divRef与目标siblingEl，区分手工事件源与React目标。 */
      constructor(props) {
        super(props);
        this.divRef = React.createRef();
        this.siblingEl = React.createRef();
      }

      /** 把新原生div插到React父节点，再mouseout指向React子div，让插件从未缓存源向上查找Fiber。 */
      componentDidMount() {
        const attachedNode = document.createElement('div');
        this.divRef.current.appendChild(attachedNode);
        attachedNode.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: this.siblingEl.current,
          }),
        );
      }

      /** 输出宿主父div与带onMouseEnter子div，作为未跟踪事件源的有效祖先和进入目标。 */
      render() {
        return (
          <div ref={this.divRef}>
            <div ref={this.siblingEl} onMouseEnter={mockFn} />
          </div>
        );
      }
    }

    await act(() => {
      ReactDOM.render(<Parent />, container);
    });
    expect(mockFn.mock.calls.length).toBe(1);
  });

  /** 组件的React祖先div注册leave，portal子div实际在body外部根容器；从portal移到body应触发祖先leave一次，验证Portal的Fiber祖先传播。 */
  it('should work with portals outside of the root that has onMouseLeave', async () => {
    const divRef = React.createRef();
    const onMouseLeave = jest.fn();

    /** 祖先div有onMouseLeave，子树portal到document.body，验证逻辑祖先收集跨DOM容器。 */
    function Component() {
      return (
        <div onMouseLeave={onMouseLeave}>
          {ReactDOM.createPortal(<div ref={divRef} />, document.body)}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    // 从 Portal 的 div 离开。
    await act(() => {
      divRef.current.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  /** 普通父div内逻辑挂portal，portal子div有enter；从父div派mouseout relatedTarget为portal子节点；enter一次，验证跨DOM容器但同Fiber树的进入目标收集。 */
  it('should work with portals that have onMouseEnter outside of the root', async () => {
    const divRef = React.createRef();
    const otherDivRef = React.createRef();
    const onMouseEnter = jest.fn();

    /** 普通父div保存ref，portal子div另保存ref并有onMouseEnter，模拟父到portal的relatedTarget移动。 */
    function Component() {
      return (
        <div ref={divRef}>
          {ReactDOM.createPortal(
            <div ref={otherDivRef} onMouseEnter={onMouseEnter} />,
            document.body,
          )}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    // 从普通父div移向实际挂在body的Portal子节点。
    divRef.current.dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        cancelable: true,
        relatedTarget: otherDivRef.current,
      }),
    );

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });
});
