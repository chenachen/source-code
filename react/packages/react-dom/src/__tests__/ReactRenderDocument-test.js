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

/** 创建独立HTMLDocument并以open/write/close解析给定markup；缺省输入提供meta/title的最小文档，DOM结构由HTML parser补齐。 */
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

/** 仅保留第一个句号之前及该句号，或无句号时原消息，避免后续解释变化影响恢复错误断言。 */
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
    /** SSR完整html/head/body的Root(world)，hydrateRoot(Document)后更新moon；文字更新且body对象身份保持，legacy字符串无DOCTYPE/rel=expect，验证文档单例认领与后续更新。 */
    it('should be able to adopt server markup', async () => {
      /** world/moon文本可更新的完整文档类，验证Document单例复用。 */
      class Root extends React.Component {
        /** 输出固定html/head/title与按hello变化的body，隔离文字更新。 */
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

    /** SSR完整文档并hydrateRoot后unmount；html/head/body对象均保留，head/body内容清空，验证Document单例不会随React子树删除。 */
    it('should be able to unmount component from document node, but leaves singleton nodes intact', async () => {
      /** 输出完整Hello文档供水合后卸载，保存单例身份。 */
      class Root extends React.Component {
        /** 固定html/head/title/body，卸载应只清其子内容。 */
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

      // 卸载会清理 React 的内容，但复用的 html、head、body 单例节点仍留在文档中。
      root.unmount();
      expect(testDocument.firstChild).toBe(originalDocEl);
      expect(testDocument.head).toBe(originalHead);
      expect(testDocument.body).toBe(originalBody);
      expect(originalBody.innerHTML).toBe('');
      expect(originalHead.innerHTML).toBe('');
    });

    /** SSR Component后水合，再root.render不同类Component2；body从Hello变Goodbye，验证当前实现允许更换根组件类型；旧标题并不反映实际断言。 */
    it('should not be able to switch root constructors', async () => {
      /** 初始Hello完整文档类，随后被另一组件类型替换。 */
      class Component extends React.Component {
        /** 固定Hello body，作为类型切换前内容。 */
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

      /** 另一独立类输出Goodbye但单例标签结构相同。 */
      class Component2 extends React.Component {
        /** 替换后输出Goodbye body，用于证明当前支持根类型变化。 */
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

    /** SSR Component(text=Hello)后hydrateRoot(Document)；body文字正确，验证显式Document容器水合。 */
    it('should be able to mount into document', async () => {
      /** 完整文档fixture，从text props生成body供显式水合。 */
      class Component extends React.Component {
        /** 固定单例标签并透传text，只检查服务端认领成功。 */
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

    /** 容器直接Text potato，却水合div/parsnip；flushSync报告HTML不匹配并最终文字parsnip，验证根形状错配退回客户端构建。 */
    it('cannot render over an existing text child at the root', async () => {
      const container = document.createElement('div');
      container.textContent = 'potato';

      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(container, <div>parsnip</div>, {
          /** 把主错误及可选cause的首句写Scheduler日志，比较形状/文本错配恢复；回调只记录，不自行重建DOM。 */
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

      // 原服务端根是Text而客户端要求div；恢复后只留下客户端parsnip。
      expect(container.textContent).toBe('parsnip');
    });

    /** 容器已有div内Text potato，却水合div/div/parsnip；flushSync报告HTML不匹配而不抛未处理错误、最终parsnip，验证嵌套元素形状恢复。 */
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
            /** 把主错误及可选cause的首句写Scheduler日志，比较形状/文本错配恢复；回调只记录，不自行重建DOM。 */
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

    /** SSR完整文档body为Goodbye，客户端同结构为Hello；flushSync给文本不匹配恢复消息并替换body内容，验证文档文本错配。 */
    it('should give helpful errors on state desync', async () => {
      /** 同结构但服务端与客户端text不同的完整文档类。 */
      class Component extends React.Component {
        /** body透传text，使测试仅制造文本不匹配。 */
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
            /** 把主错误及可选cause的首句写Scheduler日志，比较形状/文本错配恢复；回调只记录，不自行重建DOM。 */
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

    /** 默认测试Document有meta/title但空body，水合完整Hello文档；title作为可提升资源不导致首个错误，报告body HTML错配并恢复Hello，验证singleton/hoistable搜索与恢复。 */
    it('should render w/ no markup to full document', async () => {
      const testDocument = getTestDocument();

      /** 从默认空body文档水合的完整文档类。 */
      class Component extends React.Component {
        /** 输出Hello body及可提升title，区分title认领与body错配。 */
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
            /** 把主错误及可选cause的首句写Scheduler日志，比较形状/文本错配恢复；回调只记录，不自行重建DOM。 */
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
