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
let ReactNoop;
let Scheduler;
let waitFor;
let waitForAll;

/** 验证 findInstance 只反射 current 已提交树，不会泄漏并发 work-in-progress 的插入、替换或删除。 */
describe('ReactIncrementalReflection', () => {
  /** 重置模块并绑定可分片推进的调度工具，确保 current/work-in-progress 状态从空根开始。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
  });

  /** 构造 ReactNoop 的 div 宿主快照，并把字符串子节点规范化为文本记录。 */
  function div(...children) {
    children = children.map(c =>
      typeof c === 'string' ? {text: c, hidden: false} : c,
    );
    return {type: 'div', children, prop: undefined, hidden: false};
  }

  /** 构造带可选 prop 的空 span 宿主快照，用于和 findInstance 结果比较。 */
  function span(prop) {
    return {type: 'span', children: [], prop, hidden: false};
  }

  /** Given Component 按 step 在 span、div、null 间切换且并发渲染可停在提交前；When 分别在挂载、替换、删除与卸载前后调用 findInstance；Then提交前始终返回旧 current 宿主实例，提交后才原子切换。通过生命周期日志、保存的 ref 与 ReactNoop 宿主对象验证 findCurrentHostFiber 路径。 */
  it('finds no node before insertion and correct node before deletion', async () => {
    let classInstance = null;

    /** 在临时屏蔽废弃警告的同时调用 ReactNoop.findInstance，并保证异常路径也恢复 console.error。 */
    function findInstance(inst) {
      // findInstance 已废弃，会发出警告；本用例只验证其既有反射语义，
      // 因此暂时屏蔽 console.error，
      // 并在 finally 中恢复全局控制台。
      const oldConsoleError = console.error;
      console.error = jest.fn();
      try {
        return ReactNoop.findInstance(inst);
      } finally {
        console.error = oldConsoleError;
      }
    }

    /** 跨多个 step 保存自身及宿主 ref 的反射探针，覆盖挂载、替换、隐藏与卸载生命周期。 */
    class Component extends React.Component {
      /** 在首次提交前保存类实例，并记录 findInstance 仍为 null 的未提交状态。 */
      UNSAFE_componentWillMount() {
        classInstance = this;
        Scheduler.log(['componentWillMount', findInstance(this)]);
      }
      /** 挂载提交后再次查找宿主实例，验证 current 树已连接到 span。 */
      componentDidMount() {
        Scheduler.log(['componentDidMount', findInstance(this)]);
      }
      /** 更新 render 前记录当前已提交宿主实例；进行中的 work-in-progress 不应提前暴露。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log(['componentWillUpdate', findInstance(this)]);
      }
      /** 更新提交后记录新的宿主实例或 null，验证反射结果随 current 树原子切换。 */
      componentDidUpdate() {
        Scheduler.log(['componentDidUpdate', findInstance(this)]);
      }
      /** 卸载提交前记录最后一个仍可反射的宿主实例。 */
      componentWillUnmount() {
        Scheduler.log(['componentWillUnmount', findInstance(this)]);
      }
      /** 按 step 在 span、div 与 null 之间切换，并保存 ref，制造插入、替换和删除各阶段。 */
      render() {
        Scheduler.log('render');
        return this.props.step < 2 ? (
          <span ref={ref => (this.span = ref)} />
        ) : this.props.step === 2 ? (
          <div ref={ref => (this.div = ref)} />
        ) : this.props.step === 3 ? null : this.props.step === 4 ? (
          <div ref={ref => (this.span = ref)} />
        ) : null;
      }
    }

    /** 提供渲染越界日志，确认 waitFor 暂停点已经处理完 Component 之后的兄弟。 */
    function Sibling() {
      // Sibling 的日志证明并发渲染已经越过第一个 Component。
      Scheduler.log('render sibling');
      return <span />;
    }

    /** 以稳定 key 并列 Component 与 Sibling，驱动 step 更新且保持类组件身份。 */
    function Foo(props) {
      return [<Component key="a" step={props.step} />, <Sibling key="b" />];
    }

    React.startTransition(() => {
      ReactNoop.render(<Foo step={0} />);
    });
    // 推进到越过 Component，但保留尚未提交的并发工作。
    await waitFor([['componentWillMount', null], 'render', 'render sibling']);

    expect(classInstance).toBeDefined();
    // 类实例虽已完成 render，却尚未提交到 current 树，
    // 因而不能反射到任何宿主节点。
    expect(findInstance(classInstance)).toBe(null);

    await waitForAll([['componentDidMount', span()]]);

    const hostSpan = classInstance.span;
    expect(hostSpan).toBeDefined();

    expect(findInstance(classInstance)).toBe(hostSpan);

    // step=1 触发更新，但仍复用原 span，
    // 直到提交前后 findInstance 都应指向它。
    ReactNoop.render(<Foo step={1} />);
    await waitForAll([
      ['componentWillUpdate', hostSpan],
      'render',
      'render sibling',
      ['componentDidUpdate', hostSpan],
    ]);

    expect(ReactNoop.findInstance(classInstance)).toBe(hostSpan);

    // step=2 已在 work-in-progress 中生成新 div，但尚未提交。
    // 关键边界：进行中 Fiber 的变化不能泄漏到 current 树的反射结果。
    React.startTransition(() => {
      ReactNoop.render(<Foo step={2} />);
    });
    await waitFor([
      ['componentWillUpdate', hostSpan],
      'render',
      'render sibling',
    ]);

    // 提交前仍必须返回旧 current 树中的 span。
    expect(ReactNoop.findInstance(classInstance)).toBe(hostSpan);

    // 耗尽剩余工作后，新 div 才成为已提交宿主实例。
    await waitForAll([['componentDidUpdate', div()]]);

    const hostDiv = classInstance.div;
    expect(hostDiv).toBeDefined();
    expect(hostSpan).not.toBe(hostDiv);

    // 提交后反射结果应切换为新 div。
    expect(ReactNoop.findInstance(classInstance)).toBe(hostDiv);

    // 开始渲染 null，但先停在提交之前。
    React.startTransition(() => {
      ReactNoop.render(<Foo step={3} />);
    });
    await waitFor([
      ['componentWillUpdate', hostDiv],
      'render',
      'render sibling',
    ]);

    // 删除尚未提交时仍必须返回旧 div。
    expect(ReactNoop.findInstance(classInstance)).toBe(hostDiv);

    await waitForAll([['componentDidUpdate', null]]);

    // 删除已经提交后，反射结果应变为 null。
    expect(ReactNoop.findInstance(classInstance)).toBe(null);

    // 再次渲染 div，覆盖从无宿主节点恢复的路径。
    ReactNoop.render(<Foo step={4} />);
    await waitForAll([
      ['componentWillUpdate', null],
      'render',
      'render sibling',
      ['componentDidUpdate', div()],
    ]);

    // 最后卸载组件，验证卸载生命周期仍能看到删除前的宿主实例。
    ReactNoop.render([]);
    await waitForAll([['componentWillUnmount', hostDiv]]);
  });
});
