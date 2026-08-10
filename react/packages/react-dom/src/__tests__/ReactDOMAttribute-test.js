/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 修复 JSDOM。 setAttribute 应该在无法隐式转换为字符串的东西上抛出错误。
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  // eslint-disable-next-line react-internal/safe-string-coercion
  return setAttribute.call(this, name, '' + value);
};

describe('ReactDOM unknown attribute', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /** `testUnknownAttributeRemoval`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testUnknownAttributeRemoval(givenValue) {
    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);

    await act(() => {
      root.render(<div unknown="something" />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe('something');

    await act(() => {
      root.render(<div unknown={givenValue} />);
    });

    expect(el.firstChild.hasAttribute('unknown')).toBe(false);
  }

  /** `testUnknownAttributeAssignment`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testUnknownAttributeAssignment(givenValue, expectedDOMValue) {
    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);

    await act(() => {
      root.render(<div unknown="something" />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe('something');

    await act(() => {
      root.render(<div unknown={givenValue} />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe(expectedDOMValue);
  }

  describe('unknown attributes', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「removes values null and undefined」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 DOM host 属性写入与提交路径。
     */
    it('removes values null and undefined', async () => {
      await testUnknownAttributeRemoval(null);
      await testUnknownAttributeRemoval(undefined);
    });

    /** 测试场景：验证「changes values true, false to null, and also warns once」描述的渲染、交互或错误处理结果。 */
    it('changes values true, false to null, and also warns once', async () => {
      await testUnknownAttributeAssignment(true, null);
      assertConsoleErrorDev([
        'Received `true` for a non-boolean attribute `unknown`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'unknown="true" or unknown={value.toString()}.\n' +
          '    in div (at **)',
      ]);
      await testUnknownAttributeAssignment(false, null);
    });

    /** 测试场景：验证「removes unknown attributes that were rendered but are now missing」描述的渲染、交互或错误处理结果。 */
    it('removes unknown attributes that were rendered but are now missing', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div unknown="something" />);
      });

      expect(el.firstChild.getAttribute('unknown')).toBe('something');

      await act(() => {
        root.render(<div />);
      });

      expect(el.firstChild.hasAttribute('unknown')).toBe(false);
    });

    /** 测试场景：验证「removes new boolean props」描述的渲染、交互或错误处理结果。 */
    it('removes new boolean props', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div inert={true} />);
      });

      expect(el.firstChild.getAttribute('inert')).toBe(true ? '' : null);
    });

    /** 测试场景：验证「warns once for empty strings in new boolean props」描述的渲染、交互或错误处理结果。 */
    it('warns once for empty strings in new boolean props', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div inert="" />);
      });
      assertConsoleErrorDev([
        'Received an empty string for a boolean attribute `inert`. ' +
          'This will treat the attribute as if it were false. ' +
          'Either pass `false` to silence this warning, or ' +
          'pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.\n' +
          '    in div (at **)',
      ]);

      expect(el.firstChild.getAttribute('inert')).toBe(true ? null : '');

      // 警告只会打印一次。
      await act(() => {
        root.render(<div inert="" />);
      });
    });

    /** 测试场景：验证「passes through strings」描述的渲染、交互或错误处理结果。 */
    it('passes through strings', async () => {
      await testUnknownAttributeAssignment('a string', 'a string');
    });

    /** 测试场景：验证「coerces numbers to strings」描述的渲染、交互或错误处理结果。 */
    it('coerces numbers to strings', async () => {
      await testUnknownAttributeAssignment(0, '0');
      await testUnknownAttributeAssignment(-1, '-1');
      await testUnknownAttributeAssignment(42, '42');
      await testUnknownAttributeAssignment(9000.99, '9000.99');
    });

    /** 测试场景：验证「coerces NaN to strings and warns」描述的渲染、交互或错误处理结果。 */
    it('coerces NaN to strings and warns', async () => {
      await testUnknownAttributeAssignment(NaN, 'NaN');
      assertConsoleErrorDev([
        'Received NaN for the `unknown` attribute. ' +
          'If this is expected, cast the value to a string.\n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「coerces objects to strings and warns」描述的渲染、交互或错误处理结果。 */
    it('coerces objects to strings and warns', async () => {
      const lol = {
        /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
        toString() {
          return 'lol';
        },
      };

      await testUnknownAttributeAssignment({hello: 'world'}, '[object Object]');
      await testUnknownAttributeAssignment(lol, 'lol');
    });

    /** 测试场景：验证「throws with Temporal-like objects」描述的渲染、交互或错误处理结果。 */
    it('throws with Temporal-like objects', async () => {
      /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class TemporalLike {
        /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
        valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
          throw new TypeError('prod message');
        }
        /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
        toString() {
          return '2020-01-01';
        }
      }
      /** `test`：封装当前用例复用的操作、回调或断言步骤。 */
      const test = () =>
        testUnknownAttributeAssignment(new TemporalLike(), null);

      await expect(test).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `unknown` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「removes symbols and warns」描述的渲染、交互或错误处理结果。 */
    it('removes symbols and warns', async () => {
      await testUnknownAttributeRemoval(Symbol('foo'));
      assertConsoleErrorDev([
        'Invalid value for prop `unknown` on <div> tag. Either remove it ' +
          'from the element, or pass a string or number value to keep it ' +
          'in the DOM. For details, see https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「removes functions and warns」描述的渲染、交互或错误处理结果。 */
    it('removes functions and warns', async () => {
      await testUnknownAttributeRemoval(function someFunction() {});
      assertConsoleErrorDev([
        'Invalid value for prop `unknown` on <div> tag. Either remove ' +
          'it from the element, or pass a string or number value to ' +
          'keep it in the DOM. For details, see ' +
          'https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「allows camelCase unknown attributes and warns」描述的渲染、交互或错误处理结果。 */
    it('allows camelCase unknown attributes and warns', async () => {
      const el = document.createElement('div');

      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div helloWorld="something" />);
      });
      assertConsoleErrorDev([
        'React does not recognize the `helloWorld` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom ' +
          'attribute, spell it as lowercase `helloworld` instead. ' +
          'If you accidentally passed it from a parent component, remove ' +
          'it from the DOM element.\n' +
          '    in div (at **)',
      ]);

      expect(el.firstChild.getAttribute('helloworld')).toBe('something');
    });
  });
});
