/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 用 Navigation API 为 React 默认 Transition 驱动浏览器加载指示器。
 *
 * 函数启动指向当前地址的可拦截 replace 导航，并返回幂等清理函数。真实路由器可通过
 * `info === 'react-transition'` 忽略该伪导航；若平台没有 Navigation API，则安全降级。
 */
export function defaultOnDefaultTransitionIndicator(): void | (() => void) {
  if (typeof navigation !== 'object') {
    // Navigation API 不可用时不能驱动浏览器指示器，直接退化为空操作。
    return;
  }

  let isCancelled = false;
  let pendingResolve: null | (() => void) = null;

  /** 拦截本模块发起的伪导航，并用待决 Promise 维持导航进行态。 */
  function handleNavigate(event: NavigateEvent) {
    if (event.canIntercept && event.info === 'react-transition') {
      event.intercept({
        /** 返回由完成/取消路径统一解除的 Promise。 */
        handler() {
          return new Promise(resolve => (pendingResolve = resolve));
        },
        focusReset: 'manual',
        scroll: 'manual',
      });
    }
  }

  /**
   * 收束一次导航并在 Transition 尚未取消时续接下一次伪导航。
   *
   * 无论完成事件是否来自本模块，都先解除旧 Promise，防止 Navigation transition
   * 永久悬挂；随后用异步间隔避开 Chromium 连续导航竞态。
   */
  function handleNavigateComplete() {
    if (pendingResolve !== null) {
      // 若完成的不是本模块导航，旧伪导航大概率已被外部导航取消；先解除它，再在下方续接。
      pendingResolve();
      pendingResolve = null;
    }
    if (!isCancelled) {
      // 外部导航虽已完成，但 React Transition 仍在运行；延迟续接以保持加载指示器。
      // 必须留出异步间隔，以规避 https://issues.chromium.org/u/1/issues/419746417。
      setTimeout(startFakeNavigation, 20);
    }
  }

  // $FlowFixMe[incompatible-type]
  navigation.addEventListener('navigate', handleNavigate);
  // $FlowFixMe[incompatible-type]
  navigation.addEventListener('navigatesuccess', handleNavigateComplete);
  // $FlowFixMe[incompatible-type]
  navigation.addEventListener('navigateerror', handleNavigateComplete);

  /** 在没有真实导航占用槽位时，发起一次指向当前页面的 replace 伪导航。 */
  function startFakeNavigation() {
    if (isCancelled) {
      // Transition 已经停止，延迟任务不得重新启动导航。
      return;
    }
    if (navigation.transition) {
      // 已有真实导航进行中；等待其完成事件触发续接，避免覆盖用户导航。
      return;
    }
    // 用 replace 导航当前地址，不增加历史记录项。
    const currentEntry = navigation.currentEntry;
    if (currentEntry && currentEntry.url != null) {
      navigation.navigate(currentEntry.url, {
        state: currentEntry.getState(),
        info: 'react-transition', // 给路由器的标记：忽略这次仅用于指示器的导航。
        history: 'replace',
      });
    }
  }

  // 先等待一小段时间；快速 Transition 可在产生任何伪导航前结束。
  setTimeout(startFakeNavigation, 100);

  /**
   * 停止指示器，移除全部监听器并解除仍待决的拦截 Promise。
   * 清理顺序先置取消位，确保已排队的定时任务不会复活状态机。
   */
  return function () {
    isCancelled = true;
    // $FlowFixMe[incompatible-type]
    navigation.removeEventListener('navigate', handleNavigate);
    // $FlowFixMe[incompatible-type]
    navigation.removeEventListener('navigatesuccess', handleNavigateComplete);
    // $FlowFixMe[incompatible-type]
    navigation.removeEventListener('navigateerror', handleNavigateComplete);
    if (pendingResolve !== null) {
      pendingResolve();
      pendingResolve = null;
    }
  };
}
