/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from '../../events/DOMEventNames';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {AnyNativeEvent} from '../../events/PluginModuleType';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {ReactSyntheticEvent} from '../ReactSyntheticEventType';

import {canUseDOM} from 'shared/ExecutionEnvironment';

import {registerTwoPhaseEvent} from '../EventRegistry';
import {
  getData as FallbackCompositionStateGetData,
  initialize as FallbackCompositionStateInitialize,
  reset as FallbackCompositionStateReset,
} from '../FallbackCompositionState';
import {
  SyntheticCompositionEvent,
  SyntheticInputEvent,
} from '../SyntheticEvent';
import {accumulateTwoPhaseListeners} from '../DOMPluginEventSystem';

/** END_KEYCODES 保存统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const END_KEYCODES = [9, 13, 27, 32]; // 控制键包括 Tab、Return、Esc、Space。
/** START_KEYCODE 保存统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const START_KEYCODE = 229;

/** canUseCompositionEvent 保存统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const canUseCompositionEvent = canUseDOM && 'CompositionEvent' in window;

let documentMode = null;
if (canUseDOM && 'documentMode' in document) {
  documentMode = document.documentMode;
}

// WebKit 提供实用的 `textInput`，可直接表示
// `beforeInput`；IE 的 `textinput` 实用性较差，
// 因此不使用。
/** canUseTextInputEvent 保存统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const canUseTextInputEvent =
  canUseDOM && 'TextEvent' in window && !documentMode;

// IE9+ 支持 composition 事件，但原生
// compositionend 提供的数据可能错误，例如日文表意
// 空格（\u3000）无法正确记录。
/** useFallbackCompositionData 是统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异使用的稳定常量，避免在热路径重复分配或推导。 */
const useFallbackCompositionData =
  canUseDOM &&
  (!canUseCompositionEvent ||
    (documentMode && documentMode > 8 && documentMode <= 11));

/** SPACEBAR_CODE 是统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异使用的稳定常量，避免在热路径重复分配或推导。 */
const SPACEBAR_CODE = 32;
/** SPACEBAR_CHAR 是统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异使用的稳定常量，避免在热路径重复分配或推导。 */
const SPACEBAR_CHAR = String.fromCharCode(SPACEBAR_CODE);

/** registerEvents 管理统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
function registerEvents() {
  registerTwoPhaseEvent('onBeforeInput', [
    'compositionend',
    'keypress',
    'textInput',
    'paste',
  ]);
  registerTwoPhaseEvent('onCompositionEnd', [
    'compositionend',
    'focusout',
    'keydown',
    'keypress',
    'keyup',
    'mousedown',
  ]);
  registerTwoPhaseEvent('onCompositionStart', [
    'compositionstart',
    'focusout',
    'keydown',
    'keypress',
    'keyup',
    'mousedown',
  ]);
  registerTwoPhaseEvent('onCompositionUpdate', [
    'compositionupdate',
    'focusout',
    'keydown',
    'keypress',
    'keyup',
    'mousedown',
  ]);
}

// 记录是否已经处理过空格键的 keypress。
let hasSpaceKeypress = false;

/**
 * 判断原生 keypress 是否应视为命令。Firefox 会为剪切、复制、全选等命令触发 `keypress`，
 * 即使没有插入任何字符，因此必须过滤。
 */
/** isKeypressCommand 判断统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isKeypressCommand(nativeEvent: any) {
  return (
    (nativeEvent.ctrlKey || nativeEvent.altKey || nativeEvent.metaKey) &&
    // ctrlKey && altKey 等价于 AltGr，不属于命令组合。
    !(nativeEvent.ctrlKey && nativeEvent.altKey)
  );
}

/**
 * 把原生顶层事件转换为 composition 事件类型。
 */
/** getCompositionEventType 查询并返回统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getCompositionEventType(domEventName: DOMEventName) {
  switch (domEventName) {
    case 'compositionstart':
      return 'onCompositionStart';
    case 'compositionend':
      return 'onCompositionEnd';
    case 'compositionupdate':
      return 'onCompositionUpdate';
  }
}

/**
 * fallback 推断模型是否认为该事件表示 composition 开始。
 */
/** isFallbackCompositionStart 判断统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isFallbackCompositionStart(
  domEventName: DOMEventName,
  nativeEvent: any,
): boolean {
  return domEventName === 'keydown' && nativeEvent.keyCode === START_KEYCODE;
}

/**
 * fallback 模式是否认为该事件表示 composition 结束。
 */
/** isFallbackCompositionEnd 判断统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isFallbackCompositionEnd(
  domEventName: DOMEventName,
  nativeEvent: any,
): boolean {
  switch (domEventName) {
    case 'keyup':
      // 命令键会提交或清除 IME 输入。
      return END_KEYCODES.indexOf(nativeEvent.keyCode) !== -1;
    case 'keydown':
      // composition 期间每次 keydown 都应得到 IME keyCode；若出现其他
      // 编码，说明 composition 已提前结束。
      return nativeEvent.keyCode !== START_KEYCODE;
    case 'keypress':
    case 'mousedown':
    case 'focusout':
      // 只有取消 IME 才可能出现这些事件。
      return true;
    default:
      return false;
  }
}

/**
 * Google Input Tools 通过 CustomEvent 提供 composition 数据，`data` 位于 `detail` 中。
 * 若事件包含该字段则使用；否则这是普通 composition 事件，没有额外数据可提取。
 * 
 * @param {object} nativeEvent 可能携带 CustomEvent detail 的原生事件。
 * @return {?string} 自定义 composition 数据；不存在时为 null。
 */
/** getDataFromCustomEvent 查询并返回统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getDataFromCustomEvent(nativeEvent: any) {
  const detail = nativeEvent.detail;
  if (typeof detail === 'object' && 'data' in detail) {
    return detail.data;
  }
  return null;
}

/**
 * 判断 composition 是否由韩文 IME 触发。fallback 模式与 IE 韩文 IME 配合不佳，
 * 因此韩文输入直接使用原生 composition 事件。CompositionEvent.locale 虽已废弃，
 * 但在启用 fallback 的 IE 中仍可用。
 * 
 * @param {object} nativeEvent 待识别输入法区域的原生 composition 事件。
 * @return {boolean} 是否来自韩文 IME。
 */
/** isUsingKoreanIME 判断统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isUsingKoreanIME(nativeEvent: any) {
  return nativeEvent.locale === 'ko';
}

// 跟踪当前 IME composition 状态。
let isComposing = false;

/**
* @return {?object} 返回 SyntheticCompositionEvent。
 */
/** extractCompositionEvent 从原生事件和 Fiber 路径收集统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需数据；只生成满足插件条件的 listener/event。 */
function extractCompositionEvent(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
) {
  let eventType;
  let fallbackData;

  if (canUseCompositionEvent) {
    eventType = getCompositionEventType(domEventName);
  } else if (!isComposing) {
    if (isFallbackCompositionStart(domEventName, nativeEvent)) {
      eventType = 'onCompositionStart';
    }
  } else if (isFallbackCompositionEnd(domEventName, nativeEvent)) {
    eventType = 'onCompositionEnd';
  }

  if (!eventType) {
    return null;
  }

  if (useFallbackCompositionData && !isUsingKoreanIME(nativeEvent)) {
    // 当前 composition 以模块状态保存，持续期间不能
    // 被后续事件覆盖。
    if (!isComposing && eventType === 'onCompositionStart') {
      isComposing = FallbackCompositionStateInitialize(nativeEventTarget);
    } else if (eventType === 'onCompositionEnd') {
      if (isComposing) {
        fallbackData = FallbackCompositionStateGetData();
      }
    }
  }

  const listeners = accumulateTwoPhaseListeners(targetInst, eventType);
  if (listeners.length > 0) {
    const event: ReactSyntheticEvent = new SyntheticCompositionEvent(
      eventType,
      domEventName,
      null,
      nativeEvent,
      nativeEventTarget,
    );
    dispatchQueue.push({event, listeners});
    if (fallbackData) {
      // 把 fallback 路径生成的数据写入合成事件。
      // 字段语义与原生 CompositionEventInterface 一致。
      // $FlowFixMe[incompatible-use]
      event.data = fallbackData;
    } else {
      const customData = getDataFromCustomEvent(nativeEvent);
      if (customData !== null) {
        // $FlowFixMe[incompatible-use]
        event.data = customData;
      }
    }
  }
}

/** getNativeBeforeInputChars 查询并返回统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getNativeBeforeInputChars(
  domEventName: DOMEventName,
  nativeEvent: any,
): ?string {
  switch (domEventName) {
    case 'compositionend':
      return getDataFromCustomEvent(nativeEvent);
    case 'keypress':
      /**
       * 原生 `textInput` 可用时应优先使用，但空格键是例外。WebKit 中阻止空格 `textInput` 的默认行为，
       * 既会取消字符插入，也会让浏览器回退到空格滚动页面的默认行为。
       * 
       * 跟踪：https://code.google.com/p/chromium/issues/detail?id=355103
       * 
       * 为规避该问题，空格键改用 keypress，按没有 `textInput` 支持处理。
       */
      const which = nativeEvent.which;
      if (which !== SPACEBAR_CODE) {
        return null;
      }

      hasSpaceKeypress = true;
      return SPACEBAR_CHAR;

    case 'textInput':
      // 记录即将写入 DOM 的字符。
      const chars = nativeEvent.data;

      // 若字符为空格，认为已经在 keypress 阶段处理，
      // 立即退出。Android Chrome
      // 不提供 keyCode，因此也必须忽略。
      if (chars === SPACEBAR_CHAR && hasSpaceKeypress) {
        return null;
      }

      return chars;

    default:
      // 其他原生事件类型不执行任何操作。
      return null;
  }
}

/**
 * 对不支持 `textInput` 的浏览器，提取 SyntheticInputEvent 所需的字符字符串。
 */
/** getFallbackBeforeInputChars 查询并返回统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getFallbackBeforeInputChars(
  domEventName: DOMEventName,
  nativeEvent: any,
): ?string {
  // 若当前处于 IME composition 且使用 fallback，
  // 尝试从 fallback 对象提取组合字符。
  // 若 composition 事件可用，只在 compositionend
  // 提取字符串；否则在 fallback 结束事件中提取。
  if (isComposing) {
    if (
      domEventName === 'compositionend' ||
      (!canUseCompositionEvent &&
        isFallbackCompositionEnd(domEventName, nativeEvent))
    ) {
      const chars = FallbackCompositionStateGetData();
      FallbackCompositionStateReset();
      isComposing = false;
      return chars;
    }
    return null;
  }

  switch (domEventName) {
    case 'paste':
      // 若 keypress 后出现 paste，丢弃已缓存的输入
      // 字符；paste 不应产生 BeforeInput。
      return null;
    case 'keypress':
      /**
       * Firefox 27 起，即使不会插入字符也可能触发 keypress：
       * 
       * - `which` 为 `0`，例如方向键、Esc；
       * 
       * - `which` 是按键编码，但没有可用字符。例如波兰键盘的 `AltGr + d` 不会插入字符，
       *   Firefox 仍会触发 char code `100` 的 keypress，且不会有 `input`；
       * 
       * - `which` 是按键编码，但使用了命令组合，例如 `Cmd+C`，同样不插入字符也没有 `input`。
       */
      if (!isKeypressCommand(nativeEvent)) {
        // 用户通过 Windows 触摸键盘输入 emoji 时，IE 会触发
        // `keypress`；此时 `char` 字段
        // 保存类似 `\uD83D\uDE0A` 的 emoji。由于长度
        // 为 2，`which` 无法正确表示该字符。
        // 这种情况下直接返回 `char`，而不是
        // 使用 `which`。
        if (nativeEvent.char && nativeEvent.char.length > 1) {
          return nativeEvent.char;
        } else if (nativeEvent.which) {
          return String.fromCharCode(nativeEvent.which);
        }
      }
      return null;
    case 'compositionend':
      return useFallbackCompositionData && !isUsingKoreanIME(nativeEvent)
        ? null
        : nativeEvent.data;
    default:
      return null;
  }
}

/**
 * 基于原生 `textInput` 或 fallback 行为提取 `beforeInput` 的 SyntheticInputEvent。
 * 
 * @return {?object} SyntheticInputEvent。
 */
/** extractBeforeInputEvent 从原生事件和 Fiber 路径收集统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需数据；只生成满足插件条件的 listener/event。 */
function extractBeforeInputEvent(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
) {
  let chars;

  if (canUseTextInputEvent) {
    chars = getNativeBeforeInputChars(domEventName, nativeEvent);
  } else {
    chars = getFallbackBeforeInputChars(domEventName, nativeEvent);
  }

  // 若没有字符插入，就不应
  // 触发 BeforeInput。
  if (!chars) {
    return null;
  }

  const listeners = accumulateTwoPhaseListeners(targetInst, 'onBeforeInput');
  if (listeners.length > 0) {
    const event: ReactSyntheticEvent = new SyntheticInputEvent(
      'onBeforeInput',
      'beforeinput',
      null,
      nativeEvent,
      nativeEventTarget,
    );
    dispatchQueue.push({event, listeners});
    // $FlowFixMe[incompatible-use]
    event.data = chars;
  }
}

/**
 * 创建符合以下规范的 `onBeforeInput`：
 * http://www.w3.org/TR/2013/WD-DOM-Level-3-Events-20131105/#events-inputevents
 * 
 * 插件基于 Chrome、Safari、Opera、IE 的原生 `textInput`；它在 `onKeyPress`/`onCompositionEnd` 之后、
 * `onInput` 之前触发。
 * 
 * 浏览器尚未实现规范中的 `beforeInput`，而 `input` 也没有提供实际插入内容。
 * 因此 `textInput` 是识别写入目标节点字符的最佳可用事件。
 * 
 * 该插件还负责发出 `composition` 事件，使 `beforeInput` 与 `composition` 共用 fallback 代码。
 */
/** extractEvents 从原生事件和 Fiber 路径收集统一 composition、beforeInput 与 fallback 字符数据，处理 IME 和旧浏览器差异所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
): void {
  extractCompositionEvent(
    dispatchQueue,
    domEventName,
    targetInst,
    nativeEvent,
    nativeEventTarget,
  );
  extractBeforeInputEvent(
    dispatchQueue,
    domEventName,
    targetInst,
    nativeEvent,
    nativeEventTarget,
  );
}

export {registerEvents, extractEvents};
