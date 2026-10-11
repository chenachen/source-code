/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 构造 legacy 类组件与 StrictMode 树，覆盖 findDOMNode 兼容实例边界。 */
const React = require('react');
/** 经典 WWW findDOMNode/render/unmount 入口；构建 gate 决定兼容 API 是否可运行。 */
const ReactDOM = require('react-dom');
/** 分别放在目标类组件内部或外部，区分查找进入严格子树和实例本身位于严格模式。 */
const StrictMode = React.StrictMode;
/** 匹配 StrictMode 下两个不同措辞的弃用诊断，同时保留返回节点身份断言。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('findDOMNode', () => {
  // @gate www && classic
  /** 经典 WWW 构建直接查 findDOMNode(null) 应返回 null，验证空输入不会进入实例查找异常路径。 */
  it('findDOMNode should return null if passed null', () => {
    expect(ReactDOM.findDOMNode(null)).toBe(null);
  });

  // @gate www && classic && !disableLegacyMode
  /** legacy 挂载类组件输出 div/span，先查类实例再查所得 div；两次结果应为同一 DIV，验证宿主 Element 直接透传与类实例查找汇合。 */
  it('findDOMNode should find dom element', () => {
    /** 输出可查宿主 div 的类实例 fixture，内部 span 避免将最深叶节点误当公开根节点。 */
    class MyNode extends React.Component {
      /** 返回 div/span 树，findDOMNode 应选择类组件首个宿主 div。 */
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
  /** 同一类实例初次经 Bar 返回 null，更新 flag=true 输出 span；类实例身份应保持，findDOMNode 由 null 变 SPAN，验证查询读取当前提交树而非旧宿主缓存。 */
  it('findDOMNode should find dom element after an update from null', () => {
    /** 按 flag 切换 null 与 span，让同一父类实例的宿主查找结果在更新后改变。 */
    function Bar({flag}) {
      if (flag) {
        return <span>A</span>;
      }
      return null;
    }
    /** 稳定类实例经 Bar 转交 flag，验证宿主节点变化不要求重新构造类实例。 */
    class MyNode extends React.Component {
      /** 渲染 Bar 并透传 flag，初次无宿主、更新后输出 span。 */
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
  /** 向 findDOMNode 传普通对象 {foo:bar}；应抛包含 Keys: foo 的非 ReactComponent 诊断，验证任意对象不能当已挂载组件处理。 */
  it('findDOMNode should reject random objects', () => {
    expect(function () {
      ReactDOM.findDOMNode({foo: 'bar'});
    }).toThrowError('Argument appears to not be a ReactComponent. Keys: foo');
  });

  // @gate www && classic && !disableLegacyMode
  /** legacy 挂载带 render 的 Foo 后卸载根，保留旧类实例调用查询；应抛 unmounted component，验证拥有 render 方法也不能绕过挂载状态检查。 */
  it('findDOMNode should reject unmounted objects with render func', () => {
    /** 提供卸载前存在宿主节点、卸载后仍保留 JS 实例引用的类 fixture。 */
    class Foo extends React.Component {
      /** 返回 div，随后根卸载使实例不可再用于宿主查询。 */
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
  /** 在类组件 willMount 内查自身，再完成 legacy render；查询应为 null 且整个挂载不抛错，验证尚未提交的合法实例与已卸载实例采用不同边界。 */
  it('findDOMNode should not throw an error when called within a component that is not mounted', () => {
    /** 在 willMount 阶段查询自身，检查合法但未提交的实例返回 null。 */
    class Bar extends React.Component {
      /** 断言 findDOMNode(this) 为 null，验证尚未提交时没有宿主节点而非抛已卸载错误。 */
      UNSAFE_componentWillMount() {
        expect(ReactDOM.findDOMNode(this)).toBeNull();
      }

      /** 正常返回 div，让 willMount 查询后的挂载能够完整结束。 */
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
  /** 外层类组件不在 StrictMode 内，但其宿主 div 位于 StrictMode 子树；查询仍返回 div，同时 DEV 说明实例 renders StrictMode children，验证查找穿入严格子树的诊断。 */
  it('findDOMNode should warn if used to find a host component inside StrictMode', () => {
    let parent = undefined;
    let child = undefined;

    /** 自身在严格模式外，内部宿主 div 包在 StrictMode；供穿入严格子树的诊断使用。 */
    class ContainsStrictModeChild extends React.Component {
      /** 用 div 回调 ref 保存宿主节点，供警告后的 findDOMNode 返回身份比较。 */
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
  /** 类组件自身被 StrictMode 包裹，其 div ref 与 findDOMNode 结果应相同；DEV 说明实例 is inside StrictMode，验证组件自身严格模式的诊断分支。 */
  it('findDOMNode should warn if passed a component that is inside StrictMode', () => {
    let parent = undefined;
    let child = undefined;

    /** 目标类组件被外层 StrictMode 包裹，覆盖实例本身严格模式的弃用诊断。 */
    class IsInStrictMode extends React.Component {
      /** 返回带回调 ref 的 div，验证弃用警告不会改变查询返回的宿主身份。 */
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
