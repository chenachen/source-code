/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 构造带style对象的宿主与类包装树，供SSR和客户端样式路径对比。 */
const React = require('react');
/** 创建客户端根以检查style属性写入和DEV样式校验。 */
const ReactDOMClient = require('react-dom/client');
/** 用renderToString检查名称连字符化、单位与空style序列化。 */
const ReactDOMServer = require('react-dom/server');
/** 等待客户端样式提交后检查DOM与诊断。 */
const act = require('internal-test-utils').act;
/** 匹配非法名称、末尾分号、NaN/Infinity的诊断及组件栈。 */
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

describe('CSSPropertyOperations', () => {
  /** SSR的style含left=0、margin=16、opacity=.5及padding字符串4px；输出应为0无单位、16px、.5无单位和原4px，验证只给非零且非unitless的数字补px。 */
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

  /** SSR中left/right值为两侧带空格的字符串；HTML应含去空格的16/4，验证字符串样式trim但不再补单位。 */
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

  /** SSR中flex=0、opacity=.5；HTML应保持纯数字，验证unitless属性映射。 */
  it('should not append `px` to styles that might need a number', () => {
    const styles = {
      flex: 0,
      opacity: 0.5,
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"flex:0;opacity:0.5"');
  });

  /** SSR传msTransition和MozTransition；属性名应为-ms-transition/-moz-transition，验证厂商前缀连字符化。 */
  it('should create vendor-prefixed markup correctly', () => {
    const styles = {
      msTransition: 'none',
      MozTransition: 'none',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"-ms-transition:none;-moz-transition:none"');
  });

  /** SSR传--someColor自定义属性；大小写名称与颜色值保持原样，验证CSS变量不走普通名称连字符化。 */
  it('should not hyphenate custom CSS property', () => {
    const styles = {
      '--someColor': '#000000',
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(html).toContain('"--someColor:#000000"');
  });

  /** 客户端挂载有backgroundColor/display样式的div；innerHTML应存在style attribute，验证有可用值时DOM输出样式。 */
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

  /** SSR传两个值均null的style对象；HTML不应有style attribute，验证空序列化结果省略属性。 */
  it('should not set style attribute when no styles exist', () => {
    const styles = {
      backgroundColor: null,
      display: null,
    };
    const div = <div style={styles} />;
    const html = ReactDOMServer.renderToString(div);
    expect(/style=/.test(html)).toBe(false);
  });

  /** Comp首次输出background-color带连字符的style键；DEV应建议backgroundColor并含Comp栈，验证样式名诊断。 */
  it('should warn when using hyphenated style names', async () => {
    /** 类fixture 输出带连字符background-color，触发首次样式名称诊断。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 输出带连字符background-color，触发首次样式名称诊断。 */
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

  /** Comp先无style再更新-ms-transform/-webkit-transform；DEV分别建议msTransform/WebkitTransform，验证更新添加属性同样校验。 */
  it('should warn when updating hyphenated style names', async () => {
    /** 类fixture 把props.style透传宿主div，首轮无style而更新后出现非法前缀键。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 把props.style透传宿主div，首轮无style而更新后出现非法前缀键。 */
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

  /** Comp传msTransform/oTransform/webkitTransform；仅后两者诊断并建议大写O/Webkit，验证ms前缀例外。 */
  it('warns when miscapitalizing vendored style names', async () => {
    /** 类fixture 输出ms/o/webkit三个前缀键，验证ms合法而其余大小写错误。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 输出ms/o/webkit三个前缀键，验证ms合法而其余大小写错误。 */
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
      // msTransform 的小写 ms 前缀合法，不应警告；这里只检查 oTransform 与 webkitTransform。
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

  /** style含fontFamily、url(foo;bar)、blue;及red;空白；只末尾分号两值诊断，验证URL内部的分号并不违规。 */
  it('should warn about style having a trailing semicolon', async () => {
    /** 类fixture 输出含URL内部与值末尾分号的样式，区分真正非法结尾。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 输出含URL内部与值末尾分号的样式，区分真正非法结尾。 */
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

  /** Comp.fontSize=NaN；DEV应给无效fontSize诊断并含组件栈，验证非有限数字校验。 */
  it('should warn about style containing a NaN value', async () => {
    /** 类fixture 输出fontSize=NaN，触发非有限数值诊断。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 输出fontSize=NaN，触发非有限数值诊断。 */
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

  /** Comp同时传--foo-primary与backgroundColor为red；act完成且无未消费诊断，验证CSS变量名称不触发普通连字符名警告。 */
  it('should not warn when setting CSS custom properties', async () => {
    /** 类fixture 同时输出CSS变量--foo-primary与普通backgroundColor，验证变量合法。 */
    class Comp extends React.Component {
      /** 同时输出CSS变量--foo-primary与普通backgroundColor，验证变量合法。 */
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

  /** Comp.fontSize=1/0；DEV应给Infinity无效诊断，验证无穷大样式。 */
  it('should warn about style containing an Infinity value', async () => {
    /** 类fixture 输出fontSize=Infinity，触发无穷大样式诊断。 */
    class Comp extends React.Component {
      /** 固定组件诊断名称为Comp，让各style警告栈可预测。 */
      static displayName = 'Comp';

      /** 输出fontSize=Infinity，触发无穷大样式诊断。 */
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

  /** 客户端CSS变量--foo的输入为字符串5；getPropertyValue仍5，验证变量值不补单位；本例没有用数字5。 */
  it('should not add units to CSS custom properties', async () => {
    /** 类fixture 输出CSS变量--foo的字符串5，检查原值不补px。 */
    class Comp extends React.Component {
      /** 输出CSS变量--foo的字符串5，检查原值不补px。 */
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
