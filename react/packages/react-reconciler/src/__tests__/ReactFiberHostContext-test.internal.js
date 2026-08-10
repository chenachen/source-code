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
let act;
let ReactFiberReconciler;
let ConcurrentRoot;
let DefaultEventPriority;
let NoEventPriority;

/** 验证根 HostContext 在 render 到 commit 的栈传递，尤其 prepareForCommit/resetAfterCommit 接收同一根上下文。 */
describe('ReactFiberHostContext', () => {
  /** 每例重载 reconciler 工厂、根标签和事件优先级常量，避免自定义 HostConfig 状态复用。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    act = React.act;
    ReactFiberReconciler = require('react-reconciler');
    ConcurrentRoot =
      require('react-reconciler/src/ReactRootTags').ConcurrentRoot;
    DefaultEventPriority =
      require('react-reconciler/src/ReactEventPriorities').DefaultEventPriority;
    NoEventPriority =
      require('react-reconciler/src/ReactEventPriorities').NoEventPriority;
  });

  global.IS_REACT_ACT_ENVIRONMENT = true;

  /**
   * Given 自定义 renderer 返回唯一 rootContext 与不同 childContext；When 创建 ConcurrentRoot 并提交嵌套宿主树；
   * Then commit 前后钩子都收到 rootContext，而非当前子节点上下文。
   * 验证机制：HostConfig 参数断言；对应 ReactFiberHostContext 的 push/pop 栈与 ReactFiberWorkLoop commit 包装。
   */
  // @gate __DEV__
  it('should send the context to prepareForCommit and resetAfterCommit', () => {
    const rootContext = {};
    const childContext = {};
    let updatePriority: typeof DefaultEventPriority = NoEventPriority;
    // 构造最小 mutation renderer；无关宿主能力使用稳定空实现，突出 HostContext 传递。
    const Renderer = ReactFiberReconciler({
      /** commit 开始前核对 reconciler 恢复到根 HostContext。 */
      prepareForCommit: function (hostContext) {
        expect(hostContext).toBe(rootContext);
        return null;
      },
      /** commit 结束后再次核对根 HostContext，防止子上下文残留在栈顶。 */
      resetAfterCommit: function (hostContext) {
        expect(hostContext).toBe(rootContext);
      },
      /** 为根容器提供唯一 rootContext，作为整条断言链的身份标记。 */
      getRootHostContext: function () {
        return rootContext;
      },
      /** 为嵌套宿主节点返回不同 childContext，证明 commit 钩子不会误取它。 */
      getChildHostContext: function () {
        return childContext;
      },
      /** 禁止文本内容快速路径，使测试树按普通宿主节点完成。 */
      shouldSetTextContent: function () {
        return false;
      },
      /** 创建占位宿主实例；本测试只关心上下文，不观察实例内容。 */
      createInstance: function () {
        return null;
      },
      /** 初始完成阶段不请求额外 commit 更新。 */
      finalizeInitialChildren: function () {
        return null;
      },
      /** 接收初始子节点追加调用，但不维护真实宿主树。 */
      appendInitialChild: function () {
        return null;
      },
      /** 返回稳定时间戳，排除时间推进对调度的影响。 */
      now: function () {
        return 0;
      },
      /** 接收根容器追加调用；无需保存实例即可完成 commit。 */
      appendChildToContainer: function () {
        return null;
      },
      /** 清空容器的空实现，满足 mutation HostConfig 契约。 */
      clearContainer: function () {},
      /** 记录 reconciler 当前更新优先级，供读取与解析方法共享。 */
      setCurrentUpdatePriority: function (newPriority: any) {
        updatePriority = newPriority;
      },
      /** 返回最近设置的更新优先级。 */
      getCurrentUpdatePriority: function () {
        return updatePriority;
      },
      /** 有显式优先级时沿用，否则回退到 DefaultEventPriority。 */
      resolveUpdatePriority: function () {
        if (updatePriority !== NoEventPriority) {
          return updatePriority;
        }
        return DefaultEventPriority;
      },
      /** 忽略 Scheduler 事件；HostContext 测试不采集性能轨迹。 */
      trackSchedulerEvent: function () {},
      /** 无浏览器事件环境，始终返回空事件类型。 */
      resolveEventType: function () {
        return null;
      },
      /** 返回固定非法哨兵时间，避免真实时钟参与测试。 */
      resolveEventTimeStamp: function () {
        return -1.1;
      },
      /** 禁止 eager transition，确保只走普通提交路径。 */
      shouldAttemptEagerTransition() {
        return false;
      },
      /** post-paint 回调为空实现，本例没有绘制后工作。 */
      requestPostPaintCallback: function () {},
      /** 声明新实例不会因资源而挂起 commit。 */
      maySuspendCommit(type, props) {
        return false;
      },
      /** 声明实例更新不会挂起 commit。 */
      maySuspendCommitOnUpdate(type, oldProps, newProps) {
        return false;
      },
      /** 声明同步 render 也无需等待可提交资源。 */
      maySuspendCommitInSyncRender(type, props) {
        return false;
      },
      /** 立即报告实例预加载完成，关闭 Suspensey commit 分支。 */
      preloadInstance(instance, type, props) {
        return true;
      },
      /** 若意外进入挂起提交，返回空状态作为边界哨兵。 */
      startSuspendingCommit() {
        return null;
      },
      /** 挂起单个实例的空实现；按前置门控正常不会调用。 */
      suspendInstance(state, instance, type, props) {},
      /** Active View Transition 挂起为空实现，避免引入无关状态。 */
      suspendOnActiveViewTransition(state, container) {},
      /** 无需异步等待，直接允许 commit 继续。 */
      waitForCommitToBeReady(state, timeoutOffset) {
        return null;
      },
      /** 未挂起时不提供原因，保持返回 null 的 HostConfig 契约。 */
      getSuspendedCommitReason(state, rootContainer) {
        return null;
      },
      supportsMutation: true,
    });

    const container = Renderer.createContainer(
      rootContext,
      ConcurrentRoot,
      null,
      false,
      null,
      '',
      () => {},
      () => {},
      () => {},
      null,
    );
    act(() => {
      Renderer.updateContainer(
        <a>
          <b />
        </a>,
        container,
        /* parentComponent: */ null,
        /* callback: */ null,
      );
    });
  });
});
