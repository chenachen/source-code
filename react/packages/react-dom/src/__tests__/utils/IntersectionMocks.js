/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/** `intersectionObserverMock`：保存当前测试场景复用的夹具、状态或回调。 */
const intersectionObserverMock = {callback: null, observedTargets: []};

/**
 * 这是一个不完整的 polyfill，只用于提供最低限度的测试覆盖；更有意义的测试需要使用真实 fixture。
 */
export function mockIntersectionObserver() {
  intersectionObserverMock.callback = null;
  intersectionObserverMock.observedTargets = [];

  /** `mockIntersectionObserver.IntersectionObserver`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
  class IntersectionObserver {
    /** `IntersectionObserver.constructor`：初始化测试夹具实例及其状态。 */
    constructor() {
      intersectionObserverMock.callback = arguments[0];
    }

    /** `IntersectionObserver.disconnect`：实现测试夹具的生命周期、渲染或交互步骤。 */
    disconnect() {
      intersectionObserverMock.callback = null;
      intersectionObserverMock.observedTargets.splice(0);
    }

    /** `IntersectionObserver.observe`：实现测试夹具的生命周期、渲染或交互步骤。 */
    observe(target) {
      intersectionObserverMock.observedTargets.push(target);
    }

    /** `IntersectionObserver.unobserve`：实现测试夹具的生命周期、渲染或交互步骤。 */
    unobserve(target) {
      const index = intersectionObserverMock.observedTargets.indexOf(target);
      if (index >= 0) {
        intersectionObserverMock.observedTargets.splice(index, 1);
      }
    }
  }

  window.IntersectionObserver = IntersectionObserver;

  return intersectionObserverMock;
}

/** `simulateIntersection`：封装当前用例复用的操作、回调或断言步骤。 */
export function simulateIntersection(...entries) {
  intersectionObserverMock.callback(
    entries.map(([target, rect, ratio]) => ({
      boundingClientRect: {
        top: rect.y,
        left: rect.x,
        width: rect.width,
        height: rect.height,
      },
      intersectionRatio: ratio,
      target,
    })),
  );
}

/**
 * 为指定目标提供 getBoundingClientRect 桩实现。测试选择器依赖此 API，但 jsdom 没有实现它。
 */
export function setBoundingClientRect(target, {x, y, width, height}) {
  target.getBoundingClientRect = function () {
    return {
      width,
      height,
      left: x,
      right: x + width,
      top: y,
      bottom: y + height,
    };
  };
}

/** 为指定目标提供 getClientRects 桩实现。 */
export function setClientRects(target, rects) {
  target.getClientRects = function () {
    return rects.map(({x, y, width, height}) => ({
      width,
      height,
      left: x,
      right: x + width,
      top: y,
      bottom: y + height,
      x,
      y,
    }));
  };
}

/**
 * 模拟 Range.prototype.getClientRects 并获取BoundingClientRect，因为 jsdom 不实现它们。 调用此
 * 方法在 beforeEach 中设置模拟。
 */
export function mockRangeClientRects(
  rects = [{x: 0, y: 0, width: 100, height: 20}],
) {
  const originalCreateRange = document.createRange;
  document.createRange = function () {
    const range = originalCreateRange.call(document);
    range.getClientRects = function () {
      return rects.map(({x, y, width, height}) => ({
        width,
        height,
        left: x,
        right: x + width,
        top: y,
        bottom: y + height,
        x,
        y,
      }));
    };
    range.getBoundingClientRect = function () {
      // 返回所有直径的边界直线
      if (rects.length === 0) {
        return {
          width: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          x: 0,
          y: 0,
        };
      }
      const first = rects[0];
      return {
        width: first.width,
        height: first.height,
        left: first.x,
        right: first.x + first.width,
        top: first.y,
        bottom: first.y + first.height,
        x: first.x,
        y: first.y,
      };
    };
    return range;
  };
  return function restore() {
    document.createRange = originalCreateRange;
  };
}
