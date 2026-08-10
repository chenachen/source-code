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
      /** `isHTML`：封装当前用例复用的操作、回调或断言步骤。 */
      isHTML: function (value) {
        if (this !== window.trustedTypes) {
          throw new Error(this);
        }
        return fakeTTObjects.has(value);
      },
      /** `isScript`：封装当前用例复用的操作、回调或断言步骤。 */
      isScript: () => false,
      /** `isScriptURL`：封装当前用例复用的操作、回调或断言步骤。 */
      isScriptURL: () => false,
    };
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    ttObject1 = {
      /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '<b>Hi</b>';
      },
    };
    ttObject2 = {
      /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should not stringify trusted values for dangerouslySetInnerHTML」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should not stringify trusted values for dangerouslySetInnerHTML', async () => {
    const innerHTMLDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'innerHTML',
    );
    try {
      const innerHTMLCalls = [];
      Object.defineProperty(Element.prototype, 'innerHTML', {
        /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
        get() {
          return innerHTMLDescriptor.get.apply(this, arguments);
        },
        /** `set`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should not stringify trusted values for setAttribute (unknown attribute)」描述的渲染、交互或错误处理结果。 */
  it('should not stringify trusted values for setAttribute (unknown attribute)', async () => {
    const setAttribute = Element.prototype.setAttribute;
    try {
      const setAttributeCalls = [];
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

  /** 测试场景：验证「should not stringify trusted values for setAttribute (known attribute)」描述的渲染、交互或错误处理结果。 */
  it('should not stringify trusted values for setAttribute (known attribute)', async () => {
    const setAttribute = Element.prototype.setAttribute;
    try {
      const setAttributeCalls = [];
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

  /** 测试场景：验证「should not stringify trusted values for setAttributeNS」描述的渲染、交互或错误处理结果。 */
  it('should not stringify trusted values for setAttributeNS', async () => {
    const setAttributeNS = Element.prototype.setAttributeNS;
    try {
      const setAttributeNSCalls = [];
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

  /** 测试场景：验证「should warn once when rendering script tag in jsx on client」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not warn when rendering a data block script tag」描述的渲染、交互或错误处理结果。 */
  it('should not warn when rendering a data block script tag', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <script type="application/json">{'{"key": "value"}'}</script>,
      );
    });
  });

  /** 测试场景：验证「should not warn when rendering a ld+json script tag」描述的渲染、交互或错误处理结果。 */
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
