/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `ReactDOMServer`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServer = require('react-dom/server');
/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;
/** `assertConsoleErrorDev`：保存当前测试场景复用的夹具、状态或回调。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('CSSPropertyOperations', () => {
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should automatically append `px` to relevant styles」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should automatically append `px` to relevant styles', () => {
    const styles = {
      left: 0,
      margin: 16,
      opacity: 0.5,
      padding: '4px',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"left:0;margin:16px;opacity:0.5;padding:4px"');
  });

  /** 测试场景：验证「should trim values」描述的渲染、交互或错误处理结果。 */
  it('should trim values', () => {
    const styles = {
      left: '16 ',
      opacity: 0.5,
      right: ' 4 ',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"left:16;opacity:0.5;right:4"');
  });

  /** 测试场景：验证「should not append `px` to styles that might need a number」描述的渲染、交互或错误处理结果。 */
  it('should not append `px` to styles that might need a number', () => {
    const styles = {
      flex: 0,
      opacity: 0.5,
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"flex:0;opacity:0.5"');
  });

  /** 测试场景：验证「should create vendor-prefixed markup correctly」描述的渲染、交互或错误处理结果。 */
  it('should create vendor-prefixed markup correctly', () => {
    const styles = {
      msTransition: 'none',
      MozTransition: 'none',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"-ms-transition:none;-moz-transition:none"');
  });

  /** 测试场景：验证「should not hyphenate custom CSS property」描述的渲染、交互或错误处理结果。 */
  it('should not hyphenate custom CSS property', () => {
    const styles = {
      '--someColor': '#000000',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"--someColor:#000000"');
  });

  /** 测试场景：验证「should set style attribute when styles exist」描述的渲染、交互或错误处理结果。 */
  it('should set style attribute when styles exist', async () => {
    const styles = {
      backgroundColor: '#000',
      display: 'none',
    };
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div style={styles} />);
    });

    const div = container.firstChild;
    expect(/style=".*"/.test(container.innerHTML)).toBe(true);
  });

  /** 测试场景：验证「should not set style attribute when no styles exist」描述的渲染、交互或错误处理结果。 */
  it('should not set style attribute when no styles exist', () => {
    const styles = {
      backgroundColor: null,
      display: null,
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(/style=/.test(html)).toBe(false);
  });

  /** 测试场景：验证「should warn when using hyphenated style names」描述的渲染、交互或错误处理结果。 */
  it('should warn when using hyphenated style names', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={{'background-color': 'crimson'}} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    assertConsoleErrorDev([
      'Unsupported style property background-color. Did you mean backgroundColor?' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when updating hyphenated style names」描述的渲染、交互或错误处理结果。 */
  it('should warn when updating hyphenated style names', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={this.props.style} />;
      }
    }

    const styles = {
      '-ms-transform': 'translate3d(0, 0, 0)',
      '-webkit-transform': 'translate3d(0, 0, 0)',
    };
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    await act(() => {
      root.render(<Comp style={styles} />);
    });
    assertConsoleErrorDev([
      'Unsupported style property -ms-transform. Did you mean msTransform?' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
      'Unsupported style property -webkit-transform. Did you mean WebkitTransform?' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「warns when miscapitalizing vendored style names」描述的渲染、交互或错误处理结果。 */
  it('warns when miscapitalizing vendored style names', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div
            style={{
              msTransform: 'translate3d(0, 0, 0)',
              oTransform: 'translate3d(0, 0, 0)',
              webkitTransform: 'translate3d(0, 0, 0)',
            }}
          />
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    assertConsoleErrorDev([
      // 转换已经正确了,不应该警告
      'Unsupported vendor-prefixed style property oTransform. ' +
        'Did you mean OTransform?' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
      'Unsupported vendor-prefixed style property webkitTransform. ' +
        'Did you mean WebkitTransform?' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about style having a trailing semicolon」描述的渲染、交互或错误处理结果。 */
  it('should warn about style having a trailing semicolon', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div
            style={{
              fontFamily: 'Helvetica, arial',
              backgroundImage: 'url(foo;bar)',
              backgroundColor: 'blue;',
              color: 'red;   ',
            }}
          />
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    assertConsoleErrorDev([
      "Style property values shouldn't contain a semicolon. " +
        'Try "backgroundColor: blue" instead.' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
      "Style property values shouldn't contain a semicolon. " +
        'Try "color: red" instead.' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about style containing a NaN value」描述的渲染、交互或错误处理结果。 */
  it('should warn about style containing a NaN value', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={{fontSize: NaN}} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    assertConsoleErrorDev([
      '`NaN` is an invalid value for the `fontSize` css style property.' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「should not warn when setting CSS custom properties」描述的渲染、交互或错误处理结果。 */
  it('should not warn when setting CSS custom properties', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={{'--foo-primary': 'red', backgroundColor: 'red'}} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
  });

  /** 测试场景：验证「should warn about style containing an Infinity value」描述的渲染、交互或错误处理结果。 */
  it('should warn about style containing an Infinity value', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.displayName`：记录测试夹具在当前场景中的状态。 */
      static displayName = 'Comp';

      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={{fontSize: 1 / 0}} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });
    assertConsoleErrorDev([
      '`Infinity` is an invalid value for the `fontSize` css style property.' +
        '\n    in div (at **)' +
        '\n    in Comp (at **)',
    ]);
  });

  /** 测试场景：验证「should not add units to CSS custom properties」描述的渲染、交互或错误处理结果。 */
  it('should not add units to CSS custom properties', async () => {
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div style={{'--foo': '5'}} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp />);
    });

    expect(container.children[0].style.getPropertyValue('--foo')).toEqual('5');
  });
});
