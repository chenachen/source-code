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
let Scheduler;
let ReactNoop;
let act;
let assertLog;

/** 覆盖 ref 在 bailout、宿主节点、非法字符串 ref、callback ref 迁移与默认 refs 对象上的提交语义。 */
describe('ReactFiberRefs', () => {
  /** 每例重置 React/Noop/Scheduler，避免 ref.current、类实例与日志跨用例残留。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    ReactNoop = require('react-noop-renderer');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
  });

  /**
   * Given shouldComponentUpdate 恒为 false 的类组件已绑定 ref1；When 只把 ref 替换为 ref2；
   * Then 组件不重新 render，但 commit 仍清空 ref1 并附加 ref2。
   * 验证机制：Scheduler 日志和 ref.current；对应 ReactFiberBeginWork bailout 与 ReactFiberCommitEffects 的 Ref 标记。
   */
  it('ref is attached even if there are no other updates (class)', async () => {
    let component;
    /** 永久 bailout 的类组件，用来证明 ref 变化独立于 render 更新。 */
    class Component extends React.Component {
      /** 拒绝 props/state 驱动的重渲染，把测试变量限制为 ref 变化。 */
      shouldComponentUpdate() {
        // 组件输出不依赖任何 props 或 state，因此可安全地恒定 bailout。
        return false;
      }
      /** 记录真正发生的 render，并暴露实例供 ref 身份断言。 */
      render() {
        Scheduler.log('Render');
        component = this;
        return 'Hi';
      }
    }

    const ref1 = React.createRef();
    const ref2 = React.createRef();
    const root = ReactNoop.createRoot();

    // 首次挂载并附加 ref1。
    await act(() => root.render(<Component ref={ref1} />));
    assertLog(['Render']);
    expect(root).toMatchRenderedOutput('Hi');
    expect(ref1.current).toBe(component);
    // 尚未使用的 ref2 必须保持空值。
    expect(ref2.current).toBe(null);

    // 仅把 ref 切换到 ref2，不改变其他输入。
    await act(() => root.render(<Component ref={ref2} />));
    // props 未变且组件 bailout，因此不应重新 render。
    assertLog([]);
    expect(root).toMatchRenderedOutput('Hi');
    // 即使 render bailout，commit 仍必须完成两个 ref 的交换。
    expect(ref1.current).toBe(null);
    expect(ref2.current).toBe(component);
  });

  /**
   * Given div 已绑定 ref1；When 用相同 props/children 重新创建元素但改为 ref2；
   * Then 宿主输出不变，ref1 被清空且 ref2 指向实例。
   * 验证机制：Noop 输出与 ref.current；对应 ReactFiberCompleteWork 的 Ref 标记及 commit detach/attach 顺序。
   */
  it('ref is attached even if there are no other updates (host component)', async () => {
    // 宿主组件收到新元素时不会像类组件一样 bailout，且更新 ref 时也会产生新 props；
    // 此例仍保留，用于与上方类组件场景对称地验证宿主 ref 交换。
    const ref1 = React.createRef();
    const ref2 = React.createRef();
    const root = ReactNoop.createRoot();

    // 首次挂载并附加 ref1。
    await act(() => root.render(<div ref={ref1}>Hi</div>));
    expect(root).toMatchRenderedOutput(<div>Hi</div>);
    expect(ref1.current).not.toBe(null);
    // ref2 尚未附加，必须为空。
    expect(ref2.current).toBe(null);

    // 保持可见输出不变，仅切换到 ref2。
    await act(() => root.render(<div ref={ref2}>Hi</div>));
    expect(root).toMatchRenderedOutput(<div>Hi</div>);
    // commit 后两个 ref 的所有权应完成交换。
    expect(ref1.current).toBe(null);
    expect(ref2.current).not.toBe(null);
  });

  /**
   * Given ref 字符串先作为普通 prop 穿过函数组件；When Child 把它转交给可接收 ref 的 div；
   * Then reconciler 在 div 边界拒绝该 ref，同时 Child 本身能完成 render。
   * 验证机制：act rejection 与已记录 refProp；对应 ReactFiberBeginWork 的 ref 类型校验。
   */
  it('throw if a string ref is passed to a ref-receiving component', async () => {
    let refProp;
    /** 接收 ref 作为普通函数参数，再把它传给 div，以定位类型校验真正发生的位置。 */
    function Child({ref}) {
      // 函数组件自身可成功 render，因为 ref 类型检查直到值传给可接收 ref 的组件才发生。
      // 因此抛错者是 div，而不是 Child。
      refProp = ref;
      return <div ref={ref} />;
    }

    /** 使用旧字符串 ref 调用 Child，模拟待迁移的类组件所有者。 */
    class Owner extends React.Component {
      /** 把字符串 ref 交给 Child，触发向宿主组件继续转发。 */
      render() {
        return <Child ref="child" />;
      }
    }

    const root = ReactNoop.createRoot();
    await expect(act(() => root.render(<Owner />))).rejects.toThrow(
      'Expected ref to be a function',
    );
    expect(refProp).toBe('child');
  });

  /**
   * Given 用户态 callback ref 向 this.refs 写入宿主实例；When 类组件挂载；
   * Then 写入成功且实例 prop 可读，证明字符串 ref 可机械迁移为 callback ref。
   * 验证机制：this.refs.div；对应 ReactBaseClasses 的 refs 初始化与 commitAttachRef。
   */
  it('strings refs can be codemodded to callback refs', async () => {
    let app;
    /** 通过 callback ref 主动维护 this.refs.div 的迁移示例组件。 */
    class App extends React.Component {
      /** 渲染带 callback ref 的 div，并保存当前类实例供断言读取。 */
      render() {
        app = this;
        return (
          <div
            prop="Hello!"
            ref={el => {
              // `refs` 曾在 reconciler 附加字符串 ref 前共享同一冻结对象；现在允许用户态写入，
              // 因而字符串 ref 可以 codemod 成 callback ref。
              this.refs.div = el;
            }}
          />
        );
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    expect(app.refs.div.prop).toBe('Hello!');
  });

  /**
   * Given 同一类创建两个实例且都未附加字符串 ref；When constructor 收集初始 this.refs；
   * Then 两者引用同一对象，并在 DEV 中保持冻结。
   * 验证机制：Set 去重与 Object.isFrozen；对应 ReactBaseClasses 的 emptyObject 初始化。
   */
  it('class refs are initialized to a frozen shared object', async () => {
    const refsCollection = new Set();
    /** 收集每个实例初始 refs 身份的类组件夹具。 */
    class Component extends React.Component {
      /** 在任何 ref 附加前记录 this.refs，确保观察到构造期默认对象。 */
      constructor(props) {
        super(props);
        refsCollection.add(this.refs);
      }
      /** 返回稳定宿主节点，使两个实例都完成正常挂载。 */
      render() {
        return <div />;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() =>
      root.render(
        <>
          <Component />
          <Component />
        </>,
      ),
    );

    expect(refsCollection.size).toBe(1);
    const refsInstance = Array.from(refsCollection)[0];
    expect(Object.isFrozen(refsInstance)).toBe(__DEV__);
  });
});
