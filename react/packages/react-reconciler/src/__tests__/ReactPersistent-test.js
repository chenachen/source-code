/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoopPersistent;

let act;
let waitForAll;

/** 验证持久化宿主配置通过新 child set 提交更新，同时保持旧树不可变并复用 bailout 节点。 */
describe('ReactPersistent', () => {
  /** 重置模块并加载 persistent ReactNoop 根及异步冲刷工具，隔离各代 child set。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoopPersistent = require('react-noop-renderer/persistent');
    ({act, waitForAll} = require('internal-test-utils'));
  });

  // 从 shared 内联此构造器，使同一测试也能针对打包产物运行。
  /** 构造最小 React Portal 记录；key 归一化与 $$typeof 必须匹配协调器识别协议。 */
  function createPortal(children, containerInfo, implementation, key) {
    return {
      $$typeof: Symbol.for('react.portal'),
      key: key == null ? null : String(key),
      children,
      containerInfo,
      implementation,
    };
  }

  /** 将元素提交到共享 persistent 根，统一各用例的渲染入口。 */
  function render(element) {
    ReactNoopPersistent.render(element);
  }

  /** 构造预期 div 宿主快照，并把字符串规范化为不可见文本记录。 */
  function div(...children) {
    children = children.map(c =>
      typeof c === 'string' ? {text: c, hidden: false} : c,
    );
    return {type: 'div', children, prop: undefined, hidden: false};
  }

  /** 构造带 prop 的空 span 宿主快照，用于深比较与引用比较。 */
  function span(prop) {
    return {type: 'span', children: [], prop, hidden: false};
  }

  // 持久化渲染器既要比较树内容，也要确认被复用节点的引用身份，
  // 因此这里需要直接读取实际 children。
  // 这些用例不受 feature gate 控制，底层实现也很少变动，
  // 因而失败时大型 `toEqual` diff 的性能风险可接受。
  /** 读取 persistent 根当前真实 child set；仅测试使用，以同时检查内容与对象身份。 */
  function dangerouslyGetChildren() {
    return ReactNoopPersistent.dangerouslyGetChildren();
  }

  /** Given–When–Then：Given Foo 从一个 Bar 子节点更新为两个；When 持久化根完成第二次提交；Then新 child set 包含两个 span，而旧 child set 保持一个。通过深比较验证 cloneInstance 构建新树且不突变旧快照。 */
  it('can update child nodes of a host instance', async () => {
    /** 把 text 转成 span 子节点，使父级增删可以在宿主快照中直接观察。 */
    function Bar(props) {
      return <span>{props.text}</span>;
    }

    /** 按 text 决定 Bar 数量，制造持久化宿主节点的增量追加。 */
    function Foo(props) {
      return (
        <div>
          <Bar text={props.text} />
          {props.text === 'World' ? <Bar text={props.text} /> : null}
        </div>
      );
    }

    render(<Foo text="Hello" />);
    await waitForAll([]);
    const originalChildren = dangerouslyGetChildren();
    expect(originalChildren).toEqual([div(span())]);

    render(<Foo text="World" />);
    await waitForAll([]);
    const newChildren = dangerouslyGetChildren();
    expect(newChildren).toEqual([div(span(), span())]);

    expect(originalChildren).toEqual([div(span())]);
  });

  /** Given–When–Then：Given Bar 的 shouldComponentUpdate 固定 bailout；When 父树新增第二个 Bar；Then第一个 span 在新旧 child set 中引用相等，新增节点仅存在于新树。通过深相等与 toBe 联合验证持久化渲染器的子节点复用。 */
  it('can reuse child nodes between updates', async () => {
    /** 根据 text 创建带 prop 的 span，作为 Bar bailout 后应复用的宿主节点。 */
    function Baz(props) {
      return <span prop={props.text} />;
    }
    /** 固定拒绝更新的类组件，用于证明旧宿主 span 可跨父树克隆复用。 */
    class Bar extends React.Component {
      /** 始终返回 false，明确建立 bailout 边界。 */
      shouldComponentUpdate(newProps) {
        return false;
      }
      /** 将初次 props 交给 Baz；后续父级 props 变化会被 shouldComponentUpdate 拦截。 */
      render() {
        return <Baz text={this.props.text} />;
      }
    }
    /** 保留首个 bailout Bar，并在 World 状态追加第二个 Bar。 */
    function Foo(props) {
      return (
        <div>
          <Bar text={props.text} />
          {props.text === 'World' ? <Bar text={props.text} /> : null}
        </div>
      );
    }

    render(<Foo text="Hello" />);
    await waitForAll([]);
    const originalChildren = dangerouslyGetChildren();
    expect(originalChildren).toEqual([div(span('Hello'))]);

    render(<Foo text="World" />);
    await waitForAll([]);
    const newChildren = dangerouslyGetChildren();
    expect(newChildren).toEqual([div(span('Hello'), span('World'))]);

    expect(originalChildren).toEqual([div(span('Hello'))]);

    // 被 bailout 复用的节点必须保持引用相等。
    expect(newChildren[0].children[0]).toBe(originalChildren[0].children[0]);
  });

  /** Given–When–Then：Given div 的文本从 Hello 更新为 World；When 持久化根提交新 child set；Then新树含 World，旧树仍含 Hello。通过保留两代快照验证文本克隆不会原地修改。 */
  it('can update child text nodes', async () => {
    /** 把可变文本和稳定 span 放入同一 div，验证文本更新的不可变快照。 */
    function Foo(props) {
      return (
        <div>
          {props.text}
          <span />
        </div>
      );
    }

    render(<Foo text="Hello" />);
    await waitForAll([]);
    const originalChildren = dangerouslyGetChildren();
    expect(originalChildren).toEqual([div('Hello', span())]);

    render(<Foo text="World" />);
    await waitForAll([]);
    const newChildren = dangerouslyGetChildren();
    expect(newChildren).toEqual([div('World', span())]);

    expect(originalChildren).toEqual([div('Hello', span())]);
  });

  /** Given–When–Then：Given portal 容器内有 bailout 子树；When 依次挂载、追加文本并删除 portal；Then目标容器原子替换 child set、复用稳定 span、删除时清空，而历史集合不变。通过门户容器引用与快照验证 persistent portal 提交协议。 */
  it('supports portals', async () => {
    /** 在主根中包裹 portal 入口；portal 内容应提交到独立 containerInfo。 */
    function Parent(props) {
      return <div>{props.children}</div>;
    }

    /** 返回稳定 span，作为 portal 内引用相等断言的叶节点。 */
    function BailoutSpan() {
      return <span />;
    }

    /** Portal 内的稳定 bailout 子树，用于检查 child set 更新时的引用复用。 */
    class BailoutTest extends React.Component {
      /** 始终返回 false，明确建立 bailout 边界。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 返回 BailoutSpan，使 portal 更新前后可比较同一宿主节点引用。 */
      render() {
        return <BailoutSpan />;
      }
    }

    /** 构造 portal 子树：包含可复用 BailoutTest 与可变 children。 */
    function Child(props) {
      return (
        <div>
          <BailoutTest />
          {props.children}
        </div>
      );
    }
    const portalContainer = {rootID: 'persistent-portal-test', children: []};
    const emptyPortalChildSet = portalContainer.children;
    render(<Parent>{createPortal(<Child />, portalContainer, null)}</Parent>);
    await waitForAll([]);

    expect(emptyPortalChildSet).toEqual([]);

    const originalChildren = dangerouslyGetChildren();
    expect(originalChildren).toEqual([div()]);
    const originalPortalChildren = portalContainer.children;
    expect(originalPortalChildren).toEqual([div(span())]);

    render(
      <Parent>
        {createPortal(<Child>Hello {'World'}</Child>, portalContainer, null)}
      </Parent>,
    );
    await waitForAll([]);

    const newChildren = dangerouslyGetChildren();
    expect(newChildren).toEqual([div()]);
    const newPortalChildren = portalContainer.children;
    expect(newPortalChildren).toEqual([div(span(), 'Hello ', 'World')]);

    expect(originalChildren).toEqual([div()]);
    expect(originalPortalChildren).toEqual([div(span())]);

    // portal 中被 bailout 复用的子节点也必须保持引用相等。
    expect(newPortalChildren[0].children[0]).toBe(
      originalPortalChildren[0].children[0],
    );

    // 删除 Portal 时必须清空目标容器的当前 children。
    render(<Parent />);
    await waitForAll([]);

    const clearedPortalChildren = portalContainer.children;
    expect(clearedPortalChildren).toEqual([]);

    // 已保存的上一代 child set 仍保持不变。
    expect(newPortalChildren).toEqual([div(span(), 'Hello ', 'World')]);
  });

  /** Given–When–Then：Given Wrapper 初次返回 inner，随后返回空 children；When 同一持久化 root 更新；Then宿主 JSX 从 inner 变为 null。通过 root child set 验证删除最后一个子节点的路径。 */
  it('remove children', async () => {
    /** 原样返回 children，使根能在单个 inner 与空集合之间切换。 */
    function Wrapper({children}) {
      return children;
    }

    const root = ReactNoopPersistent.createRoot();
    await act(() => {
      root.render(
        <Wrapper>
          <inner />
        </Wrapper>,
      );
    });
    expect(root.getChildrenAsJSX()).toEqual(<inner />);

    await act(() => {
      root.render(<Wrapper />);
    });
    expect(root.getChildrenAsJSX()).toEqual(null);
  });
});
