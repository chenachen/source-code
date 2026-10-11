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

/** fallback composition 的结束控制键编码：Tab、Enter、Esc、Space。 */
const END_KEYCODES = [9, 13, 27, 32]; // 控制键包括 Tab、Return、Esc、Space。
/** fallback 通过 keydown 的 IME 编码 229 识别 composition 开始。 */
const START_KEYCODE = 229;

/** 当前 DOM 环境是否暴露 CompositionEvent。 */
const canUseCompositionEvent = canUseDOM && 'CompositionEvent' in window;

let documentMode = null;
if (canUseDOM && 'documentMode' in document) {
  documentMode = document.documentMode;
}

// WebKit 提供实用的 `textInput`，可直接表示
// `beforeInput`；IE 的 `textinput` 实用性较差，
// 因此不使用。
/** 非 IE 文档模式下是否暴露 TextEvent，用于选择 textInput 字符路径。 */
const canUseTextInputEvent =
  canUseDOM && 'TextEvent' in window && !documentMode;

// IE9+ 支持 composition 事件，但原生
// compositionend 提供的数据可能错误，例如日文表意
// 空格（\u3000）无法正确记录。
/** 不支持原生 composition 或 IE9-11 数据不可靠时，启用文本差异回退。 */
const useFallbackCompositionData =
  canUseDOM &&
  (!canUseCompositionEvent ||
    (documentMode && documentMode > 8 && documentMode <= 11));

/** 空格的 keypress 编码 32。 */
const SPACEBAR_CODE = 32;
/** 空格字符，用于过滤 keypress 后重复的 textInput。 */
const SPACEBAR_CHAR = String.fromCharCode(SPACEBAR_CODE);

/** 登记 beforeInput 和 composition 的两阶段 React 名称及原生依赖，不安装 DOM listener。 */
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
/** 过滤 ctrl/alt/meta 命令组合；ctrl+alt 的 AltGr 保留为字符输入。 */
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
/** 把 compositionstart/update/end 映射到 React 注册名；其他类型没有返回值，调用者按 falsy 忽略。 */
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
/** 无原生 composition 时，用 keydown+229 判断输入法开始。 */
function isFallbackCompositionStart(
  domEventName: DOMEventName,
  nativeEvent: any,
): boolean {
  return domEventName === 'keydown' && nativeEvent.keyCode === START_KEYCODE;
}

/**
 * fallback 模式是否认为该事件表示 composition 结束。
 */
/** 用控制键 keyup、非229 keydown、keypress/mousedown/focusout 判断 fallback 输入法结束。 */
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
/** 读取 Google Input Tools 的 detail.data；不存在时返回 null。 */
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
/** 通过 locale=ko 识别应跳过文本差异 fallback 的韩文 IME。 */
function isUsingKoreanIME(nativeEvent: any) {
  return nativeEvent.locale === 'ko';
}

// 跟踪当前 IME composition 状态。
let isComposing = false;

/**
* composition 事件写入 dispatchQueue。
 */
/** 识别原生/fallback composition 阶段，维护 isComposing，并把字符数据与两阶段 listeners 加入队列。 */
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

/** 从 textInput/compositionend/空格 keypress 取字符，过滤已经处理过的空格。 */
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

      // 仅在前面已处理空格 keypress 时过滤重复 textInput；否则保留空格字符。
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
/** composition 结束时消费文本差异并 reset；普通 keypress 提取字符，paste 与命令组合不生成输入字符。 */
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
      // paste 不走这个字符回退路径，此分支不生成 beforeInput。
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
 * beforeInput 事件写入 dispatchQueue。
 */
/** 选择 textInput 或 fallback 字符路径；有字符与 listener 时创建 beforeinput 合成事件并入队。 */
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
 * 用 textInput 与 composition/keypress 回退产生 onBeforeInput 的字符数据，
 * 不监听原生 beforeinput；composition 与 beforeInput 共用同一份 fallback 状态。
 */
/** 先提取 composition，再提取 beforeInput，让两者共享并依次消费 fallback 状态。 */
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
