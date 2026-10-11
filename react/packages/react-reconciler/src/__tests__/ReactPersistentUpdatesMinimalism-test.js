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

/** 以 持久化宿主渲染器 的宿主计数器验证 bailout：只克隆真正受影响的宿主路径。 */
describe('ReactPersistentUpdatesMinimalism', () => {
  /** 重置模块并加载 ReactNoopPersistent 与 act，确保每个用例从空根和清零计数器开始。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoopPersistent = require('react-noop-renderer/persistent');
    act = require('internal-test-utils').act;
  });

  /** Given Parent/Child 产生一个稳定 div；When 连续两次渲染同一组件树；Then首次创建不计为更新，第二次只克隆根宿主节点。通过 hostCloneCounter 验证最小宿主工作量。 */
  it('should render a simple component', async () => {
    /** 返回单一 div，建立最小的函数组件到宿主节点路径。 */
    function Child() {
      return <div>Hello World</div>;
    }

    /** 仅委托给 Child，用于测量重复顶层渲染的最小宿主工作。 */
    function Parent() {
      return <Child />;
    }

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      hostCloneCounter: 0,
    });

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      hostCloneCounter: 1,
    });
  });

  /** Given Child 每次都返回同一个 constEl 引用；When 父组件再次渲染；Then协调器在元素引用相等处 bailout，宿主克隆计数仍为零。通过 hostCloneCounter 验证 beginWork 的引用相等快路径。 */
  it('should not diff referentially equal host elements', async () => {
    /** 根据 name 构造嵌套宿主子树；它位于常量元素内，重渲染时应被引用相等 bailout 跳过。 */
    function Leaf(props) {
      return (
        <span>
          hello
          <b />
          {props.name}
        </span>
      );
    }

    /** 跨渲染复用的元素对象；引用相等是本用例触发 bailout 的关键输入。 */
    const constEl = (
      <div>
        <Leaf name="world" />
      </div>
    );

    /** 返回预先创建的 constEl；函数虽重新调用，元素引用必须保持不变。 */
    function Child() {
      return constEl;
    }

    /** 每轮创建 Child 元素，但允许 Child 返回的常量宿主元素触发深层 bailout。 */
    function Parent() {
      return <Child />;
    }

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      hostCloneCounter: 0,
    });

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      hostCloneCounter: 0,
    });
  });

  /** Given Child 的 name=Batman，而祖先组件与两侧 Leaf 没有自身更新；When 局部 setState(Robin)，随后顶层重渲染；Then持久化局部轮克隆目标路径及宿主祖先共 5 个实例，顶层轮克隆 10 个。通过 hostCloneCounter 验证祖先组件可 bailout，但组装新宿主树仍需克隆祖先实例。 */
  it('should not diff parents of setState targets', async () => {
    let childInst;

    /** 把 name 写入嵌套 span/b/text 结构，用宿主计数精确暴露局部 state 变化的影响范围。 */
    function Leaf(props) {
      return (
        <span>
          hello
          <b />
          {props.name}
        </span>
      );
    }

    /** 持有可独立更新的 name 状态，作为不触发祖先重渲染的局部更新目标。 */
    class Child extends React.Component {
      /** 当前角色名；从 Batman 更新为 Robin 以制造叶级文本变化。 */
      state = {name: 'Batman'};
      /** 保存实例句柄并把状态限制在自身 div/Leaf 子树内。 */
      render() {
        childInst = this;
        return (
          <div>
            <Leaf name={this.state.name} />
          </div>
        );
      }
    }

    /** 构造目标 Child 的祖先和稳定兄弟，用计数器区分局部更新与顶层更新范围。 */
    function Parent() {
      return (
        <section>
          <div>
            <Leaf name="world" />
            <Child />
            <hr />
            <Leaf name="world" />
          </div>
        </section>
      );
    }

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      hostCloneCounter: 0,
    });

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => childInst.setState({name: 'Robin'}));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      // section
      // section > div
      // section > div > Child > div
      // section > div > Child > Leaf > span
      // section > div > Child > Leaf > span > b
      hostCloneCounter: 5,
    });

    ReactNoopPersistent.startTrackingHostCounters();
    await act(() => ReactNoopPersistent.render(<Parent />));
    expect(ReactNoopPersistent.stopTrackingHostCounters()).toEqual({
      // Parent > section
      // Parent > section > div
      // Parent > section > div > Leaf > span
      // Parent > section > div > Leaf > span > b
      // Parent > section > div > Child > div
      // Parent > section > div > Child > div > Leaf > span
      // Parent > section > div > Child > div > Leaf > span > b
      // Parent > section > div > hr
      // Parent > section > div > Leaf > span
      // Parent > section > div > Leaf > span > b
      hostCloneCounter: 10,
    });
  });
});
