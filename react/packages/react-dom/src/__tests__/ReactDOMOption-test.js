/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMOption', () => {
  let React;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /** 每次新建容器和根，在act中渲染children后返回容器；用于独立验证option输入，不在此工具内卸载。 */
  async function renderIntoDocument(children) {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => root.render(children));
    return container;
  }

  /** option子级含数字1、空白及foo；innerHTML应1 foo，验证普通文本/数字组合扁平化。 */
  it('should flatten children to a string', async () => {
    const stub = (
      <option>
        {1} {'foo'}
      </option>
    );
    const container = await renderIntoDocument(stub);

    expect(container.firstChild.innerHTML).toBe('1 foo');
  });

  /** option显式value=12且子级含div；DEV应提示HTML嵌套导致hydration错误，客户端仍有1 <div></div> 2；第二次渲染不重复警告，验证诊断不阻止客户端构建。 */
  it('should warn for invalid child tags', async () => {
    const el = (
      <option value="12">
        {1} <div /> {2}
      </option>
    );
    const container = await renderIntoDocument(el);
    assertConsoleErrorDev([
      'In HTML, <div> cannot be a child of <option>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <option value="12">\n' +
        '>   <div>\n' +
        '    ...\n' +
        '\n' +
        '    in div (at **)',
    ]);
    expect(container.firstChild.innerHTML).toBe('1 <div></div> 2');
    await renderIntoDocument(el);
  });

  /** option未显式value且子级含返回2的Foo组件；DEV不能推断复杂children值诊断、DOM为1 2 3，再次不重复，验证复杂树需要显式值。 */
  it('should warn for component child if no value prop is provided', async () => {
    /** 返回文本2，作为option复杂组件child，区分最终DOM文字与renderer可直接推断的原始child。 */
    function Foo() {
      return '2';
    }
    const el = (
      <option>
        {1} <Foo /> {3}
      </option>
    );
    const container = await renderIntoDocument(el);
    assertConsoleErrorDev([
      'Cannot infer the option value of complex children. ' +
        'Pass a `value` prop or use a plain string as children to <option>.\n' +
        '    in option (at **)',
    ]);
    expect(container.firstChild.innerHTML).toBe('1 2 3');
    await renderIntoDocument(el);
  });

  /** 相同Foo子级但option显式value=123；DOM仍1 2 3且无警告，验证显式值避开复杂children推断。 */
  it('should not warn for component child if value prop is provided', async () => {
    /** 返回文本2，作为option复杂组件child，区分最终DOM文字与renderer可直接推断的原始child。 */
    function Foo() {
      return '2';
    }
    const el = (
      <option value="123">
        {1} <Foo /> {3}
      </option>
    );
    const container = await renderIntoDocument(el);
    expect(container.firstChild.innerHTML).toBe('1 2 3');
    await renderIntoDocument(el);
  });

  /** option子级混数字、布尔、null/undefined与JSX空白；输出1  2，验证空子值不产生文本但相邻空白保留。 */
  it('should ignore null/undefined/false children without warning', async () => {
    const stub = (
      <option>
        {1} {false}
        {true}
        {null}
        {undefined} {2}
      </option>
    );
    const container = await renderIntoDocument(stub);

    expect(container.firstChild.innerHTML).toBe('1  2');
  });

  /** 分别将普通对象直接、数组内、与元素/文本混合放入option；每次异步渲染均应拒绝对象不是合法child，验证option不绕过通用child校验。 */
  it('should throw on object children', async () => {
    await expect(async () =>
      renderIntoDocument(<option>{{}}</option>),
    ).rejects.toThrow('Objects are not valid as a React child');
    await expect(async () => {
      await renderIntoDocument(<option>{[{}]}</option>);
    }).rejects.toThrow('Objects are not valid as a React child');
    await expect(async () => {
      await renderIntoDocument(
        <option>
          {{}}
          <span />
        </option>,
      );
    }).rejects.toThrow('Objects are not valid as a React child');
    await expect(async () => {
      await renderIntoDocument(
        <option>
          {'1'}
          {{}}
          {2}
        </option>,
      );
    }).rejects.toThrow('Objects are not valid as a React child');
  });

  /** 手工React元素形状对象既可渲染hello又有toString=hello；作为直接/数组child时输出hello，作为option.value时value=hello，混合文本仍1hello2，验证元素渲染与值序列化走不同协议。 */
  it('should support element-ish child', async () => {
    // 这类似于 <fbt>。 我们不将其转换为字符串，因为您必须提供一个值属性。
    const obj = {
      $$typeof: Symbol.for('react.transitional.element'),
      /** 手工元素对象的函数类型，从props.content返回hello，走正常React元素渲染而非对象toString。 */
      type: props => props.content,
      ref: null,
      key: null,
      props: {
        content: 'hello',
      },
      /** 返回this.props.content，供同一对象作为option.value时进行属性字符串化。 */
      toString() {
        return this.props.content;
      },
    };

    let container = await renderIntoDocument(<option value="a">{obj}</option>);
    expect(container.firstChild.innerHTML).toBe('hello');

    container = await renderIntoDocument(<option value="b">{[obj]}</option>);
    expect(container.firstChild.innerHTML).toBe('hello');

    container = await renderIntoDocument(<option value={obj}>{obj}</option>);
    expect(container.firstChild.innerHTML).toBe('hello');
    expect(container.firstChild.value).toBe('hello');

    container = await renderIntoDocument(
      <option value={obj}>
        {'1'}
        {obj}
        {2}
      </option>,
    );
    expect(container.firstChild.innerHTML).toBe('1hello2');
    expect(container.firstChild.value).toBe('hello');
  });

  /** option仅含5n；HTML与DOM value均5，验证bigint文本并作为隐式option值。 */
  it('should support bigint values', async () => {
    const container = await renderIntoDocument(<option>{5n}</option>);
    expect(container.firstChild.innerHTML).toBe('5');
    expect(container.firstChild.value).toBe('5');
  });

  /** option只有innerHTML=foobar无value；DOM文本foobar且DEV建议显式value，验证rawHTML内容不能供renderer推断选择值。 */
  it('should be able to use dangerouslySetInnerHTML on option', async () => {
    const stub = <option dangerouslySetInnerHTML={{__html: 'foobar'}} />;
    const container = await renderIntoDocument(stub);
    assertConsoleErrorDev([
      'Pass a `value` prop if you set dangerouslyInnerHTML so React knows which value should be selected.\n' +
        '    in option (at **)',
    ]);

    expect(container.firstChild.innerHTML).toBe('foobar');
  });

  /** option初值value为空字符串再更新lava；两轮value attribute均存在且分别空/lava，验证空值与缺值不同。 */
  it('should set attribute for empty value', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let option;
    await act(() => {
      root.render(<option value="" />);
    });
    option = container.firstChild;
    expect(option.hasAttribute('value')).toBe(true);
    expect(option.getAttribute('value')).toBe('');

    await act(() => {
      root.render(<option value="lava" />);
    });
    option = container.firstChild;
    expect(option.hasAttribute('value')).toBe(true);
    expect(option.getAttribute('value')).toBe('lava');
  });

  /** 受控select.value=giraffe，options无显式值且部分文本分段；首轮selectedIndex=1，改gorilla为2，验证option隐式值从最终文字取得。 */
  it('should allow ignoring `value` on option', async () => {
    const a = 'a';
    let node;
    const stub = (
      <select value="giraffe" onChange={() => {}}>
        <option>monkey</option>
        <option>gir{a}ffe</option>
        <option>gorill{a}</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });
    node = container.firstChild;

    expect(node.selectedIndex).toBe(1);

    await act(() => {
      root.render(<select value="gorilla">{options}</select>);
    });
    node = container.firstChild;
    expect(node.selectedIndex).toEqual(2);
  });

  /** SSR受控select的option内含非法div；解析后option文字BarFooBaz且选中，hydrate应给嵌套诊断并客户端恢复出真实div/ref在option下，文字与选中状态保持，验证解析树变化触发恢复。 */
  it('generates a hydration error when an invalid nested tag is used as a child', async () => {
    const ref = React.createRef();
    const children = (
      <select readOnly={true} value="bar">
        <option value="bar">
          {['Bar', false, 'Foo', <div key="1" ref={ref} />, 'Baz']}
        </option>
      </select>
    );

    const container = document.createElement('div');

    container.innerHTML = ReactDOMServer.renderToString(children);

    expect(container.firstChild.getAttribute('value')).toBe(null);
    expect(container.firstChild.getAttribute('defaultValue')).toBe(null);

    let option = container.firstChild.firstChild;
    expect(option.nodeName).toBe('OPTION');

    expect(option.textContent).toBe('BarFooBaz');
    expect(option.selected).toBe(true);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, children, {
        /** 忽略本例预期hydration恢复错误的回调，嵌套诊断仍由console断言检查；不改变恢复子树。 */
        onRecoverableError: () => {},
      });
    });
    assertConsoleErrorDev([
      'In HTML, <div> cannot be a child of <option>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '  <select readOnly={true} value="bar">\n' +
        '>   <option value="bar">\n' +
        '>     <div ref={{current:null}}>\n' +
        '      ...\n' +
        '\n' +
        '    in div (at **)',
    ]);
    option = container.firstChild.firstChild;

    expect(option.textContent).toBe('BarFooBaz');
    expect(option.selected).toBe(true);

    expect(ref.current.nodeName).toBe('DIV');
    expect(ref.current.parentNode).toBe(option);
  });
});
