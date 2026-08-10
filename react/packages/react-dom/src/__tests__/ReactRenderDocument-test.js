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
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let act;
let Scheduler;
let assertLog;

/** `getTestDocument`：封装当前用例复用的操作、回调或断言步骤。 */
function getTestDocument(markup) {
  const doc = document.implementation.createHTMLDocument('');
  doc.open();
  doc.write(
    markup ||
      '<!doctype html><html><meta charset=utf-8><title>test doc</title>',
  );
  doc.close();
  return doc;
}

/** `normalizeError`：封装当前用例复用的操作、回调或断言步骤。 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

describe('rendering React components at document', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    Scheduler = require('scheduler');
  });

  describe('with new explicit hydration API', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should be able to adopt server markup」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('should be able to adopt server markup', async () => {
      /** `Root`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Root extends React.Component {
        /** `Root.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>{'Hello ' + this.props.hello}</body>
            </html>
          );
        }
      }

      const markup = ReactDOMServer.renderToString(<Root hello="world" />);
      expect(markup).not.toContain('DOCTYPE');
      expect(markup).not.toContain('rel="expect"');
      const testDocument = getTestDocument(markup);
      const body = testDocument.body;

      let root;
      await act(() => {
        root = ReactDOMClient.hydrateRoot(testDocument, <Root hello="world" />);
      });
      expect(testDocument.body.innerHTML).toBe('Hello world');

      await act(() => {
        root.render(<Root hello="moon" />);
      });
      expect(testDocument.body.innerHTML).toBe('Hello moon');

      expect(body === testDocument.body).toBe(true);
    });

    /** 测试场景：验证「should be able to unmount component from document node, but leaves singleton nodes intact」描述的渲染、交互或错误处理结果。 */
    it('should be able to unmount component from document node, but leaves singleton nodes intact', async () => {
      /** `Root`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Root extends React.Component {
        /** `Root.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>Hello world</body>
            </html>
          );
        }
      }

      const markup = ReactDOMServer.renderToString(<Root />);
      const testDocument = getTestDocument(markup);
      let root;
      await act(() => {
        root = ReactDOMClient.hydrateRoot(testDocument, <Root />);
      });
      expect(testDocument.body.innerHTML).toBe('Hello world');

      const originalDocEl = testDocument.documentElement;
      const originalHead = testDocument.head;
      const originalBody = testDocument.body;

      // 当卸载时，除了 HTML 的单例节点外，一切都被移除。 头部 `<body>` 和 `<html>` 是 HTML 文档的根
      // 元素。它们是文档的主体部分，包含所有其他 HTML 元素。
      root.unmount();
      expect(testDocument.firstChild).toBe(originalDocEl);
      expect(testDocument.head).toBe(originalHead);
      expect(testDocument.body).toBe(originalBody);
      expect(originalBody.innerHTML).toBe('');
      expect(originalHead.innerHTML).toBe('');
    });

    /** 测试场景：验证「should not be able to switch root constructors」描述的渲染、交互或错误处理结果。 */
    it('should not be able to switch root constructors', async () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>Hello world</body>
            </html>
          );
        }
      }

      /** `Component2`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component2 extends React.Component {
        /** `Component2.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>Goodbye world</body>
            </html>
          );
        }
      }

      const markup = ReactDOMServer.renderToString(<Component />);
      const testDocument = getTestDocument(markup);

      let root;
      await act(() => {
        root = ReactDOMClient.hydrateRoot(testDocument, <Component />);
      });

      expect(testDocument.body.innerHTML).toBe('Hello world');

      await act(() => {
        root.render(<Component2 />);
      });

      expect(testDocument.body.innerHTML).toBe('Goodbye world');
    });

    /** 测试场景：验证「should be able to mount into document」描述的渲染、交互或错误处理结果。 */
    it('should be able to mount into document', async () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>{this.props.text}</body>
            </html>
          );
        }
      }

      const markup = ReactDOMServer.renderToString(
        <Component text="Hello world" />,
      );
      const testDocument = getTestDocument(markup);

      await act(() => {
        ReactDOMClient.hydrateRoot(
          testDocument,
          <Component text="Hello world" />,
        );
      });

      expect(testDocument.body.innerHTML).toBe('Hello world');
    });

    /** 测试场景：验证「cannot render over an existing text child at the root」描述的渲染、交互或错误处理结果。 */
    it('cannot render over an existing text child at the root', async () => {
      const container = document.createElement('div');
      container.textContent = 'potato';

      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(container, <div>parsnip</div>, {
          /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
          onRecoverableError: error => {
            Scheduler.log(
              'onRecoverableError: ' + normalizeError(error.message),
            );
            if (error.cause) {
              Scheduler.log('Cause: ' + normalizeError(error.cause.message));
            }
          },
        });
      });

      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);

      // 这造成了可悲的双重文本案例.
      expect(container.textContent).toBe('parsnip');
    });

    /** 测试场景：验证「renders over an existing nested text child without throwing」描述的渲染、交互或错误处理结果。 */
    it('renders over an existing nested text child without throwing', async () => {
      const container = document.createElement('div');
      const wrapper = document.createElement('div');
      wrapper.textContent = 'potato';
      container.appendChild(wrapper);
      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(
          container,
          <div>
            <div>parsnip</div>
          </div>,
          {
            /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
            onRecoverableError: error => {
              Scheduler.log(
                'onRecoverableError: ' + normalizeError(error.message),
              );
              if (error.cause) {
                Scheduler.log('Cause: ' + normalizeError(error.cause.message));
              }
            },
          },
        );
      });

      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
      expect(container.textContent).toBe('parsnip');
    });

    /** 测试场景：验证「should give helpful errors on state desync」描述的渲染、交互或错误处理结果。 */
    it('should give helpful errors on state desync', async () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>{this.props.text}</body>
            </html>
          );
        }
      }

      const markup = ReactDOMServer.renderToString(
        <Component text="Goodbye world" />,
      );
      const testDocument = getTestDocument(markup);

      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(
          testDocument,
          <Component text="Hello world" />,
          {
            /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
            onRecoverableError: error => {
              Scheduler.log(
                'onRecoverableError: ' + normalizeError(error.message),
              );
              if (error.cause) {
                Scheduler.log('Cause: ' + normalizeError(error.cause.message));
              }
            },
          },
        );
      });

      assertLog([
        "onRecoverableError: Hydration failed because the server rendered text didn't match the client.",
      ]);
      expect(testDocument.body.innerHTML).toBe('Hello world');
    });

    /** 测试场景：验证「should render w/ no markup to full document」描述的渲染、交互或错误处理结果。 */
    it('should render w/ no markup to full document', async () => {
      const testDocument = getTestDocument();

      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <html>
              <head>
                <title>Hello World</title>
              </head>
              <body>{this.props.text}</body>
            </html>
          );
        }
      }

      // 使用 Float 后，title 不再产生水合不匹配，因此错误会准确指向 body 的不匹配。
      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(
          testDocument,
          <Component text="Hello world" />,
          {
            /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
            onRecoverableError: error => {
              Scheduler.log(
                'onRecoverableError: ' + normalizeError(error.message),
              );
              if (error.cause) {
                Scheduler.log('Cause: ' + normalizeError(error.cause.message));
              }
            },
          },
        );
      });
      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
      expect(testDocument.body.innerHTML).toBe('Hello world');
    });
  });
});
