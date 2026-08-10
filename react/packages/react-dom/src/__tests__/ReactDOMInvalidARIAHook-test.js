/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMInvalidARIAHook', () => {
  let React;
  let ReactDOMClient;
  let mountComponent;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    mountComponent = async function (props) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div {...props} />);
      });
    };
  });

  describe('aria-* props', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should allow valid aria-* props」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('should allow valid aria-* props', async () => {
      await mountComponent({'aria-label': 'Bumble bees'});
    });

    /** 测试场景：验证「should allow new ARIA 1.3 attributes」描述的渲染、交互或错误处理结果。 */
    it('should allow new ARIA 1.3 attributes', async () => {
      // 测试 aaria-braillelabel
      await mountComponent({'aria-braillelabel': 'Braille label text'});

      // 测试 aria-brailleroledescription 属性
      await mountComponent({'aria-brailleroledescription': 'Navigation menu'});

      // 测试 aria-colindextext
      await mountComponent({'aria-colindextext': 'Column A'});

      // 测试 aria-rowindex 属性
      await mountComponent({'aria-rowindextext': 'Row 1'});

      // 测试多个 ARIA 1.3 属性一起使用
      await mountComponent({
        'aria-braillelabel': 'Braille text',
        'aria-colindextext': 'First column',
        'aria-rowindextext': 'First row',
      });
    });
    /** 测试场景：验证「should warn for one invalid aria-* prop」描述的渲染、交互或错误处理结果。 */
    it('should warn for one invalid aria-* prop', async () => {
      await mountComponent({'aria-badprop': 'maybe'});
      assertConsoleErrorDev([
        'Invalid aria prop `aria-badprop` on <div> tag. ' +
          'For details, see https://react.dev/link/invalid-aria-props\n' +
          '    in div (at **)',
      ]);
    });
    /** 测试场景：验证「should warn for many invalid aria-* props」描述的渲染、交互或错误处理结果。 */
    it('should warn for many invalid aria-* props', async () => {
      await mountComponent({
        'aria-badprop': 'Very tall trees',
        'aria-malprop': 'Turbulent seas',
      });
      assertConsoleErrorDev([
        'Invalid aria props `aria-badprop`, `aria-malprop` on <div> ' +
          'tag. For details, see https://react.dev/link/invalid-aria-props\n' +
          '    in div (at **)',
      ]);
    });
    /** 测试场景：验证「should warn for an improperly cased aria-* prop」描述的渲染、交互或错误处理结果。 */
    it('should warn for an improperly cased aria-* prop', async () => {
      // 有效属性名称是 aria-haspopup.
      await mountComponent({'aria-hasPopup': 'true'});
      assertConsoleErrorDev([
        'Unknown ARIA attribute `aria-hasPopup`. ' +
          'Did you mean `aria-haspopup`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「should warn for use of recognized camel case aria attributes」描述的渲染、交互或错误处理结果。 */
    it('should warn for use of recognized camel case aria attributes', async () => {
      // 有效属性名称是 aria-haspopup.
      await mountComponent({ariaHasPopup: 'true'});
      assertConsoleErrorDev([
        'Invalid ARIA attribute `ariaHasPopup`. ' +
          'Did you mean `aria-haspopup`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「should warn for use of unrecognized camel case aria attributes」描述的渲染、交互或错误处理结果。 */
    it('should warn for use of unrecognized camel case aria attributes', async () => {
      // 有效属性名称是 aria-haspopup.
      await mountComponent({ariaSomethingInvalid: 'true'});
      assertConsoleErrorDev([
        'Invalid ARIA attribute `ariaSomethingInvalid`. ARIA ' +
          'attributes follow the pattern aria-* and must be lowercase.\n' +
          '    in div (at **)',
      ]);
    });
  });
});
