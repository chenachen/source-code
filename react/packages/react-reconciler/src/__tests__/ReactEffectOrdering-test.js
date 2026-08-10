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
let act;
let useEffect;
let useLayoutEffect;
let assertLog;

/** 汇总验证提交删除时不同 Effect 类型的卸载顺序。 */
describe('ReactEffectOrdering', () => {
  /** 每个用例重置模块和虚拟时钟，并重新绑定 Noop 渲染器、调度日志与 Effect API。 */
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    useEffect = React.useEffect;
    useLayoutEffect = React.useLayoutEffect;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /**
   * Given：父子组件均注册 Layout Effect 的卸载函数并已完成挂载。
   * When：根节点删除整棵父子树。
   * Then：卸载日志严格按父组件到子组件的顺序出现。
   *
   * 验证机制：`assertLog` 同时约束两次清理的内容与先后次序。
   * 对应源码：`commitDeletionEffectsOnFiber()` 与 `commitHookLayoutUnmountEffects()` 的删除提交路径。
   */
  it('layout unmounts on deletion are fired in parent -> child order', async () => {
    const root = ReactNoop.createRoot();

    /** 父级 fixture 注册 Layout Effect 清理，并在树中持有子组件以形成删除遍历关系。 */
    function Parent() {
      useLayoutEffect(() => {
        return () => Scheduler.log('Unmount parent');
      });
      return <Child />;
    }

    /** 子级 fixture 注册第二个 Layout Effect 清理，用于识别父子卸载的相对顺序。 */
    function Child() {
      useLayoutEffect(() => {
        return () => Scheduler.log('Unmount child');
      });
      return 'Child';
    }

    await act(() => {
      root.render(<Parent />);
    });
    expect(root).toMatchRenderedOutput('Child');
    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount parent', 'Unmount child']);
  });

  /**
   * Given：父子组件均注册 Passive Effect 的卸载函数并已完成挂载。
   * When：根节点删除整棵父子树并冲刷被动清理。
   * Then：被动卸载日志严格按父组件到子组件的顺序出现。
   *
   * 验证机制：`act` 冲刷提交后的被动阶段，`assertLog` 校验清理内容与顺序。
   * 对应源码：`commitPassiveUnmountEffectsInsideOfDeletedTree_begin()` 的已删除子树遍历路径。
   */
  it('passive unmounts on deletion are fired in parent -> child order', async () => {
    const root = ReactNoop.createRoot();

    /** 父级 fixture 注册 Passive Effect 清理，并持有子组件以形成删除子树。 */
    function Parent() {
      useEffect(() => {
        return () => Scheduler.log('Unmount parent');
      });
      return <Child />;
    }

    /** 子级 fixture 注册第二个 Passive Effect 清理，用于观察被动卸载的相对顺序。 */
    function Child() {
      useEffect(() => {
        return () => Scheduler.log('Unmount child');
      });
      return 'Child';
    }

    await act(() => {
      root.render(<Parent />);
    });
    expect(root).toMatchRenderedOutput('Child');
    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount parent', 'Unmount child']);
  });
});
