/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 使用Node类型常量确认特定React挂载标记确实是Comment，测试comment容器路径。 */
const {COMMENT_NODE} = require('react-dom-bindings/src/client/HTMLNodeType');

let React;
let ReactDOM;
let ReactDOMClient;
let waitForAll;
let assertConsoleErrorDev;

describe('ReactMount', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  describe('unmountComponentAtNode', () => {
    // @gate !disableLegacyMode
    /** legacy模式开启时，把HTMLCollection而非Node给unmountComponentAtNode；同步抛无效容器消息，验证容器类型校验。 */
    it('throws when given a non-node', () => {
      const nodeArray = document.getElementsByTagName('div');
      expect(() => {
        ReactDOM.unmountComponentAtNode(nodeArray);
      }).toThrowError('Target container is not a DOM element.');
    });

    // @gate !disableLegacyMode
    /** legacy开启时，容器仅原始b/hellooo而未有React根；unmount返回false且文字保持，验证非React容器无清理。 */
    it('returns false on non-React containers', () => {
      const d = document.createElement('div');
      d.innerHTML = '<b>hellooo</b>';
      expect(ReactDOM.unmountComponentAtNode(d)).toBe(false);
      expect(d.textContent).toBe('hellooo');
    });

    // @gate !disableLegacyMode
    /** legacy开启时，render b/hellooo后unmount；返回true且清空文字，验证已注册legacy根卸载。 */
    it('returns true on React containers', () => {
      const d = document.createElement('div');
      ReactDOM.render(<b>hellooo</b>, d);
      expect(d.textContent).toBe('hellooo');
      expect(ReactDOM.unmountComponentAtNode(d)).toBe(true);
      expect(d.textContent).toBe('');
    });
  });

  // @gate !disableLegacyMode
  /** legacy开启时，将类Component本身而非元素给render；DEV提示函数不是child，验证不自动调用工厂/类。 */
  it('warns when given a factory', () => {
    /** 类fixture正常可输出div，但测试故意传类型本身给legacy render。 */
    class Component extends React.Component {
      /** 返回div，非法输入来自未创建元素而非组件输出。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(Component, container);
    assertConsoleErrorDev([
      'Functions are not valid as a React child. ' +
        'This may happen if you return Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.\n' +
        '  root.render(Component)',
    ]);
  });

  // @gate !disableLegacyMode
  /** legacy同容器先render div后span；同步nodeName更新，验证允许根宿主类型切换。 */
  it('should render different components in same root', () => {
    const container = document.createElement('container');
    document.body.appendChild(container);

    ReactDOM.render(<div />, container);
    expect(container.firstChild.nodeName).toBe('DIV');

    ReactDOM.render(<span />, container);
    expect(container.firstChild.nodeName).toBe('SPAN');
  });

  // @gate !disableLegacyMode
  /** legacy类记录didMount/willUnmount，key A orange→B green→B blue；挂载次数1→2→2、卸载0→1→1，验证换key重建、同key复用。 */
  it('should unmount and remount if the key changes', () => {
    const container = document.createElement('container');

    const mockMount = jest.fn();
    const mockUnmount = jest.fn();

    /** 用mount/unmount mock记录key变化的类，输出text。 */
    class Component extends React.Component {
      /** 引用稳定mount mock，初次/换key应调用而同key不调用。 */
      componentDidMount = mockMount;
      /** 引用稳定unmount mock，只有换key删除旧类实例时调用。 */
      componentWillUnmount = mockUnmount;
      /** span输出text，宿主同类型变化由类key身份决定。 */
      render() {
        return <span>{this.props.text}</span>;
      }
    }

    expect(mockMount).toHaveBeenCalledTimes(0);
    expect(mockUnmount).toHaveBeenCalledTimes(0);

    ReactDOM.render(<Component text="orange" key="A" />, container);
    expect(container.firstChild.innerHTML).toBe('orange');
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(mockUnmount).toHaveBeenCalledTimes(0);

    // 改变 key 会使组件先卸载再重新挂载。
    ReactDOM.render(<Component text="green" key="B" />, container);
    expect(container.firstChild.innerHTML).toBe('green');
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(mockUnmount).toHaveBeenCalledTimes(1);

    // 但是如果我们不改变键,组件实例会重复使用
    ReactDOM.render(<Component text="blue" key="B" />, container);
    expect(container.firstChild.innerHTML).toBe('blue');
    expect(mockMount).toHaveBeenCalledTimes(2);
    expect(mockUnmount).toHaveBeenCalledTimes(1);
  });

  // @gate !disableLegacyMode
  /** legacy同容器两次render div；返回值对象身份相同，验证宿主公用实例复用。 */
  it('should reuse markup if rendering to the same target twice', () => {
    const container = document.createElement('container');
    const instance1 = ReactDOM.render(<div />, container);
    const instance2 = ReactDOM.render(<div />, container);

    expect(instance1 === instance2).toBe(true);
  });

  // @gate !disableLegacyMode
  /** legacy挂到已有div的非空容器；成功且无未消费诊断，本例没有旧节点身份断言，验证非空容器可用。 */
  it('should not warn if mounting into non-empty node', () => {
    const container = document.createElement('container');
    container.innerHTML = '<div></div>';

    ReactDOM.render(<div />, container);
  });

  // @gate !disableLegacyMode
  /** legacy在iframe.document.body挂div；当前没有历史body警告，验证文档body支持；旧标题warn保留。 */
  it('should warn when mounting into document.body', () => {
    const iFrame = document.createElement('iframe');
    document.body.appendChild(iFrame);

    // HostSingletons 使针对 document.body 的警告不再必要。
    ReactDOM.render(<div />, iFrame.contentDocument.body);
  });

  // @gate !disableLegacyMode
  /** legacy外根Component已有div子节点，再把其firstChild作为新根render span；DEV报告替换React子树警告，验证不得用另根接管受管理子内容。 */
  it('should warn if render removes React-rendered children', () => {
    const container = document.createElement('container');

    /** 已由外legacy根管理子div的类，用firstChild建立新根制造所有权诊断。 */
    class Component extends React.Component {
      /** 嵌套两个div，确保firstChild已拥有React子内容。 */
      render() {
        return (
          <div>
            <div />
          </div>
        );
      }
    }

    ReactDOM.render(<Component />, container);

    // 取已受外根管理的宿主作为新根容器，render替换其子内容应给所有权诊断。
    const rootNode = container.firstChild;

    ReactDOM.render(<span />, rootNode);
    assertConsoleErrorDev([
      'Replacing React-rendered children with a new ' +
        'root component. If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state and ' +
        'render the new components instead of calling ReactDOM.render.',
    ]);
  });

  // @gate !disableLegacyMode
  /** legacy一份ReactDOM建立根，另一模块副本尝试卸载；副本不相同并诊断来源不匹配，原副本再正常卸载，验证容器私有标记按模块副本识别。 */
  it('should warn if the unmounted node was rendered by another copy of React', () => {
    jest.resetModules();
    const ReactDOMOther = require('react-dom');
    const container = document.createElement('div');

    /** 跨ReactDOM模块副本卸载fixture，输出固定嵌套div。 */
    class Component extends React.Component {
      /** 返回同样两div，便于新副本识别渲染源不一致。 */
      render() {
        return (
          <div>
            <div />
          </div>
        );
      }
    }

    ReactDOM.render(<Component />, container);
    // 确保 ReactDOM 和 ReactDOMOther 是不同的副本。
    expect(ReactDOM).not.toEqual(ReactDOMOther);

    ReactDOMOther.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      "unmountComponentAtNode(): The node you're attempting to unmount " +
        'was rendered by another copy of React.',
    ]);

    // 由创建该根的 ReactDOM 副本卸载，不应触发副本不匹配警告。
    ReactDOM.unmountComponentAtNode(container);
  });

  // @gate !disableLegacyMode
  /** legacy首次/同类型更新/类型切换/两种batch更新共五次render callback；this分别为DIV、SPAN、ARTICLE当前公用宿主，calls=5，验证回调绑定提交后的实例。 */
  it('passes the correct callback context', () => {
    const container = document.createElement('div');
    let calls = 0;

    ReactDOM.render(<div />, container, function () {
      expect(this.nodeName).toBe('DIV');
      calls++;
    });

    // 更新，类型未改变
    ReactDOM.render(<div />, container, function () {
      expect(this.nodeName).toBe('DIV');
      calls++;
    });

    // 更新和类型变化
    ReactDOM.render(<span />, container, function () {
      expect(this.nodeName).toBe('SPAN');
      calls++;
    });

    // 批量更新，无类型改变
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.render(<span />, container, function () {
        expect(this.nodeName).toBe('SPAN');
        calls++;
      });
    });

    // 批量更新，类型改变
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.render(<article />, container, function () {
        expect(this.nodeName).toBe('ARTICLE');
        calls++;
      });
    });

    expect(calls).toBe(5);
  });

  // @gate !disableLegacyMode && classic
  /** 仅legacy classic：先根1=1，batch内排更新2仍暂旧；根2首次挂Foo在didMount设active，立即使根1=2、根2=a!，验证首次legacy根挂载会同步冲刷跨根同步及layout更新。 */
  it('initial mount of legacy root is sync inside batchedUpdates, as if it were wrapped in flushSync', () => {
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');

    /** 新legacy根初挂didMount setState的类，检查布局更新同步冲刷。 */
    class Foo extends React.Component {
      /** 初active=false，didMount变true后文字加感叹号。 */
      state = {active: false};
      /** 挂载即setState(active=true)，应与初始legacy同步挂载一起完成。 */
      componentDidMount() {
        this.setState({active: true});
      }
      /** 将children与active感叹号拼为文本，root2最终a!。 */
      render() {
        return (
          <div>{this.props.children + (this.state.active ? '!' : '')}</div>
        );
      }
    }

    ReactDOM.render(<div>1</div>, container1);

    ReactDOM.unstable_batchedUpdates(() => {
    // 安排更新；此时尚未冲刷。
      ReactDOM.render(<div>2</div>, container1);
      expect(container1.textContent).toEqual('1');

      // 初始挂载到另一个根节点。 应立即冲刷。
      ReactDOM.render(<Foo>a</Foo>, container2);
      // 之前的更新也出现了, 由于 `flushSync` 会将所有同步工作都同步地发送到所有根上，因此它会清除所
      // 有同步工作。
      expect(container1.textContent).toEqual('2');
      // 布局更新也会同步冲刷
      expect(container2.textContent).toEqual('a!');
    });
    expect(container1.textContent).toEqual('2');
    expect(container2.textContent).toEqual('a!');
  });

  describe('mount point is a comment node', () => {
    let containerDiv;
    let mountPoint;

    beforeEach(() => {
      containerDiv = document.createElement('div');
      containerDiv.innerHTML = 'A<!-- react-mount-point-unstable -->B';
      mountPoint = containerDiv.childNodes[1];
      expect(mountPoint.nodeType).toBe(COMMENT_NODE);
    });

    // @gate !disableLegacyMode
    /** legacy以特定comment为挂载点，aeiou→yea→空字符列表；内容插在A与comment前且B保持，验证comment容器的插入/更新/清理位置。 */
    it('renders at a comment node', () => {
      /** 透传单字符children，不生成额外DOM，用于comment前文字列表。 */
      function Char(props) {
        return props.children;
      }
      /** 按每个字符生成带该字符key的Char，aeiou/yea唯一字符避免重复key，把空字符串变空列表。 */
      function list(chars) {
        return chars.split('').map(c => <Char key={c}>{c}</Char>);
      }

      ReactDOM.render(list('aeiou'), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'Aaeiou<!-- react-mount-point-unstable -->B',
      );

      ReactDOM.render(list('yea'), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'Ayea<!-- react-mount-point-unstable -->B',
      );

      ReactDOM.render(list(''), mountPoint);
      expect(containerDiv.innerHTML).toBe(
        'A<!-- react-mount-point-unstable -->B',
      );
    });
  });

  // @gate !disableLegacyMode
  /** legacy容器已有a/b，render c/d后换d/c；文字cd→dc，验证首次清原内容与后续同步更新。 */
  it('clears existing children with legacy API', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<div>a</div><div>b</div>';
    ReactDOM.render(
      <div>
        <span>c</span>
        <span>d</span>
      </div>,
      container,
    );
    expect(container.textContent).toEqual('cd');
    ReactDOM.render(
      <div>
        <span>d</span>
        <span>c</span>
      </div>,
      container,
    );
    await waitForAll([]);
    expect(container.textContent).toEqual('dc');
  });

  // @gate !disableLegacyMode
  /** createRoot已提交Hi后legacy render Bye；DEV两条混根/替子内容诊断，最终Bye，验证不支持混用仍执行遗留替换的实际结果。 */
  it('warns when rendering with legacy API into createRoot() container', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    ReactDOM.render(<div>Bye</div>, container);
    assertConsoleErrorDev([
      // 我们关心这个警告：
      'You are calling ReactDOM.render() on a container that was previously ' +
        'passed to ReactDOMClient.createRoot(). This is not supported. ' +
        'Did you mean to call root.render(element)?',
      // 错误地混用根 API 还会触发下列容器诊断：
      'Replacing React-rendered children with a new root component. ' +
        'If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state ' +
        'and render the new components instead of calling ReactDOM.render.',
    ]);
    await waitForAll([]);
    // 虽然最终内容被替换为 Bye，本用例仍要求记录不支持混用根 API 的警告。
    expect(container.textContent).toEqual('Bye');
  });

  // @gate !disableLegacyMode
  /** createRoot已提交Hi，legacy unmount；DEV两条混根/非顶层诊断，false且Hi仍在；root.unmount才清空，验证legacy不能清理现代根。 */
  it('warns when unmounting with legacy API (no previous content)', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    const unmounted = ReactDOM.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      // 我们关心这个警告：
      'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
        'passed to ReactDOMClient.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      // 错误地混用根 API 还会触发下列容器诊断：
      'unmountComponentAtNode(): ' +
        "The node you're attempting to unmount was rendered by React and is not a top-level container. " +
        'Instead, have the parent component update its state and rerender in order to remove this component.',
    ]);
    expect(unmounted).toBe(false);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  // @gate !disableLegacyMode
  /** 同上但createRoot之前容器已有div；legacy unmount仍false保留Hi、现代unmount清空，验证初始非空容器不改变根API所有权。 */
  it('warns when unmounting with legacy API (has previous content)', async () => {
    const container = document.createElement('div');
    // 先放原始div制造非空起点；后续检查的仍是已提交现代根Hi，未断言原div保留。
    container.appendChild(document.createElement('div'));
    // 其余部分与上述测试相同。
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    const unmounted = ReactDOM.unmountComponentAtNode(container);
    assertConsoleErrorDev([
      'You are calling ReactDOM.unmountComponentAtNode() on a container ' +
        'that was previously passed to ReactDOMClient.createRoot(). ' +
        'This is not supported. Did you mean to call root.unmount()?',
      // 错误地混用根 API 还会触发下列容器诊断：
      'unmountComponentAtNode(): ' +
        "The node you're attempting to unmount was rendered by React and is not a top-level container. " +
        'Instead, have the parent component update its state and rerender in order to remove this component.',
    ]);
    expect(unmounted).toBe(false);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  // @gate !disableLegacyMode
  /** legacy render Hi后同容器createRoot；DEV提示已有legacy根，验证反向混用入口诊断。 */
  it('warns when passing legacy container to createRoot()', () => {
    const container = document.createElement('div');
    ReactDOM.render(<div>Hi</div>, container);
    ReactDOMClient.createRoot(container);
    assertConsoleErrorDev([
      'You are calling ReactDOMClient.createRoot() on a container that was previously ' +
        'passed to ReactDOM.render(). This is not supported.',
    ]);
  });
});
