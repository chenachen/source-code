/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let ReactDOMServer;
let act;
let SuspenseList;

describe('ReactDOMServerSuspense', () => {
  beforeEach(() => {
    // 重置警告缓存。
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }
  });

  /** 用 div 包裹传入文本，作为内容与 fallback 的可见树断言叶节点。 */
  function Text(props) {
    return <div>{props.text}</div>;
  }

  /** 始终抛永不完成的 Promise，模拟同步字符串 SSR 无法等待的边界内容；props.text 不会输出。 */
  function AsyncText(props) {
    throw new Promise(() => {});
  }

  /** 递归把可见元素/Text 转成 React 节点供比较；过滤脚本、模板及任何含 hidden/aria-hidden 的节点，并跳过含冒号的 id 属性。 */
  function getVisibleChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          node.tagName !== 'SCRIPT' &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
        ) {
          const props = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // 我们假设这是一个 React 的唯一标识符，是一个非视觉实现细节。
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getVisibleChildren(node);
          children.push(React.createElement(node.tagName.toLowerCase(), props));
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
        ? children[0]
        : children;
  }

  /** 同步 SSR 的 Suspense 子树只含正常 Text；解析 HTML 后可见结果应是 Children div，验证未悬挂边界输出内容而非 fallback。 */
  it('should render the children when no promise is thrown', async () => {
    const container = document.createElement('div');
    const html = ReactDOMServer.renderToString(
      <React.Suspense fallback={<Text text="Fallback" />}>
        <Text text="Children" />
      </React.Suspense>,
    );
    container.innerHTML = html;
    expect(getVisibleChildren(container)).toEqual(<div>Children</div>);
  });

  /** 同步 SSR 的 Suspense 子树抛永不完成 Promise；可见 HTML 应是 Fallback div，验证 legacy 字符串入口不等待异步边界。 */
  it('should render the fallback when a promise thrown', async () => {
    const container = document.createElement('div');
    const html = ReactDOMServer.renderToString(
      <React.Suspense fallback={<Text text="Fallback" />}>
        <AsyncText text="Children" />
      </React.Suspense>,
    );
    container.innerHTML = html;
    expect(getVisibleChildren(container)).toEqual(<div>Fallback</div>);
  });

  /** 外层 Suspense 中同步 Children 与内层悬挂 AsyncText 并存；可见结果应保留同步兄弟并只替换内层为 Fallback，验证最近边界接住悬挂。 */
  it('should work with nested suspense components', async () => {
    const container = document.createElement('div');
    const html = ReactDOMServer.renderToString(
      <React.Suspense fallback={<Text text="Fallback" />}>
        <div>
          <Text text="Children" />
          <React.Suspense fallback={<Text text="Fallback" />}>
            <AsyncText text="Children" />
          </React.Suspense>
        </div>
      </React.Suspense>,
    );
    container.innerHTML = html;

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Children</div>
        <div>Fallback</div>
      </div>,
    );
  });

  // @gate enableSuspenseList

  /** forwards/visible SuspenseList 含两个同步边界 A/B；SSR 输出两个 div，客户端 hydration 后两个 div 身份都应不变，验证列表可串联输出并认领原节点。 */
  it('server renders a SuspenseList component and its children', async () => {
    const example = (
      <SuspenseList revealOrder="forwards" tail="visible">
        <React.Suspense fallback="Loading A">
          <div>A</div>
        </React.Suspense>
        <React.Suspense fallback="Loading B">
          <div>B</div>
        </React.Suspense>
      </SuspenseList>
    );
    const container = document.createElement('div');
    const html = ReactDOMServer.renderToString(example);
    container.innerHTML = html;

    const divA = container.children[0];
    expect(divA.tagName).toBe('DIV');
    expect(divA.textContent).toBe('A');
    const divB = container.children[1];
    expect(divB.tagName).toBe('DIV');
    expect(divB.textContent).toBe('B');

    await act(() => {
      ReactDOMClient.hydrateRoot(container, example);
    });

    const divA2 = container.children[0];
    const divB2 = container.children[1];
    expect(divA).toBe(divA2);
    expect(divB).toBe(divB2);
  });

  /** AsyncText 位于 div 下但不在相邻空 Suspense 的内部；renderToString 应抛同步输入悬挂错误，验证兄弟边界不能捕获范围外的悬挂。 */
  it('throws when rendering a suspending component outside a Suspense node', async () => {
    expect(() => {
      ReactDOMServer.renderToString(
        <div>
          <React.Suspense />
          <AsyncText text="Children" />
          <React.Suspense />
        </div>,
      );
    }).toThrow('A component suspended while responding to synchronous input.');
  });

  /** 组件抛 null 后调用 renderToString，以独立 didError 标记记录 catch；应确实捕获且原值为 null，验证 falsy 错误值不被当作无错误。 */
  it('does not get confused by throwing null', () => {

    /** 抛 null 而非 Error，检测 legacy SSR 是否保留 falsy 异常值。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw null;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(null);
  });

  /** 组件抛 undefined 后调用 renderToString；didError 应为 true 且捕获值仍 undefined，验证异常是否发生不能用错误值 truthiness 判断。 */
  it('does not get confused by throwing undefined', () => {

    /** 抛 undefined，借外层 didError 哨兵区分确实抛错与无返回值。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(undefined);
  });

  /** 组件抛字符串 foo 后调用 renderToString；应捕获原始 foo，验证服务端错误传播不要求 Error 对象。 */
  it('does not get confused by throwing a primitive', () => {

    /** 抛字符串 foo，覆盖非对象异常值的原样传播。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw 'foo';
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe('foo');
  });
});
