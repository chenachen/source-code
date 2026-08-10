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

  /** `renderIntoDocument`：封装当前用例复用的操作、回调或断言步骤。 */
  async function renderIntoDocument(children) {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => root.render(children));
    return container;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should flatten children to a string」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should flatten children to a string', async () => {
    const stub = (
      <option>
        {1} {'foo'}
      </option>
    );
    const container = await renderIntoDocument(stub);

    expect(container.firstChild.innerHTML).toBe('1 foo');
  });

  /** 测试场景：验证「should warn for invalid child tags」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should warn for component child if no value prop is provided」描述的渲染、交互或错误处理结果。 */
  it('should warn for component child if no value prop is provided', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should not warn for component child if value prop is provided」描述的渲染、交互或错误处理结果。 */
  it('should not warn for component child if value prop is provided', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should ignore null/undefined/false children without warning」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should throw on object children」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should support element-ish child」描述的渲染、交互或错误处理结果。 */
  it('should support element-ish child', async () => {
    // 这类似于 <fbt>。 我们不将其转换为字符串，因为您必须提供一个值属性。
    const obj = {
      $$typeof: Symbol.for('react.transitional.element'),
      /** `type`：封装当前用例复用的操作、回调或断言步骤。 */
      type: props => props.content,
      ref: null,
      key: null,
      props: {
        content: 'hello',
      },
      /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should support bigint values」描述的渲染、交互或错误处理结果。 */
  it('should support bigint values', async () => {
    const container = await renderIntoDocument(<option>{5n}</option>);
    expect(container.firstChild.innerHTML).toBe('5');
    expect(container.firstChild.value).toBe('5');
  });

  /** 测试场景：验证「should be able to use dangerouslySetInnerHTML on option」描述的渲染、交互或错误处理结果。 */
  it('should be able to use dangerouslySetInnerHTML on option', async () => {
    const stub = <option dangerouslySetInnerHTML={{__html: 'foobar'}} />;
    const container = await renderIntoDocument(stub);
    assertConsoleErrorDev([
      'Pass a `value` prop if you set dangerouslyInnerHTML so React knows which value should be selected.\n' +
        '    in option (at **)',
    ]);

    expect(container.firstChild.innerHTML).toBe('foobar');
  });

  /** 测试场景：验证「should set attribute for empty value」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should allow ignoring `value` on option」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「generates a hydration error when an invalid nested tag is used as a child」描述的渲染、交互或错误处理结果。 */
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
        /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
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
