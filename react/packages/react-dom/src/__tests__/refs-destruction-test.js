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
let TestComponent;
let act;
let theInnerDivRef;
let theInnerClassComponentRef;

describe('refs-destruction', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    /** 无 DOM 输出的类实例 fixture，验证类组件 ref 清理与宿主元素 ref 使用相同删除时机。 */
    class ClassComponent extends React.Component {
      /** 返回 null 保留类实例但不增加 DOM 子节点，避免把 ref 目标误认为宿主节点。 */
      render() {
        return null;
      }
    }

    /** 以 destroy/removeRef 两个输入分别删除 children 或仅解除绑定，同时保存宿主与类组件 ref 对象。 */
    TestComponent = class extends React.Component {
      /** 初始化父类并创建两个独立对象 ref；这些对象供更新和卸载前后检查 current。 */
      constructor(props) {
        super(props);
        theInnerDivRef = React.createRef();
        theInnerClassComponentRef = React.createRef();
      }

      /** 默认绑定两个 ref，destroy 时删除两类 children，removeRef 时保持 child 类型而去掉 ref，以区分删除与解绑。 */
      render() {
        if (this.props.destroy) {
          return <div />;
        } else if (this.props.removeRef) {
          return (
            <div>
              <div />
              <ClassComponent />
            </div>
          );
        } else {
          return (
            <div>
              <div ref={theInnerDivRef} />
              <ClassComponent ref={theInnerClassComponentRef} />
            </div>
          );
        }
      }
    };
  });

  afterEach(() => {
    theInnerClassComponentRef = null;
    theInnerDivRef = null;
  });

  /** 先挂载同时持有宿主 ref 与类实例 ref 的父 fixture，再 unmount 根；两个 ref 先非空、卸载后均为 null，验证整棵父树删除会清除不同实例类型的 ref。 */
  it('should remove refs when destroying the parent', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    root.unmount();

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** 先挂载两个带 ref 的 children，再更新父 destroy=true 只留下空 div；两个 ref 均应置 null，验证子树删除的 ref detach。 */
  it('should remove refs when destroying the child', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    await act(async () => {
      root.render(<TestComponent destroy={true} />);
    });

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** 保留两种 child 类型但更新 removeRef=true 去掉 ref prop；两个旧 ref 应置 null，验证仅解除 ref 绑定也会清理旧对象。 */
  it('should remove refs when removing the child ref attribute', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(theInnerDivRef.current).toBeInstanceOf(Element);
    expect(theInnerClassComponentRef.current).toBeTruthy();

    await act(async () => {
      root.render(<TestComponent removeRef={true} />);
    });

    expect(theInnerDivRef.current).toBe(null);
    expect(theInnerClassComponentRef.current).toBe(null);
  });

  /** Modal 在独立 DOM 根异步渲染带 ref 的子树，父 App 随后隐藏 Modal 并延迟卸载其根；act 应完成，定时器里的 unmount 不应抛错，验证外层删除与独立根延后 ref 清理可以配合。 */
  it('should not error when destroying child with ref asynchronously', async () => {
    let nestedRoot;
    /** 使用独立并发根承载 children，渲染与卸载均通过定时器延后，制造外层父树先销毁的时序。 */
    class Modal extends React.Component {
      /** 创建并挂接独立容器和根，再复用更新方法安排异步子树渲染。 */
      componentDidMount() {
        this.div = document.createElement('div');
        nestedRoot = ReactDOMClient.createRoot(this.div);
        document.body.appendChild(this.div);
        this.componentDidUpdate();
      }

      /** 在下一定时器中用 flushSync 提交当前 children；内根调度独立于 Modal 外层树。 */
      componentDidUpdate() {
        setTimeout(() => {
          ReactDOM.flushSync(() => {
            nestedRoot.render(<div>{this.props.children}</div>);
          });
        }, 0);
      }

      /** 保存容器引用，在后续定时器断言内根 unmount 不抛错，再从 document 移除容器。 */
      componentWillUnmount() {
        const self = this;
        // 一些异步动画
        setTimeout(function () {
          expect(function () {
            nestedRoot.unmount();
          }).not.toThrow();
          document.body.removeChild(self.div);
        }, 0);
      }

      /** 不在外层根输出宿主内容，实际子树位于 componentDidMount 创建的独立容器。 */
      render() {
        return null;
      }
    }

    /** 向 Modal 提供带对象 ref 的 a 元素，让延后删除路径确实需要执行 ref detach。 */
    class AppModal extends React.Component {
      /** 组合 Modal 与带 ref 的宿主叶节点，作为独立根异步清理的输入。 */
      render() {
        return (
          <Modal>
            <a ref={React.createRef()} />
          </Modal>
        );
      }
    }

    /** 用 hidden 控制 Modal 的外层生命周期，触发父先销毁、内根后卸载的时序。 */
    class App extends React.Component {
      /** hidden 时返回 null 删除 Modal，否则渲染 AppModal；该分支仅控制外树，不直接操作内根。 */
      render() {
        return this.props.hidden ? null : <AppModal onClose={this.close} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      root.render(<App hidden={true} />);
    });
  });
});
