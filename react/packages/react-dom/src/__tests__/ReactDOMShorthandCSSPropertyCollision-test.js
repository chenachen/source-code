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

  /** 同一 div 依次更新 font/fontStyle、background/backgroundPosition 与交叠的 borderStyle/borderLeft；仅改变或删除一方而保留另一方时应出现更新/移除冲突诊断，同轮一起更新则无警告，验证把简写展开到长属性后判断实际覆盖冲突，而非只看名称是否相同。 */
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

    // 这是一个特殊情况：backgroundPosition 并不是独立长属性（它扩展为 backgroundPosition{X,Y}，但
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
