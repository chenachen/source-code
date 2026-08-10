/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMShorthandCSSPropertyCollision', () => {
  let act;

  let React;
  let ReactDOMClient;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();

    act = require('internal-test-utils').act;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should warn for conflicting CSS shorthand updates」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should warn for conflicting CSS shorthand updates', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div style={{font: 'foo', fontStyle: 'bar'}} />);
    });
    await act(() => {
      root.render(<div style={{font: 'foo'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender (fontStyle) ' +
        'when a conflicting property is set (font) can lead to styling ' +
        "bugs. To avoid this, don't mix shorthand and non-shorthand " +
        'properties for the same value; instead, replace the shorthand ' +
        'with separate values.' +
        '\n    in div (at **)',
    ]);

    // 这些更新是正确的，并不会警告。
    await act(() => {
      root.render(<div style={{font: 'qux', fontStyle: 'bar'}} />);
    });
    await act(() => {
      root.render(<div style={{font: 'foo', fontStyle: 'baz'}} />);
    });

    await act(() => {
      root.render(<div style={{font: 'qux', fontStyle: 'baz'}} />);
    });
    assertConsoleErrorDev([
      'Updating a style property during rerender (font) when ' +
        'a conflicting property is set (fontStyle) can lead to styling ' +
        "bugs. To avoid this, don't mix shorthand and non-shorthand " +
        'properties for the same value; instead, replace the shorthand ' +
        'with separate values.' +
        '\n    in div (at **)',
    ]);
    await act(() => {
      root.render(<div style={{fontStyle: 'baz'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender (font) when ' +
        'a conflicting property is set (fontStyle) can lead to styling ' +
        "bugs. To avoid this, don't mix shorthand and non-shorthand " +
        'properties for the same value; instead, replace the shorthand ' +
        'with separate values.' +
        '\n    in div (at **)',
    ]);

    // 这是一个特殊情况：backgroundPosition 并不是长手（它扩展为 backgroundPosition{X,Y}，但
    // background 也一样）。
    await act(() => {
      root.render(
        <div style={{background: 'yellow', backgroundPosition: 'center'}} />,
      );
    });
    await act(() => {
      root.render(<div style={{background: 'yellow'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender ' +
        '(backgroundPosition) when a conflicting property is set ' +
        "(background) can lead to styling bugs. To avoid this, don't mix " +
        'shorthand and non-shorthand properties for the same value; ' +
        'instead, replace the shorthand with separate values.' +
        '\n    in div (at **)',
    ]);
    await act(() => {
      root.render(
        <div style={{background: 'yellow', backgroundPosition: 'center'}} />,
      );
    });
    // 但同时设置它们是可以的:
    await act(() => {
      root.render(
        <div style={{background: 'green', backgroundPosition: 'top'}} />,
      );
    });
    await act(() => {
      root.render(<div style={{backgroundPosition: 'top'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender (background) ' +
        'when a conflicting property is set (backgroundPosition) can lead ' +
        "to styling bugs. To avoid this, don't mix shorthand and " +
        'non-shorthand properties for the same value; instead, replace the ' +
        'shorthand with separate values.' +
        '\n    in div (at **)',
    ]);

    // 这是一个更特殊的案例：borderLeft 和 borderStyle 重叠。
    await act(() => {
      root.render(
        <div style={{borderStyle: 'dotted', borderLeft: '1px solid red'}} />,
      );
    });
    await act(() => {
      root.render(<div style={{borderLeft: '1px solid red'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender (borderStyle) ' +
        'when a conflicting property is set (borderLeft) can lead to ' +
        "styling bugs. To avoid this, don't mix shorthand and " +
        'non-shorthand properties for the same value; instead, replace the ' +
        'shorthand with separate values.' +
        '\n    in div (at **)',
    ]);
    await act(() => {
      root.render(
        <div style={{borderStyle: 'dashed', borderLeft: '1px solid red'}} />,
      );
    });
    assertConsoleErrorDev([
      'Updating a style property during rerender (borderStyle) ' +
        'when a conflicting property is set (borderLeft) can lead to ' +
        "styling bugs. To avoid this, don't mix shorthand and " +
        'non-shorthand properties for the same value; instead, replace the ' +
        'shorthand with separate values.' +
        '\n    in div (at **)',
    ]);
    // 但同时设置它们是可以的:
    await act(() => {
      root.render(
        <div style={{borderStyle: 'dotted', borderLeft: '2px solid red'}} />,
      );
    });
    await act(() => {
      root.render(<div style={{borderStyle: 'dotted'}} />);
    });
    assertConsoleErrorDev([
      'Removing a style property during rerender (borderLeft) ' +
        'when a conflicting property is set (borderStyle) can lead to ' +
        "styling bugs. To avoid this, don't mix shorthand and " +
        'non-shorthand properties for the same value; instead, replace the ' +
        'shorthand with separate values.' +
        '\n    in div (at **)',
    ]);
  });
});
