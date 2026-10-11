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

  /** resetModules后先改浏览器能力标记，再加载DOMClient和act，让插件在模块初始化时按模拟能力选路径。 */
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

  /** 设IE documentMode=11并提供CompositionEvent标记，触发IE的fallback数据策略。 */
  function simulateIE11() {
    document.documentMode = 11;
    window.CompositionEvent = {};
  }

  /** 同时提供CompositionEvent和TextEvent能力标记，模拟Webkit textInput路径；对象不是真事件构造器。 */
  function simulateWebkit() {
    window.CompositionEvent = {};
    window.TextEvent = {};
  }

  /** 仅提供CompositionEvent标记，保留keypress fallback而无TextEvent能力。 */
  function simulateComposition() {
    window.CompositionEvent = {};
  }

  /** 不添加能力标记，依赖当前环境及afterEach删除标记后进入fallback；函数自身不主动delete浏览器属性。 */
  function simulateNoComposition() {
    // 没有在 Window 中的组合事件 - 将使用备用实现
  }

  /** 创建冒泡Event并复制data/detail等字段后在目标派发，模拟原生组合/textInput事件。 */
  function simulateEvent(elem, type, data) {
    const event = new Event(type, {bubbles: true});
    Object.assign(event, data);
    elem.dispatchEvent(event);
  }

  /** 以KeyboardEvent构造其余键参数，char额外写属性、truthy value先赋节点value再派发；contentEditable只会新增value属性，不修改textContent。 */
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

  /** 派发带全null clipboardData字段的paste事件，验证不会从这份空数据生成beforeinput；不实际插入剪贴板文本。 */
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

  /** 取字符串第一个UTF16 code unit，作为本文件ASCII which/keyCode辅助。 */
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
          /** 在Webkit连续序列第1步 compositionstart(test) 后，验证仅compositionstart一次、data=test；beforeinput为零；其余步骤不会在此回调执行。 */
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
          /** 在Webkit连续序列第2步 compositionupdate(test string) 后，验证仅compositionupdate一次、data=test string；beforeinput为零；其余步骤不会在此回调执行。 */
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
          /** 在Webkit连续序列第3步 compositionend(test string 3) 后，验证beforeinput一次取组合结束data=test string 3；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('compositionend');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('test string 3');
          },
        },
        {
          /** 在Webkit连续序列第4步 textInput(abcß) 后，验证beforeinput一次取abcß；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('textInput');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('abcß');
          },
        },
        {
          /** 在Webkit连续序列第5步 keypress a 后，验证beforeinput零次，普通字符等textInput路径；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第6步 keypress 空格 后，验证beforeinput一次取空格、来源keypress；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** 在Webkit连续序列第7步 随后textInput空格 后，验证beforeinput零次，去重前一个keypress空格；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第8步 Ctrl+a 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第9步 Alt+b 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第10步 Ctrl+Alt+c（AltGr） 后，验证beforeinput零次，Webkit此分支不由keypress生成普通字符；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第11步 keypress.char emoji 后，验证beforeinput零次，emoji等待textInput；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第12步 textInput emoji 后，验证beforeinput一次取emoji、来源textInput；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('textInput');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** 在Webkit连续序列第13步 keydown229并value=foo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第14步 Tab keydown并value=foobar 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第15步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第16步 Tab keyup并value=fooBARfoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第17步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第18步 keypress终止并value=Barfoofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在Webkit连续序列第19步 paste空剪贴板 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
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
          /** 在IE11连续序列第1步 compositionstart(test) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第2步 compositionupdate(test string) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第3步 compositionend(test string 3) 后，验证beforeinput零次，IE不取该原生组合data；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第4步 textInput(abcß) 后，验证beforeinput零次，无TextEvent路径；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第5步 keypress a 后，验证beforeinput一次取a；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** 在IE11连续序列第6步 keypress 空格 后，验证beforeinput一次取空格；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** 在IE11连续序列第7步 随后textInput空格 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第8步 Ctrl+a 后，验证beforeinput零次，过滤Ctrl命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第9步 Alt+b 后，验证beforeinput零次，过滤Alt命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第10步 Ctrl+Alt+c（AltGr） 后，验证beforeinput一次取c，Ctrl+Alt不按命令过滤；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** 在IE11连续序列第11步 keypress.char emoji 后，验证beforeinput一次取char字段emoji；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** 在IE11连续序列第12步 textInput emoji 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第13步 keydown229并value=foo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第14步 Tab keydown并value=foobar 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第15步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第16步 Tab keyup并value=fooBARfoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第17步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第18步 keypress终止并value=Barfoofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在IE11连续序列第19步 paste空剪贴板 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
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
          /** 在无CompositionEvent连续序列第1步 compositionstart(test) 后，验证beforeinput零次，无原生组合事件能力；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第2步 compositionupdate(test string) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第3步 compositionend(test string 3) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第4步 textInput(abcß) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第5步 keypress a 后，验证beforeinput一次取a；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** 在无CompositionEvent连续序列第6步 keypress 空格 后，验证beforeinput一次取空格；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** 在无CompositionEvent连续序列第7步 随后textInput空格 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第8步 Ctrl+a 后，验证beforeinput零次，过滤Ctrl命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第9步 Alt+b 后，验证beforeinput零次，过滤Alt命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第10步 Ctrl+Alt+c（AltGr） 后，验证beforeinput一次取c，允许AltGr字符；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** 在无CompositionEvent连续序列第11步 keypress.char emoji 后，验证beforeinput一次取char字段emoji；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** 在无CompositionEvent连续序列第12步 textInput emoji 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第13步 keydown229并value=foo 后，验证beforeinput零次，并启动以foo为基线的组合差分；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第14步 Tab keydown并value=foobar 后，验证beforeinput一次取bar、来源keydown，结束第一组差分；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keydown');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('bar');
          },
        },
        {
          /** 在无CompositionEvent连续序列第15步 keydown229并value=foofoo 后，验证beforeinput零次，并以foofoo重新开始组合；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第16步 Tab keyup并value=fooBARfoo 后，验证beforeinput一次取BAR、来源keyup，比较foofoo与fooBARfoo；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keyup');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('BAR');
          },
        },
        {
          /** 在无CompositionEvent连续序列第17步 keydown229并value=foofoo 后，验证beforeinput零次，再以foofoo开始组合；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在无CompositionEvent连续序列第18步 keypress终止并value=Barfoofoo 后，验证beforeinput一次取Bar、来源keypress，比较foofoo与Barfoofoo；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('Bar');
          },
        },
        {
          /** 在无CompositionEvent连续序列第19步 paste空剪贴板 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
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
          /** 在仅CompositionEvent连续序列第1步 compositionstart(test) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第2步 compositionupdate(test string) 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第3步 compositionend(test string 3) 后，验证beforeinput一次取组合结束data=test string 3；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('compositionend');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('test string 3');
          },
        },
        {
          /** 在仅CompositionEvent连续序列第4步 textInput(abcß) 后，验证beforeinput零次，无TextEvent能力；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第5步 keypress a 后，验证beforeinput一次取a；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('a');
          },
        },
        {
          /** 在仅CompositionEvent连续序列第6步 keypress 空格 后，验证beforeinput一次取空格；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe(' ');
          },
        },
        {
          /** 在仅CompositionEvent连续序列第7步 随后textInput空格 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第8步 Ctrl+a 后，验证beforeinput零次，过滤Ctrl命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第9步 Alt+b 后，验证beforeinput零次，过滤Alt命令；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第10步 Ctrl+Alt+c（AltGr） 后，验证beforeinput一次取c，允许AltGr字符；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('c');
          },
        },
        {
          /** 在仅CompositionEvent连续序列第11步 keypress.char emoji 后，验证beforeinput一次取char字段emoji；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(1);
            expect(beforeInputEvent.nativeEvent.type).toBe('keypress');
            expect(beforeInputEvent.type).toBe('beforeinput');
            expect(beforeInputEvent.data).toBe('\uD83D\uDE0A');
          },
        },
        {
          /** 在仅CompositionEvent连续序列第12步 textInput emoji 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第13步 keydown229并value=foo 后，验证beforeinput零次，已有CompositionEvent不靠229启动fallback；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第14步 Tab keydown并value=foobar 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第15步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第16步 Tab keyup并value=fooBARfoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第17步 keydown229并value=foofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第18步 keypress终止并value=Barfoofoo 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
        {
          /** 在仅CompositionEvent连续序列第19步 paste空剪贴板 后，验证beforeinput零次；其余步骤不会在此回调执行。 */
          run: ({beforeInputEvent, spyOnBeforeInput}) => {
            expect(spyOnBeforeInput).toHaveBeenCalledTimes(0);
            expect(beforeInputEvent).toBeNull();
          },
        },
      ],
    },
  ];

  /** 按env重载插件并挂载input，连续执行同一19步序列；每步只清event/spies，不清模块组合状态或DOM值，再用同索引断言验证调用数、来源和data。 */
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

  /** 在contentEditable div执行同一环境/连续序列并逐步断言；不重置插件的space/组合状态，键盘helper的value也不是编辑div的真实文本。 */
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

  /** 模拟有CompositionEvent/TextEvent的Webkit，input连续执行19步；组合开始/更新不生成beforeinput，结束或textInput给data，空格keypress给一次并去重后续textInput，普通keypress/修饰键/paste不补发。 */
  it('should extract onBeforeInput when simulating in Webkit on input[type=text]', async () => {
    await testInputComponent(environments[0], scenarios);
  });
  /** 同Webkit19步改为contentEditable；逐步检查native来源、data与调用计数，验证TextEvent路径适用于非input编辑节点。 */
  it('should extract onBeforeInput when simulating in Webkit on contenteditable', async () => {
    await testContentEditableComponent(environments[0], scenarios);
  });

  /** 模拟documentMode=11与CompositionEvent，input执行19步；beforeinput靠普通keypress含a/空格/AltGr-c/emoji，原生composition/textInput与后续229场景不产生额外输入，验证IE能力选择。 */
  it('should extract onBeforeInput when simulating in IE11 on input[type=text]', async () => {
    await testInputComponent(environments[1], scenarios);
  });
  /** 同IE11序列在contentEditable执行；用相同断言表检查keypress fallback与修饰键过滤，覆盖编辑div。 */
  it('should extract onBeforeInput when simulating in IE11 on contenteditable', async () => {
    await testContentEditableComponent(environments[1], scenarios);
  });

  /** 无CompositionEvent/TextEvent的input执行同19步；普通keypress给字符，keydown229启动差分，Tab keydown/keyup或keypress结束分别提取bar/BAR/Bar，paste不产生beforeinput，验证fallback组合状态。 */
  it('should extract onBeforeInput when simulating in env with no CompositionEvent on input[type=text]', async () => {
    await testInputComponent(environments[2], scenarios);
  });

  // 以下两例有 CompositionEvent，组合结束直接取事件数据；无该能力的229/Tab差分已由上一 input用例覆盖。

  /** 仅CompositionEvent的input执行19步；compositionend取test string 3，普通keypress给a/空格/AltGr-c/emoji，textInput及229序列不补发，验证无TextEvent但有组合事件的路径。 */
  it('should extract onBeforeInput when simulating in env with only CompositionEvent on input[type=text]', async () => {
    await testInputComponent(environments[3], scenarios);
  });

  /** 仅CompositionEvent的contentEditable执行同表；确认原生组合结束data与keypress fallback组合，无CompositionEvent差分场景没有在contentEditable单独注册用例。 */
  it('should extract onBeforeInput when simulating in env with only CompositionEvent on contenteditable', async () => {
    await testContentEditableComponent(environments[3], scenarios);
  });
});
