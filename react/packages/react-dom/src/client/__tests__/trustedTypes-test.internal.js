/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('when Trusted Types are available in global object', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;
  let container;
  let ttObject1;
  let ttObject2;

  beforeEach(() => {
    jest.resetModules();
    container = document.createElement('div');
    const fakeTTObjects = new Set();
    window.trustedTypes = {

      /** 检查this必须为window.trustedTypes，再以Set身份判断两个假TrustedHTML对象；模拟原生brand检测而不是按toString值判断。 */
      isHTML: function (value) {
        if (this !== window.trustedTypes) {
          throw new Error(this);
        }
        return fakeTTObjects.has(value);
      },

      /** 始终否认脚本brand，本文件只模拟TrustedHTML。 */
      isScript: () => false,

      /** 始终否认脚本URL brand，避免HTML对象被视为TrustedScriptURL。 */
      isScriptURL: () => false,
    };
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    ttObject1 = {

      /** 第一个假TrustedHTML的原生sink转换结果为<b>Hi</b>。 */
      toString() {
        return '<b>Hi</b>';
      },
    };
    ttObject2 = {

      /** 第二个假TrustedHTML转换为<b>Bye</b>，更新用于核对对象身份换新。 */
      toString() {
        return '<b>Bye</b>';
      },
    };
    fakeTTObjects.add(ttObject1);
    fakeTTObjects.add(ttObject2);
  });

  afterEach(() => {
    delete window.trustedTypes;
  });

  /** 假TrustedHTML对象先Hi后Bye，拦截innerHTML原生setter；DOM相应更新且每轮只一次setter、收到原对象身份，验证dangerouslySetInnerHTML在DOM sink前不字符串化，finally恢复descriptor。 */
  it('should not stringify trusted values for dangerouslySetInnerHTML', async () => {
    const innerHTMLDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'innerHTML',
    );
    try {
      const innerHTMLCalls = [];
      Object.defineProperty(Element.prototype, 'innerHTML', {

        /** 透传原innerHTML getter的this/arguments，让测试读取DOM不会被拦截器改变。 */
        get() {
          return innerHTMLDescriptor.get.apply(this, arguments);
        },

        /** 先记录原value对象，再以原this调用原setter，核对React交给DOM sink前是否字符串化。 */
        set(value) {
          innerHTMLCalls.push(value);
          return innerHTMLDescriptor.set.apply(this, arguments);
        },
      });
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: ttObject1}} />);
      });

      expect(container.innerHTML).toBe('<div><b>Hi</b></div>');
      expect(innerHTMLCalls.length).toBe(1);
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      expect(innerHTMLCalls[0]).toBe(ttObject1);

      innerHTMLCalls.length = 0;
      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: ttObject2}} />);
      });

      expect(container.innerHTML).toBe('<div><b>Bye</b></div>');
      expect(innerHTMLCalls.length).toBe(1);
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      expect(innerHTMLCalls[0]).toBe(ttObject2);
    } finally {
      Object.defineProperty(
        Element.prototype,
        'innerHTML',
        innerHTMLDescriptor,
      );
    }
  });

  /** data-foo由假TrustedHTML Hi改Bye，拦截setAttribute；DOM字符串正确且目标/名称正确，启用集成时sink收到原对象，关闭时收到字符串，验证未知属性的feature分支与更新。 */
  it('should not stringify trusted values for setAttribute (unknown attribute)', async () => {
    const setAttribute = Element.prototype.setAttribute;
    try {
      const setAttributeCalls = [];
      /** 拦截未知data-foo的setAttribute，记录目标/小写名称/原值后转交原方法；finally恢复，比较feature开关下的对象身份。 */
      Element.prototype.setAttribute = function (name, value) {
        setAttributeCalls.push([this, name.toLowerCase(), value]);
        return setAttribute.apply(this, arguments);
      };
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div data-foo={ttObject1} />);
      });

      expect(container.innerHTML).toBe('<div data-foo="<b>Hi</b>"></div>');
      expect(setAttributeCalls.length).toBe(1);
      expect(setAttributeCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeCalls[0][1]).toBe('data-foo');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeCalls[0][2]).toBe(ttObject1);
      } else {
        expect(setAttributeCalls[0][2]).toBe('<b>Hi</b>');
      }

      setAttributeCalls.length = 0;
      await act(() => {
        root.render(<div data-foo={ttObject2} />);
      });

      expect(setAttributeCalls.length).toBe(1);
      expect(setAttributeCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeCalls[0][1]).toBe('data-foo');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeCalls[0][2]).toBe(ttObject2);
      } else {
        expect(setAttributeCalls[0][2]).toBe('<b>Bye</b>');
      }
    } finally {
      Element.prototype.setAttribute = setAttribute;
    }
  });

  /** className由假TrustedHTML Hi改Bye；setAttribute调用名称class、目标正确，集成开关决定原对象或字符串，验证已知别名属性的TrustedTypes分支。 */
  it('should not stringify trusted values for setAttribute (known attribute)', async () => {
    const setAttribute = Element.prototype.setAttribute;
    try {
      const setAttributeCalls = [];
      /** 拦截className别名对应setAttribute，记录真实DOM调用后透传，验证已知属性和开关行为。 */
      Element.prototype.setAttribute = function (name, value) {
        setAttributeCalls.push([this, name.toLowerCase(), value]);
        return setAttribute.apply(this, arguments);
      };
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div className={ttObject1} />);
      });

      expect(container.innerHTML).toBe('<div class="<b>Hi</b>"></div>');
      expect(setAttributeCalls.length).toBe(1);
      expect(setAttributeCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeCalls[0][1]).toBe('class');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeCalls[0][2]).toBe(ttObject1);
      } else {
        expect(setAttributeCalls[0][2]).toBe('<b>Hi</b>');
      }

      setAttributeCalls.length = 0;
      await act(() => {
        root.render(<div className={ttObject2} />);
      });

      expect(setAttributeCalls.length).toBe(1);
      expect(setAttributeCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeCalls[0][1]).toBe('class');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeCalls[0][2]).toBe(ttObject2);
      } else {
        expect(setAttributeCalls[0][2]).toBe('<b>Bye</b>');
      }
    } finally {
      Element.prototype.setAttribute = setAttribute;
    }
  });

  /** SVG xlinkHref由Hi改Bye；拦截setAttributeNS，命名空间与xlink:href正确，集成开关决定原对象或字符串，验证命名空间sink；finally恢复方法。 */
  it('should not stringify trusted values for setAttributeNS', async () => {
    const setAttributeNS = Element.prototype.setAttributeNS;
    try {
      const setAttributeNSCalls = [];
      /** 拦截setAttributeNS记录命名空间、名称、原值和this后透传；finally恢复，验证xlink属性的对象身份。 */
      Element.prototype.setAttributeNS = function (ns, name, value) {
        setAttributeNSCalls.push([this, ns, name, value]);
        return setAttributeNS.apply(this, arguments);
      };
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<svg xlinkHref={ttObject1} />);
      });

      expect(container.innerHTML).toBe('<svg xlink:href="<b>Hi</b>"></svg>');
      expect(setAttributeNSCalls.length).toBe(1);
      expect(setAttributeNSCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeNSCalls[0][1]).toBe('http://www.w3.org/1999/xlink');
      expect(setAttributeNSCalls[0][2]).toBe('xlink:href');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeNSCalls[0][3]).toBe(ttObject1);
      } else {
        expect(setAttributeNSCalls[0][3]).toBe('<b>Hi</b>');
      }

      setAttributeNSCalls.length = 0;
      await act(() => {
        root.render(<svg xlinkHref={ttObject2} />);
      });

      expect(setAttributeNSCalls.length).toBe(1);
      expect(setAttributeNSCalls[0][0]).toBe(container.firstChild);
      expect(setAttributeNSCalls[0][1]).toBe('http://www.w3.org/1999/xlink');
      expect(setAttributeNSCalls[0][2]).toBe('xlink:href');
      // 确保它没有在传递给一个 DOM 接收者时被字符串化：
      if (gate('enableTrustedTypesIntegration')) {
        expect(setAttributeNSCalls[0][3]).toBe(ttObject2);
      } else {
        expect(setAttributeNSCalls[0][3]).toBe('<b>Bye</b>');
      }
    } finally {
      Element.prototype.setAttributeNS = setAttributeNS;
    }
  });

  /** 客户端连续渲染普通script文字；集成开启时首次DEV出现脚本不执行诊断，第二次不再诊断，验证普通script告警去重；本例不直接执行/计数脚本。 */
  it('should warn once when rendering script tag in jsx on client', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<script>alert("I am not executed")</script>);
    });
    if (gate('enableTrustedTypesIntegration')) {
      assertConsoleErrorDev([
        'Encountered a script tag while rendering React component. ' +
          'Scripts inside React components are never executed when rendering ' +
          'on the client. Consider using template tag instead ' +
          '(https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).\n' +
          '    in script (at **)',
      ]);
    }

    // 检查警告只打印一次
    await act(() => {
      root.render(<script>alert("I am not executed")</script>);
    });
  });

  /** 客户端script.type=application/json且JSON文本；act完成无未消费诊断，验证数据块不触发普通可执行script告警。 */
  it('should not warn when rendering a data block script tag', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <script type="application/json">{'{"key": "value"}'}</script>,
      );
    });
  });

  /** 客户端script.type=application/ld+json且schema JSON文本；act完成无未消费诊断，验证结构化数据脚本免普通script告警。 */
  it('should not warn when rendering a ld+json script tag', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <script type="application/ld+json">
          {'{"@context": "https://schema.org"}'}
        </script>,
      );
    });
  });
});
