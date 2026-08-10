/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint valid-typeof: 0 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';

import assign from 'shared/assign';
import getEventCharCode from './getEventCharCode';

/** EventInterfaceType 定义 Flow 数据形状，用于构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type EventInterfaceType = {
  /** EventInterfaceType.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。；EventInterfaceType.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  [propName: string]: 0 | ((event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed, ...}) => mixed),
};

/** functionThatReturnsTrue 执行构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function functionThatReturnsTrue() {
  return true;
}

/** functionThatReturnsFalse 执行构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function functionThatReturnsFalse() {
  return false;
}

// 这里刻意使用工厂，为不同事件接口返回不同 constructor。
// 若共用单一 constructor，调用点会变成 megamorphic，导致引擎去优化。
/** createSyntheticEvent 为构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
function createSyntheticEvent(Interface: EventInterfaceType) {
  /**
   * SyntheticEvent 通常由事件插件响应顶层委托 listener 而创建和分发。
   * 
   * 旧事件系统可通过池化降低 GC 频率：分发后检查 `isPersistent`，非持久事件可回收到池；
   * 需要保留引用的用户应调用 `persist`。现代事件系统不再池化。
   * 
   * SyntheticEvent 及子类通过归一化浏览器差异实现 DOM Level 3 Events API。
   * 子类不必对应 DOM 接口，应用自定义事件也可继承。
   */
  // $FlowFixMe[missing-this-annot]
  /** SyntheticBaseEvent 执行构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
  function SyntheticBaseEvent(
    reactName: string | null,
    reactEventType: string,
    targetInst: Fiber | null,
    /** createSyntheticEvent.SyntheticBaseEvent.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
    nativeEvent: {
      /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
      [propName: string]: mixed, ...},
    nativeEventTarget: null | EventTarget,
  ) {
    this._reactName = reactName;
    this._targetInst = targetInst;
    this.type = reactEventType;
    this.nativeEvent = nativeEvent;
    this.target = nativeEventTarget;
    this.currentTarget = null;

    for (const propName in Interface) {
      if (!Interface.hasOwnProperty(propName)) {
        continue;
      }
      const normalize = Interface[propName];
      if (normalize) {
        this[propName] = normalize(nativeEvent);
      } else {
        this[propName] = nativeEvent[propName];
      }
    }

    const defaultPrevented =
      nativeEvent.defaultPrevented != null
        ? nativeEvent.defaultPrevented
        : nativeEvent.returnValue === false;
    if (defaultPrevented) {
      this.isDefaultPrevented = functionThatReturnsTrue;
    } else {
      this.isDefaultPrevented = functionThatReturnsFalse;
    }
    this.isPropagationStopped = functionThatReturnsFalse;
    return this;
  }

  // $FlowFixMe[prop-missing] found when upgrading Flow
  assign(SyntheticBaseEvent.prototype, {
    // $FlowFixMe[missing-this-annot]
    /** createSyntheticEvent.preventDefault 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
    preventDefault: function () {
      this.defaultPrevented = true;
      const event = this.nativeEvent;
      if (!event) {
        return;
      }

      if (event.preventDefault) {
        event.preventDefault();
        // $FlowFixMe[illegal-typeof] - flow is not aware of `unknown` in IE
      } else if (typeof event.returnValue !== 'unknown') {
        event.returnValue = false;
      }
      this.isDefaultPrevented = functionThatReturnsTrue;
    },

    // $FlowFixMe[missing-this-annot]
    /** createSyntheticEvent.stopPropagation 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
    stopPropagation: function () {
      const event = this.nativeEvent;
      if (!event) {
        return;
      }

      if (event.stopPropagation) {
        event.stopPropagation();
        // $FlowFixMe[illegal-typeof] - flow is not aware of `unknown` in IE
      } else if (typeof event.cancelBubble !== 'unknown') {
        // ChangeEventPlugin 在 IE 中注册“propertychange”。
        // 该事件不支持冒泡或取消，
        // 访问 cancelBubble 会抛出“Member not found”。
        // 使用 typeof "unknown" 可规避该问题，且这是
        // IE 专用行为。
        event.cancelBubble = true;
      }

      this.isPropagationStopped = functionThatReturnsTrue;
    },

    /**
     * 旧事件系统在每轮事件循环后释放已分发的 `SyntheticEvent` 并放回池中；
     * persist 提供保留引用、阻止回收的方式。
     */
    /** createSyntheticEvent.persist 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
    persist: function () {
      // 现代事件系统不使用事件池。
    },

    /**
     * 判断该事件是否应避免回收到池。
     * 
     * @return {boolean} true 表示保留，false 表示可释放。
     */
    isPersistent: functionThatReturnsTrue,
  });
  return SyntheticBaseEvent;
}

/**
 * 标准 Event 事件接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** EventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const EventInterface: EventInterfaceType = {
  eventPhase: 0,
  bubbles: 0,
  cancelable: 0,
  /** timeStamp 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；timeStamp.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  timeStamp: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    return event.timeStamp || Date.now();
  },
  defaultPrevented: 0,
  isTrusted: 0,
};
/** SyntheticEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticEvent: $FlowFixMe = createSyntheticEvent(EventInterface);

/** UIEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const UIEventInterface: EventInterfaceType = {
  ...EventInterface,
  view: 0,
  detail: 0,
};
/** SyntheticUIEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticUIEvent: $FlowFixMe =
  createSyntheticEvent(UIEventInterface);

let lastMovementX;
let lastMovementY;
/** propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
let lastMouseEvent: ?{
  /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
  [propName: string]: mixed};

/** updateMouseMovementPolyfillState 更新构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。；updateMouseMovementPolyfillState.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
function updateMouseMovementPolyfillState(event: {
  /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
  [propName: string]: mixed}) {
  if (event !== lastMouseEvent) {
    if (lastMouseEvent && event.type === 'mousemove') {
      // $FlowFixMe[unsafe-arithmetic] assuming this is a number
      lastMovementX = event.screenX - lastMouseEvent.screenX;
      // $FlowFixMe[unsafe-arithmetic] assuming this is a number
      lastMovementY = event.screenY - lastMouseEvent.screenY;
    } else {
      lastMovementX = 0;
      lastMovementY = 0;
    }
    lastMouseEvent = event;
  }
}

/**
 * 标准 MouseEvent 事件接口字段。
 * @interface MouseEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** MouseEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const MouseEventInterface: EventInterfaceType = {
  ...UIEventInterface,
  screenX: 0,
  screenY: 0,
  clientX: 0,
  clientY: 0,
  pageX: 0,
  pageY: 0,
  ctrlKey: 0,
  shiftKey: 0,
  altKey: 0,
  metaKey: 0,
  getModifierState: getEventModifierState,
  button: 0,
  buttons: 0,
  /** relatedTarget 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  relatedTarget: function (event) {
    if (event.relatedTarget === undefined)
      return event.fromElement === event.srcElement
        ? event.toElement
        : event.fromElement;

    return event.relatedTarget;
  },
  /** movementX 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  movementX: function (event) {
    if ('movementX' in event) {
      return event.movementX;
    }
    updateMouseMovementPolyfillState(event);
    return lastMovementX;
  },
  /** movementY 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  movementY: function (event) {
    if ('movementY' in event) {
      return event.movementY;
    }
    // 这里无需调用 updateMouseMovementPolyfillState()，
    // 因为复制 movementX
    // 之前保证已经更新过 polyfill 状态。
    return lastMovementY;
  },
};

/** SyntheticMouseEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticMouseEvent: $FlowFixMe =
  createSyntheticEvent(MouseEventInterface);

/**
 * 标准 DragEvent 事件接口字段。
 * @interface DragEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** DragEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const DragEventInterface: EventInterfaceType = {
  ...MouseEventInterface,
  dataTransfer: 0,
};
/** SyntheticDragEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticDragEvent: $FlowFixMe =
  createSyntheticEvent(DragEventInterface);

/**
 * 标准 FocusEvent 事件接口字段。
 * @interface FocusEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** FocusEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const FocusEventInterface: EventInterfaceType = {
  ...UIEventInterface,
  relatedTarget: 0,
};
/** SyntheticFocusEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticFocusEvent: $FlowFixMe =
  createSyntheticEvent(FocusEventInterface);

/**
 * 标准 AnimationEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/css3-animations/#AnimationEvent-interface
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AnimationEvent
 */
/** AnimationEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const AnimationEventInterface: EventInterfaceType = {
  ...EventInterface,
  animationName: 0,
  elapsedTime: 0,
  pseudoElement: 0,
};
/** SyntheticAnimationEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticAnimationEvent: $FlowFixMe = createSyntheticEvent(
  AnimationEventInterface,
);

/**
 * 标准 ClipboardEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/clipboard-apis/
 */
/** ClipboardEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const ClipboardEventInterface: EventInterfaceType = {
  ...EventInterface,
  /** clipboardData 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  clipboardData: function (event) {
    return 'clipboardData' in event
      ? event.clipboardData
      : window.clipboardData;
  },
};
/** SyntheticClipboardEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticClipboardEvent: $FlowFixMe = createSyntheticEvent(
  ClipboardEventInterface,
);

/**
 * 标准 CompositionEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#events-compositionevents
 */
/** CompositionEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const CompositionEventInterface: EventInterfaceType = {
  ...EventInterface,
  data: 0,
};
/** SyntheticCompositionEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticCompositionEvent: $FlowFixMe = createSyntheticEvent(
  CompositionEventInterface,
);

/**
 * 标准 InputEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/2013/WD-DOM-Level-3-Events-20131105
 *      /#events-inputevents
 */
// 当前恰好与 CompositionEvent 共用同一字段列表。
/** SyntheticInputEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticInputEvent = SyntheticCompositionEvent;

/**
 * 归一化已废弃的 HTML5 `key` 值。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Key_names
 */
/** normalizeKey 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const normalizeKey = {
  Esc: 'Escape',
  Spacebar: ' ',
  Left: 'ArrowLeft',
  Up: 'ArrowUp',
  Right: 'ArrowRight',
  Down: 'ArrowDown',
  Del: 'Delete',
  Win: 'OS',
  Menu: 'ContextMenu',
  Apps: 'ContextMenu',
  Scroll: 'ScrollLock',
  MozPrintableKey: 'Unidentified',
};

/**
 * 把旧 `keyCode` 转换为 HTML5 `key`。仅映射特殊键；其他键取决于键盘布局或浏览器。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Key_names
 */
/** translateToKey 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const translateToKey = {
  '8': 'Backspace',
  '9': 'Tab',
  '12': 'Clear',
  '13': 'Enter',
  '16': 'Shift',
  '17': 'Control',
  '18': 'Alt',
  '19': 'Pause',
  '20': 'CapsLock',
  '27': 'Escape',
  '32': ' ',
  '33': 'PageUp',
  '34': 'PageDown',
  '35': 'End',
  '36': 'Home',
  '37': 'ArrowLeft',
  '38': 'ArrowUp',
  '39': 'ArrowRight',
  '40': 'ArrowDown',
  '45': 'Insert',
  '46': 'Delete',
  '112': 'F1',
  '113': 'F2',
  '114': 'F3',
  '115': 'F4',
  '116': 'F5',
  '117': 'F6',
  '118': 'F7',
  '119': 'F8',
  '120': 'F9',
  '121': 'F10',
  '122': 'F11',
  '123': 'F12',
  '144': 'NumLock',
  '145': 'ScrollLock',
  '224': 'Meta',
};

/**
 * @param {object} nativeEvent 原生浏览器事件。
 * @return {string} 归一化后的 `key`。
 */
/** getEventKey 查询并返回构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需状态；无匹配时使用 null/默认值而不修改事件队列。；getEventKey.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
function getEventKey(nativeEvent: {
  /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
  [propName: string]: mixed}) {
  if (nativeEvent.key) {
    // 归一化浏览器因实现工作草案而报告的
    // 不一致 key 值。

    // Firefox 虽实现 `key`，却为所有可打印字符返回
    // `MozPrintableKey`（会归一化为 `Unidentified`），因此忽略。
    const key =
      // $FlowFixMe[invalid-computed-prop] unable to index with a `mixed` value
      normalizeKey[nativeEvent.key] || nativeEvent.key;
    if (key !== 'Unidentified') {
      return key;
    }
  }

  // 浏览器未实现 `key`，尽可能用旧字段补齐。
  if (nativeEvent.type === 'keypress') {
    const charCode = getEventCharCode(
      // $FlowFixMe[incompatible-type] unable to narrow to `KeyboardEvent`
      nativeEvent,
    );

    // Enter 同时具备可打印与不可打印语义，可由
    // `keypress` 捕获；其他不可打印键不应如此。
    return charCode === 13 ? 'Enter' : String.fromCharCode(charCode);
  }
  if (nativeEvent.type === 'keydown' || nativeEvent.type === 'keyup') {
    // 每个 `keyCode` 的真实含义由用户键盘布局决定，
    // 但几乎所有功能键都有通用编码。
    // $FlowFixMe[invalid-computed-prop] unable to index with a `mixed` value
    return translateToKey[nativeEvent.keyCode] || 'Unidentified';
  }
  return '';
}

/**
 * 把修饰键名称转换为事件上的对应属性。
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#keys-Modifiers
 */
/** modifierKeyToProp 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const modifierKeyToProp = {
  Alt: 'altKey',
  Control: 'ctrlKey',
  Meta: 'metaKey',
  Shift: 'shiftKey',
};

// 旧浏览器（Safari <= 10、iOS Safari <= 10.2）不支持
// getModifierState，因此回退映射到事件暴露的
// 修饰键字段；该路径不支持 Lock 类按键。
// $FlowFixMe[missing-local-annot]
// $FlowFixMe[missing-this-annot]
/** modifierStateGetter 执行构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function modifierStateGetter(keyArg) {
  const syntheticEvent = this;
  const nativeEvent = syntheticEvent.nativeEvent;
  if (nativeEvent.getModifierState) {
    return nativeEvent.getModifierState(keyArg);
  }
  const keyProp = modifierKeyToProp[keyArg];
  return keyProp ? !!nativeEvent[keyProp] : false;
}

/** getEventModifierState 查询并返回构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需状态；无匹配时使用 null/默认值而不修改事件队列。；getEventModifierState.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
function getEventModifierState(nativeEvent: {
  /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
  [propName: string]: mixed}) {
  return modifierStateGetter;
}

/**
 * 标准 KeyboardEvent 事件接口字段。
 * @interface KeyboardEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** KeyboardEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const KeyboardEventInterface: EventInterfaceType = {
  ...UIEventInterface,
  key: getEventKey,
  code: 0,
  location: 0,
  ctrlKey: 0,
  shiftKey: 0,
  altKey: 0,
  metaKey: 0,
  repeat: 0,
  locale: 0,
  getModifierState: getEventModifierState,
  // 以下为旧 KeyboardEvent 接口。
  /** charCode 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；charCode.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  charCode: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    // `charCode` 来自 KeyPress，表示
    // 实际可打印字符的编码。

    // KeyPress 已废弃，但替代方案尚未定稿，主流浏览器也未
    // 实现；目前只有 KeyPress 提供 charCode。
    if (event.type === 'keypress') {
      return getEventCharCode(
        // $FlowFixMe[incompatible-type] unable to narrow to `KeyboardEvent`
        event,
      );
    }
    return 0;
  },
  /** keyCode 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；keyCode.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  keyCode: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    // `keyCode` 来自 KeyDown/Up，表示
    // 物理键盘按键编码。

    // 编码含义取决于无法检测的用户键盘布局；
    // 假定为美式布局，
    // 对美国和欧洲用户通常能得到较准确映射。
    // 因此当前把进一步解释留给用户代码。
    if (event.type === 'keydown' || event.type === 'keyup') {
      return event.keyCode;
    }
    return 0;
  },
  /** which 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；which.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  which: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    // `which` 会根据
    // 事件类型别名为 `keyCode` 或 `charCode`。
    if (event.type === 'keypress') {
      return getEventCharCode(
        // $FlowFixMe[incompatible-type] unable to narrow to `KeyboardEvent`
        event,
      );
    }
    if (event.type === 'keydown' || event.type === 'keyup') {
      return event.keyCode;
    }
    return 0;
  },
};
/** SyntheticKeyboardEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticKeyboardEvent: $FlowFixMe = createSyntheticEvent(
  KeyboardEventInterface,
);

/**
 * 标准 PointerEvent 事件接口字段。
 * @interface PointerEvent
 * @see http://www.w3.org/TR/pointerevents/
 */
/** PointerEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const PointerEventInterface: EventInterfaceType = {
  ...MouseEventInterface,
  pointerId: 0,
  width: 0,
  height: 0,
  pressure: 0,
  tangentialPressure: 0,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  pointerType: 0,
  isPrimary: 0,
};
/** SyntheticPointerEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticPointerEvent: $FlowFixMe = createSyntheticEvent(
  PointerEventInterface,
);

/**
 * 标准 SubmitEvent 事件接口字段。
 * @interface SubmitEvent
 * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#the-submitevent-interface
 */
/** SubmitEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const SubmitEventInterface: EventInterfaceType = {
  ...EventInterface,
  submitter: 0,
};
/** SyntheticSubmitEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticSubmitEvent: $FlowFixMe =
  createSyntheticEvent(SubmitEventInterface);

/**
 * 标准 TouchEvent 事件接口字段。
 * @interface TouchEvent
 * @see http://www.w3.org/TR/touch-events/
 */
/** TouchEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const TouchEventInterface: EventInterfaceType = {
  ...UIEventInterface,
  touches: 0,
  targetTouches: 0,
  changedTouches: 0,
  altKey: 0,
  metaKey: 0,
  ctrlKey: 0,
  shiftKey: 0,
  getModifierState: getEventModifierState,
};
/** SyntheticTouchEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticTouchEvent: $FlowFixMe =
  createSyntheticEvent(TouchEventInterface);

/**
 * 标准 TransitionEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/2009/WD-css3-transitions-20090320/#transition-events-
 * @see https://developer.mozilla.org/en-US/docs/Web/API/TransitionEvent
 */
/** TransitionEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const TransitionEventInterface: EventInterfaceType = {
  ...EventInterface,
  propertyName: 0,
  elapsedTime: 0,
  pseudoElement: 0,
};
/** SyntheticTransitionEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticTransitionEvent: $FlowFixMe = createSyntheticEvent(
  TransitionEventInterface,
);

/**
 * 标准 WheelEvent 事件接口字段。
 * @interface WheelEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** WheelEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const WheelEventInterface: EventInterfaceType = {
  ...MouseEventInterface,
  /** deltaX 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；deltaX.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  deltaX(event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    return 'deltaX' in event
      ? event.deltaX
      : // WebKit 回退使用 `wheelDeltaX`，并归一化为向右为正。
        'wheelDeltaX' in event
        ? // $FlowFixMe[unsafe-arithmetic] assuming this is a number
          -event.wheelDeltaX
        : 0;
  },
  /** deltaY 是构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的可调用属性；它在读取或归一化该字段时保持宿主事件语义。；deltaY.propName 描述构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  deltaY(event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    return 'deltaY' in event
      ? event.deltaY
      : // WebKit 回退使用 `wheelDeltaY`，并归一化为向下为正。
        'wheelDeltaY' in event
        ? // $FlowFixMe[unsafe-arithmetic] assuming this is a number
          -event.wheelDeltaY
        : // IE9 以前回退使用 `wheelDelta`，并归一化为向下为正。
          'wheelDelta' in event
          ? // $FlowFixMe[unsafe-arithmetic] assuming this is a number
            -event.wheelDelta
          : 0;
  },
  deltaZ: 0,

  // 没有“deltaMode”的浏览器报告原始 wheel delta，每个
  // 滚轮刻度固定为 +/-120，需要近似换算为像素。
  // DOM_DELTA_LINE (1) 可近似为视口尺寸的 5% 或
  // 约 40 像素；DOM_DELTA_SCREEN (2) 可近似为视口的 87.5%。
  deltaMode: 0,
};
/** SyntheticWheelEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticWheelEvent: $FlowFixMe =
  createSyntheticEvent(WheelEventInterface);

/** ToggleEventInterface 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const ToggleEventInterface: EventInterfaceType = {
  ...EventInterface,
  newState: 0,
  oldState: 0,
};
/** SyntheticToggleEvent 保存构造、归一化并控制默认行为/传播状态的 SyntheticEvent 类型族所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SyntheticToggleEvent: $FlowFixMe =
  createSyntheticEvent(ToggleEventInterface);
