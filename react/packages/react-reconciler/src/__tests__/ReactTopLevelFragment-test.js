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
let waitForAll;

// 顶层 Fragment 最初是 Fiber 新能力，因而独立成文件；稳定后可并入其他 reconciliation 测试。
/** 验证组件直接返回数组时，key、嵌套层级、null slot 与重排如何决定 Fiber identity/state 保留。 */
describe('ReactTopLevelFragment', function () {
  /** 每例重建 Noop renderer，确保类实例身份只来自当前 reconciliation 序列。 */
  beforeEach(function () {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /**
   * Given 组件直接返回两个带 key 的顶层元素数组；When Noop 根完成 render；Then 数组可作为合法顶层 child 提交。
   * 验证机制：无错误完成所有 work；对应 ReactChildFiber 的 reconcileChildrenArray。
   */
  it('should render a simple fragment at the top of a component', async function () {
    /** 返回最小带 key 顶层数组，验证无需额外 DOM/Fragment 包装。 */
    function Fragment() {
      return [<div key="a">Hello</div>, <div key="b">World</div>];
    }
    ReactNoop.render(<Fragment />);
    await waitForAll([]);
  });

  /**
   * Given key=a 的 Stateful 起初位于顶层数组；When 结构切换为同 key 的单 child；
   * Then 类实例身份保持不变。验证 ReactChildFiber 对单元素与顶层数组 slot 的兼容复用。
   */
  it('should preserve state when switching from a single child', async function () {
    let instance = null;

    /** 把当前类实例暴露给测试，以身份判断 state Fiber 是否复用。 */
    class Stateful extends React.Component {
      /** 保存 this 并输出稳定宿主节点。 */
      render() {
        instance = this;
        return <div>Hello</div>;
      }
    }

    /** 在 key=a 单 child 与包含同 key 元素的数组间切换。 */
    function Fragment({condition}) {
      return condition ? (
        <Stateful key="a" />
      ) : (
        [<Stateful key="a" />, <div key="b">World</div>]
      );
    }
    ReactNoop.render(<Fragment />);
    await waitForAll([]);

    const instanceA = instance;

    expect(instanceA).not.toBe(null);

    ReactNoop.render(<Fragment condition={true} />);
    await waitForAll([]);

    const instanceB = instance;

    expect(instanceB).toBe(instanceA);
  });

  /**
   * Given key=a 元素位于嵌套数组；When 切换为顶层单 child；Then 数组层级改变 Fiber slot，类实例必须重建。
   * 验证 ReactChildFiber 不跨隐式嵌套 Fragment 边界复用 state。
   */
  it('should not preserve state when switching to a nested array', async function () {
    let instance = null;

    /** 记录嵌套结构切换前后的实例身份。 */
    class Stateful extends React.Component {
      /** 暴露 this 并返回固定输出。 */
      render() {
        instance = this;
        return <div>Hello</div>;
      }
    }

    /** 在嵌套数组与顶层单 child 之间切换 key=a 元素。 */
    function Fragment({condition}) {
      return condition ? (
        <Stateful key="a" />
      ) : (
        [[<Stateful key="a" />, <div key="b">World</div>], <div key="c" />]
      );
    }
    ReactNoop.render(<Fragment />);
    await waitForAll([]);

    const instanceA = instance;

    expect(instanceA).not.toBe(null);

    ReactNoop.render(<Fragment condition={true} />);
    await waitForAll([]);

    const instanceB = instance;

    expect(instanceB).not.toBe(instanceA);
  });

  /**
   * Given key=a Stateful 始终位于第二个显式 key 位置，而第一 slot 在元素与 null 间切换；
   * When 往返更新；Then Stateful 实例持续复用。验证空 slot 不应扰动后续显式 key 映射。
   */
  it('preserves state if an implicit key slot switches from/to null', async function () {
    let instance = null;

    /** 暴露实例以检查 null slot 切换是否错误重建 state。 */
    class Stateful extends React.Component {
      /** 记录实例并输出 World。 */
      render() {
        instance = this;
        return <div>World</div>;
      }
    }

    /** 在第一 slot 的 div/null 间切换，同时保持 key=a Stateful。 */
    function Fragment({condition}) {
      return condition
        ? [null, <Stateful key="a" />]
        : [<div key="b">Hello</div>, <Stateful key="a" />];
    }
    ReactNoop.render(<Fragment />);
    await waitForAll([]);

    const instanceA = instance;

    expect(instanceA).not.toBe(null);

    ReactNoop.render(<Fragment condition={true} />);
    await waitForAll([]);

    const instanceB = instance;

    expect(instanceB).toBe(instanceA);

    ReactNoop.render(<Fragment condition={false} />);
    await waitForAll([]);

    const instanceC = instance;

    expect(instanceC === instanceA).toBe(true);
  });

  /**
   * Given 嵌套数组中 key=a 与 key=b 的顺序；When 两者重排且外层数组形状收缩；
   * Then key=a 类实例保持。验证 keyed reconciliation 的移动复用而非索引复用。
   */
  it('should preserve state in a reorder', async function () {
    let instance = null;

    /** 暴露重排前后 key=a 对应的类实例。 */
    class Stateful extends React.Component {
      /** 记录 this 并返回固定 Hello。 */
      render() {
        instance = this;
        return <div>Hello</div>;
      }
    }

    /** 在两种嵌套数组顺序间切换 key=a/key=b。 */
    function Fragment({condition}) {
      return condition
        ? [[<div key="b">World</div>, <Stateful key="a" />]]
        : [[<Stateful key="a" />, <div key="b">World</div>], <div key="c" />];
    }
    ReactNoop.render(<Fragment />);
    await waitForAll([]);

    const instanceA = instance;

    expect(instanceA).not.toBe(null);

    ReactNoop.render(<Fragment condition={true} />);
    await waitForAll([]);

    const instanceB = instance;

    expect(instanceB).toBe(instanceA);
  });
});
