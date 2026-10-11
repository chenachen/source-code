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

    /** 为一组 ARIA props 创建独立并发根并等待 div 提交；beforeEach 重置模块清空警告去重缓存，让每个诊断 case 可独立观察。 */
    mountComponent = async function (props) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div {...props} />);
      });
    };
  });

  describe('aria-* props', () => {
    /** 给 div 传标准 aria-label 文本后提交；应无 DEV 警告，验证合法 aria-* 名称被标准表接受。 */
    it('should allow valid aria-* props', async () => {
      await mountComponent({'aria-label': 'Bumble bees'});
    });

    /** 分别及组合传 aria-braillelabel、aria-brailleroledescription、aria-colindextext、aria-rowindextext；各次提交应无警告，验证当前标准表包含这些 ARIA 1.3 扩展键。 */
    it('should allow new ARIA 1.3 attributes', async () => {
      // 测试 aria-braillelabel
      await mountComponent({'aria-braillelabel': 'Braille label text'});

      // 测试 aria-brailleroledescription 属性
      await mountComponent({'aria-brailleroledescription': 'Navigation menu'});

      // 测试 aria-colindextext
      await mountComponent({'aria-colindextext': 'Column A'});

      // 测试 aria-rowindextext 属性
      await mountComponent({'aria-rowindextext': 'Row 1'});

      // 测试本版本 validAriaProperties 表中的多个扩展属性一起使用
      await mountComponent({
        'aria-braillelabel': 'Braille text',
        'aria-colindextext': 'First column',
        'aria-rowindextext': 'First row',
      });
    });
    /** 仅传 aria-badprop；DEV 应生成单数 Invalid aria prop 汇总消息，验证未知标准形状属性归入批量诊断。 */
    it('should warn for one invalid aria-* prop', async () => {
      await mountComponent({'aria-badprop': 'maybe'});
      assertConsoleErrorDev([
        'Invalid aria prop `aria-badprop` on <div> tag. ' +
          'For details, see https://react.dev/link/invalid-aria-props\n' +
          '    in div (at **)',
      ]);
    });
    /** 同时传 aria-badprop 与 aria-malprop；DEV 应以一次复数消息列出两个键，验证多个未知 ARIA 名的汇总顺序。 */
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
    /** 传带连字符但混合大小写的 aria-hasPopup；DEV 应建议 aria-haspopup，验证名称归一化后能在标准表找到正确键。 */
    it('should warn for an improperly cased aria-* prop', async () => {
      // 有效属性名称是 aria-haspopup.
      await mountComponent({'aria-hasPopup': 'true'});
      assertConsoleErrorDev([
        'Unknown ARIA attribute `aria-hasPopup`. ' +
          'Did you mean `aria-haspopup`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 传 camelCase 的 ariaHasPopup；DEV 应建议 aria-haspopup，验证 ariaXxx 形状转换到已知规范名称。 */
    it('should warn for use of recognized camel case aria attributes', async () => {
      // 有效属性名称是 aria-haspopup.
      await mountComponent({ariaHasPopup: 'true'});
      assertConsoleErrorDev([
        'Invalid ARIA attribute `ariaHasPopup`. ' +
          'Did you mean `aria-haspopup`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 传 camelCase 的 ariaSomethingInvalid；DEV 仅提示 aria-* 与小写规则而不虚构替代名称，验证无法在标准表识别的拼写分支。 */
    it('should warn for use of unrecognized camel case aria attributes', async () => {
      // 未知的驼峰 ARIA 属性没有可建议的名称，警告只提示 aria-* 与小写命名规则。
      await mountComponent({ariaSomethingInvalid: 'true'});
      assertConsoleErrorDev([
        'Invalid ARIA attribute `ariaSomethingInvalid`. ARIA ' +
          'attributes follow the pattern aria-* and must be lowercase.\n' +
          '    in div (at **)',
      ]);
    });
  });
});
