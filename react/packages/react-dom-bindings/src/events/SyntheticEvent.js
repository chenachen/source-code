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

/** 合成事件字段的复制/归一化表：0 直接复制，函数从 nativeEvent 计算字段值。 */
type EventInterfaceType = {
  /** 字段名映射到直接复制标记 0 或归一化函数。 */
  [propName: string]: 0 | ((event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed, ...}) => mixed),
};

/** 作为事件状态查询的恒真实现。 */
function functionThatReturnsTrue() {
  return true;
}

/** 作为事件状态查询的恒假实现。 */
function functionThatReturnsFalse() {
  return false;
}

// 这里刻意使用工厂，为不同事件接口返回不同 constructor。
// 若共用单一 constructor，调用点会变成 megamorphic，导致引擎去优化。
/**
 * 为每张字段接口表创建独立 constructor，避免所有事件类型共用构造器形成多态热点。
 * 表值为 0 时复制原生同名字段，为函数时计算归一化值；原型方法读取各实例自己的
 * nativeEvent，默认行为和传播状态则用恒真/恒假函数表示。对象不回收到事件池。
 */
function createSyntheticEvent(Interface: EventInterfaceType) {
  /**
   * 插件按 Interface 创建独立事件对象，并归一化浏览器字段差异。
   * 现代 DOM 事件不池化，用户无需调用 persist 才能保留对象引用。
   */
  // $FlowFixMe[missing-this-annot]
  /** 保存原生事件与目标，按 Interface 复制/归一化字段，并初始化默认行为和传播状态。 */
  function SyntheticBaseEvent(
    reactName: string | null,
    reactEventType: string,
    targetInst: Fiber | null,
    /** 插件传入的原生事件字段集合。 */
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
    /** 标记 defaultPrevented；有 nativeEvent 时取消其默认行为，并把 isDefaultPrevented 改为恒真。 */
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
    /** 有 nativeEvent 时停止其传播，并把 isPropagationStopped 改为恒真；没有原事件则直接返回。 */
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
     * 保留旧 persist API 形状；现代实现无需阻止事件回收。
     */
    /** 兼容旧调用形状；现代 DOM 合成事件不池化，此方法为空。 */
    persist: function () {
      // 现代事件系统不使用事件池。
    },

    /**
     * 现代 DOM 合成事件不池化，因此此兼容查询恒为 true。
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
/** 供 Event 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const EventInterface: EventInterfaceType = {
  eventPhase: 0,
  bubbles: 0,
  cancelable: 0,
  /** 原生 timeStamp 为 truthy 时复制，否则使用 Date.now()；原生值为 0 也走回退。 */
  timeStamp: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    return event.timeStamp || Date.now();
  },
  defaultPrevented: 0,
  isTrusted: 0,
};
/** 按 EventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticEvent: $FlowFixMe = createSyntheticEvent(EventInterface);

/** 供 UIEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const UIEventInterface: EventInterfaceType = {
  ...EventInterface,
  view: 0,
  detail: 0,
};
/** 按 UIEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticUIEvent: $FlowFixMe =
  createSyntheticEvent(UIEventInterface);

let lastMovementX;
let lastMovementY;
/** 原生事件字段名到字段值的开放映射。 */
let lastMouseEvent: ?{
  /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
  [propName: string]: mixed};

/** 原生 movementX/Y 缺失时，用相邻 mousemove 的 screen 坐标更新位移；同一原生事件只计算一次。 */
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
/** 供 MouseEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
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
  /** 优先读取 relatedTarget，旧 IE 从 fromElement/toElement 推导关联目标。 */
  relatedTarget: function (event) {
    if (event.relatedTarget === undefined)
      return event.fromElement === event.srcElement
        ? event.toElement
        : event.fromElement;

    return event.relatedTarget;
  },
  /** 优先读取原生 movementX，否则先更新位移缓存，再返回水平坐标差。 */
  movementX: function (event) {
    if ('movementX' in event) {
      return event.movementX;
    }
    updateMouseMovementPolyfillState(event);
    return lastMovementX;
  },
  /** 优先读取原生 movementY，否则返回 movementX 读取时已更新的垂直坐标差。 */
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

/** 按 MouseEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticMouseEvent: $FlowFixMe =
  createSyntheticEvent(MouseEventInterface);

/**
 * 标准 DragEvent 事件接口字段。
 * @interface DragEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** 供 DragEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const DragEventInterface: EventInterfaceType = {
  ...MouseEventInterface,
  dataTransfer: 0,
};
/** 按 DragEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticDragEvent: $FlowFixMe =
  createSyntheticEvent(DragEventInterface);

/**
 * 标准 FocusEvent 事件接口字段。
 * @interface FocusEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** 供 FocusEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const FocusEventInterface: EventInterfaceType = {
  ...UIEventInterface,
  relatedTarget: 0,
};
/** 按 FocusEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticFocusEvent: $FlowFixMe =
  createSyntheticEvent(FocusEventInterface);

/**
 * 标准 AnimationEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/css3-animations/#AnimationEvent-interface
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AnimationEvent
 */
/** 供 AnimationEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const AnimationEventInterface: EventInterfaceType = {
  ...EventInterface,
  animationName: 0,
  elapsedTime: 0,
  pseudoElement: 0,
};
/** 按 AnimationEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticAnimationEvent: $FlowFixMe = createSyntheticEvent(
  AnimationEventInterface,
);

/**
 * 标准 ClipboardEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/clipboard-apis/
 */
/** 供 ClipboardEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const ClipboardEventInterface: EventInterfaceType = {
  ...EventInterface,
  /** 复制原生 clipboardData，旧 IE 回退 window.clipboardData。 */
  clipboardData: function (event) {
    return 'clipboardData' in event
      ? event.clipboardData
      : window.clipboardData;
  },
};
/** 按 ClipboardEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticClipboardEvent: $FlowFixMe = createSyntheticEvent(
  ClipboardEventInterface,
);

/**
 * 标准 CompositionEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#events-compositionevents
 */
/** 供 CompositionEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const CompositionEventInterface: EventInterfaceType = {
  ...EventInterface,
  data: 0,
};
/** 按 CompositionEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
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
/** 复用 CompositionEventInterface 的 data 字段创建 beforeInput 合成事件 constructor。 */
export const SyntheticInputEvent = SyntheticCompositionEvent;

/**
 * 归一化已废弃的 HTML5 `key` 值。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent#Key_names
 */
/** 旧浏览器 key 拼写到标准 key 名的别名表。 */
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
/** 旧 keyCode 到特殊按键名称的回退表；不映射依赖键盘布局的普通字符。 */
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
/** 优先使用规范化的 nativeEvent.key，未提供时按 keypress 的字符或 keydown/up 的特殊编码回退。 */
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
/** 旧浏览器修饰键名称到 ctrlKey/shiftKey/altKey/metaKey 的映射。 */
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
/** 优先调用原生 getModifierState；旧浏览器从相应 modifier 字段读值。 */
function modifierStateGetter(keyArg) {
  const syntheticEvent = this;
  const nativeEvent = syntheticEvent.nativeEvent;
  if (nativeEvent.getModifierState) {
    return nativeEvent.getModifierState(keyArg);
  }
  const keyProp = modifierKeyToProp[keyArg];
  return keyProp ? !!nativeEvent[keyProp] : false;
}

/** 返回绑定合成事件 this 使用的 modifierStateGetter，实际调用时读取 this.nativeEvent。 */
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
/** 供 KeyboardEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
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
  /** 仅 keypress 返回归一化可打印字符编码；其他键盘事件返回 0。 */
  charCode: function (event: {
    /** propName 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
    [propName: string]: mixed}) {
    // `charCode` 来自 KeyPress，表示
    // 实际可打印字符的编码。

    // 此兼容字段只在 keypress 中读取 charCode；keydown/keyup 返回 0。
    if (event.type === 'keypress') {
      return getEventCharCode(
        // $FlowFixMe[incompatible-type] unable to narrow to `KeyboardEvent`
        event,
      );
    }
    return 0;
  },
  /** 仅 keydown/keyup 复制原生 keyCode；其他事件返回 0。 */
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
  /** keypress 使用归一化 charCode，keydown/keyup 使用 keyCode。 */
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
/** 按 KeyboardEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticKeyboardEvent: $FlowFixMe = createSyntheticEvent(
  KeyboardEventInterface,
);

/**
 * 标准 PointerEvent 事件接口字段。
 * @interface PointerEvent
 * @see http://www.w3.org/TR/pointerevents/
 */
/** 供 PointerEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
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
/** 按 PointerEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticPointerEvent: $FlowFixMe = createSyntheticEvent(
  PointerEventInterface,
);

/**
 * 标准 SubmitEvent 事件接口字段。
 * @interface SubmitEvent
 * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#the-submitevent-interface
 */
/** 供 SubmitEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const SubmitEventInterface: EventInterfaceType = {
  ...EventInterface,
  submitter: 0,
};
/** 按 SubmitEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticSubmitEvent: $FlowFixMe =
  createSyntheticEvent(SubmitEventInterface);

/**
 * 标准 TouchEvent 事件接口字段。
 * @interface TouchEvent
 * @see http://www.w3.org/TR/touch-events/
 */
/** 供 TouchEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
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
/** 按 TouchEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticTouchEvent: $FlowFixMe =
  createSyntheticEvent(TouchEventInterface);

/**
 * 标准 TransitionEvent 接口字段。
 * @interface Event
 * @see http://www.w3.org/TR/2009/WD-css3-transitions-20090320/#transition-events-
 * @see https://developer.mozilla.org/en-US/docs/Web/API/TransitionEvent
 */
/** 供 TransitionEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const TransitionEventInterface: EventInterfaceType = {
  ...EventInterface,
  propertyName: 0,
  elapsedTime: 0,
  pseudoElement: 0,
};
/** 按 TransitionEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticTransitionEvent: $FlowFixMe = createSyntheticEvent(
  TransitionEventInterface,
);

/**
 * 标准 WheelEvent 事件接口字段。
 * @interface WheelEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
/** 供 WheelEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const WheelEventInterface: EventInterfaceType = {
  ...MouseEventInterface,
  /** 优先读取原生 deltaX；旧 WebKit wheelDeltaX 反号后返回，缺失时为 0。 */
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
  /** 优先读取原生 deltaY；旧 wheelDeltaY/wheelDelta 反号后返回，缺失时为 0。 */
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

  // deltaMode 按原生字段复制；旧 wheelDelta 回退仅修正方向，不换算成像素。
  deltaMode: 0,
};
/** 按 WheelEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticWheelEvent: $FlowFixMe =
  createSyntheticEvent(WheelEventInterface);

/** 供 ToggleEvent 合成事件使用的字段复制/归一化表；继承的字段与本类型字段合并。 */
const ToggleEventInterface: EventInterfaceType = {
  ...EventInterface,
  newState: 0,
  oldState: 0,
};
/** 按 ToggleEventInterface 创建的合成事件 constructor；每次派发创建独立事件对象。 */
export const SyntheticToggleEvent: $FlowFixMe =
  createSyntheticEvent(ToggleEventInterface);
