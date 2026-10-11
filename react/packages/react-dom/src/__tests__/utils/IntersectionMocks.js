/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/** 共享一个 callback 与观察目标数组；此桩只模拟单观察器，不计算布局或自动触发通知。 */
const intersectionObserverMock = {callback: null, observedTargets: []};

/**
 * 这是一个不完整的 polyfill，只用于提供最低限度的测试覆盖；更有意义的测试需要使用真实 fixture。
 */
/** 清空上一轮 callback/targets并替换 window.IntersectionObserver；返回同一记录供测试查询，不自动保存或恢复原生构造器。 */
export function mockIntersectionObserver() {
  intersectionObserverMock.callback = null;
  intersectionObserverMock.observedTargets = [];

  /** 最低限度观察器桩；构造、observe/unobserve/disconnect直接更新共享记录而不实现真实浏览器队列。 */
  class IntersectionObserver {

    /** 保存第一个实参回调为共享通知入口；后建实例会覆盖前一个实例的 callback。 */
    constructor() {
      intersectionObserverMock.callback = arguments[0];
    }

    /** 清除共享回调并原地清空所有目标，模拟此桩的全局断连状态。 */
    disconnect() {
      intersectionObserverMock.callback = null;
      intersectionObserverMock.observedTargets.splice(0);
    }

    /** 把 target 追加到观察数组；此桩不去重，也不据此自动产生 entry。 */
    observe(target) {
      intersectionObserverMock.observedTargets.push(target);
    }

    /** 找到 target 的首个索引后移除一个条目；不存在时保持数组，避免 splice(-1)删末尾。 */
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

/** 把 [target,{x,y,width,height},ratio] 三元组转 IntersectionObserver entry并同步调用共享回调；调用者须先构造观察器，entries不按观察数组过滤。 */
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
/** 用给定 x/y/width/height 为目标覆盖矩形方法，每次返回派生的边界；无布局计算或自动恢复。 */
export function setBoundingClientRect(target, {x, y, width, height}) {
  /** 读取闭包中的固定矩形，right/bottom 由起点加尺寸计算，模拟测试选择器的宿主测量。 */
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
/** 以 rects 数组覆盖目标的多片段矩形方法；每次调用映射为新对象，保留输入顺序。 */
export function setClientRects(target, rects) {
  /** 把每个输入矩形展开为含 x/y和四边的 ClientRect形状，作为 Fragment 多宿主结果。 */
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
 * 包装 document.createRange，为每个 Range 补上 getClientRects/getBoundingClientRect；
 * 在 beforeEach 中调用，以使用指定 rects 替代 jsdom 缺少的布局结果。
 */
/** 保存原 createRange后包装新 Range 的两个布局方法；默认给单个100×20矩形，返回 restore供调用方恢复工厂，不自动恢复已经创建的 Range。 */
export function mockRangeClientRects(
  rects = [{x: 0, y: 0, width: 100, height: 20}],
) {
  const originalCreateRange = document.createRange;
  /** 按原 document接收者创建 Range，只替换此实例布局方法，其余 Range 行为由 jsdom原对象提供。 */
  document.createRange = function () {
    const range = originalCreateRange.call(document);
    /** 按传入 rects 顺序返回新矩形对象数组，模拟 Range 多片段布局。 */
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
    /** 无矩形时返回全零边界；有矩形时仅取第一项并派生四边，本桩没有合并所有片段的外接框。 */
    range.getBoundingClientRect = function () {
      // 此桩只返回第一项矩形；未实现真实 Range 对多个片段求外接范围。
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
  return /** 把 document.createRange 恢复为包装前工厂；已创建 Range 上的桩方法保留。 */ function restore() {
    document.createRange = originalCreateRange;
  };
}
