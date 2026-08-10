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

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text(props) {
    return <div>{props.text}</div>;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText(props) {
    throw new Promise(() => {});
  }

  /** `getVisibleChildren`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should render the children when no promise is thrown」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
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

  /** 测试场景：验证「should render the fallback when a promise thrown」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should work with nested suspense components」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「server renders a SuspenseList component and its children」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「throws when rendering a suspending component outside a Suspense node」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「does not get confused by throwing null」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing null', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「does not get confused by throwing undefined」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing undefined', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「does not get confused by throwing a primitive」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing a primitive', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
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
