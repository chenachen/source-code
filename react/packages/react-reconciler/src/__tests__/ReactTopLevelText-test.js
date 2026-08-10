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

// 顶层文本最初是 Fiber 新能力，因而独立成文件；能力稳定后可并入其他基础渲染测试。
/** 覆盖组件直接返回 string、number、bigint 时的顶层 HostText 创建与字符串归一化。 */
describe('ReactTopLevelText', () => {
  /** 每例创建全新 Noop renderer，并取得等待所有 work 完成的调度辅助函数。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /**
   * Given 组件直接返回字符串；When 根完成并发 render；Then 输出保持原字符串 "foo"。
   * 验证机制：Noop 渲染树；对应 ReactChildFiber 文本节点创建与 completeWork HostText 路径。
   */
  it('should render a component returning strings directly from render', async () => {
    /** 原样返回 value，用于隔离顶层字符串的 reconciliation 行为。 */
    const Text = ({value}) => value;
    ReactNoop.render(<Text value="foo" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('foo');
  });

  /**
   * Given 组件直接返回 number 10；When reconciler 创建顶层文本 Fiber；Then 宿主输出归一化为字符串 "10"。
   * 验证机制：Noop 输出；对应 ReactChildFiber 的 number-to-text 规范化。
   */
  it('should render a component returning numbers directly from render', async () => {
    /** 返回数值 value，验证 HostText 层而非组件层完成字符串化。 */
    const Text = ({value}) => value;
    ReactNoop.render(<Text value={10} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('10');
  });

  /**
   * Given 组件直接返回 bigint 10n；When reconciler 处理该 child；Then 输出为可渲染文本 "10"。
   * 验证机制：Noop 输出；对应 ReactChildFiber 的 bigint 文本分支与 HostText 完成阶段。
   */
  it('should render a component returning bigints directly from render', async () => {
    /** 返回 bigint value，验证大整数不被当作空 child 丢弃。 */
    const Text = ({value}) => value;
    ReactNoop.render(<Text value={10n} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput('10');
  });
});
