/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMComponent', () => {
  let React;
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  const ReactFeatureFlags = require('shared/ReactFeatureFlags');

  let act;
  let assertLog;
  let Scheduler;
  let assertConsoleErrorDev;

  /** 各例重置模块并重载React/DOM/Scheduler及内部act，使用同一轮实例；套件外层FeatureFlags引用仍用于事件顺序条件。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    assertLog = require('internal-test-utils').assertLog;
  });

  /** 恢复jest/spy改写的方法；事件顺序例的document监听不由restoreAllMocks移除，其finally仅移容器。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateDOM', () => {
    /** div从无class更新foo→bar→null，DOM className最终空串，验证别名属性的增加、替换与删除。 */
    it('should handle className', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={{}} />);
      });

      await act(() => {
        root.render(<div className={'foo'} />);
      });
      expect(container.firstChild.className).toEqual('foo');
      await act(() => {
        root.render(<div className={'bar'} />);
      });
      expect(container.firstChild.className).toEqual('bar');
      await act(() => {
        root.render(<div className={null} />);
      });
      expect(container.firstChild.className).toEqual('');
    });

    /** 空style更新display/left字符串、top数字2、fontFamily字符串，top成为2px；再用空串/null/布尔清除各项，验证样式值转换与重置。 */
    it('should gracefully handle various style value types', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={{}} />);
      });
      const stubStyle = container.firstChild.style;

      // 设置初始样式
      const setup = {
        display: 'block',
        left: '1px',
        top: 2,
        fontFamily: 'Arial',
      };
      await act(() => {
        root.render(<div style={setup} />);
      });
      expect(stubStyle.display).toEqual('block');
      expect(stubStyle.left).toEqual('1px');
      expect(stubStyle.top).toEqual('2px');
      expect(stubStyle.fontFamily).toEqual('Arial');

      // 重置样式为默认状态
      const reset = {display: '', left: null, top: false, fontFamily: true};
      await act(() => {
        root.render(<div style={reset} />);
      });
      expect(stubStyle.display).toEqual('');
      expect(stubStyle.left).toEqual('');
      expect(stubStyle.top).toEqual('');
      expect(stubStyle.fontFamily).toEqual('');
    });

    /** 同一style代理对象以getter读取可变store，DEV冻结也仍能改store；三次复用对象后DOM仍none/Arial/1.2，去掉style才清空，验证差分依据对象身份而不重读同对象变更。 */
    it('should not update styles when mutating a proxy style object', async () => {
      const styleStore = {
        display: 'none',
        fontFamily: 'Arial',
        lineHeight: 1.2,
      };
      // 使用代理样式外壳，即使DEV冻结外壳，setter仍可修改底层styleStore。
      const styles = {
        /** 读取代理store的display，允许同一冻结style外壳暴露后来值；React复用该外壳时仍不应重写DOM。 */
        get display() {
          return styleStore.display;
        },
        /** 只更新display底层store，不新增或修改style外壳字段，绕过DEV冻结以测试引用不变的差分。 */
        set display(v) {
          styleStore.display = v;
        },
        /** 读取store当前fontFamily，供同引用style输入测试。 */
        get fontFamily() {
          return styleStore.fontFamily;
        },
        /** 改fontFamily底层值而保持styles对象身份，DOM应仍保留原Arial。 */
        set fontFamily(v) {
          styleStore.fontFamily = v;
        },
        /** 读取store中的无单位lineHeight，初次DOM应得到1.2。 */
        get lineHeight() {
          return styleStore.lineHeight;
        },
        /** 只把store lineHeight改0.5；复用styles对象时不应把它写到DOM。 */
        set lineHeight(v) {
          styleStore.lineHeight = v;
        },
      };
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={styles} />);
      });

      const stubStyle = container.firstChild.style;
      stubStyle.display = styles.display;
      stubStyle.fontFamily = styles.fontFamily;

      styles.display = 'block';

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('none');
      expect(stubStyle.fontFamily).toEqual('Arial');
      expect(stubStyle.lineHeight).toEqual('1.2');

      styles.fontFamily = 'Helvetica';

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('none');
      expect(stubStyle.fontFamily).toEqual('Arial');
      expect(stubStyle.lineHeight).toEqual('1.2');

      styles.lineHeight = 0.5;

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('none');
      expect(stubStyle.fontFamily).toEqual('Arial');
      expect(stubStyle.lineHeight).toEqual('1.2');

      await act(() => {
        root.render(<div style={undefined} />);
      });
      expect(stubStyle.display).toBe('');
      expect(stubStyle.fontFamily).toBe('');
      expect(stubStyle.lineHeight).toBe('');
    });

    /** App用state引用普通style对象挂载，DEV再给style新增position应抛错；验证样式对象冻结，仅开发分支有变更断言。 */
    it('should throw when mutating style objects', async () => {
      const style = {border: '1px solid black'};

      /** state持有原style引用的类fixture，供开发冻结后外部修改测试。 */
      class App extends React.Component {
        /** 保存同一个style对象，不拷贝，以便外部新增键命中React冻结的实际输入。 */
        state = {style: style};

        /** 把state.style传主机div，触发样式初始化及DEV冻结。 */
        render() {
          return <div style={this.state.style}>asd</div>;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<App />);
      });

      if (__DEV__) {
        expect(() => (style.position = 'absolute')).toThrow();
      }
    });

    /** 普通div的未知foo值为函数，开发警告要求字符串/数字；本例验证无效值诊断，不是拒绝所有未知属性名。 */
    it('should warn for unknown prop', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div foo={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `foo` on <div> tag. Either remove it ' +
          'from the element, or pass a string or number value to keep ' +
          'it in the DOM. For details, see https://react.dev/link/attribute-behavior ' +
          '\n    in div (at **)',
      ]);
    });

    /** div同时带函数foo/baz，只输出一条合并的Invalid values诊断，验证同元素多个无效值集中报告。 */
    it('should group multiple unknown prop warnings together', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div foo={() => {}} baz={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid values for props `foo`, `baz` on <div> tag. Either remove ' +
          'them from the element, or pass a string or number value to keep ' +
          'them in the DOM. For details, see https://react.dev/link/attribute-behavior ' +
          '\n    in div (at **)',
      ]);
    });

    /** div使用错误事件名onDblClick，开发建议onDoubleClick，验证已知事件别名拼写诊断。 */
    it('should warn for onDblClick prop', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onDblClick={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid event handler property `onDblClick`. Did you mean `onDoubleClick`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 依次挂未知onUnknown/onunknown/on-unknown字符串，三种都警告且无DOM attribute/property，验证未知on前缀不会作为可执行字符串落DOM。 */
    it('should warn for unknown string event handlers', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onUnknown='alert("hack")' />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `onUnknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('onUnknown')).toBe(false);
      expect(container.firstChild.onUnknown).toBe(undefined);
      await act(() => {
        root.render(<div onunknown='alert("hack")' />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `onunknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('onunknown')).toBe(false);
      expect(container.firstChild.onunknown).toBe(undefined);

      await act(() => {
        root.render(<div on-unknown='alert("hack")' />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `on-unknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('on-unknown')).toBe(false);
      expect(container.firstChild['on-unknown']).toBe(undefined);
    });

    /** 同三种未知on拼写的值改为函数，仍警告且无attribute/property，验证函数值不能绕过未知事件过滤。 */
    it('should warn for unknown function event handlers', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onUnknown={function () {}} />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `onUnknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('onUnknown')).toBe(false);
      expect(container.firstChild.onUnknown).toBe(undefined);
      await act(() => {
        root.render(<div onunknown={function () {}} />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `onunknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('onunknown')).toBe(false);
      expect(container.firstChild.onunknown).toBe(undefined);
      await act(() => {
        root.render(<div on-unknown={function () {}} />);
      });
      assertConsoleErrorDev([
        'Unknown event handler property `on-unknown`. It will be ignored.\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.hasAttribute('on-unknown')).toBe(false);
      expect(container.firstChild['on-unknown']).toBe(undefined);
    });

    /** 大写CHILDREN传字符串5，开发建议children但仍作为普通attribute读取到5，验证保留名大小写警告不等于删除该原始属性。 */
    it('should warn for badly cased React attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div CHILDREN="5" />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `CHILDREN`. Did you mean `children`?\n' +
          '    in div (at **)',
      ]);
      expect(container.firstChild.getAttribute('CHILDREN')).toBe('5');
    });

    /** 类fixture返回margin字符串0，act成功且无警告；验证CSS零值允许不带单位，无显式DOM数值断言。 */
    it('should not warn for "0" as a unitless style value', async () => {
      /** 返回零值margin的类fixture，检查样式校验不误报合法字符串0。 */
      class Component extends React.Component {
        /** 输出margin字符串0而非数字，覆盖已有CSS单位规则的零值特例。 */
        render() {
          return <div style={{margin: '0'}} />;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Component />);
      });
    });

    /** span fontSize为NaN，首次开发诊断明确属性名，再复用style对象渲染不再报；验证非法样式值诊断与缓存去重。 */
    it('should warn nicely about NaN in style', async () => {
      const style = {fontSize: NaN};
      const div = document.createElement('div');
      const root = ReactDOMClient.createRoot(div);
      await act(() => {
        root.render(<span style={style} />);
      });
      assertConsoleErrorDev([
        '`NaN` is an invalid value for the `fontSize` css style property.\n' +
          '    in span (at **)',
      ]);
      await act(() => {
        root.render(<span style={style} />);
      });
    });

    /** fontSize对象的valueOf抛TypeError而toString返回日期，act最终拒绝同错误、开发报告两次unsupported type；验证样式会做字符串前的类型强制转换。 */
    it('throws with Temporal-like objects as style values', async () => {
      /** 模拟Temporal对象：字符串表示可用但数值默认转换抛错，暴露样式值的隐式转换路径。 */
      class TemporalLike {
        /** valueOf总抛prod message TypeError，保证错误来自默认类型转换而非日期toString。 */
        valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
          throw new TypeError('prod message');
        }
        /** 提供日期字符串表示；此方法可用不代表样式赋值绕过valueOf。 */
        toString() {
          return '2020-01-01';
        }
      }
      const style = {fontSize: new TemporalLike()};
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await expect(async () => {
        await act(() => {
          root.render(<span style={style} />);
        });
      }).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `fontSize` CSS property is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in span (at **)',
        'The provided `fontSize` CSS property is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in span (at **)',
      ]);
    });

    /** style最初null，再变display block对象，保存的CSSStyleDeclaration变block，验证从无样式到对象的初始化。 */
    it('should update styles if initially null', async () => {
      let styles = null;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={styles} />);
      });

      const stubStyle = container.firstChild.style;

      styles = {display: 'block'};

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('block');
    });

    /** style按null→block→null→同block对象→null反复更新，display逐次block/空串，验证删除后再添加不会被旧引用差分遗漏。 */
    it('should update styles if updated to null multiple times', async () => {
      let styles = null;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={styles} />);
      });

      styles = {display: 'block'};
      const stubStyle = container.firstChild.style;

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('block');

      await act(() => {
        root.render(<div style={null} />);
      });
      expect(stubStyle.display).toEqual('');

      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('block');

      await act(() => {
        root.render(<div style={null} />);
      });
      expect(stubStyle.display).toEqual('');
    });

    /** 自定义父内同时有自定义child slot first与button slot second，两个light DOM节点属性分别保存，验证普通元素和Web Component都允许slot。 */
    it('should allow named slot projection on both web components and regular DOM elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <my-component>
            <my-second-component slot="first" />
            <button slot="second">Hello</button>
          </my-component>,
        );
      });

      const lightDOM = container.firstChild.childNodes;

      expect(lightDOM[0].getAttribute('slot')).toBe('first');
      expect(lightDOM[1].getAttribute('slot')).toBe('second');
    });

    /** 自定义元素children及两个suppress开关初始true再false，三者始终不成为attribute，验证保留props在初始化/更新中均过滤。 */
    it('should skip reserved props on web components', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <my-component
            children={['foo']}
            suppressContentEditableWarning={true}
            suppressHydrationWarning={true}
          />,
        );
      });
      expect(container.firstChild.hasAttribute('children')).toBe(false);
      expect(
        container.firstChild.hasAttribute('suppressContentEditableWarning'),
      ).toBe(false);
      expect(
        container.firstChild.hasAttribute('suppressHydrationWarning'),
      ).toBe(false);

      await act(() => {
        root.render(
          <my-component
            children={['bar']}
            suppressContentEditableWarning={false}
            suppressHydrationWarning={false}
          />,
        );
      });
      expect(container.firstChild.hasAttribute('children')).toBe(false);
      expect(
        container.firstChild.hasAttribute('suppressContentEditableWarning'),
      ).toBe(false);
      expect(
        container.firstChild.hasAttribute('suppressHydrationWarning'),
      ).toBe(false);
    });

    /** 自定义元素危险HTML hi→bye，两次均不生成dangerouslySetInnerHTML attribute；本例只检查保留名过滤，未断言innerHTML文本。 */
    it('should skip dangerouslySetInnerHTML on web components', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<my-component dangerouslySetInnerHTML={{__html: 'hi'}} />);
      });
      expect(container.firstChild.hasAttribute('dangerouslySetInnerHTML')).toBe(
        false,
      );

      await act(() => {
        root.render(<my-component dangerouslySetInnerHTML={{__html: 'bye'}} />);
      });
      expect(container.firstChild.hasAttribute('dangerouslySetInnerHTML')).toBe(
        false,
      );
    });

    /** 危险HTML内容依次文本、0、false、空串、null、undefined，textContent分别文本/0/false/空，验证nullish清空而其它假值仍写字符串。 */
    it('should render null and undefined as empty but print other falsy values', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: 'textContent'}} />);
      });
      expect(container.textContent).toEqual('textContent');

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: 0}} />);
      });
      expect(container.textContent).toEqual('0');

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: false}} />);
      });
      expect(container.textContent).toEqual('false');

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: ''}} />);
      });
      expect(container.textContent).toEqual('');

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: null}} />);
      });
      expect(container.textContent).toEqual('');

      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: undefined}} />);
      });
      expect(container.textContent).toEqual('');
    });

    /** img初始height17，再删该prop，hasAttribute由true变false，验证旧属性从DOM移除。 */
    it('should remove attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<img height="17" />);
      });

      expect(container.firstChild.hasAttribute('height')).toBe(true);
      await act(() => {
        root.render(<img />);
      });
      expect(container.firstChild.hasAttribute('height')).toBe(false);
    });

    /** div className monkey更新为空props，DOM className空串，验证别名class属性清除。 */
    it('should remove properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div className="monkey" />);
      });

      expect(container.firstChild.className).toEqual('monkey');
      await act(() => {
        root.render(<div />);
      });
      expect(container.firstChild.className).toEqual('');
    });

    /** img src/data-foo的null/undefined交换、去掉、再加，始终没有两attribute，验证nullish值在增加/更新/删除各路径均不写。 */
    it('should not set null/undefined attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      // 初始渲染。
      await act(() => {
        root.render(<img src={null} data-foo={undefined} />);
      });
      const node = container.firstChild;
      expect(node.hasAttribute('src')).toBe(false);
      expect(node.hasAttribute('data-foo')).toBe(false);
      // 单向更新。
      await act(() => {
        root.render(<img src={undefined} data-foo={null} />);
      });
      expect(node.hasAttribute('src')).toBe(false);
      expect(node.hasAttribute('data-foo')).toBe(false);
      // 向另一个方向更新。
      await act(() => {
        root.render(<img src={null} data-foo={undefined} />);
      });
      expect(node.hasAttribute('src')).toBe(false);
      expect(node.hasAttribute('data-foo')).toBe(false);
      // 移除。
      await act(() => {
        root.render(<img />);
      });
      expect(node.hasAttribute('src')).toBe(false);
      expect(node.hasAttribute('data-foo')).toBe(false);
      // 增加.
      await act(() => {
        root.render(<img src={undefined} data-foo={null} />);
      });
      expect(node.hasAttribute('src')).toBe(false);
      expect(node.hasAttribute('data-foo')).toBe(false);
    });

    /** img src空串警告且不生成attribute，改abc存在，再空串警告并删除，验证URL空串在初始化与更新中都过滤。 */
    it('should not add an empty src attribute', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<img src="" />);
      });
      assertConsoleErrorDev([
        'An empty string ("") was passed to the src attribute. ' +
          'This may cause the browser to download the whole page again over the network. ' +
          'To fix this, either do not render the element at all ' +
          'or pass null to src instead of an empty string.\n' +
          '    in img (at **)',
      ]);
      const node = container.firstChild;
      expect(node.hasAttribute('src')).toBe(false);

      await act(() => {
        root.render(<img src="abc" />);
      });
      expect(node.hasAttribute('src')).toBe(true);

      await act(() => {
        root.render(<img src="" />);
      });
      assertConsoleErrorDev([
        'An empty string ("") was passed to the src attribute. ' +
          'This may cause the browser to download the whole page again over the network. ' +
          'To fix this, either do not render the element at all ' +
          'or pass null to src instead of an empty string.\n' +
          '    in img (at **)',
      ]);
      expect(node.hasAttribute('src')).toBe(false);
    });

    /** link href空串警告且不存在，改abc再空串又删除并警告，验证非anchor的空href过滤。 */
    it('should not add an empty href attribute', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<link href="" />);
      });
      assertConsoleErrorDev([
        'An empty string ("") was passed to the href attribute. ' +
          'To fix this, either do not render the element at all ' +
          'or pass null to href instead of an empty string.\n' +
          '    in link (at **)',
      ]);
      const node = container.firstChild;
      expect(node.hasAttribute('href')).toBe(false);

      await act(() => {
        root.render(<link href="abc" />);
      });
      expect(node.hasAttribute('href')).toBe(true);

      await act(() => {
        root.render(<link href="" />);
      });
      assertConsoleErrorDev([
        'An empty string ("") was passed to the href attribute. ' +
          'To fix this, either do not render the element at all ' +
          'or pass null to href instead of an empty string.\n' +
          '    in link (at **)',
      ]);
      expect(node.hasAttribute('href')).toBe(false);
    });

    /** a href空串保留为空attribute，验证anchor允许当前页链接这一标签例外。 */
    it('should allow an empty href attribute on anchors', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<a href="" />);
      });
      const node = container.firstChild;
      expect(node.getAttribute('href')).toBe('');
    });

    /** form action空串→abc→空串，action始终可用且最终为空，验证表单action允许空URL。 */
    it('should allow an empty action attribute', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<form action="" />);
      });
      const node = container.firstChild;
      expect(node.getAttribute('action')).toBe('');

      await act(() => {
        root.render(<form action="abc" />);
      });
      expect(node.hasAttribute('action')).toBe(true);

      await act(() => {
        root.render(<form action="" />);
      });
      expect(node.getAttribute('action')).toBe('');
    });

    /** 父form action hello而button formAction空串，按钮formaction存在且为空，验证显式空覆盖父默认值。 */
    it('allows empty string of a formAction to override the default of a parent', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <form action="hello">
            <button formAction="" />,
          </form>,
        );
      });
      const node = container.firstChild.firstChild;
      expect(node.hasAttribute('formaction')).toBe(true);
      expect(node.getAttribute('formaction')).toBe('');
    });

    /** 自定义元素action/formAction/href/src均空串，四attribute都保留，验证普通URL字段过滤不套用自定义标签。 */
    it('should not filter attributes for custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <some-custom-element action="" formAction="" href="" src="" />,
        );
      });
      const node = container.firstChild;
      expect(node.hasAttribute('action')).toBe(true);
      expect(node.hasAttribute('formAction')).toBe(true);
      expect(node.hasAttribute('href')).toBe(true);
      expect(node.hasAttribute('src')).toBe(true);
    });

    /** HTML form acceptCharset foo→boo→null→恢复→undefined→恢复→移除，始终用accept-charset而无acceptCharset，验证HTML别名与删除各分支。 */
    it('should apply React-specific aliases to HTML elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<form acceptCharset="foo" />);
      });
      const node = container.firstChild;
      // 测试属性初始化。
      expect(node.getAttribute('accept-charset')).toBe('foo');
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 测试属性更新。
      await act(() => {
        root.render(<form acceptCharset="boo" />);
      });
      expect(node.getAttribute('accept-charset')).toBe('boo');
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 测试属性删除，将值设置为 null。
      await act(() => {
        root.render(<form acceptCharset={null} />);
      });
      expect(node.hasAttribute('accept-charset')).toBe(false);
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 恢复。
      await act(() => {
        root.render(<form acceptCharset="foo" />);
      });
      expect(node.getAttribute('accept-charset')).toBe('foo');
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 测试属性删除，将值设置为 undefined。
      await act(() => {
        root.render(<form acceptCharset={undefined} />);
      });
      expect(node.hasAttribute('accept-charset')).toBe(false);
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 恢复。
      await act(() => {
        root.render(<form acceptCharset="foo" />);
      });
      expect(node.getAttribute('accept-charset')).toBe('foo');
      expect(node.hasAttribute('acceptCharset')).toBe(false);
      // 测试属性删除。
      await act(() => {
        root.render(<form />);
      });
      expect(node.hasAttribute('accept-charset')).toBe(false);
      expect(node.hasAttribute('acceptCharset')).toBe(false);
    });

    /** SVG arabicForm同样经历字符串、null、undefined与缺省，使用arabic-form且不留原名，验证SVG别名的初始化/更新/删除。 */
    it('should apply React-specific aliases to SVG elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<svg arabicForm="foo" />);
      });
      const node = container.firstChild;
      // 测试属性初始化。
      expect(node.getAttribute('arabic-form')).toBe('foo');
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 测试属性更新。
      await act(() => {
        root.render(<svg arabicForm="boo" />);
      });
      expect(node.getAttribute('arabic-form')).toBe('boo');
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 测试属性删除，将值设置为 null。
      await act(() => {
        root.render(<svg arabicForm={null} />);
      });
      expect(node.hasAttribute('arabic-form')).toBe(false);
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 恢复。
      await act(() => {
        root.render(<svg arabicForm="foo" />);
      });
      expect(node.getAttribute('arabic-form')).toBe('foo');
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 测试属性删除，将值设置为 undefined。
      await act(() => {
        root.render(<svg arabicForm={undefined} />);
      });
      expect(node.hasAttribute('arabic-form')).toBe(false);
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 恢复。
      await act(() => {
        root.render(<svg arabicForm="foo" />);
      });
      expect(node.getAttribute('arabic-form')).toBe('foo');
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 测试属性删除。
      await act(() => {
        root.render(<svg />);
      });
      expect(node.hasAttribute('arabic-form')).toBe(false);
      expect(node.hasAttribute('arabicForm')).toBe(false);
    });

    /** 自定义标签foo bar更新为仅bar buzz，旧foo删除、新bar保存buzz，验证任意自定义attribute的双向差分。 */
    it('should properly update custom attributes on custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<some-custom-element foo="bar" />);
      });
      expect(container.firstChild.getAttribute('foo')).toBe('bar');
      await act(() => {
        root.render(<some-custom-element bar="buzz" />);
      });
      expect(container.firstChild.hasAttribute('foo')).toBe(false);
      expect(container.firstChild.getAttribute('bar')).toBe('buzz');
      const node = container.firstChild;
      expect(node.hasAttribute('foo')).toBe(false);
      expect(node.getAttribute('bar')).toBe('buzz');
    });

    /** 自定义标签arabicForm foo→boo后改acceptCharset buzz，保留原名、删除旧名且不生成SVG/HTML连字符别名，验证自定义路径名称规则。 */
    it('should not apply React-specific aliases to custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<some-custom-element arabicForm="foo" />);
      });
      const node = container.firstChild;
      // 不应像 SVG 那样转换为 `arabic-form`。
      expect(node.getAttribute('arabicForm')).toBe('foo');
      expect(node.hasAttribute('arabic-form')).toBe(false);
      // 测试属性更新。
      await act(() => {
        root.render(<some-custom-element arabicForm="boo" />);
      });
      expect(node.getAttribute('arabicForm')).toBe('boo');
      // 测试属性删除和添加。
      await act(() => {
        root.render(<some-custom-element acceptCharset="buzz" />);
      });
      // 检查之前的属性已删除.
      expect(node.hasAttribute('arabicForm')).toBe(false);
      // 不应像 HTML 属性那样转换为 `accept-charset`。
      expect(node.getAttribute('acceptCharset')).toBe('buzz');
      expect(node.hasAttribute('accept-charset')).toBe(false);
    });

    /** style从display none/color red改为仅color green，display清空而color变green，验证删除单个样式键与修改保留键。 */
    it('should clear a single style prop when changing `style`', async () => {
      let styles = {display: 'none', color: 'red'};
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={styles} />);
      });

      const stubStyle = container.firstChild.style;

      styles = {color: 'green'};
      await act(() => {
        root.render(<div style={styles} />);
      });
      expect(stubStyle.display).toEqual('');
      expect(stubStyle.color).toEqual('green');
    });

    /** SSR普通div循环三遍传含引号onclick与闭标签script的两种非法键，结果不含onclick/script且仅首次诊断每种键，验证键过滤及警告缓存。 */
    it('should reject attribute key injection attack on markup for regular DOM (SSR)', () => {
      for (let i = 0; i < 3; i++) {
        const element1 = React.createElement(
          'div',
          {'blah" onclick="beevil" noise="hi': 'selected'},
          null,
        );
        const element2 = React.createElement(
          'div',
          {'></div><script>alert("hi")</script>': 'selected'},
          null,
        );
        const result1 = ReactDOMServer.renderToString(element1);
        const result2 = ReactDOMServer.renderToString(element2);
        expect(result1.toLowerCase()).not.toContain('onclick');
        expect(result2.toLowerCase()).not.toContain('script');
      }
      assertConsoleErrorDev([
        'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
          '    in div (at **)',
        'Invalid attribute name: `></div><script>alert("hi")</script>`\n' +
          '    in div (at **)',
      ]);
    });

    /** SSR自定义x-foo-component重复相同两类非法键，结果不含注入onclick/script且每种只警告一次，验证自定义标签仍检查属性名。 */
    it('should reject attribute key injection attack on markup for custom elements (SSR)', () => {
      for (let i = 0; i < 3; i++) {
        const element1 = React.createElement(
          'x-foo-component',
          {'blah" onclick="beevil" noise="hi': 'selected'},
          null,
        );
        const element2 = React.createElement(
          'x-foo-component',
          {'></x-foo-component><script>alert("hi")</script>': 'selected'},
          null,
        );
        const result1 = ReactDOMServer.renderToString(element1);
        const result2 = ReactDOMServer.renderToString(element2);
        expect(result1.toLowerCase()).not.toContain('onclick');
        expect(result2.toLowerCase()).not.toContain('script');
      }
      assertConsoleErrorDev([
        'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
          '    in x-foo-component (at **)',
        'Invalid attribute name: `></x-foo-component><script>alert("hi")</script>`\n' +
          '    in x-foo-component (at **)',
      ]);
    });

    /** 客户端普通div三轮挂载两种非法键，中间unmount并建新root；每次零attribute、仅首轮各报非法名，验证挂载过滤与跨root警告缓存。 */
    it('should reject attribute key injection attack on mount for regular DOM', async () => {
      for (let i = 0; i < 3; i++) {
        const container = document.createElement('div');
        let root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            React.createElement(
              'div',
              {'blah" onclick="beevil" noise="hi': 'selected'},
              null,
            ),
          );
        });

        expect(container.firstChild.attributes.length).toBe(0);
        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
              '    in div (at **)',
          ]);
        }
        await act(() => {
          root.unmount();
        });
        root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            React.createElement(
              'div',
              {'></div><script>alert("hi")</script>': 'selected'},
              null,
            ),
          );
        });
        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `></div><script>alert("hi")</script>`\n' +
              '    in div (at **)',
          ]);
        }

        expect(container.firstChild.attributes.length).toBe(0);
      }
    });

    /** 同攻击键挂到自定义x-foo-component，三轮重建root仍无attribute、只首轮警告，验证自定义挂载不会绕过键校验。 */
    it('should reject attribute key injection attack on mount for custom elements', async () => {
      for (let i = 0; i < 3; i++) {
        const container = document.createElement('div');
        let root = ReactDOMClient.createRoot(container);

        await act(() => {
          root.render(
            React.createElement(
              'x-foo-component',
              {'blah" onclick="beevil" noise="hi': 'selected'},
              null,
            ),
          );
        });

        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
              '    in x-foo-component (at **)',
          ]);
        }
        expect(container.firstChild.attributes.length).toBe(0);
        await act(() => {
          root.unmount();
        });

        root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            React.createElement(
              'x-foo-component',
              {'></x-foo-component><script>alert("hi")</script>': 'selected'},
              null,
            ),
          );
        });

        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `></x-foo-component><script>alert("hi")</script>`\n' +
              '    in x-foo-component (at **)',
          ]);
        }
        expect(container.firstChild.attributes.length).toBe(0);
      }
    });

    /** 普通空div后依次更新两类注入键，循环三轮始终零attribute且仅首轮警告，验证更新阶段也校验键而非只初始化。 */
    it('should reject attribute key injection attack on update for regular DOM', async () => {
      for (let i = 0; i < 3; i++) {
        const container = document.createElement('div');
        const beforeUpdate = React.createElement('div', {}, null);
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(beforeUpdate);
        });
        await act(() => {
          root.render(
            React.createElement(
              'div',
              {'blah" onclick="beevil" noise="hi': 'selected'},
              null,
            ),
          );
        });

        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
              '    in div (at **)',
          ]);
        }
        expect(container.firstChild.attributes.length).toBe(0);
        await act(() => {
          root.render(
            React.createElement(
              'div',
              {'></div><script>alert("hi")</script>': 'selected'},
              null,
            ),
          );
        });
        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `></div><script>alert("hi")</script>`\n' +
              '    in div (at **)',
          ]);
        }

        expect(container.firstChild.attributes.length).toBe(0);
      }
    });

    /** 自定义空元素后更新两类注入键，三轮零attribute与警告去重，验证custom更新路径的非法名过滤。 */
    it('should reject attribute key injection attack on update for custom elements', async () => {
      for (let i = 0; i < 3; i++) {
        const container = document.createElement('div');
        const beforeUpdate = React.createElement('x-foo-component', {}, null);
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(beforeUpdate);
        });
        await act(() => {
          root.render(
            React.createElement(
              'x-foo-component',
              {'blah" onclick="beevil" noise="hi': 'selected'},
              null,
            ),
          );
        });

        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `blah" onclick="beevil" noise="hi`\n' +
              '    in x-foo-component (at **)',
          ]);
        }
        expect(container.firstChild.attributes.length).toBe(0);
        await act(() => {
          root.render(
            React.createElement(
              'x-foo-component',
              {'></x-foo-component><script>alert("hi")</script>': 'selected'},
              null,
            ),
          );
        });

        if (i === 0) {
          assertConsoleErrorDev([
            'Invalid attribute name: `></x-foo-component><script>alert("hi")</script>`\n' +
              '    in x-foo-component (at **)',
          ]);
        }
        expect(container.firstChild.attributes.length).toBe(0);
      }
    });

    /** 带连字符x-foo-component初始空props，更新myattr myval可从DOM读取，验证自定义任意字符串attribute可新增。 */
    it('should update arbitrary attributes for tags containing dashes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const beforeUpdate = React.createElement('x-foo-component', {}, null);
      await act(() => {
        root.render(beforeUpdate);
      });

      const afterUpdate = <x-foo-component myattr="myval" />;
      await act(() => {
        root.render(afterUpdate);
      });

      expect(container.childNodes[0].getAttribute('myattr')).toBe('myval');
    });

    /** display none/color red后完全去掉style，两CSS字段都清空，验证整体样式删除。 */
    it('should clear all the styles when removing `style`', async () => {
      const styles = {display: 'none', color: 'red'};
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div style={styles} />);
      });

      const stubStyle = container.firstChild.style;

      await act(() => {
        root.render(<div />);
      });
      expect(stubStyle.display).toEqual('');
      expect(stubStyle.color).toEqual('');
    });

    /** color red对象→缺省style→同对象，DOM依次red/空/red，验证删除后再次使用旧对象仍写入；输入实际缺省而非显式null。 */
    it('should update styles when `style` changes from null to object', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const styles = {color: 'red'};
      await act(() => {
        root.render(<div style={styles} />);
      });
      const stubStyle = container.firstChild.style;
      expect(stubStyle.color).toBe('red');
      await act(() => {
        root.render(<div />);
      });
      expect(stubStyle.color).toBe('');
      await act(() => {
        root.render(<div style={styles} />);
      });

      expect(stubStyle.color).toBe('red');
    });

    /** React初始和后续都渲染空div，中间外部改innerHTML bonjour，再render仍保留，验证没有旧React文本/HTML内容时不主动清理外部变更。 */
    it('should not reset innerHTML for when children is null', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div />);
      });
      container.firstChild.innerHTML = 'bonjour';
      expect(container.firstChild.innerHTML).toEqual('bonjour');

      await act(() => {
        root.render(<div />);
      });
      expect(container.firstChild.innerHTML).toEqual('bonjour');
    });

    /** 直接文本bonjour分别切到null/undefined/false三个空child，各新root innerHTML都清空，验证原直接文本转空需要ContentReset。 */
    it('should reset innerHTML when switching from a direct text child to an empty child', async () => {
      const transitionToValues = [null, undefined, false];
      // eslint-disable-next-line no-for-of-loops/no-for-of-loops
      for (const transitionToValue of transitionToValues) {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<div>bonjour</div>);
        });
        expect(container.firstChild.innerHTML).toEqual('bonjour');

        await act(() => {
          root.render(<div>{transitionToValue}</div>);
        });
        expect(container.firstChild.innerHTML).toEqual('');
      }
    });

    /** dangerous HTML :)切为无children普通div，innerHTML变空，验证删除旧HTML内容。 */
    it('should empty element when removing innerHTML', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: ':)'}} />);
      });

      expect(container.firstChild.innerHTML).toEqual(':)');
      await act(() => {
        root.render(<div />);
      });
      expect(container.firstChild.innerHTML).toEqual('');
    });

    /** 直接文本hello切dangerous HTML goodbye，innerHTML替换为goodbye，验证文本到HTML的主机更新。 */
    it('should transition from string content to innerHTML', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div>hello</div>);
      });

      expect(container.firstChild.innerHTML).toEqual('hello');
      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: 'goodbye'}} />);
      });
      expect(container.firstChild.innerHTML).toEqual('goodbye');
    });

    /** dangerous HTML bonjour切直接文本adieu，innerHTML变adieu，验证HTML到直接文本转换。 */
    it('should transition from innerHTML to string content', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div dangerouslySetInnerHTML={{__html: 'bonjour'}} />);
      });

      expect(container.firstChild.innerHTML).toEqual('bonjour');
      await act(() => {
        root.render(<div>adieu</div>);
      });
      expect(container.firstChild.innerHTML).toEqual('adieu');
    });

    /** 嵌套div从HTML bonjour切span child adieu，最终textContent adieu，验证先清旧内容再插入React子节点。 */
    it('should transition from innerHTML to children in nested el', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <div dangerouslySetInnerHTML={{__html: 'bonjour'}} />
          </div>,
        );
      });

      expect(container.textContent).toEqual('bonjour');
      await act(() => {
        root.render(
          <div>
            <div>
              <span>adieu</span>
            </div>
          </div>,
        );
      });
      expect(container.textContent).toEqual('adieu');
    });

    /** 嵌套div从span adieu切HTML bonjour，最终textContent bonjour，验证删除React子树再接管HTML。 */
    it('should transition from children to innerHTML in nested el', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <div>
              <span>adieu</span>
            </div>
          </div>,
        );
      });

      expect(container.textContent).toEqual('adieu');
      await act(() => {
        root.render(
          <div>
            <div dangerouslySetInnerHTML={{__html: 'bonjour'}} />
          </div>,
        );
      });
      expect(container.textContent).toEqual('bonjour');
    });

    /** 用两个新__html对象传相同span hi字符串，子节点身份保持；改span bye后身份变且HTML更新，验证相同内容避免重设innerHTML。 */
    it('should not incur unnecessary DOM mutations for equal innerHTML', async () => {
      // https://github.com/facebook/react/issues/30994 的回归测试：重新赋予相同 innerHTML 会销毁并
      // 重建子节点，从而打断进行中的手势（例如 focus 与 click 之间重渲染会吞掉尚未完成的 click），
      // 也会丢失文本选择等状态。
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: '<span>hi</span>'}} />,
        );
      });

      const node = container.firstChild;
      const child = node.firstChild;

      // 具有与 DOM 相同 __html 字符串的新对象不得改动 DOM。
      await act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: '<span>hi</span>'}} />,
        );
      });
      expect(node.firstChild).toBe(child);

      // 不同的 __html 字符串仍会触发更新。
      await act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: '<span>bye</span>'}} />,
        );
      });
      expect(node.firstChild).not.toBe(child);
      expect(node.innerHTML).toEqual('<span>bye</span>');
    });

    /** 代理记录setAttribute/removeAttribute，id空串不变0次、变foo仅1次、再相同不写、缺省删、空串再加再删，验证属性差分只产生必要DOM调用。 */
    it('should not incur unnecessary DOM mutations for attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div id="" />);
      });

      const node = container.firstChild;
      const nodeSetAttribute = node.setAttribute;
      node.setAttribute = jest.fn();
      node.setAttribute.mockImplementation(nodeSetAttribute);

      const nodeRemoveAttribute = node.removeAttribute;
      node.removeAttribute = jest.fn();
      node.removeAttribute.mockImplementation(nodeRemoveAttribute);

      await act(() => {
        root.render(<div id="" />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(0);
      expect(node.removeAttribute).toHaveBeenCalledTimes(0);

      await act(() => {
        root.render(<div id="foo" />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(1);
      expect(node.removeAttribute).toHaveBeenCalledTimes(0);

      await act(() => {
        root.render(<div id="foo" />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(1);
      expect(node.removeAttribute).toHaveBeenCalledTimes(0);

      await act(() => {
        root.render(<div />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(1);
      expect(node.removeAttribute).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div id="" />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(2);
      expect(node.removeAttribute).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div />);
      });
      expect(node.setAttribute).toHaveBeenCalledTimes(2);
      expect(node.removeAttribute).toHaveBeenCalledTimes(2);
    });

    /** 普通div value空串更新foo，两次相同只调用setAttribute一次；缺省/null删除不经过代理计数，再空串才增至2，验证字符串attribute差分，非input.value setter。 */
    it('should not incur unnecessary DOM mutations for string properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div value="" />);
      });

      const node = container.firstChild;

      const nodeValueSetter = jest.fn();

      const oldSetAttribute = node.setAttribute.bind(node);
      /** 委托原绑定setAttribute后记录(key,value)，统计div value更新调用；removeAttribute不经过此计数。 */
      node.setAttribute = function (key, value) {
        oldSetAttribute(key, value);
        nodeValueSetter(key, value);
      };

      await act(() => {
        root.render(<div value="foo" />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div value="foo" />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div value={null} />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<div value="" />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(2);

      await act(() => {
        root.render(<div />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(2);
    });

    /** 受控input的value getter/setter被代理，foo只写1次，改无关data属性不写；缺省/null不写并开发警告受控切换/null，空串再写1次，验证表单值避免重复赋值与模式诊断。 */
    it('should not incur unnecessary DOM mutations for controlled string properties', async () => {
      /** 受控input的空onChange，满足只读值校验而不触发业务更新；用例只统计value写入。 */
      function onChange() {}
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input value="" onChange={onChange} />);
      });

      const node = container.firstChild;

      let nodeValue = '';
      const nodeValueSetter = jest.fn();
      Object.defineProperty(node, 'value', {
        /** 返回代理保存的当前input.value，配合记录setter判断React是否真的需要再次赋值。 */
        get: function () {
          return nodeValue;
        },
        /** 记录实际value写入并更新getter返回的保存值，使相同受控value可避免再次赋值。 */
        set: nodeValueSetter.mockImplementation(function (newValue) {
          nodeValue = newValue;
        }),
      });

      await act(() => {
        root.render(<input value="foo" onChange={onChange} />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(
          <input value="foo" data-unrelated={true} onChange={onChange} />,
        );
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<input onChange={onChange} />);
      });
      assertConsoleErrorDev([
        'A component is changing a controlled input to be uncontrolled. This is likely caused by ' +
          'the value changing from a defined to undefined, which should not happen. Decide between ' +
          'using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)',
      ]);
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<input value={null} onChange={onChange} />);
      });
      assertConsoleErrorDev([
        '`value` prop on `input` should not be null. Consider using an empty string to clear the ' +
          'component or `undefined` for uncontrolled components.\n' +
          '    in input (at **)',
      ]);
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);

      await act(() => {
        root.render(<input value="" onChange={onChange} />);
      });
      assertConsoleErrorDev([
        'A component is changing an uncontrolled input to be controlled. This is likely caused by ' +
          'the value changing from undefined to a defined value, which should not happen. Decide between ' +
          'using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)',
      ]);
      expect(nodeValueSetter).toHaveBeenCalledTimes(2);

      await act(() => {
        root.render(<input onChange={onChange} />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(2);
    });

    /** audio muted初始true后代理getter/setter，仅改无关data不写、muted false才写1次，验证布尔property差分。 */
    it('should not incur unnecessary DOM mutations for boolean properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<audio muted={true} />);
      });

      const node = container.firstChild;
      let nodeValue = true;
      const nodeValueSetter = jest.fn();
      Object.defineProperty(node, 'muted', {
        /** 返回已保存的audio.muted布尔值，代理setter仅统计true→false的必要写入。 */
        get: function () {
          return nodeValue;
        },
        /** 记录实际muted写入并更新保存的布尔值，区分仅更新无关props与真正切换播放静音状态。 */
        set: nodeValueSetter.mockImplementation(function (newValue) {
          nodeValue = newValue;
        }),
      });

      await act(() => {
        root.render(<audio muted={true} data-unrelated="yes" />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(0);

      await act(() => {
        root.render(<audio muted={false} data-unrelated="ok" />);
      });
      expect(nodeValueSetter).toHaveBeenCalledTimes(1);
    });

    /** button is=test且有未知cowabunga，DOM保留cowabunga，验证扩展原生自定义元素可接收普通自定义attribute。 */
    it('should ignore attribute list for elements with the "is" attribute', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<button is="test" cowabunga="chevynova" />);
      });
      expect(container.firstChild.hasAttribute('cowabunga')).toBe(true);
    });

    /** button is值为函数，开发要求字符串属性先显式转换，验证自定义扩展名称的类型校验。 */
    it('should warn about non-string "is" attribute', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<button is={function () {}} />);
      });
      assertConsoleErrorDev([
        'Received a `function` for a string attribute `is`. If this is expected, cast ' +
          'the value to a string.\n' +
          '    in button (at **)',
      ]);
    });

    /** div dir按缺省/null/undefined/缺省更新，代理setAttribute始终0次，改ltr才1次，验证无属性的nullish切换不产生DOM写。 */
    it('should not update when switching between null/undefined', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div />);
      });

      const setter = jest.fn();
      container.firstChild.setAttribute = setter;

      await act(() => {
        root.render(<div dir={null} />);
      });
      await act(() => {
        root.render(<div dir={undefined} />);
      });
      await act(() => {
        root.render(<div />);
      });
      expect(setter).toHaveBeenCalledTimes(0);
      await act(() => {
        root.render(<div dir="ltr" />);
      });
      expect(setter).toHaveBeenCalledTimes(1);
    });

    /** 两组分别AB/CD的key子节点同时交换为BA/DC，最终文本BADC，验证两组提交操作不干扰；本例未逐个验证DOM身份。 */
    it('handles multiple child updates without interference', async () => {
      // 同时重排两组子节点，验证一组的 DOM 插入与删除不会破坏另一组；这是宿主提交路径的回归场景。
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      // ABCD
      await act(() => {
        root.render(
          <div>
            <div key="one">
              <div key="A">A</div>
              <div key="B">B</div>
            </div>
            <div key="two">
              <div key="C">C</div>
              <div key="D">D</div>
            </div>
          </div>,
        );
      });
      // BADC
      await act(() => {
        root.render(
          <div>
            <div key="one">
              <div key="B">B</div>
              <div key="A">A</div>
            </div>
            <div key="two">
              <div key="D">D</div>
              <div key="C">C</div>
            </div>
          </div>,
        );
      });

      expect(container.textContent).toBe('BADC');
    });
  });

  describe('createOpenTagMarkup', () => {
    /** 转义字符串中的正则元字符，避免class/style输出值改变后续attribute匹配模式。 */
    function quoteRegexp(str) {
      return String(str).replace(/([.?*+\^$\[\]\\(){}|-])/g, '\\$1');
    }

    /** expected为[attr,value]，在字符串actual中查带引号attribute；value缺省只检查名字及开引号，提供value时转义它，本helper不是DOM解析器。 */
    function expectToHaveAttribute(actual, expected) {
      const [attr, value] = expected;
      let re = '(?:^|\\s)' + attr + '=[\\\'"]';
      if (typeof value !== 'undefined') {
        re += quoteRegexp(value) + '[\\\'"]';
      }
      expect(actual).toMatch(new RegExp(re));
    }

    /** 把props展开到div并SSR，供HTML开标签属性的转义和别名检查。 */
    function genMarkup(props) {
      return ReactDOMServer.renderToString(<div {...props} />);
    }

    /** SSR className依次a、a b、空串，helper匹配class attribute各值，验证服务器别名和空串序列化。 */
    it('should generate the correct markup with className', () => {
      expectToHaveAttribute(genMarkup({className: 'a'}), ['class', 'a']);
      expectToHaveAttribute(genMarkup({className: 'a b'}), ['class', 'a b']);
      expectToHaveAttribute(genMarkup({className: ''}), ['class', '']);
    });

    /** SSR style键b&ckground、值<3，输出style中分别转义&与<，验证样式名和值进入HTML attribute的转义。 */
    it('should escape style names and values', () => {
      expectToHaveAttribute(
        genMarkup({
          style: {'b&ckground': '<3'},
        }),
        ['style', 'b&amp;ckground:&lt;3'],
      );
    });
  });

  describe('createContentMarkup', () => {
    /** 转义内容字符串的正则元字符，使子串测试按字面文本匹配。 */
    function quoteRegexp(str) {
      return String(str).replace(/([.?*+\^$\[\]\\(){}|-])/g, '\\$1');
    }

    /** 服务器渲染带props的div，供危险HTML内容输出检查。 */
    function genMarkup(props) {
      return ReactDOMServer.renderToString(<div {...props} />);
    }

    /** 对actual做未锚定字面子串正则测试，返回是否包含expected；名称虽称innerHTML，实际不解析或精确比较内容区间。 */
    function toHaveInnerhtml(actual, expected) {
      const re = quoteRegexp(expected);
      return new RegExp(re).test(actual);
    }

    /** SSR div危险HTML testContent，未锚定正则查到该文本即true，验证内容写入；helper并非完整innerHTML等价比较。 */
    it('should handle dangerouslySetInnerHTML', () => {
      const innerHTML = {__html: 'testContent'};
      expect(
        toHaveInnerhtml(
          genMarkup({dangerouslySetInnerHTML: innerHTML}),
          'testContent',
        ),
      ).toBe(true);
    });
  });

  describe('mountComponent', () => {
    let mountComponent;

    beforeEach(() => {
      /** 新容器/root中用act挂div props并等待完成；不返回DOM也不卸载，调用者主要检查挂载错误和开发诊断。 */
      mountComponent = async props => {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<div {...props} />);
        });
      };
    });

    /** video/source派发不冒泡error，开发日志有onError一次，验证source需目标监听；生产分支本例未断言日志。 */
    it('should work error event on <source> element', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <video>
            <source
              src="http://example.org/video"
              type="video/mp4"
              onError={e => Scheduler.log('onError called')}
            />
          </video>,
        );
      });

      const errorEvent = document.createEvent('Event');
      errorEvent.initEvent('error', false, false);
      container.getElementsByTagName('source')[0].dispatchEvent(errorEvent);

      if (__DEV__) {
        assertLog(['onError called']);
      }
    });

    /** 类Container服务端返回字符串标签BR，开发告大小写错误且结果仍含闭标签/BR，验证大写名不走小写br的void输出分支。 */
    it('should warn for uppercased selfclosing tags', () => {
      /** 服务端输出字符串BR标签的类fixture，观察错误大小写与非void闭标签。 */
      class Container extends React.Component {
        /** 用createElement的字符串BR创建主机元素，不是引用名为BR的React组件。 */
        render() {
          return React.createElement('BR', null);
        }
      }

      const returnedValue = ReactDOMServer.renderToString(<Container />);
      assertConsoleErrorDev([
        '<BR /> is using incorrect casing. ' +
          'Use PascalCase for React components, ' +
          'or lowercase for HTML elements.\n' +
          '    in BR (at **)\n' +
          '    in Container (at **)',
      ]);
      // 这包括一个重复的标签，因为我们没有将其视为自闭合标签来处理。
      expect(returnedValue).toContain('</BR>');
    });

    /** 先渲染SVG下PATH与CUSTOM-TAG都无HTML大小写警告，再渲染IMG只有该警告，验证命名空间与自定义标签豁免。 */
    it('should warn on upper case HTML tags, not SVG nor custom tags', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          React.createElement('svg', null, React.createElement('PATH')),
        );
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(React.createElement('CUSTOM-TAG'));
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(React.createElement('IMG'));
      });
      assertConsoleErrorDev([
        '<IMG /> is using incorrect casing. ' +
          'Use PascalCase for React components, ' +
          'or lowercase for HTML elements.\n' +
          '    in IMG (at **)',
      ]);
    });

    /** div aria=hello，开发提示aria保留并使用具体aria-*，验证属性名诊断。 */
    it('should warn on props reserved for future use', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div aria="hello" />);
      });
      assertConsoleErrorDev([
        'The `aria` attribute is reserved for future use in React. ' +
          'Pass individual `aria-` attributes instead.\n' +
          '    in div (at **)',
      ]);
    });

    /** 临时包装Object.prototype.toString模拟HTMLUnknownElement，bar/foo首次警告、再foo去重、time无警告、hasOwnProperty仍正常双诊断；finally恢复原方法，验证诊断缓存键及清理。 */
    it('should warn if the tag is unrecognized', async () => {
      let realToString;
      try {
        realToString = Object.prototype.toString;
        /** 对HTMLUnknownElement模拟真实浏览器toString，其它receiver委托原方法/参数；所在try/finally负责恢复全局prototype。 */
        const wrappedToString = function () {
    // 模拟 jsdom 缺失的浏览器行为。
          if (this instanceof window.HTMLUnknownElement) {
            return '[object HTMLUnknownElement]';
          }
          return realToString.apply(this, arguments);
        };
        Object.prototype.toString = wrappedToString; // eslint-disable-line no-extend-native

        const root = ReactDOMClient.createRoot(document.createElement('div'));

        await act(() => {
          root.render(<bar />);
        });
        assertConsoleErrorDev([
          'The tag <bar> is unrecognized in this browser. ' +
            'If you meant to render a React component, start its name with an uppercase letter.\n' +
            '    in bar (at **)',
        ]);
      // 测试去重。
        await act(() => {
          root.render(<foo />);
        });
        assertConsoleErrorDev([
          'The tag <foo> is unrecognized in this browser. ' +
            'If you meant to render a React component, start its name with an uppercase letter.\n' +
            '    in foo (at **)',
        ]);
        await act(() => {
          root.render(<foo />);
        });
        await act(() => {
          root.render(<time />);
        });

      // 特例：确保去重逻辑不会因奇怪标签而失效。
        await act(() => {
          root.render(<hasOwnProperty />);
        });
        assertConsoleErrorDev([
          '<hasOwnProperty /> is using incorrect casing. ' +
            'Use PascalCase for React components, or lowercase for HTML elements.\n' +
            '    in hasOwnProperty (at **)',
          'The tag <hasOwnProperty> is unrecognized in this browser. ' +
            'If you meant to render a React component, start its name with an uppercase letter.\n' +
            '    in hasOwnProperty (at **)',
        ]);
      } finally {
        Object.prototype.toString = realToString; // eslint-disable-line no-extend-native
      }
    });

    /** 首次挂input带children，act拒绝void元素错误，验证初始化禁止子内容，输入不是可恢复开发警告。 */
    it('should throw on children for void elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(async () => {
        await act(() => {
          root.render(<input>children</input>);
        });
      }).rejects.toThrowError(
        'input is a void element tag and must neither have `children` nor ' +
          'use `dangerouslySetInnerHTML`.',
      );
    });

    /** 首次input带合法__html对象仍拒绝void元素错误，验证危险HTML也不能绕过void限制。 */
    it('should throw on dangerouslySetInnerHTML for void elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(async () => {
        await act(() => {
          root.render(<input dangerouslySetInnerHTML={{__html: 'content'}} />);
        });
      }).rejects.toThrowError(
        'input is a void element tag and must neither have `children` nor ' +
          'use `dangerouslySetInnerHTML`.',
      );
    });

    /** SSR menuitem结果保留闭标签，客户端menuitem带children又拒绝void错误，并开发未知元素警告，验证该历史标签的输出/子内容规则不同。 */
    it('should treat menuitem as a void element but still create the closing tag', async () => {
      // jsdom 尚未实现 menuitem，因此会触发“未知元素”警告。
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const returnedValue = ReactDOMServer.renderToString(
        <menu>
          <menuitem />
        </menu>,
      );

      expect(returnedValue).toContain('</menuitem>');

      await expect(async () => {
        await act(() => {
          root.render(
            <menu>
              <menuitem>children</menuitem>
            </menu>,
          );
        });
      }).rejects.toThrowError(
        'menuitem is a void element tag and must neither have `children` nor use ' +
          '`dangerouslySetInnerHTML`.',
      );
      assertConsoleErrorDev([
        'The tag <menuitem> is unrecognized in this browser. ' +
          'If you meant to render a React component, start its name with an uppercase letter.\n' +
          '    in menuitem (at **)',
      ]);
    });

    /** mount helper同时children空串与dangerous HTML空串，实际拒绝__html对象格式错误，验证优先到达的结构校验，不把标题当成有效HTML与children冲突断言。 */
    it('should validate against multiple children props', async () => {
      await expect(async () => {
        await mountComponent({children: '', dangerouslySetInnerHTML: ''});
      }).rejects.toThrowError(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://react.dev/link/dangerously-set-inner-html for more information.',
      );
    });

    /** 通过普通innerHTML prop传span，开发禁止直接设置并指向危险HTML API，验证初始化保留名诊断。 */
    it('should validate against use of innerHTML', async () => {
      await mountComponent({innerHTML: '<span>Hi Jim!</span>'});
      assertConsoleErrorDev([
        'Directly setting property `innerHTML` is not permitted. ' +
          'For more information, lookup documentation on `dangerouslySetInnerHTML`.\n' +
          '    in div (at **)',
      ]);
    });

    /** 同输入改小写innerhtml，仍报同禁止直接设置诊断，验证属性名检查不区分这两种大小写。 */
    it('should validate against use of innerHTML without case sensitivity', async () => {
      await mountComponent({innerhtml: '<span>Hi Jim!</span>'});
      assertConsoleErrorDev([
        'Directly setting property `innerHTML` is not permitted. ' +
          'For more information, lookup documentation on `dangerouslySetInnerHTML`.\n' +
          '    in div (at **)',
      ]);
    });

    /** 危险HTML prop直接是HTML字符串，act拒绝必须{__html:...}，验证不是合法包装对象。 */
    it('should validate use of dangerouslySetInnerHTM with JSX', async () => {
      await expect(async () => {
        await mountComponent({dangerouslySetInnerHTML: '<span>Hi Jim!</span>'});
      }).rejects.toThrowError(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://react.dev/link/dangerously-set-inner-html for more information.',
      );
    });

    /** 危险HTML对象只有foo键而无__html，拒绝相同格式错误，验证对象本身还不足以通过结构校验。 */
    it('should validate use of dangerouslySetInnerHTML with object', async () => {
      await expect(async () => {
        await mountComponent({dangerouslySetInnerHTML: {foo: 'bar'}});
      }).rejects.toThrowError(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://react.dev/link/dangerously-set-inner-html for more information.',
      );
    });

    /** 危险HTML包装__html:null，使用not.toThrow检查async封装无同步抛错；未显式等待该封装Promise，说明空值输入而不扩大为异步拒绝覆盖。 */
    it('should allow {__html: null}', async () => {
      await expect(async () => {
        await mountComponent({dangerouslySetInnerHTML: {__html: null}});
      }).not.toThrow();
    });

    /** contentEditable true且children空串，开发警告React管理子节点可能被外部编辑，验证即使空串仍有children prop冲突。 */
    it('should warn about contentEditable and children', async () => {
      await mountComponent({contentEditable: true, children: ''});
      assertConsoleErrorDev([
        'A component is `contentEditable` and contains `children` ' +
          'managed by React. It is now your responsibility to guarantee that ' +
          'none of those nodes are unexpectedly modified or duplicated. This ' +
          'is probably not intentional.\n' +
          '    in div (at **)',
      ]);
    });

    /** 同contentEditable/children加suppressContentEditableWarning true，挂载无警告，验证显式抑制该开发诊断。 */
    it('should respect suppressContentEditableWarning', async () => {
      await mountComponent({
        contentEditable: true,
        children: '',
        suppressContentEditableWarning: true,
      });
    });

    /** style传字符串display none，mount helper拒绝mapping要求，验证样式输入类型约束。 */
    it('should validate against invalid styles', async () => {
      await expect(async () => {
        await mountComponent({style: 'display: none'});
      }).rejects.toThrowError(
        'The `style` prop expects a mapping from style properties to values, ' +
          "not a string. For example, style={{marginRight: spacing + 'em'}} " +
          'when using JSX.',
      );
    });

    /** 类X返回input子文本moo，act拒绝void错误，验证组件包装不会绕过主机子内容校验。 */
    it('should throw for children on void elements', async () => {
      /** 类包装不合法input children，确认主机校验通过组件调用链仍生效。 */
      class X extends React.Component {
        /** 返回input文本moo，触发void子内容错误。 */
        render() {
          return <input>moo</input>;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(async () => {
        await act(() => {
          root.render(<X />);
        });
      }).rejects.toThrowError(
        'input is a void element tag and must neither have `children` ' +
          'nor use `dangerouslySetInnerHTML`.',
      );
    });

    /** 监视document.createElement，挂div is custom-div应调用createElement(div,{is:custom-div})，验证扩展原生元素选项在创建时传给浏览器。 */
    it('should support custom elements which extend native elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      spyOnDevAndProd(document, 'createElement');
      await act(() => {
        root.render(<div is="custom-div" />);
      });
      expect(document.createElement).toHaveBeenCalledWith('div', {
        is: 'custom-div',
      });
    });

    /** SVG image先派不冒泡error再load，开发日志按error/load各一次，验证SVG媒体目标监听；生产分支未断言日志。 */
    it('should work load and error events on <image> element in SVG', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <svg>
            <image
              xlinkHref="http://example.org/image"
              onError={e => Scheduler.log('onError called')}
              onLoad={e => Scheduler.log('onLoad called')}
            />
          </svg>,
        );
      });

      const loadEvent = document.createEvent('Event');
      const errorEvent = document.createEvent('Event');

      loadEvent.initEvent('load', false, false);
      errorEvent.initEvent('error', false, false);

      container.getElementsByTagName('image')[0].dispatchEvent(errorEvent);
      container.getElementsByTagName('image')[0].dispatchEvent(loadEvent);

      if (__DEV__) {
        assertLog(['onError called', 'onLoad called']);
      }
    });

    /** link目标派发不冒泡load，onLoad mock1次，验证link资源事件可在目标节点接收。 */
    it('should receive a load event on <link> elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const onLoad = jest.fn();

      await act(() => {
        root.render(<link href="http://example.org/link" onLoad={onLoad} />);
      });

      const loadEvent = document.createEvent('Event');
      const link = container.getElementsByTagName('link')[0];

      loadEvent.initEvent('load', false, false);
      link.dispatchEvent(loadEvent);

      expect(onLoad).toHaveBeenCalledTimes(1);
    });

    /** link目标派发不冒泡error，onError mock1次，验证资源失败目标监听。 */
    it('should receive an error event on <link> elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const onError = jest.fn();

      await act(() => {
        root.render(<link href="http://example.org/link" onError={onError} />);
      });

      const errorEvent = document.createEvent('Event');
      const link = container.getElementsByTagName('link')[0];

      errorEvent.initEvent('error', false, false);
      link.dispatchEvent(errorEvent);

      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateComponent', () => {
    let container;
    let root;

    /** 更新组每例建立空容器和root，各场景自行决定是否先挂有效输入再更新非法props。 */
    beforeEach(() => {
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
    });

    /** 先挂空input再更新children，act拒绝void错误，验证更新阶段同样禁止子内容，不仅首次创建。 */
    it('should warn against children for void elements', async () => {
      await act(() => {
        root.render(<input />);
      });

      await expect(async () => {
        await act(() => {
          root.render(<input>children</input>);
        });
      }).rejects.toThrowError(
        'input is a void element tag and must neither have `children` nor use ' +
          '`dangerouslySetInnerHTML`.',
      );
    });

    /** 先空input再更新dangerous HTML对象，act拒绝void错误，验证更新危险HTML仍受void校验。 */
    it('should warn against dangerouslySetInnerHTML for void elements', async () => {
      await act(() => {
        root.render(<input />);
      });

      await expect(async () => {
        await act(() => {
          root.render(<input dangerouslySetInnerHTML={{__html: 'content'}} />);
        });
      }).rejects.toThrowError(
        'input is a void element tag and must neither have `children` nor use ' +
          '`dangerouslySetInnerHTML`.',
      );
    });

    /** 普通div更新时同时children空串和合法__html空串对象，拒绝只能设置一个的错误，区别初始化用例中的包装格式失败。 */
    it('should validate against multiple children props', async () => {
      await act(() => {
        root.render(<div />);
      });

      await expect(async () => {
        await act(() => {
          root.render(
            <div children="" dangerouslySetInnerHTML={{__html: ''}} />,
          );
        });
      }).rejects.toThrowError(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
      );
    });

    /** 更新区域首次挂contentEditable div含React div child，开发警告可编辑DOM和React子树冲突；本例没有先挂空div再切换的步骤。 */
    it('should warn about contentEditable and children', async () => {
      await act(() => {
        root.render(
          <div contentEditable={true}>
            <div />
          </div>,
        );
      });
      assertConsoleErrorDev([
        'A component is `contentEditable` and contains `children` managed by React. ' +
          'It is now your responsibility to guarantee that none of those nodes are unexpectedly modified or duplicated. ' +
          'This is probably not intentional.\n' +
          '    in div (at **)',
      ]);
    });

    /** 已挂空div更新style数字1，act拒绝mapping错误，验证非字符串但非对象的样式输入同样非法。 */
    it('should validate against invalid styles', async () => {
      await act(() => {
        root.render(<div />);
      });

      await expect(async () => {
        await act(() => {
          root.render(<div style={1} />);
        });
      }).rejects.toThrowError(
        'The `style` prop expects a mapping from style properties to values, ' +
          "not a string. For example, style={{marginRight: spacing + 'em'}} " +
          'when using JSX.',
      );
    });

    /** Animal类返回div style1，act拒绝样式mapping错误，验证组件包装的无效style仍向调用者抛出；未额外断言组件栈字符串。 */
    it('should report component containing invalid styles', async () => {
      /** 无效style来自类render的fixture，用于检查主机输入错误经过组件调用链仍拒绝。 */
      class Animal extends React.Component {
        /** 返回style数字1的div，触发样式mapping类型错误。 */
        render() {
          return <div style={1} />;
        }
      }

      await expect(async () => {
        await act(() => {
          root.render(<Animal />);
        });
      }).rejects.toThrowError(
        'The `style` prop expects a mapping from style properties to values, ' +
          "not a string. For example, style={{marginRight: spacing + 'em'}} " +
          'when using JSX.',
      );
    });

    /** SSR static同时给title、textAlign样式值、文本传单/双引号及<>&，精确比较各HTML实体，验证开标签/样式/文本三个输出位置的转义。 */
    it('should properly escape text content and attributes values', () => {
      expect(
        ReactDOMServer.renderToStaticMarkup(
          React.createElement(
            'div',
            {
              title: '\'"<>&',
              style: {
                textAlign: '\'"<>&',
              },
            },
            '\'"<>&',
          ),
        ),
      ).toBe(
        '<div title="&#x27;&quot;&lt;&gt;&amp;" style="text-align:&#x27;&quot;&lt;&gt;&amp;">' +
          '&#x27;&quot;&lt;&gt;&amp;' +
          '</div>',
      );
    });
  });

  describe('unmountComponent', () => {
    /** Inner返回span，root.unmount期间componentWillUnmount通过findDOMNode仍找到SPAN，验证卸载生命周期先于组件DOM关联清理。 */
    it('unmounts children before unsetting DOM node info', async () => {
      /** 返回span并在卸载生命周期查自身DOM，检查关联清理的先后顺序。 */
      class Inner extends React.Component {
        /** 提供唯一span主机节点，让findDOMNode在卸载时有明确目标。 */
        render() {
          return <span />;
        }

        /** 在关联尚未清除时findDOMNode(this)必须返回SPAN；该断言约束生命周期与DOM缓存清理顺序。 */
        componentWillUnmount() {
          // 不应抛错。
          expect(
            ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
              this,
            ).nodeName,
          ).toBe('SPAN');
        }
      }

      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(
          <div>
            <Inner />
          </div>,
        );
      });
      await act(() => {
        root.unmount();
      });
    });
  });

  describe('tag sanitization', () => {
    /** SSR字符串标签script tag含空格，renderToString抛明确Invalid tag，验证服务端标签名校验。 */
    it('should throw when an invalid tag name is used server-side', () => {
      const hackzor = React.createElement('script tag');
      expect(() => ReactDOMServer.renderToString(hackzor)).toThrowError(
        'Invalid tag: script tag',
      );
    });

    /** SSR标签含div闭开标签及img注入，renderToString抛原恶意标签的Invalid tag错误，验证标签名不能突破输出边界。 */
    it('should throw when an attack vector is used server-side', () => {
      const hackzor = React.createElement('div><img /><div');
      expect(() => ReactDOMServer.renderToString(hackzor)).toThrowError(
        'Invalid tag: div><img /><div',
      );
    });

    /** 客户端字符串标签script tag含空格，act拒绝抛错但未限定错误文本，验证浏览器创建失败可传播。 */
    it('should throw when an invalid tag name is used', async () => {
      const hackzor = React.createElement('script tag');
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(hackzor);
        }),
      ).rejects.toThrow();
    });

    /** 客户端标签含div/img注入片段，act拒绝抛错且无指定错误消息，验证非法名字不会成功挂载。 */
    it('should throw when an attack vector is used', async () => {
      const hackzor = React.createElement('div><img /><div');
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(hackzor);
        }),
      ).rejects.toThrow();
    });
  });

  describe('nesting validation', () => {
    /** 普通div下有两个tr，开发仅一组child-nesting诊断并提示水合错误，验证同标签嵌套错误缓存去重与祖先上下文。 */
    it('warns on invalid nesting', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <tr />
            <tr />
          </div>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <div>.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '> <div>\n' +
          '>   <tr>\n' +
          '    ...\n' +
          '\n    in tr (at **)',
      ]);
    });

    /** 实际root容器为p，内部span再含p，开发诊断p不可嵌套p而栈没有容器外p，验证HostContext纳入容器但组件栈边界不同。 */
    it('warns on invalid nesting at root', async () => {
      const p = document.createElement('p');
      const root = ReactDOMClient.createRoot(p);

      await act(() => {
        root.render(
          <span>
            <p />
          </span>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <p> cannot be a descendant of <p>.\n' +
          'This will cause a hydration error.' +
          // 由于根容器不在堆栈中，因此没有外层 `p`。
          '\n    in p (at **)',
      ]);
    });

    /** Foo/table下直接Row/tr x并有空白兄弟，开发分别报告缺tbody、祖先table栈、tr文本x和table空白，验证元素与两种文本嵌套诊断均带具体上下文。 */
    it('warns nicely for table rows', async () => {
      /** Row类直接产生非法tr文本x，供嵌套诊断的child组件栈。 */
      class Row extends React.Component {
        /** 输出tr内裸文本x，触发文本不能直接放tr的校验。 */
        render() {
          return <tr>x</tr>;
        }
      }

      /** Foo类在table直接放Row及空白，同时产生缺tbody和空白文本两种警告。 */
      class Foo extends React.Component {
        /** 不插tbody地透传Row，并追加空白，确保诊断能显示table/Row/tr层级。 */
        render() {
          return (
            <table>
              <Row />{' '}
            </table>
          );
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of ' +
          '<table>. Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated ' +
          'by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Foo>\n' +
          '>   <table>\n' +
          '      <Row>\n' +
          '>       <tr>\n' +
          '      ...\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in Foo (at **)',
        '<table> cannot contain a nested <tr>.\nSee this log for the ancestor stack trace.' +
          '\n    in table (at **)' +
          '\n    in Foo (at **)',
        'In HTML, text nodes cannot be a ' +
          'child of <tr>.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Foo>\n' +
          '    <table>\n' +
          '      <Row>\n' +
          '        <tr>\n' +
          '>         x\n' +
          '      ...\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in Foo (at **)',
        'In HTML, whitespace text nodes cannot ' +
          "be a child of <table>. Make sure you don't have any extra " +
          'whitespace between tags on each line of your source code.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Foo>\n' +
          '>   <table>\n' +
          '      <Row>\n' +
          '>     {" "}\n' +
          '\n    in table (at **)' +
          '\n    in Foo (at **)',
      ]);
    });

    /** 先空Foo/table无警告，再更新为空白有table文本警告；再合法tbody/空Row，最后Row加text有tr文本警告，验证更新直接文本时也做嵌套检查。 */
    it('warns nicely for updating table rows to use text', async () => {
      const root = ReactDOMClient.createRoot(document.createElement('div'));

      /** 把children直接放tr，更新可从空行变成非法裸文本。 */
      function Row({children}) {
        return <tr>{children}</tr>;
      }

      /** 把children直接放table，更新可分别成为空白或合法tbody。 */
      function Foo({children}) {
        return <table>{children}</table>;
      }

      // 第一种情况没有问题。
      await act(() => {
        root.render(<Foo />);
      });

      await act(() => {
        root.render(<Foo> </Foo>);
      });
      assertConsoleErrorDev([
        'In HTML, whitespace text nodes cannot ' +
          "be a child of <table>. Make sure you don't have any extra " +
          'whitespace between tags on each line of your source code.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Foo>\n' +
          '    <table>\n' +
          '>     {" "}\n' +
          '\n    in table (at **)' +
          '\n    in Foo (at **)',
      ]);

      await act(() => {
        root.render(
          <Foo>
            <tbody>
              <Row />
            </tbody>
          </Foo>,
        );
      });

      await act(() => {
        root.render(
          <Foo>
            <tbody>
              <Row>text</Row>
            </tbody>
          </Foo>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, text nodes cannot be a ' +
          'child of <tr>.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Foo>\n' +
          '    <table>\n' +
          '      <tbody>\n' +
          '        <Row>\n' +
          '          <tr>\n' +
          '>           text\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)',
      ]);
    });

    /** App1→Viz1→table→FancyRow→Row→tr，开发差异树标出非法table/tr并给Row owner链及另条table祖先链，验证跨函数包装的诊断定位。 */
    it('gives useful context in warnings', async () => {
      /** 输出空tr，错误仅来自它在table下的父子关系。 */
      function Row() {
        return <tr />;
      }
      /** 返回Row增加函数owner层，用于非法table/tr警告的组件上下文。 */
      function FancyRow() {
        return <Row />;
      }

      /** table直接包含FancyRow而无tbody，制造主机嵌套错误并保留Viz调用链。 */
      function Viz1() {
        return (
          <table>
            <FancyRow />
          </table>
        );
      }
      /** 最外函数包装Viz1，使诊断显示完整App/Viz/FancyRow/Row链。 */
      function App1() {
        return <Viz1 />;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<App1 />);
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <App1>\n' +
          '    <Viz1>\n' +
          '>     <table>\n' +
          '        <FancyRow>\n' +
          '          <Row>\n' +
          '>           <tr>\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in FancyRow (at **)' +
          '\n    in Viz1 (at **)' +
          '\n    in App1 (at **)',
        '<table> cannot contain a nested <tr>.\n' +
          'See this log for the ancestor stack trace.\n' +
          '    in table (at **)\n' +
          '    in Viz1 (at **)\n' +
          '    in App1 (at **)',
      ]);
    });

    /** App2/Viz2经FancyTable/Table透传children到table，再FancyRow/Row/tr；两条警告分别展示子创建者链与Table祖先链，验证owner与实际主机祖先上下文。 */
    it('gives useful context in warnings 2', async () => {
      /** 返回空tr作为非法table直接child。 */
      function Row() {
        return <tr />;
      }
      /** 函数包装Row，让子创建者栈包含FancyRow。 */
      function FancyRow() {
        return <Row />;
      }

      /** Table类把children透传到主机table，不补tbody，提供真实祖先组件栈。 */
      class Table extends React.Component {
        /** 返回table和原children，保持非法tr父子关系。 */
        render() {
          return <table>{this.props.children}</table>;
        }
      }

      /** FancyTable类透传children到Table，增加实际祖先包装层。 */
      class FancyTable extends React.Component {
        /** 保持相同child元素转交Table，区别child owner与祖先组件链。 */
        render() {
          return <Table>{this.props.children}</Table>;
        }
      }

      /** 通过FancyTable承载FancyRow，同时构成Row owner与Table祖先两条上下文。 */
      function Viz2() {
        return (
          <FancyTable>
            <FancyRow />
          </FancyTable>
        );
      }
      /** 外层返回Viz2，扩大两条警告共同的顶部上下文。 */
      function App2() {
        return <Viz2 />;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<App2 />);
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <App2>\n' +
          '    <Viz2>\n' +
          '      <FancyTable>\n' +
          '        <Table>\n' +
          '>         <table>\n' +
          '            <FancyRow>\n' +
          '              <Row>\n' +
          '>               <tr>\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in FancyRow (at **)' +
          '\n    in Viz2 (at **)' +
          '\n    in App2 (at **)',
        '<table> cannot contain a nested <tr>.\n' +
          'See this log for the ancestor stack trace.\n' +
          '    in table (at **)\n' +
          '    in Table (at **)\n' +
          '    in FancyTable (at **)\n' +
          '    in Viz2 (at **)\n' +
          '    in App2 (at **)',
      ]);
    });

    /** root直接FancyTable/Table包含FancyRow/Row/tr，无App/Viz包装；两条警告仍展示主机table/tr及各自组件栈，验证短调用链上下文。 */
    it('gives useful context in warnings 3', async () => {
      /** 返回空tr，供无App/Viz的简化诊断链。 */
      function Row() {
        return <tr />;
      }
      /** 包装Row并返回，保持子创建者上下文。 */
      function FancyRow() {
        return <Row />;
      }

      /** 类Table透传children到主机table，不修补tbody，以观察简化祖先栈。 */
      class Table extends React.Component {
        /** table直接接收this.props.children，保留非法tr关系。 */
        render() {
          return <table>{this.props.children}</table>;
        }
      }

      /** 类FancyTable继续透传相同children，让祖先链比子owner链多两层包装。 */
      class FancyTable extends React.Component {
        /** 返回Table原children，供独立祖先栈诊断。 */
        render() {
          return <Table>{this.props.children}</Table>;
        }
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <FancyTable>
            <FancyRow />
          </FancyTable>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <FancyTable>\n' +
          '    <Table>\n' +
          '>     <table>\n' +
          '        <FancyRow>\n' +
          '          <Row>\n' +
          '>           <tr>\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in FancyRow (at **)',
        '<table> cannot contain a nested <tr>.\n' +
          'See this log for the ancestor stack trace.' +
          '\n    in table (at **)' +
          '\n    in Table (at **)' +
          '\n    in FancyTable (at **)',
      ]);
    });

    /** root直接table含FancyRow/Row/tr，两条警告只给真实子owner链与table祖先栈，验证无Table组件包装时诊断裁剪。 */
    it('gives useful context in warnings 4', async () => {
      /** 返回空tr，根table用例只增加函数Row这一owner。 */
      function Row() {
        return <tr />;
      }
      /** 包Row，让根table诊断包含FancyRow/Row而无Table组件。 */
      function FancyRow() {
        return <Row />;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <table>
            <FancyRow />
          </table>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '> <table>\n' +
          '    <FancyRow>\n' +
          '      <Row>\n' +
          '>       <tr>\n' +
          '\n    in tr (at **)' +
          '\n    in Row (at **)' +
          '\n    in FancyRow (at **)',
        '<table> cannot contain a nested <tr>.\n' +
          'See this log for the ancestor stack trace.' +
          '\n    in table (at **)',
      ]);
    });

    /** FancyTable/Table直接含tr先报告table/tr，再Link/a经div嵌另Link/a报告非法a后代及祖先链，验证不同嵌套类型共享诊断格式而保持各自上下文。 */
    it('gives useful context in warnings 5', async () => {
      /** 类Table透传直接tr child，提供祖先链但没有Row组件owner。 */
      class Table extends React.Component {
        /** 返回table原children，故不合法父子关系保持。 */
        render() {
          return <table>{this.props.children}</table>;
        }
      }

      /** 类FancyTable包装Table，测试tr诊断与table祖先诊断不同栈。 */
      class FancyTable extends React.Component {
        /** 继续原样传children，保留根传入的tr元素身份。 */
        render() {
          return <Table>{this.props.children}</Table>;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <FancyTable>
            <tr />
          </FancyTable>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <FancyTable>\n' +
          '    <Table>\n' +
          '>     <table>\n' +
          '>       <tr>\n' +
          '\n    in tr (at **)',
        '<table> cannot contain a nested <tr>.\n' +
          'See this log for the ancestor stack trace.' +
          '\n    in table (at **)' +
          '\n    in Table (at **)' +
          '\n    in FancyTable (at **)',
      ]);

      /** Link类把children放a，多层实例经div构成非法a后代关系。 */
      class Link extends React.Component {
        /** 返回主机a和原children，不阻止后代另一a，供跨主机层级的祖先诊断。 */
        render() {
          return <a>{this.props.children}</a>;
        }
      }

      await act(() => {
        root.render(
          <Link>
            <div>
              <Link />
            </div>
          </Link>,
        );
      });
      assertConsoleErrorDev([
        'In HTML, <a> cannot be a descendant of <a>.\n' +
          'This will cause a hydration error.\n' +
          '\n' +
          '  <Link>\n' +
          '>   <a>\n' +
          '      <div>\n' +
          '        <Link>\n' +
          '>         <a>\n' +
          '\n    in a (at **)' +
          '\n    in Link (at **)',
        '<a> cannot contain a nested <a>.\n' +
          'See this log for the ancestor stack trace.' +
          '\n    in a (at **)' +
          '\n    in Link (at **)',
      ]);
    });

    /** SSR input tabindex字符串1，开发建议tabIndex，验证服务端已知DOM属性大小写映射。 */
    it('should warn about incorrect casing on properties (ssr)', () => {
      ReactDOMServer.renderToString(
        React.createElement('input', {type: 'text', tabindex: '1'}),
      );
      assertConsoleErrorDev([
        'Invalid DOM property `tabindex`. Did you mean `tabIndex`?\n' +
          '    in input (at **)',
      ]);
    });

    /** SSR iframe Credentialless布尔true，开发建议credentialless，验证新布尔属性的大小写校验。 */
    it('should warn about incorrect casing on the credentialless property (ssr)', () => {
      ReactDOMServer.renderToString(
        React.createElement('iframe', {Credentialless: true}),
      );
      assertConsoleErrorDev([
        'Invalid DOM property `Credentialless`. Did you mean `credentialless`?\n' +
          '    in iframe (at **)',
      ]);
    });

    /** SSR input oninput字符串先告事件用camelCase并给通用onClick示例，再onKeydown无警告；服务器不打包注册表，验证不能照客户端精确识别所有错误事件名。 */
    it('should warn about incorrect casing on event handlers (ssr)', () => {
      ReactDOMServer.renderToString(
        React.createElement('input', {type: 'text', oninput: '1'}),
      );
      assertConsoleErrorDev([
        'Invalid event handler property `oninput`. ' +
          'React events use the camelCase naming convention, ' +
          // 注意： 我们不知道正确的事件名称，因此我们使用一个通用的事件名称（onClick）作为建议。 这是因
          // 为我们在服务器上不打包事件系统。
          'for example `onClick`.\n' +
          '    in input (at **)',
      ]);
      ReactDOMServer.renderToString(
        React.createElement('input', {type: 'text', onKeydown: '1'}),
      );
        // 服务端无法针对 `onKeydown` 发出警告，因为服务端不打包事件系统，
        // 无法判断它是否为有效事件。
    });

    /** 客户端input tabindex字符串1，开发建议tabIndex，验证客户端已知属性大小写诊断。 */
    it('should warn about incorrect casing on properties', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          React.createElement('input', {type: 'text', tabindex: '1'}),
        );
      });
      assertConsoleErrorDev([
        'Invalid DOM property `tabindex`. Did you mean `tabIndex`?\n' +
          '    in input (at **)',
      ]);
    });

    /** 客户端先oninput再onKeydown，分别精确建议onInput/onKeyDown，验证事件注册表支持具体纠错而不同于SSR通用示例。 */
    it('should warn about incorrect casing on event handlers', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(React.createElement('input', {type: 'text', oninput: '1'}));
      });
      assertConsoleErrorDev([
        'Invalid event handler property `oninput`. Did you mean `onInput`?\n' +
          '    in input (at **)',
      ]);

      await act(() => {
        root.render(
          React.createElement('input', {type: 'text', onKeydown: '1'}),
        );
      });
      assertConsoleErrorDev([
        'Invalid event handler property `onKeydown`. Did you mean `onKeyDown`?\n' +
          '    in input (at **)',
      ]);
    });

    /** 客户端div class muffins，开发建议className，验证HTML属性名与React prop名的别名诊断。 */
    it('should warn about class', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(React.createElement('div', {class: 'muffins'}));
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);
    });

    /** SSR div class muffins报相同className建议，验证服务器也执行保留别名名称校验。 */
    it('should warn about class (ssr)', () => {
      ReactDOMServer.renderToString(
        React.createElement('div', {class: 'muffins'}),
      );
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 客户端新root分别onFocusIn/onFocusOut函数，开发建议onFocus/onBlur，验证两个历史事件名的专门诊断。 */
    it('should warn about props that are no longer supported', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div />);
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div onFocusIn={() => {}} />);
      });
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onFocusOut={() => {}} />);
      });
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
    });

    /** 客户端小写onfocusin/onfocusout仍各报相同Focus/Blur诊断，验证历史事件名检查忽略大小写。 */
    it('should warn about props that are no longer supported without case sensitivity', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div />);
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onfocusin={() => {}} />);
      });
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onfocusout={() => {}} />);
      });
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
    });

    /** SSR分别onFocusIn/onFocusOut函数，仍有专门Focus/Blur诊断，验证此检查无需完整客户端事件注册表。 */
    it('should warn about props that are no longer supported (ssr)', () => {
      ReactDOMServer.renderToString(<div />);
      ReactDOMServer.renderToString(<div onFocusIn={() => {}} />);
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
      ReactDOMServer.renderToString(<div onFocusOut={() => {}} />);
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
    });

    /** SSR小写onfocusin/onfocusout仍各报专门诊断，验证服务器的大小写归一化分支。 */
    it('should warn about props that are no longer supported without case sensitivity (ssr)', () => {
      ReactDOMServer.renderToString(<div />);
      ReactDOMServer.renderToString(<div onfocusin={() => {}} />);
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
      ReactDOMServer.renderToString(<div onfocusout={() => {}} />);
      assertConsoleErrorDev([
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.\n' +
          '    in div (at **)',
      ]);
    });

    /** 客户端先div class错误再新root input onclick错误，诊断分别含div/input来源行，验证错误定位到实际主机元素。 */
    it('gives source code refs for unknown prop warning', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div class="paladin" />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);
      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input type="text" onclick="1" />);
      });
      assertConsoleErrorDev([
        'Invalid event handler property `onclick`. Did you mean ' +
          '`onClick`?\n' +
          '    in input (at **)',
      ]);
    });

    /** SSR先class再oninput，分别显示div/input栈且事件只给通用onClick示例，验证服务器来源定位与有限事件建议。 */
    it('gives source code refs for unknown prop warning (ssr)', () => {
      ReactDOMServer.renderToString(<div class="paladin" />);
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);
      ReactDOMServer.renderToString(<input type="text" oninput="1" />);
      assertConsoleErrorDev([
        'Invalid event handler property `oninput`. ' +
          // 注意： 我们不知道正确的事件名称，因此我们使用一个通用的事件名称（onClick）作为建议。 这是因
          // 为我们在服务器上不打包事件系统。
          'React events use the camelCase naming convention, for example `onClick`.\n' +
          '    in input (at **)',
      ]);
    });

    /** 先正确className，随后另建容器/root挂错误class，警告仍有div来源；实际不是复用同root更新，验证新错误元素定位。 */
    it('gives source code refs for unknown prop warning for update render', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div className="paladin" />);
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div class="paladin" />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);
    });

    /** 同父树中span class、strong onclick错误而其它div正确，仅两条诊断定位span/strong，验证不会把兄弟或父主机归为来源。 */
    it('gives source code refs for unknown prop warning for exact elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div className="foo1">
            <span class="foo2" />
            <div onClick={() => {}} />
            <strong onclick={() => {}} />
            <div className="foo5" />
            <div className="foo6" />
          </div>,
        );
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in span (at **)',
        'Invalid event handler property `onclick`. Did you mean `onClick`?\n' +
          '    in strong (at **)',
      ]);
    });

    /** SSR同样的span class/strong onclick错误，仅两条定位且onclick用通用camelCase示例，验证服务器精确主机来源。 */
    it('gives source code refs for unknown prop warning for exact elements (ssr)', () => {
      ReactDOMServer.renderToString(
        <div className="foo1">
          <span class="foo2" />
          <div onClick="foo3" />
          <strong onclick="foo4" />
          <div className="foo5" />
          <div className="foo6" />
        </div>,
      );
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in span (at **)',
        'Invalid event handler property `onclick`. ' +
          'React events use the camelCase naming convention, for example `onClick`.\n' +
          '    in strong (at **)',
      ]);
    });

    /** Parent含四类Child，仅Child1/span class与Child3/strong onclick错误；诊断分别给对应Child/Parent链，验证组件组合不混淆不同子创建者。 */
    it('gives source code refs for unknown prop warning for exact elements in composition', async () => {
      /** 组合四个类Child，只有两个主机prop非法，观察不同错误各自的创建者栈。 */
      class Parent extends React.Component {
        /** 按Child1/2/3/4顺序返回，合法兄弟不得出现在其它错误来源中。 */
        render() {
          return (
            <div>
              <Child1 />
              <Child2 />
              <Child3 />
              <Child4 />
            </div>
          );
        }
      }

      /** 返回带错误class的span，提供Child1/Parent来源链。 */
      class Child1 extends React.Component {
        /** span使用class而非className，触发只属于此子组件的诊断。 */
        render() {
          return <span class="paladin">Child1</span>;
        }
      }

      /** 返回合法div Child2，作为不应产生警告的兄弟。 */
      class Child2 extends React.Component {
        /** 仅输出普通div文本，无非法属性。 */
        render() {
          return <div>Child2</div>;
        }
      }

      /** 返回错误onclick的strong，提供独立Child3/Parent来源链。 */
      class Child3 extends React.Component {
        /** 用小写onclick字符串制造事件名纠错诊断。 */
        render() {
          return <strong onclick="1">Child3</strong>;
        }
      }

      /** 合法Child4提供另一个不应被误标来源的兄弟。 */
      class Child4 extends React.Component {
        /** 返回无非法prop的div文本，保持组合树上下文。 */
        render() {
          return <div>Child4</div>;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Parent />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in span (at **)\n' +
          '    in Child1 (at **)\n' +
          '    in Parent (at **)',
        'Invalid event handler property `onclick`. Did you mean `onClick`?\n' +
          '    in strong (at **)\n' +
          '    in Child3 (at **)\n' +
          '    in Parent (at **)',
      ]);
    });

    /** SSR相同四Child组合，只有Child1/Child3各带Parent来源链，事件为服务器通用建议，验证服务器组合栈。 */
    it('gives source code refs for unknown prop warning for exact elements in composition (ssr)', () => {
      const container = document.createElement('div');

      /** 服务端组合四Child，只让Child1/Child3生成不同prop诊断。 */
      class Parent extends React.Component {
        /** 按固定顺序返回四个类子组件，比较SSR各自创建者栈。 */
        render() {
          return (
            <div>
              <Child1 />
              <Child2 />
              <Child3 />
              <Child4 />
            </div>
          );
        }
      }

      /** SSR子fixture在span用class，提供Child1来源。 */
      class Child1 extends React.Component {
        /** 返回错误class的span，验证服务端别名诊断。 */
        render() {
          return <span class="paladin">Child1</span>;
        }
      }

      /** SSR合法Child2，保证不会混进其它child的错误栈。 */
      class Child2 extends React.Component {
        /** 返回普通div Child2文本，无诊断输入。 */
        render() {
          return <div>Child2</div>;
        }
      }

      /** SSR子fixture在strong用onclick，提供Child3事件来源。 */
      class Child3 extends React.Component {
        /** 返回小写onclick字符串的strong，服务器给通用事件命名示例。 */
        render() {
          return <strong onclick="1">Child3</strong>;
        }
      }

      /** SSR合法Child4，作为错误来源定位的对照兄弟。 */
      class Child4 extends React.Component {
        /** 返回普通div Child4文本，不触发prop诊断。 */
        render() {
          return <div>Child4</div>;
        }
      }

      ReactDOMServer.renderToString(<Parent />, container);
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in span (at **)\n' +
          '    in Child1 (at **)\n' +
          '    in Parent (at **)',
        'Invalid event handler property `onclick`. ' +
          'React events use the camelCase naming convention, for example `onClick`.\n' +
          '    in strong (at **)\n' +
          '    in Child3 (at **)\n' +
          '    in Parent (at **)',
      ]);
    });

    /** 客户端label for与input autofocus分别告htmlFor/autoFocus，验证已知属性别名和大小写候选建议。 */
    it('should suggest property name if available', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(React.createElement('label', {for: 'test'}));
      });
      assertConsoleErrorDev([
        'Invalid DOM property `for`. Did you mean `htmlFor`?\n' +
          '    in label',
      ]);

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          React.createElement('input', {type: 'text', autofocus: true}),
        );
      });
      assertConsoleErrorDev([
        'Invalid DOM property `autofocus`. Did you mean `autoFocus`?\n    in input',
      ]);
    });

    /** SSR label for与input autofocus也分别建议htmlFor/autoFocus，验证服务器属性名称纠错表。 */
    it('should suggest property name if available (ssr)', () => {
      ReactDOMServer.renderToString(
        React.createElement('label', {for: 'test'}),
      );
      assertConsoleErrorDev([
        'Invalid DOM property `for`. Did you mean `htmlFor`?\n' +
          '    in label',
      ]);
      ReactDOMServer.renderToString(
        React.createElement('input', {type: 'text', autofocus: true}),
      );
      assertConsoleErrorDev([
        'Invalid DOM property `autofocus`. Did you mean `autoFocus`?\n' +
          '    in input',
      ]);
    });
  });

  describe('whitespace', () => {
    /** 危险HTML含首尾换行/tab和span内空白，挂载后innerHTML精确等于输入，验证不裁剪HTML空白。 */
    it('renders innerHTML and preserves whitespace', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const html = '\n  \t  <span>  \n  testContent  \t  </span>  \n  \t';
      const elem = <div dangerouslySetInnerHTML={{__html: html}} />;

      await act(() => {
        root.render(elem);
      });
      expect(container.firstChild.innerHTML).toBe(html);
    });

    /** 危险HTML从带空白span改为带空白div，innerHTML精确等于第二字符串，验证更新同样保留全部空白。 */
    it('render and then updates innerHTML and preserves whitespace', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const html = '\n  \t  <span>  \n  testContent1  \t  </span>  \n  \t';
      const elem = <div dangerouslySetInnerHTML={{__html: html}} />;
      await act(() => {
        root.render(elem);
      });

      const html2 = '\n  \t  <div>  \n  testContent2  \t  </div>  \n  \t';
      const elem2 = <div dangerouslySetInnerHTML={{__html: html2}} />;
      await act(() => {
        root.render(elem2);
      });

      expect(container.firstChild.innerHTML).toBe(html2);
    });
  });

  describe('Attributes with aliases', function () {
    /** 普通HTML div传class并以ref读节点，开发建议className而实际className仍test，验证诊断不阻止浏览器识别原attribute。 */
    it('sets aliased attributes on HTML attributes', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div class="test" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `class`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);

      expect(el.className).toBe('test');
    });

    /** HTML div传混合大小写cLASS，开发建议className且DOM className test，验证浏览器HTML属性大小写归一化。 */
    it('sets incorrectly cased aliased attributes on HTML attributes with a warning', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div cLASS="test" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `cLASS`. Did you mean `className`?\n' +
          '    in div (at **)',
      ]);

      expect(el.className).toBe('test');
    });

    /** SVG text用arabic-form原DOM名，开发建议React arabicForm但DOM仍有arabic-form，验证SVG别名诊断与实际写入分离。 */
    it('sets aliased attributes on SVG elements with a warning', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <svg ref={current => (el = current)}>
            <text arabic-form="initial" />
          </svg>,
        );
      });
      assertConsoleErrorDev([
        'Invalid DOM property `arabic-form`. Did you mean `arabicForm`?\n' +
          '    in text (at **)',
      ]);
      const text = el.querySelector('text');

      expect(text.hasAttribute('arabic-form')).toBe(true);
    });

    /** 扩展原生div is custom-element使用class，无警告且class test，验证自定义扩展允许原始attribute名。 */
    it('sets aliased attributes on custom elements', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div is="custom-element" class="test" />);
      });

      const el = container.firstChild;
      expect(el.getAttribute('class')).toBe('test');
    });

    /** 扩展原生div is custom-element传claSS，DOM class test且无该别名警告，验证此路径放行名称后仍由HTML DOM归一化。 */
    it('aliased attributes on custom elements with bad casing', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div is="custom-element" claSS="test" />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('class')).toBe('test');
    });

    /** 扩展原生div class foo→bar，最终attribute class bar，验证自定义扩展属性更新。 */
    it('updates aliased attributes on custom elements', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div is="custom-element" class="foo" />);
      });
      await act(() => {
        root.render(<div is="custom-element" class="bar" />);
      });

      expect(container.firstChild.getAttribute('class')).toBe('bar');
    });
  });

  describe('Custom attributes', function () {
    /** 普通div未知whatever字符串30可作为attribute读取，验证未知小写名允许字符串值。 */
    it('allows assignment of custom attributes with string values', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever="30" />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('whatever')).toBe('30');
    });

    /** whatever字符串30改null，attribute消失，验证自定义attribute删除。 */
    it('removes custom attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div whatever="30" />);
      });

      expect(container.firstChild.getAttribute('whatever')).toBe('30');

      await act(() => {
        root.render(<div whatever={null} />);
      });

      expect(container.firstChild.hasAttribute('whatever')).toBe(false);
    });

    /** 普通div未知whatever布尔true，开发非布尔属性警告且attribute不存在，验证不是一律把布尔变字符串。 */
    it('does not assign a boolean custom attributes as a string', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever={true} ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Received `true` for a non-boolean attribute `whatever`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'whatever="true" or whatever={value.toString()}.\n' +
          '    in div (at **)',
      ]);

      expect(el.hasAttribute('whatever')).toBe(false);
    });

    /** 相同whatever省略值的JSX隐式true，仍警告且无attribute，验证语法简写不改变未知非布尔过滤。 */
    it('does not assign an implicit boolean custom attributes', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          // eslint-disable-next-line react/jsx-boolean-value
          <div whatever ref={current => (el = current)} />,
        );
      });
      assertConsoleErrorDev([
        'Received `true` for a non-boolean attribute `whatever`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'whatever="true" or whatever={value.toString()}.\n' +
          '    in div (at **)',
      ]);

      expect(el.hasAttribute('whatever')).toBe(false);
    });

    /** 未知whatever数字3，DOM attribute字符串3，验证数值序列化。 */
    it('assigns a numeric custom attributes as a string', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever={3} />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('whatever')).toBe('3');
    });

    /** 未知whatever函数，开发无效值诊断且无attribute，验证函数不能序列化成自定义属性。 */
    it('will not assign a function custom attributes', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <div whatever={() => {}} ref={current => (el = current)} />,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `whatever` on <div> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);

      expect(el.hasAttribute('whatever')).toBe(false);
    });

    /** 未知whatever普通对象，DOM值为[object Object]，验证对象走字符串转换而非被函数/布尔规则拒绝。 */
    it('will assign an object custom attributes', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever={{}} />);
      });

      const el = container.firstChild;
      expect(el.getAttribute('whatever')).toBe('[object Object]');
    });

    /** 危险HTML原值为TemporalLike，valueOf抛错但DOM string hint调用toString得日期，innerHTML成功；验证此路径把对象交DOM而不先用默认hint拼字符串。 */
    it('allows Temporal-like objects as HTML (they are not coerced to strings first)', async () => {
      /** 危险HTML对象fixture拥有可用日期toString而valueOf抛错，区分DOM字符串提示与默认数值转换。 */
      class TemporalLike {
        /** 默认hint若调用valueOf即抛TypeError；成功HTML测试证明此转换没有被调用。 */
        valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
          throw new TypeError('prod message');
        }
        /** DOM innerHTML按string hint调用此方法，返回可插入的日期文本。 */
        toString() {
          return '2020-01-01';
        }
      }

      // React 将 __html 原值交给 innerHTML setter；DOM 按字符串提示调用 toString，绕开会抛错的 valueOf。
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: new TemporalLike()}} />,
        );
      });
      expect(container.firstChild.innerHTML).toEqual('2020-01-01');
    });

    /** data-fooBar字符串true，开发建议小写data-foobar而DOM可按小写读到true，验证属性名警告与HTML大小写归一化。 */
    it('allows cased data attributes', async () => {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div data-fooBar="true" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'React does not recognize the `data-fooBar` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom ' +
          'attribute, spell it as lowercase `data-foobar` instead. ' +
          'If you accidentally passed it from a parent component, remove ' +
          'it from the DOM element.\n' +
          '    in div (at **)',
      ]);
      expect(el.getAttribute('data-foobar')).toBe('true');
    });

    /** 普通div fooBar字符串true，开发建议foobar但DOM小写读取true，验证未知混合大小写名诊断而不丢合法字符串值。 */
    it('allows cased custom attributes', async () => {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div fooBar="true" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'React does not recognize the `fooBar` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom ' +
          'attribute, spell it as lowercase `foobar` instead. ' +
          'If you accidentally passed it from a parent component, remove ' +
          'it from the DOM element.\n' +
          '    in div (at **)',
      ]);
      expect(el.getAttribute('foobar')).toBe('true');
    });

    /** whatever值NaN，开发告非法数值但DOM仍保存NaN字符串，验证数值警告不等于attribute过滤。 */
    it('warns on NaN attributes', async () => {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever={NaN} ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Received NaN for the `whatever` attribute. If this is ' +
          'expected, cast the value to a string.\n' +
          '    in div',
      ]);

      expect(el.getAttribute('whatever')).toBe('NaN');
    });

    /** whatever从数字0变函数，开发无效值警告且旧attribute被删除，验证原先合法属性更新成非法值的清理。 */
    it('removes a property when it becomes invalid', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div whatever={0} />);
      });
      await act(() => {
        root.render(<div whatever={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `whatever` on <div> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);
      const el = container.firstChild;
      expect(el.hasAttribute('whatever')).toBe(false);
    });

    /** 已知HTML属性SiZe混合大小写，开发建议size而DOM size仍30，验证已知名称归一化与纠错。 */
    it('warns on bad casing of known HTML attributes', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div SiZe="30" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Invalid DOM property `SiZe`. Did you mean `size`?\n' +
          '    in div (at **)',
      ]);

      expect(el.getAttribute('size')).toBe('30');
    });
  });

  describe('Object stringification', function () {
    /** acceptCharset值普通对象，DOM accept-charset为[object Object]，验证已知别名属性也允许对象字符串转换。 */
    it('allows objects on known properties', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div acceptCharset={{}} />);
      });

      const el = container.firstChild;
      expect(el.getAttribute('accept-charset')).toBe('[object Object]');
    });

    /** 自定义toString对象返回hello，先img src property解析为localhost/hello，再SVG arabic-form及普通unknown为hello，验证URL/已知SVG/未知attribute三条转换路径。 */
    it('should pass objects as attributes if they define toString', async () => {
      const obj = {
        /** 返回hello供属性字符串化；同对象用于img URL、SVG别名与普通未知attribute，浏览器再对src做绝对URL解析。 */
        toString() {
          return 'hello';
        },
      };
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<img src={obj} />);
      });
      expect(container.firstChild.src).toBe('http://localhost/hello');

      await act(() => {
        root.render(<svg arabicForm={obj} />);
      });
      expect(container.firstChild.getAttribute('arabic-form')).toBe('hello');

      await act(() => {
        root.render(<div unknown={obj} />);
      });
      expect(container.firstChild.getAttribute('unknown')).toBe('hello');
    });

    /** SVG arabicForm普通对象无自定义toString，arabic-form值[object Object]，验证继承默认字符串转换。 */
    it('passes objects on known SVG attributes if they do not define toString', async () => {
      const obj = {};
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<svg arabicForm={obj} />);
      });
      expect(container.firstChild.getAttribute('arabic-form')).toBe(
        '[object Object]',
      );
    });

    /** 普通div unknown普通对象，attribute值[object Object]，验证未知属性同样使用默认字符串表示。 */
    it('passes objects on custom attributes if they do not define toString', async () => {
      const obj = {};
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div unknown={obj} />);
      });
      expect(container.firstChild.getAttribute('unknown')).toBe(
        '[object Object]',
      );
    });

    /** Object.create从父对象继承toString hello.jpg，img src解析为localhost/hello.jpg，验证转换方法无需是对象自身字段。 */
    it('allows objects that inherit a custom toString method', async function () {
      const parent = {
        /** 让继承该对象的属性值稳定转换为图片 URL。 */
        toString: () => 'hello.jpg'
      };
      const child = Object.create(parent);
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<img src={child} />);
      });

      const el = container.firstChild;

      expect(el.src).toBe('http://localhost/hello.jpg');
    });

    /** ajaxify值对象toString返回ajaxy，DOM未知attribute保存ajaxy，验证内部历史属性仍走普通对象字符串转换。 */
    it('assigns ajaxify (an important internal FB attribute)', async function () {
      const options = {
        /** 模拟 FB 内部属性值的自定义字符串转换。 */
        toString: () => 'ajaxy'
      };
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div ajaxify={options} />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('ajaxify')).toBe('ajaxy');
    });
  });

  describe('String boolean attributes', function () {
    /** 普通div whatever true，开发告非布尔属性且不写attribute，验证可字符串化的特定属性白名单不扩大到所有未知属性。 */
    it('does not assign string boolean attributes for custom attributes', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div whatever={true} ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Received `true` for a non-boolean attribute `whatever`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'whatever="true" or whatever={value.toString()}.\n' +
          '    in div (at **)',
      ]);

      expect(el.hasAttribute('whatever')).toBe(false);
    });

    /** spellCheck true允许并写字符串true，验证枚举式布尔属性与存在式布尔属性区别。 */
    it('stringifies the boolean true for allowed attributes', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div spellCheck={true} />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('spellCheck')).toBe('true');
    });

    /** spellCheck false仍写字符串false而非删除，验证该字段的false有实际枚举语义。 */
    it('stringifies the boolean false for allowed attributes', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div spellCheck={false} />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('spellCheck')).toBe('false');
    });

    /** JSX隐式spellCheck true，DOM仍字符串true，验证简写进入同一枚举序列化路径。 */
    it('stringifies implicit booleans for allowed attributes', async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        // eslint-disable-next-line react/jsx-boolean-value
        root.render(<div spellCheck />);
      });

      const el = container.firstChild;

      expect(el.getAttribute('spellCheck')).toBe('true');
    });
  });

  describe('Boolean attributes', function () {
    /** hidden传字符串false，开发警告浏览器视为真，DOM仍空值hidden attribute，验证存在式布尔字段不解析文本false。 */
    it('warns on the ambiguous string value "false"', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div hidden="false" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Received the string `false` for the boolean attribute `hidden`. ' +
          'The browser will interpret it as a truthy value. ' +
          'Did you mean hidden={false}?\n' +
          '    in div (at **)',
      ]);

      expect(el.getAttribute('hidden')).toBe('');
    });

    /** hidden传字符串true，开发提示字符串false风险，DOM同样空值hidden，验证字符串truthiness与布尔建议。 */
    it('warns on the potentially-ambiguous string value "true"', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<div hidden="true" ref={current => (el = current)} />);
      });
      assertConsoleErrorDev([
        'Received the string `true` for the boolean attribute `hidden`. ' +
          'Although this works, it will not work as expected if you pass the string "false". ' +
          'Did you mean hidden={true}?\n' +
          '    in div (at **)',
      ]);

      expect(el.getAttribute('hidden')).toBe('');
    });
  });

  describe('Hyphenated SVG elements', function () {
    /** SVG font-face虽带连字符仍非Web Component，x-height false先提示xHeight别名且无attribute，验证保留SVG标签不走自定义布尔路径。 */
    it('the font-face element is not a custom element', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <svg ref={current => (el = current)}>
            <font-face x-height={false} />
          </svg>,
        );
      });
      assertConsoleErrorDev([
        'Invalid DOM property `x-height`. Did you mean `xHeight`?\n' +
          '    in font-face (at **)',
      ]);

      expect(el.querySelector('font-face').hasAttribute('x-height')).toBe(
        false,
      );
    });

    /** SVG font-face whatever false，开发非布尔值诊断且无attribute，验证连字符SVG特殊标签仍过滤未知布尔。 */
    it('the font-face element does not allow unknown boolean values', async function () {
      let el;
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <svg ref={current => (el = current)}>
            <font-face whatever={false} />
          </svg>,
        );
      });
      assertConsoleErrorDev([
        'Received `false` for a non-boolean attribute `whatever`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'whatever="false" or whatever={value.toString()}.\n\n' +
          'If you used to conditionally omit it with whatever={condition && value}, ' +
          'pass whatever={condition ? value : undefined} instead.\n' +
          '    in font-face (at **)',
      ]);

      expect(el.querySelector('font-face').hasAttribute('whatever')).toBe(
        false,
      );
    });
  });

  // 自定义元素通过专用属性提交路径处理布尔值、名称大小写和事件监听；下面覆盖这些差异。
  describe('Custom elements', () => {
    /** 真正自定义some-custom-element foo true→false→缺省→true，attribute先空串后删除再存在，验证自定义布尔presence规则。 */
    it('does not strip unknown boolean attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<some-custom-element foo={true} />);
      });
      const node = container.firstChild;
      expect(node.getAttribute('foo')).toBe('');
      await act(() => {
        root.render(<some-custom-element foo={false} />);
      });
      expect(node.getAttribute('foo')).toBe(null);
      await act(() => {
        root.render(<some-custom-element />);
      });
      expect(node.hasAttribute('foo')).toBe(false);
      await act(() => {
        root.render(<some-custom-element foo={true} />);
      });
      expect(node.hasAttribute('foo')).toBe(true);
    });

    /** 自定义标签onx字符串bar→buzz→缺省→bar，attribute保留/更新/删除/恢复，验证自定义字符串on*没有套普通HTML未知事件过滤。 */
    it('does not strip the on* attributes', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<some-custom-element onx="bar" />);
      });
      const node = container.firstChild;
      expect(node.getAttribute('onx')).toBe('bar');
      await act(() => {
        root.render(<some-custom-element onx="buzz" />);
      });
      expect(node.getAttribute('onx')).toBe('buzz');
      await act(() => {
        root.render(<some-custom-element />);
      });
      expect(node.hasAttribute('onx')).toBe(false);
      await act(() => {
        root.render(<some-custom-element onx="bar" />);
      });
      expect(node.getAttribute('onx')).toBe('bar');
    });
  });

  /** 两个嵌套React root加document原生捕获/冒泡监听后点击inner，标准顺序document捕获→outer捕获→inner捕获→inner冒泡→outer冒泡→document冒泡；Legacy FB改为document冒泡早于React冒泡，验证委托时序。finally只移容器未注销document监听。 */
  it('receives events in specific order', async () => {
    const eventOrder = [];
    /** 为tag创建无参数事件记录闭包，调用时向eventOrder追加该tag；返回函数可同时用于React与document原生监听。 */
    const track = tag => () => eventOrder.push(tag);
    const outerRef = React.createRef();
    const innerRef = React.createRef();

    /** 已提交外root的div同时带capture/bubble记录和DOM ref，后续成为独立innerRoot容器。 */
    function OuterReactApp() {
      return (
        <div
          ref={outerRef}
          onClick={track('outer bubble')}
          onClickCapture={track('outer capture')}
        />
      );
    }

    /** 独立内root的div同时带capture/bubble记录和ref，click从此节点穿过两个root及document。 */
    function InnerReactApp() {
      return (
        <div
          ref={innerRef}
          onClick={track('inner bubble')}
          onClickCapture={track('inner capture')}
        />
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);

    try {
      await act(() => {
        root.render(<OuterReactApp />);
      });
      const innerRoot = ReactDOMClient.createRoot(outerRef.current);
      await act(() => {
        innerRoot.render(<InnerReactApp />);
      });

      document.addEventListener('click', track('document bubble'));
      document.addEventListener('click', track('document capture'), true);

      innerRef.current.click();

      if (ReactFeatureFlags.enableLegacyFBSupport) {
        // 这里的顺序会改变，因为 Legacy FB 支持会在上方监听器之后才把事件监听器添加到 document。
        expect(eventOrder).toEqual([
          'document capture',
          'outer capture',
          'inner capture',
          'document bubble',
          'inner bubble',
          'outer bubble',
        ]);
      } else {
        expect(eventOrder).toEqual([
          'document capture',
          'outer capture',
          'inner capture',
          'inner bubble',
          'outer bubble',
          'document bubble',
        ]);
      }
    } finally {
      document.body.removeChild(container);
    }
  });

  describe('iOS Tap Highlight', () => {
    /** 现代root主机div有onClick，ref.current.onclick类型function，验证iOS点击冒泡兼容的本地空handler安装；不直接测试真实iOS手势。 */
    it('adds onclick handler to elements with onClick prop', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const elementRef = React.createRef();
      /** 输出带onClick和ref的div，检查主机节点本地onclick兼容handler是否安装。 */
      function Component() {
        return <div ref={elementRef} onClick={() => {}} />;
      }

      await act(() => {
        root.render(<Component />);
      });
      expect(typeof elementRef.current.onclick).toBe('function');
    });

    /** 现代root通过portal返回onClick div，portal容器onclick类型function，验证点击兼容空handler同时安装到portal挂载容器。 */
    it('adds onclick handler to a portal root', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const portalContainer = document.createElement('div');

      /** 向独立portalContainer返回onClick div，测试portal容器自己的onclick补丁。 */
      function Component() {
        return ReactDOM.createPortal(
          <div onClick={() => {}} />,
          portalContainer,
        );
      }

      await act(() => {
        root.render(<Component />);
      });
      expect(typeof portalContainer.onclick).toBe('function');
    });

    /** 仅legacy模式启用定义用ReactDOM.render挂onClick div，外root容器onclick不是function，验证旧入口容器无需同样补丁；断言目标为容器而非子div。 */
    // @gate !disableLegacyMode
    it('does not add onclick handler to the React root in legacy mode', () => {
      const container = document.createElement('div');

      /** 用legacy入口输出onClick div，测试外root容器保持无onclick补丁，不把子节点行为混入断言。 */
      function Component() {
        return <div onClick={() => {}} />;
      }

      ReactDOM.render(<Component />, container);
      expect(typeof container.onclick).not.toBe('function');
    });
  });
});
