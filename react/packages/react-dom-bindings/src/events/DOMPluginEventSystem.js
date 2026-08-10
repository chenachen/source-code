/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from './DOMEventNames';
import type {EventSystemFlags} from './EventSystemFlags';
import type {AnyNativeEvent} from './PluginModuleType';
import type {
  KnownReactSyntheticEvent,
  ReactSyntheticEvent,
} from './ReactSyntheticEventType';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';

import {allNativeEvents} from './EventRegistry';
import {
  SHOULD_NOT_DEFER_CLICK_FOR_FB_SUPPORT_MODE,
  IS_LEGACY_FB_SUPPORT_MODE,
  SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS,
  IS_CAPTURE_PHASE,
  IS_EVENT_HANDLE_NON_MANAGED_NODE,
  IS_NON_DELEGATED,
} from './EventSystemFlags';
import {isReplayingEvent} from './CurrentReplayingEvent';

import {
  HostRoot,
  HostPortal,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  ScopeComponent,
} from 'react-reconciler/src/ReactWorkTags';
import {getLowestCommonAncestor} from 'react-reconciler/src/ReactFiberTreeReflection';

import getEventTarget from './getEventTarget';
import {
  getClosestInstanceFromNode,
  getEventListenerSet,
  getEventHandlerListeners,
} from '../client/ReactDOMComponentTree';
import {COMMENT_NODE, DOCUMENT_NODE} from '../client/HTMLNodeType';
import {batchedUpdates} from './ReactDOMUpdateBatching';
import getListener from './getListener';
import {passiveBrowserEventsSupported} from './checkPassiveEvents';

import {
  enableLegacyFBSupport,
  enableCreateEventHandleAPI,
  enableScopeAPI,
  disableCommentsAsDOMContainers,
  enableScrollEndPolyfill,
} from 'shared/ReactFeatureFlags';
import {createEventListenerWrapperWithPriority} from './ReactDOMEventListener';
import {
  removeEventListener,
  addEventCaptureListener,
  addEventBubbleListener,
  addEventBubbleListenerWithPassiveFlag,
  addEventCaptureListenerWithPassiveFlag,
} from './EventListener';
import * as BeforeInputEventPlugin from './plugins/BeforeInputEventPlugin';
import * as ChangeEventPlugin from './plugins/ChangeEventPlugin';
import * as EnterLeaveEventPlugin from './plugins/EnterLeaveEventPlugin';
import * as SelectEventPlugin from './plugins/SelectEventPlugin';
import * as SimpleEventPlugin from './plugins/SimpleEventPlugin';
import * as FormActionEventPlugin from './plugins/FormActionEventPlugin';
import * as ScrollEndEventPlugin from './plugins/ScrollEndEventPlugin';

import reportGlobalError from 'shared/reportGlobalError';

import {runWithFiberInDEV} from 'react-reconciler/src/ReactCurrentFiber';

/** DispatchListener 定义 Flow 数据形状，用于在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type DispatchListener = {
  /** DispatchListener.instance 描述在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  instance: null | Fiber,
  /** DispatchListener.listener 描述在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  listener: Function,
  /** DispatchListener.currentTarget 描述在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  currentTarget: EventTarget,
};

/** DispatchEntry 定义 Flow 数据形状，用于在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type DispatchEntry = {
  /** DispatchEntry.event 描述在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  event: ReactSyntheticEvent,
  /** DispatchEntry.listeners 描述在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  listeners: Array<DispatchListener>,
};

/** DispatchQueue 定义 Flow 数据形状，用于在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type DispatchQueue = Array<DispatchEntry>;

// TODO：移除顶层副作用。
SimpleEventPlugin.registerEvents();
EnterLeaveEventPlugin.registerEvents();
ChangeEventPlugin.registerEvents();
SelectEventPlugin.registerEvents();
BeforeInputEventPlugin.registerEvents();
if (enableScrollEndPolyfill) {
  ScrollEndEventPlugin.registerEvents();
}

/** extractEvents 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
) {
  // TODO：应移除“SimpleEventPlugin”这一独立概念。
  // 它承载事件系统的基础能力；其他
  // 插件本质上都是 polyfill，因此该插件
  // 应内联到核心路径，让其逻辑
  // 直接成为事件系统核心，从而允许
  // 发布不包含下方 polyfill 插件的 React 构建。
  SimpleEventPlugin.extractEvents(
    dispatchQueue,
    domEventName,
    targetInst,
    nativeEvent,
    nativeEventTarget,
    eventSystemFlags,
    targetContainer,
  );
  const shouldProcessPolyfillPlugins =
    (eventSystemFlags & SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS) === 0;
  // 只有处于原生事件
  // “bubble”阶段（即非 capture）时才处理这些事件，
  // 因为这里仍通过模拟实现
  // capture 阶段。这是一项折中：
  // 理想情况下应像 SimpleEvent
  // 插件一样直接使用正确的原生阶段，
  // 但下方插件要么依赖
  // 阶段模拟（EnterLeave），要么使用插件内部
  // 状态（BeforeInput、Change、Select）。这些
  // 模块状态使捕获阶段可能先改变
  // 启发式条件，随后到达的
  // bubble 事件便可能
  // 因为状态已变化而
  // 不再触发。虽然可以
  // 重写全部插件以适配原生阶段，
  // 但可能产生目前无法
  // 预见的副作用。
  if (shouldProcessPolyfillPlugins) {
    EnterLeaveEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
    ChangeEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
    SelectEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
    BeforeInputEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
    FormActionEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
  }
  if (enableScrollEndPolyfill) {
    ScrollEndEventPlugin.extractEvents(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
      eventSystemFlags,
      targetContainer,
    );
  }
}

// 以下事件必须单独绑定到媒体元素。
/** mediaEventTypes 保存在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const mediaEventTypes: Array<DOMEventName> = [
  'abort',
  'canplay',
  'canplaythrough',
  'durationchange',
  'emptied',
  'encrypted',
  'ended',
  'error',
  'loadeddata',
  'loadedmetadata',
  'loadstart',
  'pause',
  'play',
  'playing',
  'progress',
  'ratechange',
  'resize',
  'seeked',
  'seeking',
  'stalled',
  'suspend',
  'timeupdate',
  'volumechange',
  'waiting',
];

// 这些事件不应委托到容器，而应
// 直接绑定真实 target，主要因为
// 它们在 DOM 中并不稳定冒泡。
/** nonDelegatedEvents 保存在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const nonDelegatedEvents: Set<DOMEventName> = new Set([
  'beforetoggle',
  'cancel',
  'close',
  'invalid',
  'load',
  'scroll',
  'scrollend',
  'toggle',
  // 为减少字节数，把上方媒体事件数组
  // 插入该 Set。“error”并非媒体专属事件，
  // 也会出现在其他元素；无需重复声明，
  // 直接复用媒体事件数组中的条目。
  ...mediaEventTypes,
]);

/** executeDispatch 执行在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function executeDispatch(
  event: ReactSyntheticEvent,
  listener: Function,
  currentTarget: EventTarget,
): void {
  event.currentTarget = currentTarget;
  try {
    listener(event);
  } catch (error) {
    reportGlobalError(error);
  }
  event.currentTarget = null;
}

/** processDispatchQueueItemsInOrder 推进在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
function processDispatchQueueItemsInOrder(
  event: ReactSyntheticEvent,
  dispatchListeners: Array<DispatchListener>,
  inCapturePhase: boolean,
): void {
  let previousInstance;
  if (inCapturePhase) {
    for (let i = dispatchListeners.length - 1; i >= 0; i--) {
      const {instance, currentTarget, listener} = dispatchListeners[i];
      if (instance !== previousInstance && event.isPropagationStopped()) {
        return;
      }
      if (__DEV__ && instance !== null) {
        runWithFiberInDEV(
          instance,
          executeDispatch,
          event,
          listener,
          currentTarget,
        );
      } else {
        executeDispatch(event, listener, currentTarget);
      }
      previousInstance = instance;
    }
  } else {
    for (let i = 0; i < dispatchListeners.length; i++) {
      const {instance, currentTarget, listener} = dispatchListeners[i];
      if (instance !== previousInstance && event.isPropagationStopped()) {
        return;
      }
      if (__DEV__ && instance !== null) {
        runWithFiberInDEV(
          instance,
          executeDispatch,
          event,
          listener,
          currentTarget,
        );
      } else {
        executeDispatch(event, listener, currentTarget);
      }
      previousInstance = instance;
    }
  }
}

/** processDispatchQueue 推进在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
export function processDispatchQueue(
  dispatchQueue: DispatchQueue,
  eventSystemFlags: EventSystemFlags,
): void {
  const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;
  for (let i = 0; i < dispatchQueue.length; i++) {
    const {event, listeners} = dispatchQueue[i];
    processDispatchQueueItemsInOrder(event, listeners, inCapturePhase);
    // 现代事件系统不使用事件池。
  }
}

/** dispatchEventsForPlugins 推进在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
function dispatchEventsForPlugins(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  nativeEvent: AnyNativeEvent,
  targetInst: null | Fiber,
  targetContainer: EventTarget,
): void {
  const nativeEventTarget = getEventTarget(nativeEvent);
  const dispatchQueue: DispatchQueue = [];
  extractEvents(
    dispatchQueue,
    domEventName,
    targetInst,
    nativeEvent,
    nativeEventTarget,
    eventSystemFlags,
    targetContainer,
  );
  processDispatchQueue(dispatchQueue, eventSystemFlags);
}

/** listenToNonDelegatedEvent 管理在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function listenToNonDelegatedEvent(
  domEventName: DOMEventName,
  targetElement: Element,
): void {
  if (__DEV__) {
    if (!nonDelegatedEvents.has(domEventName)) {
      console.error(
        'Did not expect a listenToNonDelegatedEvent() call for "%s". ' +
          'This is a bug in React. Please file an issue.',
        domEventName,
      );
    }
  }
  const isCapturePhaseListener = false;
  const listenerSet = getEventListenerSet(targetElement);
  const listenerSetKey = getListenerSetKey(
    domEventName,
    isCapturePhaseListener,
  );
  if (!listenerSet.has(listenerSetKey)) {
    addTrappedEventListener(
      targetElement,
      domEventName,
      IS_NON_DELEGATED,
      isCapturePhaseListener,
    );
    listenerSet.add(listenerSetKey);
  }
}

/** listenToNativeEvent 管理在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function listenToNativeEvent(
  domEventName: DOMEventName,
  isCapturePhaseListener: boolean,
  target: EventTarget,
): void {
  if (__DEV__) {
    if (nonDelegatedEvents.has(domEventName) && !isCapturePhaseListener) {
      console.error(
        'Did not expect a listenToNativeEvent() call for "%s" in the bubble phase. ' +
          'This is a bug in React. Please file an issue.',
        domEventName,
      );
    }
  }

  let eventSystemFlags = 0;
  if (isCapturePhaseListener) {
    eventSystemFlags |= IS_CAPTURE_PHASE;
  }
  addTrappedEventListener(
    target,
    domEventName,
    eventSystemFlags,
    isCapturePhaseListener,
  );
}

// 仅 createEventHandle 在
// target 不是 DOM 元素（例如 window）时使用。
/** listenToNativeEventForNonManagedEventTarget 管理在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function listenToNativeEventForNonManagedEventTarget(
  domEventName: DOMEventName,
  isCapturePhaseListener: boolean,
  target: EventTarget,
): void {
  let eventSystemFlags: number = IS_EVENT_HANDLE_NON_MANAGED_NODE;
  const listenerSet = getEventListenerSet(target);
  const listenerSetKey = getListenerSetKey(
    domEventName,
    isCapturePhaseListener,
  );
  if (!listenerSet.has(listenerSetKey)) {
    if (isCapturePhaseListener) {
      eventSystemFlags |= IS_CAPTURE_PHASE;
    }
    addTrappedEventListener(
      target,
      domEventName,
      eventSystemFlags,
      isCapturePhaseListener,
    );
    listenerSet.add(listenerSetKey);
  }
}

/** listeningMarker 保存在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const listeningMarker = '_reactListening' + Math.random().toString(36).slice(2);

/** listenToAllSupportedEvents 管理在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function listenToAllSupportedEvents(rootContainerElement: EventTarget) {
  if (!(rootContainerElement as any)[listeningMarker]) {
    (rootContainerElement as any)[listeningMarker] = true;
    allNativeEvents.forEach(domEventName => {
      // selectionchange 不冒泡且必须绑定到 document，
      // 因此单独处理。
      if (domEventName !== 'selectionchange') {
        if (!nonDelegatedEvents.has(domEventName)) {
          listenToNativeEvent(domEventName, false, rootContainerElement);
        }
        listenToNativeEvent(domEventName, true, rootContainerElement);
      }
    });
    const ownerDocument =
      (rootContainerElement as any).nodeType === DOCUMENT_NODE
        ? rootContainerElement
        : (rootContainerElement as any).ownerDocument;
    // $FlowFixMe[invalid-compare]
    if (ownerDocument !== null) {
      // selectionchange 同样需要去重，
      // 但它绑定在 document 上。
      if (!(ownerDocument as any)[listeningMarker]) {
        (ownerDocument as any)[listeningMarker] = true;
        listenToNativeEvent('selectionchange', false, ownerDocument);
      }
    }
  }
}

/** addTrappedEventListener 管理在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
function addTrappedEventListener(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  isCapturePhaseListener: boolean,
  isDeferredListenerForLegacyFBSupport?: boolean,
) {
  let listener = createEventListenerWrapperWithPriority(
    targetContainer,
    domEventName,
    eventSystemFlags,
  );
  // 若不支持 passive 选项，事件会退化为
// 主动式 active listener。
  let isPassiveListener: void | boolean = undefined;
  if (passiveBrowserEventsSupported) {
    // 浏览器曾进行干预，让这些事件在 document 上
    // 默认 passive。React 现在不再绑定到
    // document，但若改变现有行为会损失
    // 此前获得的性能收益，因此在 root 上手动
    // 模拟旧行为。
    // 参考：https://github.com/facebook/react/issues/19651
    if (
      domEventName === 'touchstart' ||
      domEventName === 'touchmove' ||
      domEventName === 'wheel'
    ) {
      isPassiveListener = true;
    }
  }

  targetContainer =
    enableLegacyFBSupport && isDeferredListenerForLegacyFBSupport
      ? // Document 容器的 ownerDocument 为 null，必须把自身
        // 作为延迟 target。
        (targetContainer as any).nodeType === DOCUMENT_NODE
        ? targetContainer
        : (targetContainer as any).ownerDocument
      : targetContainer;

  let unsubscribeListener;
  // 启用 legacyFBSupport 时，需要在容器上添加
  // 一次性 listener。
  // 该路径只能配合 enableLegacyFBSupport，
  // 用于兼容内部 FB www
  // 事件工具；listener 首次调用后立即
  // 移除。也可尝试使用
  // addEventListener 的 {once: true}，
  // 但部分浏览器不支持；考虑到
  // 此功能服务于旧代码模式，
  // 这些浏览器很可能仍需
  // 兼容。
  if (enableLegacyFBSupport && isDeferredListenerForLegacyFBSupport) {
    const originalListener = listener;
    // $FlowFixMe[missing-this-annot]
    listener = function (...p) {
      removeEventListener(
        targetContainer,
        domEventName,
        unsubscribeListener,
        isCapturePhaseListener,
      );
      return originalListener.apply(this, p);
    };
  }
  // TODO：这里的选项组合过多，应合并简化。
  if (isCapturePhaseListener) {
    if (isPassiveListener !== undefined) {
      unsubscribeListener = addEventCaptureListenerWithPassiveFlag(
        targetContainer,
        domEventName,
        listener,
        isPassiveListener,
      );
    } else {
      unsubscribeListener = addEventCaptureListener(
        targetContainer,
        domEventName,
        listener,
      );
    }
  } else {
    if (isPassiveListener !== undefined) {
      unsubscribeListener = addEventBubbleListenerWithPassiveFlag(
        targetContainer,
        domEventName,
        listener,
        isPassiveListener,
      );
    } else {
      unsubscribeListener = addEventBubbleListener(
        targetContainer,
        domEventName,
        listener,
      );
    }
  }
}

/** deferClickToDocumentForLegacyFBSupport 执行在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function deferClickToDocumentForLegacyFBSupport(
  domEventName: DOMEventName,
  targetContainer: EventTarget,
): void {
  // legacy FB 支持模式会延迟全部 click。
  // 具体做法是添加一次性 listener，使其在
  // FB 委托 listener 执行后触发。
  const isDeferredListenerForLegacyFBSupport = true;
  addTrappedEventListener(
    targetContainer,
    domEventName,
    IS_LEGACY_FB_SUPPORT_MODE,
    false,
    isDeferredListenerForLegacyFBSupport,
  );
}

/** isMatchingRootContainer 判断在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isMatchingRootContainer(
  grandContainer: Element,
  targetContainer: EventTarget,
): boolean {
  return (
    grandContainer === targetContainer ||
    (!disableCommentsAsDOMContainers &&
      grandContainer.nodeType === COMMENT_NODE &&
      grandContainer.parentNode === targetContainer)
  );
}

/** dispatchEventForPluginEventSystem 推进在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
export function dispatchEventForPluginEventSystem(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  nativeEvent: AnyNativeEvent,
  targetInst: null | Fiber,
  targetContainer: EventTarget,
): void {
  let ancestorInst = targetInst;
  if (
    (eventSystemFlags & IS_EVENT_HANDLE_NON_MANAGED_NODE) === 0 &&
    (eventSystemFlags & IS_NON_DELEGATED) === 0
  ) {
    const targetContainerNode = targetContainer as any as Node;

    // 启用 legacy FB 标志时，
    // 通过一个一次性 listener
    // 把事件延迟到空 target 路径。
    if (
      enableLegacyFBSupport &&
      // 若事件 flags 满足进入
      // FB legacy 模式的条件，且当前处理“click”，
      // 可把事件延迟到“document”，以兼容
      // FB 旧行为：
      // React 16 以前把 click 委托到 document。
      domEventName === 'click' &&
      (eventSystemFlags & SHOULD_NOT_DEFER_CLICK_FOR_FB_SUPPORT_MODE) === 0 &&
      !isReplayingEvent(nativeEvent)
    ) {
      deferClickToDocumentForLegacyFBSupport(domEventName, targetContainer);
      return;
    }
    if (targetInst !== null) {
      // 下方逻辑判断是否需要把
      // target Fiber 改为另一祖先。旧事件系统也有类似逻辑，
      // 但现代系统的关键差异是
      // 每个 React Root 与 Portal Root
      // 都安装独立 listener；代表这些 root 的
      // DOM 节点统称“rootContainer”。
      // 为确定应使用的祖先实例，从 target 向上遍历
      // Fiber 树，寻找与当前
      // “rootContainer”匹配的 root 边界。
      // 找到后定位该 root 所属的父 Fiber
      // 子树，并把它作为事件祖先实例。
      let node: null | Fiber = targetInst;

      mainLoop: while (true) {
        if (node === null) {
          return;
        }
        const nodeTag = node.tag;
        if (nodeTag === HostRoot || nodeTag === HostPortal) {
          let container = node.stateNode.containerInfo;
          if (isMatchingRootContainer(container, targetContainerNode)) {
            break;
          }
          if (nodeTag === HostPortal) {
            // target 是 portal，但不是当前寻找的 rootContainer。
            // 通常 portal 会自行把事件一路处理到 root。
            // 此处理论上可停止，但还不能确定该 portal
            // 是否属于当前 root。
            let grandNode = node.return;
            while (grandNode !== null) {
              const grandTag = grandNode.tag;
              if (grandTag === HostRoot || grandTag === HostPortal) {
                const grandContainer = grandNode.stateNode.containerInfo;
                if (
                  isMatchingRootContainer(grandContainer, targetContainerNode)
                ) {
                  // 这正是目标 rootContainer，并且它是
                  // Portal 的祖先；可直接忽略，因为
                  // Portal 最终会向当前系统冒泡。
                  return;
                }
              }
              grandNode = grandNode.return;
            }
          }
          // 现在需要在另一棵 Fiber 树中找到对应 host Fiber。
          // 可使用 getClosestInstanceFromNode，但必须
          // 验证结果确为 host instance；否则
          // 继续沿 DOM 向上，直到找到来自另一棵树的
          // 正确节点。
          while (container !== null) {
            const parentNode = getClosestInstanceFromNode(container);
            if (parentNode === null) {
              return;
            }
            const parentTag = parentNode.tag;
            if (
              parentTag === HostComponent ||
              parentTag === HostText ||
              parentTag === HostHoistable ||
              parentTag === HostSingleton
            ) {
              node = ancestorInst = parentNode;
              continue mainLoop;
            }
            container = container.parentNode;
          }
        }
        node = node.return;
      }
    }
  }

  batchedUpdates(() =>
    dispatchEventsForPlugins(
      domEventName,
      eventSystemFlags,
      nativeEvent,
      ancestorInst,
      targetContainer,
    ),
  );
}

/** createDispatchListener 为在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
function createDispatchListener(
  instance: null | Fiber,
  listener: Function,
  currentTarget: EventTarget,
): DispatchListener {
  return {
    instance,
    listener,
    currentTarget,
  };
}

/** accumulateSinglePhaseListeners 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
export function accumulateSinglePhaseListeners(
  targetFiber: Fiber | null,
  reactName: string | null,
  nativeEventType: string,
  inCapturePhase: boolean,
  accumulateTargetOnly: boolean,
  nativeEvent: AnyNativeEvent,
): Array<DispatchListener> {
  const captureName = reactName !== null ? reactName + 'Capture' : null;
  const reactEventName = inCapturePhase ? captureName : reactName;
  let listeners: Array<DispatchListener> = [];

  let instance = targetFiber;
  let lastHostComponent = null;

  // 沿 target → root 路径累积实例与 listener。
  while (instance !== null) {
    const {stateNode, tag} = instance;
    // 处理 HostComponent（例如 <div>）上的 listener。
    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      stateNode !== null
    ) {
      lastHostComponent = stateNode;

      // 处理 createEventHandle listener。
      if (enableCreateEventHandleAPI) {
        const eventHandlerListeners =
          getEventHandlerListeners(lastHostComponent);
        if (eventHandlerListeners !== null) {
          eventHandlerListeners.forEach(entry => {
            if (
              entry.type === nativeEventType &&
              entry.capture === inCapturePhase
            ) {
              listeners.push(
                createDispatchListener(
                  instance,
                  entry.callback,
                  lastHostComponent as any,
                ),
              );
            }
          });
        }
      }

      // 处理标准 React on* listener，例如 onClick/onClickCapture。
      if (reactEventName !== null) {
        const listener = getListener(instance, reactEventName);
        if (listener != null) {
          listeners.push(
            createDispatchListener(instance, listener, lastHostComponent),
          );
        }
      }
    } else if (
      enableCreateEventHandleAPI &&
      enableScopeAPI &&
      tag === ScopeComponent &&
      lastHostComponent !== null &&
      stateNode !== null
    ) {
      // 处理 Scope listener。
      const reactScopeInstance = stateNode;
      const eventHandlerListeners =
        getEventHandlerListeners(reactScopeInstance);
      if (eventHandlerListeners !== null) {
        eventHandlerListeners.forEach(entry => {
          if (
            entry.type === nativeEventType &&
            entry.capture === inCapturePhase
          ) {
            listeners.push(
              createDispatchListener(
                instance,
                entry.callback,
                lastHostComponent as any,
              ),
            );
          }
        });
      }
    }
    // 若只为 target 本身累积事件，
    // 就不再沿 React Fiber 树继续传播查找其他
    // 其他 listener。
    if (accumulateTargetOnly) {
      break;
    }
    // 处理 onBeforeBlur 时，必须考虑
    // 部分 React 树可能已隐藏
    // 或删除，因为事件在 commit 期间调用。可通过
    // 比较事件上的 intercept Fiber 与
    // 当前实例 Fiber 判断；若匹配，应清空此前累积的
    // 已累积的 listener。
    if (enableCreateEventHandleAPI && nativeEvent.type === 'beforeblur') {
      // $FlowFixMe[prop-missing] internal field
      const detachedInterceptFiber = nativeEvent._detachedInterceptFiber;
      if (
        detachedInterceptFiber !== null &&
        (detachedInterceptFiber === instance ||
          detachedInterceptFiber === instance.alternate)
      ) {
        listeners = [];
      }
    }
    instance = instance.return;
  }
  return listeners;
}

// 该函数仅供以下插件使用：
  // - BeforeInputEventPlugin 插件
  // - ChangeEventPlugin 插件
  // - SelectEventPlugin 插件
  // - ScrollEndEventPlugin 插件
// 因为这些插件只在 bubble 阶段处理，
// 因此需要累积
// 两阶段 listener。
/** accumulateTwoPhaseListeners 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
export function accumulateTwoPhaseListeners(
  targetFiber: Fiber | null,
  reactName: string,
): Array<DispatchListener> {
  const captureName = reactName + 'Capture';
  const listeners: Array<DispatchListener> = [];
  let instance = targetFiber;

  // 沿 target → root 路径累积实例与 listener。
  while (instance !== null) {
    const {stateNode, tag} = instance;
    // 处理 HostComponent（例如 <div>）上的 listener。
    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      stateNode !== null
    ) {
      const currentTarget = stateNode;
      const captureListener = getListener(instance, captureName);
      if (captureListener != null) {
        listeners.unshift(
          createDispatchListener(instance, captureListener, currentTarget),
        );
      }
      const bubbleListener = getListener(instance, reactName);
      if (bubbleListener != null) {
        listeners.push(
          createDispatchListener(instance, bubbleListener, currentTarget),
        );
      }
    }
    if (instance.tag === HostRoot) {
      return listeners;
    }
    instance = instance.return;
  }
  // 若遍历未到达 root，说明 target 已卸载，
  // 不应向其分发事件。
  return [];
}

/** getParent 查询并返回在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getParent(inst: Fiber | null): Fiber | null {
  if (inst === null) {
    return null;
  }
  do {
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    inst = inst.return;
    // TODO：若当前是 HostRoot，可能应提前退出。
    // 取决于是否允许嵌套子树（layer）把事件冒泡到
    // 父级。也可沿 host node 的 parentNode
    // 遍历，但该方案不适用于 React Native，且无法支持
      // Portal 能力。
  } while (inst && inst.tag !== HostComponent && inst.tag !== HostSingleton);
  if (inst) {
    return inst;
  }
  return null;
}

/** accumulateEnterLeaveListenersForEvent 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
function accumulateEnterLeaveListenersForEvent(
  dispatchQueue: DispatchQueue,
  event: KnownReactSyntheticEvent,
  target: Fiber,
  common: Fiber | null,
  inCapturePhase: boolean,
): void {
  const registrationName = event._reactName;
  const listeners: Array<DispatchListener> = [];

  let instance: null | Fiber = target;
  while (instance !== null) {
    if (instance === common) {
      break;
    }
    const {alternate, stateNode, tag} = instance;
    if (alternate !== null && alternate === common) {
      break;
    }
    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      stateNode !== null
    ) {
      const currentTarget = stateNode;
      if (inCapturePhase) {
        const captureListener = getListener(instance, registrationName);
        if (captureListener != null) {
          listeners.unshift(
            createDispatchListener(instance, captureListener, currentTarget),
          );
        }
        // $FlowFixMe[constant-condition]
      } else if (!inCapturePhase) {
        const bubbleListener = getListener(instance, registrationName);
        if (bubbleListener != null) {
          listeners.push(
            createDispatchListener(instance, bubbleListener, currentTarget),
          );
        }
      }
    }
    instance = instance.return;
  }
  if (listeners.length !== 0) {
    dispatchQueue.push({event, listeners});
  }
}

// 该函数仅供以下插件使用：
  // - EnterLeaveEventPlugin 插件
// 该插件只在 bubble 阶段处理，
// 因此需要累积
// 两阶段 listener。
/** accumulateEnterLeaveTwoPhaseListeners 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
export function accumulateEnterLeaveTwoPhaseListeners(
  dispatchQueue: DispatchQueue,
  leaveEvent: KnownReactSyntheticEvent,
  enterEvent: null | KnownReactSyntheticEvent,
  from: Fiber | null,
  to: Fiber | null,
): void {
  const common =
    from && to ? getLowestCommonAncestor(from, to, getParent) : null;

  if (from !== null) {
    accumulateEnterLeaveListenersForEvent(
      dispatchQueue,
      leaveEvent,
      from,
      common,
      false,
    );
  }
  if (to !== null && enterEvent !== null) {
    accumulateEnterLeaveListenersForEvent(
      dispatchQueue,
      enterEvent,
      to,
      common,
      true,
    );
  }
}

/** accumulateEventHandleNonManagedNodeListeners 从原生事件和 Fiber 路径收集在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需数据；只生成满足插件条件的 listener/event。 */
export function accumulateEventHandleNonManagedNodeListeners(
  reactEventType: DOMEventName,
  currentTarget: EventTarget,
  inCapturePhase: boolean,
): Array<DispatchListener> {
  const listeners: Array<DispatchListener> = [];

  const eventListeners = getEventHandlerListeners(currentTarget);
  if (eventListeners !== null) {
    eventListeners.forEach(entry => {
      if (entry.type === reactEventType && entry.capture === inCapturePhase) {
        listeners.push(
          createDispatchListener(null, entry.callback, currentTarget),
        );
      }
    });
  }
  return listeners;
}

/** getListenerSetKey 查询并返回在根/portal 容器上安装监听器，选择插件并沿 Fiber 路径累积、批量分发事件所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
export function getListenerSetKey(
  domEventName: DOMEventName,
  capture: boolean,
): string {
  return `${domEventName}__${capture ? 'capture' : 'bubble'}`;
}
