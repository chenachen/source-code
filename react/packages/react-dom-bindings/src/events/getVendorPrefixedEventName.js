/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {canUseDOM} from 'shared/ExecutionEnvironment';

/**
 * 根据 style 属性与事件名生成标准厂商前缀映射。
 * 
 * @param {string} styleProp 需要探测的 CSS 属性名。
 * @param {string} eventName 对应的标准事件名。
 * @returns {object} 属性名到原生事件名的映射。
 */
/** makePrefixMap 执行探测动画/过渡事件的浏览器前缀并缓存标准事件名的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function makePrefixMap(styleProp, eventName) {
  const prefixes = {};

  prefixes[styleProp.toLowerCase()] = eventName.toLowerCase();
  prefixes['Webkit' + styleProp] = 'webkit' + eventName;
  prefixes['Moz' + styleProp] = 'moz' + eventName;

  return prefixes;
}

/**
 * 事件名到可配置厂商前缀列表的映射。
 */
/** vendorPrefixes 是探测动画/过渡事件的浏览器前缀并缓存标准事件名使用的稳定常量，避免在热路径重复分配或推导。 */
const vendorPrefixes = {
  animationend: makePrefixMap('Animation', 'AnimationEnd'),
  animationiteration: makePrefixMap('Animation', 'AnimationIteration'),
  animationstart: makePrefixMap('Animation', 'AnimationStart'),
  transitionrun: makePrefixMap('Transition', 'TransitionRun'),
  transitionstart: makePrefixMap('Transition', 'TransitionStart'),
  transitioncancel: makePrefixMap('Transition', 'TransitionCancel'),
  transitionend: makePrefixMap('Transition', 'TransitionEnd'),
};

/**
 * 缓存已经探测并在需要时添加前缀的事件名。
 */
/** prefixedEventNames 保存探测动画/过渡事件的浏览器前缀并缓存标准事件名所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const prefixedEventNames = {};

/**
 * 用于探测前缀的临时元素。
 */
let style = {};

/**
 * 仅在 DOM 存在时执行初始化探测。
 */
if (canUseDOM) {
  style = document.createElement('div').style;

  // 部分平台（尤其某些 Android 4.x 版本）
  // 虽然 style 对象定义了无前缀的“animation”和“transition”属性，
  // 实际触发的事件仍带前缀，因此必须
  // 验证无前缀事件是否可用，不可用时从映射中删除。
  if (!('AnimationEvent' in window)) {
    delete vendorPrefixes.animationend.animation;
    delete vendorPrefixes.animationiteration.animation;
    delete vendorPrefixes.animationstart.animation;
  }

  // 原因同上。
  if (!('TransitionEvent' in window)) {
    delete vendorPrefixes.transitionend.transition;
  }
}

/**
 * 尝试确定正确的厂商前缀事件名。
 * 
 * @param {string} eventName 标准事件名。
 * @returns {string} 当前浏览器实际使用的事件名。
 */
/** getVendorPrefixedEventName 查询并返回探测动画/过渡事件的浏览器前缀并缓存标准事件名所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getVendorPrefixedEventName(eventName) {
  if (prefixedEventNames[eventName]) {
    return prefixedEventNames[eventName];
  } else if (!vendorPrefixes[eventName]) {
    return eventName;
  }

  const prefixMap = vendorPrefixes[eventName];

  for (const styleProp in prefixMap) {
    if (prefixMap.hasOwnProperty(styleProp) && styleProp in style) {
      return (prefixedEventNames[eventName] = prefixMap[styleProp]);
    }
  }

  return eventName;
}

export default getVendorPrefixedEventName;
