/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let act;

describe('BeforeInputEventPlugin', () => {
  let container;

  /** `loadReactDOMClientAndAct`：封装当前用例复用的操作、回调或断言步骤。 */
  function loadReactDOMClientAndAct(envSimulator) {
    jest.resetModules();
    if (envSimulator) {
      envSimulator();
    }
    return {
      ReactDOMClient: require('react-dom/client'),
      act: require('internal-test-utils').act,
    };
  }

  /** `simulateIE11`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateIE11() {
    document.documentMode = 11;
    window.CompositionEvent = {};
  }

  /** `simulateWebkit`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateWebkit() {
    window.CompositionEvent = {};
    window.TextEvent = {};
  }

  /** `simulateComposition`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateComposition() {
    window.CompositionEvent = {};
  }

  /** `simulateNoComposition`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateNoComposition() {
    // 没有在 Window 中的组合事件 - 将使用备用实现
  }

  /** `simulateEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateEvent(elem, type, data) {
    const event = new Event(type, {bubbles: true});
    Object.assign(event, data);
    elem.dispatchEvent(event);
  }

  /** `simulateKeyboardEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulateKeyboardEvent(elem, type, data) {
    const {char, value, ...rest} = data;
    const event = new KeyboardEvent(type, {
      bubbles: true,
      ...rest,
    });
    if (char) {
      event.char = char;
    }
    if (value) {
      elem.value = value;
    }
    elem.dispatchEvent(event);
  }

  /** `simulatePaste`：封装当前用例复用的操作、回调或断言步骤。 */
  function simulatePaste(elem) {
    const pasteEvent = new Event('paste', {
      bubbles: true,
    });
    pasteEvent.clipboardData = {
      dropEffect: null,
      effectAllowed: null,
      files: null,
      items: null,
      types: null,
    };
    elem.dispatchEvent(pasteEvent);
  }

  beforeEach(() => {
    React = require('react');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    delete document.documentMode;
    delete window.CompositionEvent;
    delete window.TextEvent;
    delete window.opera;
    document.body.removeChild(container);
    container = null;
  });

  /** `keyCode`：封装当前用例复用的操作、回调或断言步骤。 */
  function keyCode(char) {
    return char.charCodeAt(0);
  }

  const scenarios = [
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: [
        'compositionstart',
        {detail: {data: 'test'}, data: 'test'},
      ],
    },
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: [
        'compositionupdate',
        {detail: {data: 'test string'}, data: 'test string'},
      ],
    },
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: [
        'compositionend',
        {detail: {data: 'test string 3'}, data: 'test string 3'},
      ],
    },
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: ['textInput', {data: 'abcß'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keypress', {which: keyCode('a')}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keypress', {which: keyCode(' ')}, ' '],
    },
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: ['textInput', {data: ' '}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keypress', {which: keyCode('a'), ctrlKey: true}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keypress', {which: keyCode('b'), altKey: true}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: [
        'keypress',
        {which: keyCode('c'), altKey: true, ctrlKey: true},
      ],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: [
        'keypress',
        {which: keyCode('X'), char: '\uD83D\uDE0A'},
      ],
    },
    {
      eventSimulator: simulateEvent,
      eventSimulatorArgs: ['textInput', {data: '\uD83D\uDE0A'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keydown', {keyCode: 229, value: 'foo'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keydown', {keyCode: 9, value: 'foobar'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keydown', {keyCode: 229, value: 'foofoo'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keyup', {keyCode: 9, value: 'fooBARfoo'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keydown', {keyCode: 229, value: 'foofoo'}],
    },
    {
      eventSimulator: simulateKeyboardEvent,
      eventSimulatorArgs: ['keypress', {keyCode: 60, value: 'Barfoofoo'}],
    },
    {
      eventSimulator: simulatePaste,
      eventSimulatorArgs: [],
    },
  ];

  const environments = [
    {
      emulator: simulateWebkit,
      assertions: [
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({
            beforeInputEvent,
            compositionStartEvent,
            spyOnBeforeInput,
            spyOnCompositionStart,
          }) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
            expect(spyOnCompositionStart).toHaveBeenCalledTimes(1);
            expect(compositionStartEvent.type).toBe('compositionstart');
            expect(compositionStartEvent.data).toBe('test');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({
            beforeInputEvent,
            compositionUpdateEvent,
            spyOnBeforeInput,
            spyOnCompositionUpdate,
          }) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
            expect(spyOnCompositionUpdate).toHaveBeenCalledTimes(1);
            expect(compositionUpdateEvent.type).toBe('compositionupdate');
            expect(compositionUpdateEvent.data).toBe('test string');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('compositionend');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('test string 3');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('textInput');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('abcß');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('textInput');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
      ],
    },
    {
      emulator: simulateIE11,
      assertions: [
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
      ],
    },
    {
      emulator: simulateNoComposition,
      assertions: [
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keydown');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('bar');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keyup');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('BAR');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('Bar');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
      ],
    },
    {
      emulator: simulateComposition,
      assertions: [
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('compositionend');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('test string 3');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** `run`：封装当前用例复用的操作、回调或断言步骤。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
      ],
    },
  ];

  /** `testInputComponent`：封装当前用例复用的操作、回调或断言步骤。 */
  const testInputComponent = async (env, scenes) => {
    let beforeInputEvent;
    let compositionStartEvent;
    let compositionUpdateEvent;
    let spyOnBeforeInput;
    let spyOnCompositionStart;
    let spyOnCompositionUpdate;
    ({ReactDOMClient, act} = loadReactDOMClientAndAct(env.emulator));
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input
          type="text"
          onBeforeInput={e => {
            spyOnBeforeInput();
            beforeInputEvent = e;
          }}
          onCompositionStart={e => {
            spyOnCompositionStart();
            compositionStartEvent = e;
          }}
          onCompositionUpdate={e => {
            spyOnCompositionUpdate();
            compositionUpdateEvent = e;
          }}
        />,
      );
    });

    const node = container.firstChild;

    scenes.forEach((s, id) => {
      beforeInputEvent = null;
      compositionStartEvent = null;
      compositionUpdateEvent = null;
      spyOnBeforeInput = jest.fn();
      spyOnCompositionStart = jest.fn();
      spyOnCompositionUpdate = jest.fn();
      s.eventSimulator.apply(null, [node, ...s.eventSimulatorArgs]);
      env.assertions[id].run({
        beforeInputEvent,
        compositionStartEvent,
        compositionUpdateEvent,
        spyOnBeforeInput,
        spyOnCompositionStart,
        spyOnCompositionUpdate,
      });
    });
  };

  /** `testContentEditableComponent`：封装当前用例复用的操作、回调或断言步骤。 */
  const testContentEditableComponent = async (env, scenes) => {
    let beforeInputEvent;
    let compositionStartEvent;
    let compositionUpdateEvent;
    let spyOnBeforeInput;
    let spyOnCompositionStart;
    let spyOnCompositionUpdate;
    ({ReactDOMClient, act} = loadReactDOMClientAndAct(env.emulator));
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div
          contentEditable={true}
          onBeforeInput={e => {
            spyOnBeforeInput();
            beforeInputEvent = e;
          }}
          onCompositionStart={e => {
            spyOnCompositionStart();
            compositionStartEvent = e;
          }}
          onCompositionUpdate={e => {
            spyOnCompositionUpdate();
            compositionUpdateEvent = e;
          }}
        />,
      );
    });

    const node = container.firstChild;

    scenes.forEach((s, id) => {
      beforeInputEvent = null;
      compositionStartEvent = null;
      compositionUpdateEvent = null;
      spyOnBeforeInput = jest.fn();
      spyOnCompositionStart = jest.fn();
      spyOnCompositionUpdate = jest.fn();
      s.eventSimulator.apply(null, [node, ...s.eventSimulatorArgs]);
      env.assertions[id].run({
        beforeInputEvent,
        compositionStartEvent,
        compositionUpdateEvent,
        spyOnBeforeInput,
        spyOnCompositionStart,
        spyOnCompositionUpdate,
      });
    });
  };

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should extract onBeforeInput when simulating in Webkit on input[type=text]」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should extract onBeforeInput when simulating in Webkit on input[type=text]', async () => {
    await testInputComponent(environments[0], scenarios);
  });
  /** 测试场景：验证「should extract onBeforeInput when simulating in Webkit on contenteditable」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in Webkit on contenteditable', async () => {
    await testContentEditableComponent(environments[0], scenarios);
  });

  /** 测试场景：验证「should extract onBeforeInput when simulating in IE11 on input[type=text]」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in IE11 on input[type=text]', async () => {
    await testInputComponent(environments[1], scenarios);
  });
  /** 测试场景：验证「should extract onBeforeInput when simulating in IE11 on contenteditable」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in IE11 on contenteditable', async () => {
    await testContentEditableComponent(environments[1], scenarios);
  });

  /** 测试场景：验证「should extract onBeforeInput when simulating in env with no CompositionEvent on input[type=text]」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in env with no CompositionEvent on input[type=text]', async () => {
    await testInputComponent(environments[2], scenarios);
  });

  // 使用 composition fallback 的环境中，contenteditable 上的 onBeforeInput 无法按预期工作，
  // 因为 keydown 与 keyup 会被转换为 keypress 事件。

  /** 测试场景：验证「should extract onBeforeInput when simulating in env with only CompositionEvent on input[type=text]」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in env with only CompositionEvent on input[type=text]', async () => {
    await testInputComponent(environments[3], scenarios);
  });

  /** 测试场景：验证「should extract onBeforeInput when simulating in env with only CompositionEvent on contenteditable」描述的渲染、交互或错误处理结果。 */
  it('should extract onBeforeInput when simulating in env with only CompositionEvent on contenteditable', async () => {
    await testContentEditableComponent(environments[3], scenarios);
  });
});
