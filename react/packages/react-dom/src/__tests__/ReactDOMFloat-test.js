/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';
import {
  insertNodesAndExecuteScripts,
  mergeOptions,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let Stream;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMFizzServer;
let Suspense;
let SuspenseList;
let textCache;
let loadCache;
let writable;
let CSPnonce = null;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let renderOptions;
let waitForAll;
let assertLog;
let Scheduler;
let clientAct;
let streamingContainer;
let assertConsoleErrorDev;

describe('ReactDOMFloat', () => {
  // 每例重置模块并创建可执行脚本的JSDOM文档，matchMedia仅匹配空串/all；初始化文本记录与按节点去重的loadCache，并把PassThrough数据累入buffer。资源load/error由辅助函数人工派发。
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;

    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    // 我们模拟 matchMedia。 为了简化起见，它只匹配 `'all'` 或空字符串，而忽略了其他一切。
    Object.defineProperty(jsdom.window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: query === 'all' || query === '',
        media: query,
      })),
    });
    streamingContainer = null;
    global.window = jsdom.window;
    global.document = global.window.document;
    global.navigator = global.window.navigator;
    global.Node = global.window.Node;
    global.addEventListener = global.window.addEventListener;
    global.MutationObserver = global.window.MutationObserver;
    // Fizz runtime 假定 requestAnimationFrame 存在，因此这里需要提供 polyfill。
    global.requestAnimationFrame =
      /** 为Fizz runtime补requestAnimationFrame，以setTimeout(cb)异步调用，不提供浏览器帧时间或真实vsync；返回timer handle。
       * @param cb 下一帧通知函数，此polyfill不传时间戳。
       * @returns setTimeout定时器句柄。 */
      global.window.requestAnimationFrame = cb =>
      setTimeout(cb);
    container = document.getElementById('container');

    CSPnonce = null;
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    SuspenseList = React.unstable_SuspenseList;
    Scheduler = require('scheduler/unstable_mock');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    clientAct = InternalTestUtils.act;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    textCache = new Map();
    loadCache = new Set();

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });

    renderOptions = {};
    if (gate(flags => flags.shouldUseFizzExternalRuntime)) {
      renderOptions.unstable_externalRuntimeSrc =
        'react-dom/unstable_server-external-runtime';
    }
  });

  const bodyStartMatch = /<body(?:>| .*?>)/;
  const headStartMatch = /<head(?:>| .*?>)/;

  /** 执行server侧callback并等待一次setImmediate，再消费PassThrough缓冲：首段可替换document内容，后段按head/body/container插入且执行内嵌脚本，最后跑定时器使节流揭示完成。这是JSDOM整片段模拟，不是浏览器增量HTML解析。
   * @param callback 本次渲染、解锁文本或派load/error的同步/异步操作。
   * @returns 插入与脚本处理完成的Promise；空缓冲只跑定时器。
   * @throws callback/脚本错误、stream fatalError或非法首段html格式；错误不自动恢复已写DOM。 */
  async function act(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // 由于 JSDOM 不支持流解析器，我们需要给它一个适当的片段。 我们还想执行嵌入式的任何脚本. 我们假
    // 设现在已经接收到一个适当的片段的 HTML。
    let bufferedContent = buffer;
    buffer = '';

    if (!bufferedContent) {
      jest.runAllTimers();
      return;
    }

    const bodyMatch = bufferedContent.match(bodyStartMatch);
    const headMatch = bufferedContent.match(headStartMatch);

    if (streamingContainer === null) {
    // 这是第一段流式内容，我们在此决定插入位置。若收到 <html>、<head> 或 <body>，就放弃预先构建
    // 的 document 并从头开始；否则假定内容属于 container。生产环境无法正确地向深层 div 流式写入，
    // 因而不会采用这种行为，但它对测试很实用。

      if (
        bufferedContent.startsWith('<head>') ||
        bufferedContent.startsWith('<head ') ||
        bufferedContent.startsWith('<body>') ||
        bufferedContent.startsWith('<body ')
      ) {
        // 将元素包裹在文档类型声明中以标准化解析过程。
        bufferedContent = '<!DOCTYPE html><html>' + bufferedContent;
      } else if (
        bufferedContent.startsWith('<html>') ||
        bufferedContent.startsWith('<html ')
      ) {
        throw new Error(
          'Recieved <html> without a <!DOCTYPE html> which is almost certainly a bug in React',
        );
      }

      if (bufferedContent.startsWith('<!DOCTYPE html>')) {
        // 我们完全可以使用整个文档。
        const tempDom = new JSDOM(bufferedContent);

        // 清除现有的头部和主体内容
        document.head.innerHTML = '';
        document.body.innerHTML = '';

        // 复制 <html> 属性。
        const tempHtmlNode = tempDom.window.document.documentElement;
        for (let i = 0; i < tempHtmlNode.attributes.length; i++) {
          const attr = tempHtmlNode.attributes[i];
          document.documentElement.setAttribute(attr.name, attr.value);
        }

        if (headMatch) {
          // 我们解析了一个头部打开标签。 我们需要复制头部属性，并将未来的内容插入到 <head> 中。
          streamingContainer = document.head;
          const tempHeadNode = tempDom.window.document.head;
          for (let i = 0; i < tempHeadNode.attributes.length; i++) {
            const attr = tempHeadNode.attributes[i];
            document.head.setAttribute(attr.name, attr.value);
          }
          const source = document.createElement('head');
          source.innerHTML = tempHeadNode.innerHTML;
          await insertNodesAndExecuteScripts(source, document.head, CSPnonce);
        }

        if (bodyMatch) {
          // 解析到 body 标签后复制 body 属性，并把后续流式内容插入 document.body。
          streamingContainer = document.body;
          const tempBodyNode = tempDom.window.document.body;
          for (let i = 0; i < tempBodyNode.attributes.length; i++) {
            const attr = tempBodyNode.attributes[i];
            document.body.setAttribute(attr.name, attr.value);
          }
          const source = document.createElement('body');
          source.innerHTML = tempBodyNode.innerHTML;
          await insertNodesAndExecuteScripts(source, document.body, CSPnonce);
        }

        if (!headMatch && !bodyMatch) {
          throw new Error('expected <head> or <body> after <html>');
        }
      } else {
        // 我们假设数据流进入默认容器。
        streamingContainer = container;
        const div = document.createElement('div');
        div.innerHTML = bufferedContent;
        await insertNodesAndExecuteScripts(div, container, CSPnonce);
      }
    } else if (streamingContainer === document.head) {
      bufferedContent = '<!DOCTYPE html><html><head>' + bufferedContent;
      const tempDom = new JSDOM(bufferedContent);

      const tempHeadNode = tempDom.window.document.head;
      const source = document.createElement('head');
      source.innerHTML = tempHeadNode.innerHTML;
      await insertNodesAndExecuteScripts(source, document.head, CSPnonce);

      if (bodyMatch) {
        streamingContainer = document.body;

        const tempBodyNode = tempDom.window.document.body;
        for (let i = 0; i < tempBodyNode.attributes.length; i++) {
          const attr = tempBodyNode.attributes[i];
          document.body.setAttribute(attr.name, attr.value);
        }
        const bodySource = document.createElement('body');
        bodySource.innerHTML = tempBodyNode.innerHTML;
        await insertNodesAndExecuteScripts(bodySource, document.body, CSPnonce);
      }
    } else {
      const div = document.createElement('div');
      div.innerHTML = bufferedContent;
      await insertNodesAndExecuteScripts(div, streamingContainer, CSPnonce);
    }
    await 0;
    // 让节流边界揭示
    jest.runAllTimers();
  }

  /** 递归把DOM投影为可比较的React元素/文本，忽略实现脚本、template、hidden/aria-hidden节点与render-blocking expect标记；data-meaningful覆盖过滤，async外部脚本可保留，含冒号id被省略。只比较此投影，不证明节点身份或网络加载。
   * @param element 从其firstChild遍历的DOM容器。
   * @returns 无可见子项为undefined，一个项直接返回，多个项返回数组。 */
  function getMeaningfulChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          // 某些标签可能是模糊的，可能会因为看起来像非有意义的子节点而被隐藏，因此我们有一个全局的覆盖，
          // 如果包含这个数据属性，我们就包括这个节点。
          node.hasAttribute('data-meaningful') ||
          (node.tagName === 'SCRIPT' &&
            node.hasAttribute('src') &&
            node.getAttribute('src') !==
              renderOptions.unstable_externalRuntimeSrc &&
            node.hasAttribute('async')) ||
          (node.tagName !== 'SCRIPT' &&
            node.tagName !== 'TEMPLATE' &&
            node.tagName !== 'template' &&
            !node.hasAttribute('hidden') &&
            !node.hasAttribute('aria-hidden') &&
            // 忽略渲染阻塞，期望
            (node.getAttribute('rel') !== 'expect' ||
              node.getAttribute('blocking') !== 'render'))
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
          props.children = getMeaningfulChildren(node);
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

  /** 先读value对应文本记录，pending时抛thenable使当前Suspense挂起，resolved后透传children。
   * @param props value为缓存键，children为解锁后的资源/内容。
   * @returns children；挂起或拒绝时不返回。 */
  function BlockedOn({value, children}) {
    readText(value);
    return children;
  }

  /** 缺记录时创建resolved记录；pending时先改状态和值，再同步调用全部ping，已resolved/rejected记录不修改。ping数组不清空，但重复resolve不再次通知。
   * @param text 缓存键及最终字符串值。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** 读textCache的resolved值，pending/rejected抛记录值；首次未命中构造可订阅thenable存为pending后抛出，供BlockedOn/AsyncText控制Fizz边界。
   * @param text 字符串缓存键。
   * @returns resolved文本；未就绪时抛thenable，rejected时抛原因。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      const thenable = {
        pings: [],

        /** pending时把resolve加入ping列表，状态已改变时以Promise微任务调用resolve(newRecord.value)；仅实现单一成功订阅，不接受拒绝回调或返回链式promise。
         * @param resolve Fizz重试用通知函数。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** 返回文本缓存值，pending则沿readText抛thenable，由最近Suspense显示fallback。
   * @param props text为记录键和成功值。
   * @returns resolved文本。 */
  function AsyncText({text}) {
    return readText(text);
  }

  /** 将本例options与按特性开关建立的renderOptions经mergeOptions合并后转发Fizz Node流入口；测试调用方负责pipe到writable。
   * @param jsx 待流式输出的React树。
   * @param options 本例额外服务端选项，可能为空。
   * @returns Fizz返回的pipe/abort流控制对象。 */
  function renderToPipeableStream(jsx, options) {
    // 合并选项与 renderOptions。 可能包含特定于 featureFlag 的行为。
    return ReactDOMFizzServer.renderToPipeableStream(
      jsx,
      mergeOptions(options, renderOptions),
    );
  }

  /** 为document中尚未通知的preload节点派load并记href日志，按可选hrefs筛选；不触发真实网络请求。
   * @param hrefs 可选href数组；缺省选择所有preload。 */
  function loadPreloads(hrefs) {
    const event = new window.Event('load');
    const nodes = document.querySelectorAll('link[rel="preload"]');
    resolveLoadables(hrefs, nodes, event, href =>
      Scheduler.log('load preload: ' + href),
    );
  }

  /** 为document中未通知的preload节点派error并记日志；与成功路径共享按节点记录的loadCache。
   * @param hrefs 可选href筛选列表。 */
  function errorPreloads(hrefs) {
    const event = new window.Event('error');
    const nodes = document.querySelectorAll('link[rel="preload"]');
    resolveLoadables(hrefs, nodes, event, href =>
      Scheduler.log('error preload: ' + href),
    );
  }

  /** 把document作为资源查找根转交loadStylesheetsFrom，模拟全页样式加载。
   * @param hrefs 可选stylesheet href筛选列表。 */
  function loadStylesheets(hrefs) {
    loadStylesheetsFrom(document, hrefs);
  }

  /** 在指定Document或shadowRoot内查找stylesheet，给未通知节点派load并记录日志，支持验证shadow资源归属。
   * @param root 支持querySelectorAll的样式查找根。
   * @param hrefs 可选href筛选列表。 */
  function loadStylesheetsFrom(root, hrefs) {
    const event = new window.Event('load');
    const nodes = root.querySelectorAll('link[rel="stylesheet"]');
    resolveLoadables(hrefs, nodes, event, href => {
      Scheduler.log('load stylesheet: ' + href);
    });
  }

  /** 在document内为未通知的stylesheet派error并记录日志，让样式依赖失败路径可控。
   * @param hrefs 可选href筛选列表。 */
  function errorStylesheets(hrefs) {
    const event = new window.Event('error');
    const nodes = document.querySelectorAll('link[rel="stylesheet"]');
    resolveLoadables(hrefs, nodes, event, href => {
      Scheduler.log('error stylesheet: ' + href);
    });
  }

  /** 按href筛选nodes，跳过loadCache中已处理的节点；先记录节点，再调用onLoad日志钩子并派event。去重键是DOM节点而非URL，同节点不再通知，替换节点可重新通知。
   * @param hrefs 可选href列表，缺省全部；空数组不处理任何节点。
   * @param nodes 本次querySelectorAll得到的节点集合。
   * @param event 循环复用的load或error事件。
   * @param onLoad 派事件前调用的href观察函数；抛错会中止循环且当前节点已入缓存。 */
  function resolveLoadables(hrefs, nodes, event, onLoad) {
    const hrefSet = hrefs ? new Set(hrefs) : null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (loadCache.has(node)) {
        continue;
      }
      const href = node.getAttribute('href');
      if (!hrefSet || hrefSet.has(href)) {
        loadCache.add(node);
        onLoad(href);
        node.dispatchEvent(event);
      }
    }
  }

  /** 以document为根，title先于html/head/body出现；等待提交后title仍归入head，body保持hello world，验证资源可先于singleton创建。 */
  it('can render resources before singletons', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <>
        <title>foo</title>
        <html>
          <head>
            <link rel="foo" href="foo" />
          </head>
          <body>hello world</body>
        </html>
      </>,
    );
    try {
      await waitForAll([]);
    } catch (e) {
      // 对于DOMExceptions,当我们预计测试失败时,我们需要先清除调度器,否则预期失败将失败
      await waitForAll([]);
      throw e;
    }
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <title>foo</title>
          <link rel="foo" href="foo" />
        </head>
        <body>hello world</body>
      </html>,
    );
  });

  /** Fizz先输出含meta、带onLoad的普通link、title、noscript、base与async脚本的head；再用相同树hydrate，前后有意义DOM完全相同，普通节点与提升资源可并存。 */
  it('can hydrate non Resources in head when Resources are also inserted there', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head>
            <meta property="foo" content="bar" />
            <link rel="foo" href="bar" onLoad={() => {}} />
            <title>foo</title>
            <noscript>
              <link rel="icon" href="icon" />
            </noscript>
            <base target="foo" href="bar" />
            <script async={true} src="foo" onLoad={() => {}} />
          </head>
          <body>foo</body>
        </html>,
      );
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta property="foo" content="bar" />
          <title>foo</title>
          <link rel="foo" href="bar" />
          <noscript>&lt;link rel="icon" href="icon"&gt;</noscript>
          <base target="foo" href="bar" />
          <script async="" src="foo" />
        </head>
        <body>foo</body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head>
          <meta property="foo" content="bar" />
          <link rel="foo" href="bar" onLoad={() => {}} />
          <title>foo</title>
          <noscript>
            <link rel="icon" href="icon" />
          </noscript>
          <base target="foo" href="bar" />
          <script async={true} src="foo" onLoad={() => {}} />
        </head>
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta property="foo" content="bar" />
          <title>foo</title>
          <link rel="foo" href="bar" />
          <noscript>&lt;link rel="icon" href="icon"&gt;</noscript>
          <base target="foo" href="bar" />
          <script async="" src="foo" />
        </head>
        <body>foo</body>
      </html>,
    );
  });

  /** 依次把noscript、template、无资源键style、无precedence样式link、同步script及带事件的link/script放在head/body外；断言各类定位和嵌套警告，trusted-types开关只增加脚本执行提示。 */
  it('warns if you render resource-like elements above <head> or <body>', async () => {
    const root = ReactDOMClient.createRoot(document);

    root.render(
      <>
        <noscript>foo</noscript>
        <html>
          <body>foo</body>
        </html>
      </>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render <noscript> outside the main document. Try moving it into the root <head> tag.',
    ]);

    root.render(
      <html>
        <template>foo</template>
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render <template> outside the main document. Try moving it into the root <head> tag.\n' +
        '    in html (at **)',
      'In HTML, <template> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n\n' +
        '> <html>\n' +
        '>   <template>\n' +
        '    ...\n' +
        '\n' +
        '    in template (at **)',
    ]);

    root.render(
      <html>
        <body>foo</body>
        <style>foo</style>
      </html>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <style> outside the main document without knowing its precedence ' +
        'and a unique href key. React can hoist and deduplicate <style> tags if you provide a ' +
        '`precedence` prop along with an `href` prop that does not conflict with the `href` ' +
        'values used in any other hoisted <style> or <link rel="stylesheet" ...> tags.  ' +
        'Note that hoisting <style> tags is considered an advanced feature that most will not use directly. ' +
        'Consider moving the <style> tag to the <head> or consider adding a `precedence="default"` ' +
        'and `href="some unique resource identifier"`.\n' +
        '    in html (at **)',
      'In HTML, <style> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n\n' +
        '> <html>\n' +
        '    <body>\n' +
        '>   <style>\n' +
        '\n' +
        '    in style (at **)',
    ]);

    root.render(
      <>
        <html>
          <body>foo</body>
        </html>
        <link rel="stylesheet" href="foo" />
      </>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <link rel="stylesheet" /> outside the main document without knowing its precedence. ' +
        'Consider adding precedence="default" or moving it into the root <head> tag.',
    ]);

    root.render(
      <>
        <html>
          <body>foo</body>
          <script href="foo" />
        </html>
      </>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a sync or defer <script> outside the main document without knowing its order. ' +
        'Try adding async="" or moving it into the root <head> tag.\n' +
        '    in html (at **)',
      'In HTML, <script> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '    <body>\n' +
        '>   <script href="foo">\n' +
        '\n' +
        '    in script (at **)',
      ...(gate('enableTrustedTypesIntegration')
        ? [
            'Encountered a script tag while rendering React component. ' +
              'Scripts inside React components are never executed when rendering on the client. ' +
              'Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).\n' +
              '     in script (at **)',
          ]
        : []),
    ]);

    root.render(
      <html>
        <script async={true} onLoad={() => {}} href="bar" />
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <script> with onLoad or onError listeners outside the main document. ' +
        'Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or ' +
        'somewhere in the <body>.\n' +
        '    in html (at **)',
    ]);

    root.render(
      <>
        <link rel="foo" onLoad={() => {}} href="bar" />
        <html>
          <body>foo</body>
        </html>
      </>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <link> with onLoad or onError listeners outside the main document. ' +
        'Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or ' +
        'somewhere in the <body>.',
    ]);
    return;
  });

  /** 先挂载async src=foo资源，再同提交删除原引用并在第二槽位重新引用foo、增加data-new；head仍只有原脚本且无新增属性，验证资源复用而非重建。 */
  it('can acquire a resource after releasing it in the same commit', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(
      <>
        <script async={true} src="foo" />
      </>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="foo" />
        </head>
        <body>
          <div id="container" />
        </body>
      </html>,
    );

    root.render(
      <>
        {null}
        <script data-new="new" async={true} src="foo" />
      </>,
    );
    await waitForAll([]);
    // 我们看不到该属性，因为资源是相同的，并且没有重建。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="foo" />
        </head>
        <body>
          <div id="container" />
        </body>
      </html>,
    );
  });

  /** Fizz树有html/body而无head，title和async脚本在html外；采集两段原始流，第一段补head并按开关加入外部runtime/阻塞标记，第二段关闭body/html。 */
  it('emits an implicit <head> element to hold resources when none is rendered but an <html> is rendered', async () => {
    const chunks = [];

    writable.on('data', chunk => {
      chunks.push(chunk);
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <title>foo</title>
          <html>
            <body>bar</body>
          </html>
          <script async={true} src="foo" />
        </>,
      );
      pipe(writable);
    });
    expect(chunks).toEqual([
      '<!DOCTYPE html><html><head><script async="" src="foo"></script>' +
        (gate(flags => flags.shouldUseFizzExternalRuntime)
          ? '<script src="react-dom/unstable_server-external-runtime" async=""></script>'
          : '') +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<link rel="expect" href="#_R_" blocking="render"/>'
          : '') +
        '<title>foo</title></head>' +
        '<body>bar' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<template id="_R_"></template>'
          : ''),
      '</body></html>',
    ]);
  });

  /** App在render中preinit与externalRuntimeSrc相同的脚本，子Suspense仍pending；输出文档只含一个对应async脚本，验证显式预初始化与Fizz runtime去重。 */
  it('dedupes if the external runtime is explicitly loaded using preinit', async () => {
    const unstable_externalRuntimeSrc = 'src-of-external-runtime';

    /** render时preinit指定的外部Fizz runtime脚本，再返回等待Hello文本的Suspense，给显式脚本与runtime自动插入的去重提供同URL输入。
     * @returns div与pending边界。 */
    function App() {
      ReactDOM.preinit(unstable_externalRuntimeSrc, {as: 'script'});
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <AsyncText text="Hello" />
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <App />
          </body>
        </html>,
        {
          unstable_externalRuntimeSrc,
        },
      );
      pipe(writable);
    });

    expect(
      Array.from(document.querySelectorAll('script[async]')).map(
        n => n.outerHTML,
      ),
    ).toEqual(['<script src="src-of-external-runtime" async=""></script>']);
  });

  /** 两个文本边界分别等待foo/bar，只有bar依赖样式；先解foo可直接显示，解bar后插入stylesheet与preload但仍保留bar fallback，验证晚到样式插入与无样式边界完成可独立执行。 */
  it('can send style insertion implementation independent of boundary commpletion instruction implementation', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="loading foo...">
              <BlockedOn value="foo">foo</BlockedOn>
            </Suspense>
            <Suspense fallback="loading bar...">
              <BlockedOn value="bar">
                <link rel="stylesheet" href="bar" precedence="bar" />
                bar
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          foo
          {'loading bar...'}
        </body>
      </html>,
    );
    await act(() => {
      resolveText('bar');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="bar" data-precedence="bar" />
        </head>
        <body>
          foo
          {'loading bar...'}
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );
  });

  /** 服务端foo/bar边界都pending，hydrate时客户端在边界外先引用foo样式；先解bar并模拟两样式load后显示bar，再解foo时不再发新load，head只有各一份资源，晚到服务端复用客户端样式。 */
  it('can avoid inserting a late stylesheet if it already rendered on the client', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="loading foo...">
              <BlockedOn value="foo">
                <link rel="stylesheet" href="foo" precedence="foo" />
                foo
              </BlockedOn>
            </Suspense>
            <Suspense fallback="loading bar...">
              <BlockedOn value="bar">
                <link rel="stylesheet" href="bar" precedence="bar" />
                bar
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>
          <link rel="stylesheet" href="foo" precedence="foo" />
          <Suspense fallback="loading foo...">
            <link rel="stylesheet" href="foo" precedence="foo" />
            foo
          </Suspense>
          <Suspense fallback="loading bar...">
            <link rel="stylesheet" href="bar" precedence="bar" />
            bar
          </Suspense>
        </body>
      </html>,
    );
    await waitForAll([]);
    loadPreloads();
    await assertLog(['load preload: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('bar');
    });
    await act(() => {
      loadStylesheets();
    });
    await assertLog(['load stylesheet: foo', 'load stylesheet: bar']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link rel="stylesheet" href="bar" data-precedence="bar" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'loading foo...'}
          {'bar'}
          <link as="style" href="bar" rel="preload" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
    });
    await act(() => {
      loadStylesheets();
    });
    await assertLog([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
          <link rel="stylesheet" href="bar" data-precedence="bar" />
          <link as="style" href="foo" rel="preload" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          <link as="style" href="bar" rel="preload" />
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );
  });

  /** shell先发现one到four组link/style，随后依次解三个含重复资源的边界，再hydrate加入one到eight的新项并派load；核对每组内部发现顺序、组首次顺序、重复项去重及晚到preload位置。 */
  it('can hoist <link rel="stylesheet" .../> and <style /> tags together, respecting order of discovery', async () => {
    const css = `
body {
  background-color: red;
}`;

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <link rel="stylesheet" href="one1" precedence="one" />
            <style href="two1" precedence="two">
              {css}
            </style>
            <link rel="stylesheet" href="three1" precedence="three" />
            <style href="four1" precedence="four">
              {css}
            </style>
            <Suspense>
              <BlockedOn value="block">
                <link rel="stylesheet" href="one2" precedence="one" />
                <link rel="stylesheet" href="two2" precedence="two" />
                <style href="three2" precedence="three">
                  {css}
                </style>
                <style href="four2" precedence="four">
                  {css}
                </style>
                <link rel="stylesheet" href="five1" precedence="five" />
              </BlockedOn>
            </Suspense>
            <Suspense>
              <BlockedOn value="block2">
                <style href="one3" precedence="one">
                  {css}
                </style>
                <style href="two3" precedence="two">
                  {css}
                </style>
                <link rel="stylesheet" href="three3" precedence="three" />
                <link rel="stylesheet" href="four3" precedence="four" />
                <style href="six1" precedence="six">
                  {css}
                </style>
              </BlockedOn>
            </Suspense>
            <Suspense>
              <BlockedOn value="block again">
                <link rel="stylesheet" href="one2" precedence="one" />
                <link rel="stylesheet" href="two2" precedence="two" />
                <style href="three2" precedence="three">
                  {css}
                </style>
                <style href="four2" precedence="four">
                  {css}
                </style>
                <link rel="stylesheet" href="five1" precedence="five" />
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
        </head>
        <body />
      </html>,
    );

    await act(() => {
      resolveText('block');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="five1" data-precedence="five" />
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('block2');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('block again');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>
          <link rel="stylesheet" href="one4" precedence="one" />
          <style href="two4" precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three4" precedence="three" />
          <style href="four4" precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="seven1" precedence="seven" />
          <style href="eight1" precedence="eight">
            {css}
          </style>
        </body>
      </html>,
    );
    await waitForAll([]);
    await act(() => {
      loadPreloads();
      loadStylesheets();
    });
    await assertLog([
      'load preload: one4',
      'load preload: three4',
      'load preload: seven1',
      'load preload: one2',
      'load preload: two2',
      'load preload: five1',
      'load preload: three3',
      'load preload: four3',
      'load stylesheet: one1',
      'load stylesheet: one2',
      'load stylesheet: one4',
      'load stylesheet: two2',
      'load stylesheet: three1',
      'load stylesheet: three3',
      'load stylesheet: three4',
      'load stylesheet: four3',
      'load stylesheet: five1',
      'load stylesheet: seven1',
    ]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="one1" data-precedence="one" />
          <link rel="stylesheet" href="one2" data-precedence="one" />
          <style data-href="one3" data-precedence="one">
            {css}
          </style>
          <link rel="stylesheet" href="one4" data-precedence="one" />
          <style data-href="two1" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="two2" data-precedence="two" />
          <style data-href="two3" data-precedence="two">
            {css}
          </style>
          <style data-href="two4" data-precedence="two">
            {css}
          </style>
          <link rel="stylesheet" href="three1" data-precedence="three" />
          <style data-href="three2" data-precedence="three">
            {css}
          </style>
          <link rel="stylesheet" href="three3" data-precedence="three" />
          <link rel="stylesheet" href="three4" data-precedence="three" />
          <style data-href="four1" data-precedence="four">
            {css}
          </style>
          <style data-href="four2" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="four3" data-precedence="four" />
          <style data-href="four4" data-precedence="four">
            {css}
          </style>
          <link rel="stylesheet" href="five1" data-precedence="five" />
          <style data-href="six1" data-precedence="six">
            {css}
          </style>
          <link rel="stylesheet" href="seven1" data-precedence="seven" />
          <style data-href="eight1" data-precedence="eight">
            {css}
          </style>
          <link rel="preload" href="one4" as="style" />
          <link rel="preload" href="three4" as="style" />
          <link rel="preload" href="seven1" as="style" />
        </head>
        <body>
          <link rel="preload" href="one2" as="style" />
          <link rel="preload" href="two2" as="style" />
          <link rel="preload" href="five1" as="style" />
          <link rel="preload" href="three3" as="style" />
          <link rel="preload" href="four3" as="style" />
        </body>
      </html>,
    );
  });

  /** 晚到边界插入foo/bar样式后仍显示loading，模拟bar error使边界注释变$!并带CSS failed to load digest；hydrate后load foo，改由客户端显示Hello并收集可恢复错误消息及digest。 */
  it('client renders a boundary if a style Resource dependency fails to load', async () => {

    /** 文档内一个Suspense先等待unblock，再依赖foo/bar两份样式与Hello；服务端和hydrate复用同树以观察CSS失败转客户端恢复。
     * @returns 完整html/head/body树。 */
    function App() {
      return (
        <html>
          <head />
          <body>
            <Suspense fallback="loading...">
              <BlockedOn value="unblock">
                <link rel="stylesheet" href="foo" precedence="arbitrary" />
                <link rel="stylesheet" href="bar" precedence="arbitrary" />
                Hello
              </BlockedOn>
            </Suspense>
          </body>
        </html>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );

    await act(() => {
      resolveText('unblock');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          loading...
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    errorStylesheets(['bar']);
    assertLog(['error stylesheet: bar']);

    await waitForAll([]);

    const boundaryTemplateInstance = document.getElementById('B:0');
    const suspenseInstance = boundaryTemplateInstance.previousSibling;

    expect(suspenseInstance.data).toEqual('$!');
    expect(boundaryTemplateInstance.dataset.dgst).toBe('CSS failed to load');

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          loading...
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    const errors = [];
    ReactDOMClient.hydrateRoot(document, <App />, {

      /** 记录hydrate恢复错误的message和digest，供CSS failed to load两项断言；errInfo参数未读取。
       * @param err React恢复路径提供的错误对象。
       * @param errInfo 错误上下文，本夹具忽略。 */
      onRecoverableError(err, errInfo) {
        errors.push(err.message);
        errors.push(err.digest);
      },
    });
    await waitForAll([]);
        // 在 boundary reveal 中绑定 SSR 样式表时会有一个 loadingState promise。由于无法确定 load 或
        // error 事件是否已经触发，必须用它来解除已挂起的提交；提交需等待加载，才有机会冲刷。也可以像
        // thenable 一样直接在 loadingState 上追踪 fulfilled 状态，但这会略微增加 Fizz runtime 的体积。
    await clientAct(() => loadStylesheets());
    assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
          <link rel="stylesheet" href="bar" data-precedence="arbitrary" />
        </head>
        <body>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          Hello
        </body>
      </html>,
    );
    expect(errors).toEqual([
      'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
      'CSS failed to load',
    ]);
  });

  /** 服务端body内带precedence的foo样式被提升到head；hydrate树省略该link仍保留已输出的样式，body Hello不变，验证资源独立于普通子节点生命周期。 */
  it('treats stylesheet links with a precedence as a resource', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="foo" precedence="arbitrary" />
            Hello
          </body>
        </html>,
      );
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
        </head>
        <body>Hello</body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head />
        <body>Hello</body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="arbitrary" />
        </head>
        <body>Hello</body>
      </html>,
    );
  });

  /** 三个组件各返回已解锁文本和被提升的样式link；服务端head有三个资源，body投影仍为foo、bar、baz三个文本项，避免移走link后相邻文本合并。 */
  it('inserts text separators following text when followed by an element that is converted to a resource and thus removed from the html inline', async () => {
        // 将多个此类节点作为兄弟节点渲染时，值有时会合并成一段无分隔符的文本，因为 link 会作为资源被省略。

    /** 先读text，成功后返回文本与紧邻的stylesheet资源；link被提升后文本仍需保留节点分隔。
     * @param props text缓存键，href资源URL，precedence为资源分组。
     * @returns 文本/link Fragment；pending时抛thenable。 */
    function AsyncTextWithResource({text, href, precedence}) {
      const value = readText(text);
      return (
        <>
          {value}
          <link rel="stylesheet" href={href} precedence={precedence} />
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <AsyncTextWithResource text="foo" href="foo" precedence="one" />
            <AsyncTextWithResource text="bar" href="bar" precedence="two" />
            <AsyncTextWithResource text="baz" href="baz" precedence="three" />
          </body>
        </html>,
      );
      pipe(writable);
      resolveText('foo');
      resolveText('bar');
      resolveText('baz');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="bar" data-precedence="two" />
          <link rel="stylesheet" href="baz" data-precedence="three" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          {'baz'}
        </body>
      </html>,
    );
  });

  /** 先建立one与preset组，晚到bar/default、baz/two、qux/one分批解锁；foo/bar及baz/qux各load前对应fallback保留，load后逐边界显示，最终第三重复边界直接复用资源且head按one/preset/default/two排序。 */
  it('hoists late stylesheets the correct precedence', async () => {

    /** 在render中preinit preset样式并先建立preset分组；无显式return，测试只观察资源副作用。
     * @returns undefined，不产生UI。 */
    function PresetPrecedence() {
      ReactDOM.preinit('preset', {as: 'style', precedence: 'preset'});
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="initial" precedence="one" />
            <PresetPrecedence />
            <div>
              <Suspense fallback="loading foo bar...">
                <div>foo</div>
                <link rel="stylesheet" href="foo" precedence="one" />
                <BlockedOn value="bar">
                  <div>bar</div>
                  <link rel="stylesheet" href="bar" precedence="default" />
                </BlockedOn>
              </Suspense>
            </div>
            <div>
              <Suspense fallback="loading bar baz qux...">
                <BlockedOn value="bar">
                  <div>bar</div>
                  <link rel="stylesheet" href="bar" precedence="default" />
                </BlockedOn>
                <BlockedOn value="baz">
                  <div>baz</div>
                  <link rel="stylesheet" href="baz" precedence="two" />
                </BlockedOn>
                <BlockedOn value="qux">
                  <div>qux</div>
                  <link rel="stylesheet" href="qux" precedence="one" />
                </BlockedOn>
              </Suspense>
            </div>
            <div>
              <Suspense fallback="loading bar baz qux...">
                <BlockedOn value="unblock">
                  <BlockedOn value="bar">
                    <div>bar</div>
                    <link rel="stylesheet" href="bar" precedence="default" />
                  </BlockedOn>
                  <BlockedOn value="baz">
                    <div>baz</div>
                    <link rel="stylesheet" href="baz" precedence="two" />
                  </BlockedOn>
                  <BlockedOn value="qux">
                    <div>qux</div>
                    <link rel="stylesheet" href="qux" precedence="one" />
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
      resolveText('bar');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      const link = document.querySelector('link[rel="stylesheet"][href="foo"]');
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      link.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>loading foo bar...</div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      const link = document.querySelector('link[rel="stylesheet"][href="bar"]');
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      link.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" href="bar" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('baz');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('qux');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>loading bar baz qux...</div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );

    await act(() => {
      const bazlink = document.querySelector(
        'link[rel="stylesheet"][href="baz"]',
      );
      const quxlink = document.querySelector(
        'link[rel="stylesheet"][href="qux"]',
      );
      const presetLink = document.querySelector(
        'link[rel="stylesheet"][href="preset"]',
      );
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      bazlink.dispatchEvent(event);
      quxlink.dispatchEvent(event);
      presetLink.dispatchEvent(event);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <div>loading bar baz qux...</div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('unblock');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="initial" data-precedence="one" />
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="qux" data-precedence="one" />
          <link rel="stylesheet" href="preset" data-precedence="preset" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="two" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <div>
            <div>bar</div>
            <div>baz</div>
            <div>qux</div>
          </div>
          <link rel="preload" as="style" href="bar" />
          <link rel="preload" as="style" href="baz" />
          <link rel="preload" as="style" href="qux" />
        </body>
      </html>,
    );
  });

  /** 外/中/内与另一兄弟边界都同步完成并随shell内联，资源发现顺序交错；最终按one到four各收集1/2/3/4资源，新的five组最后，body同步显示全部内容，验证shell统一precedence排序。 */
  it('normalizes stylesheet resource precedence for all boundaries inlined as part of the shell flush', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              outer
              <link rel="stylesheet" href="1one" precedence="one" />
              <link rel="stylesheet" href="1two" precedence="two" />
              <link rel="stylesheet" href="1three" precedence="three" />
              <link rel="stylesheet" href="1four" precedence="four" />
              <Suspense fallback={null}>
                <div>
                  middle
                  <link rel="stylesheet" href="2one" precedence="one" />
                  <link rel="stylesheet" href="2two" precedence="two" />
                  <link rel="stylesheet" href="2three" precedence="three" />
                  <link rel="stylesheet" href="2four" precedence="four" />
                  <Suspense fallback={null}>
                    <div>
                      inner
                      <link rel="stylesheet" href="3five" precedence="five" />
                      <link rel="stylesheet" href="3one" precedence="one" />
                      <link rel="stylesheet" href="3two" precedence="two" />
                      <link rel="stylesheet" href="3three" precedence="three" />
                      <link rel="stylesheet" href="3four" precedence="four" />
                    </div>
                  </Suspense>
                </div>
              </Suspense>
              <Suspense fallback={null}>
                <div>middle</div>
                <link rel="stylesheet" href="4one" precedence="one" />
                <link rel="stylesheet" href="4two" precedence="two" />
                <link rel="stylesheet" href="4three" precedence="three" />
                <link rel="stylesheet" href="4four" precedence="four" />
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="1one" data-precedence="one" />
          <link rel="stylesheet" href="2one" data-precedence="one" />
          <link rel="stylesheet" href="3one" data-precedence="one" />
          <link rel="stylesheet" href="4one" data-precedence="one" />

          <link rel="stylesheet" href="1two" data-precedence="two" />
          <link rel="stylesheet" href="2two" data-precedence="two" />
          <link rel="stylesheet" href="3two" data-precedence="two" />
          <link rel="stylesheet" href="4two" data-precedence="two" />

          <link rel="stylesheet" href="1three" data-precedence="three" />
          <link rel="stylesheet" href="2three" data-precedence="three" />
          <link rel="stylesheet" href="3three" data-precedence="three" />
          <link rel="stylesheet" href="4three" data-precedence="three" />

          <link rel="stylesheet" href="1four" data-precedence="four" />
          <link rel="stylesheet" href="2four" data-precedence="four" />
          <link rel="stylesheet" href="3four" data-precedence="four" />
          <link rel="stylesheet" href="4four" data-precedence="four" />

          <link rel="stylesheet" href="3five" data-precedence="five" />
        </head>
        <body>
          <div>
            outer
            <div>
              middle<div>inner</div>
            </div>
            <div>middle</div>
          </div>
        </body>
      </html>,
    );
  });

  /** 先SSR并hydrate foo/one与bar/two，再客户端更新Goodbye并加baz/one；派preload和stylesheet load后head顺序foo、baz、bar，旧资源保留，新资源插入既有precedence组末尾。 */
  it('stylesheet resources are inserted according to precedence order on the client', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              <link rel="stylesheet" href="foo" precedence="one" />
              <link rel="stylesheet" href="bar" precedence="two" />
              Hello
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="bar" data-precedence="two" />
        </head>
        <body>
          <div>Hello</div>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head />
        <body>
          <div>
            <link rel="stylesheet" href="foo" precedence="one" />
            <link rel="stylesheet" href="bar" precedence="two" />
            Hello
          </div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="bar" data-precedence="two" />
        </head>
        <body>
          <div>Hello</div>
        </body>
      </html>,
    );

    root.render(
      <html>
        <head />
        <body>
          <div>Goodbye</div>
          <link rel="stylesheet" href="baz" precedence="one" />
        </body>
      </html>,
    );
    await waitForAll([]);
    await act(() => {
      loadPreloads();
      loadStylesheets();
    });
    await assertLog([
      'load preload: baz',
      'load stylesheet: foo',
      'load stylesheet: baz',
      'load stylesheet: bar',
    ]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="one" />
          <link rel="stylesheet" href="baz" data-precedence="one" />
          <link rel="stylesheet" href="bar" data-precedence="two" />
          <link rel="preload" as="style" href="baz" />
        </head>
        <body>
          <div>Goodbye</div>
        </body>
      </html>,
    );
  });

  /** 客户端边界内先发现foo样式，再由Throw抛Uh oh；错误边界提交错误文本，head仍有foo preload但没有stylesheet，证明render发现的预加载不依赖原子树成功提交。 */
  it('inserts preloads in render phase eagerly', async () => {

    /** 在样式preload已于render登记后抛Uh oh，迫使原树未提交就切换错误回退。
     * @throws Uh oh错误，不返回UI。 */
    function Throw() {
      throw new Error('Uh oh!');
    }

    /** 将Throw错误派生为hasError/error，回退直接显示message，观察废弃render留下的preload。 */
    class ErrorBoundary extends React.Component {

      /** hasError=false/error=null初值透传children，派生错误后切换消息回退。 */
      state = {hasError: false, error: null};

      /** 返回hasError与捕获error补丁，不自行发起网络或资源处理。
       * @param error 后代render的Uh oh异常。
       * @returns 回退状态补丁。 */
      static getDerivedStateFromError(error) {
        return {
          hasError: true,
          error,
        };
      }

      /** 无错误时透传children，有错时返回error.message作为唯一可见回退。
       * @returns 原子树或错误文本。 */
      render() {
        if (this.state.hasError) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    root.render(
      <ErrorBoundary>
        <link rel="stylesheet" href="foo" precedence="default" />
        <div>foo</div>
        <Throw />
      </ErrorBoundary>,
    );
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
        </head>
        <body>
          <div id="container">Uh oh!</div>
        </body>
      </html>,
    );
  });

  /** foo包含bar包含baz三个等待文本的边界，先解bar/baz仍无输出；再解foo后插入三份样式和preload但保留外层fallback，三样式load后才一次显示整棵内容，依赖汇总到外层揭示。 */
  it('will include child boundary stylesheet resources in the boundary reveal instruction', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              <Suspense fallback="loading foo...">
                <BlockedOn value="foo">
                  <div>foo</div>
                  <link rel="stylesheet" href="foo" precedence="default" />
                  <Suspense fallback="loading bar...">
                    <BlockedOn value="bar">
                      <div>bar</div>
                      <link rel="stylesheet" href="bar" precedence="default" />
                      <Suspense fallback="loading baz...">
                        <BlockedOn value="baz">
                          <div>baz</div>
                          <link
                            rel="stylesheet"
                            href="baz"
                            precedence="default"
                          />
                        </BlockedOn>
                      </Suspense>
                    </BlockedOn>
                  </Suspense>
                </BlockedOn>
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading foo...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('bar');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading foo...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('baz');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading foo...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="default" />
        </head>
        <body>
          <div>loading foo...</div>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          <link rel="preload" href="baz" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach(
        el => {
          el.dispatchEvent(event);
        },
      );
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>foo</div>
            <div>bar</div>
            <div>baz</div>
          </div>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          <link rel="preload" href="baz" as="style" />
        </body>
      </html>,
    );
  });

  /** 外边界同时等foo与qux，foo内部bar/baz先完成；解foo只输出已完成segment的三份preload，head仍空，解qux才插四份stylesheet，全部load后外层揭示，验证partial flush把子依赖交父边界。 */
  it('will hoist resources of child boundaries emitted as part of a partial boundary to the parent boundary', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              <Suspense fallback="loading...">
                <div>
                  <BlockedOn value="foo">
                    <div>foo</div>
                    <link rel="stylesheet" href="foo" precedence="default" />
                    <Suspense fallback="loading bar...">
                      <BlockedOn value="bar">
                        <div>bar</div>
                        <link
                          rel="stylesheet"
                          href="bar"
                          precedence="default"
                        />
                        <Suspense fallback="loading baz...">
                          <div>
                            <BlockedOn value="baz">
                              <div>baz</div>
                              <link
                                rel="stylesheet"
                                href="baz"
                                precedence="default"
                              />
                            </BlockedOn>
                          </div>
                        </Suspense>
                      </BlockedOn>
                    </Suspense>
                  </BlockedOn>
                  <BlockedOn value="qux">
                    <div>qux</div>
                    <link rel="stylesheet" href="qux" precedence="default" />
                  </BlockedOn>
                </div>
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );

    // 这将在深度阻塞边界（加载 baz...）中排队一个样式资源。
    await act(() => {
      resolveText('baz');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );

    // 这将在中间阻塞边界（加载中...）中排队一个样式资源。
    await act(() => {
      resolveText('bar');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );

    // 这会完成顶层边界中的一个 segment，但该边界仍被另一 segment 阻塞。已完成 segment 会被冲刷；
    // 内层边界尚未显示，因此不应输出其样式依赖，而应把依赖提升到被阻塞的顶层边界。
    await act(() => {
      resolveText('foo');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading...</div>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          <link rel="preload" href="baz" as="style" />
        </body>
      </html>,
    );

    // 这会解除顶层边界最后一个 segment 的阻塞，因此嵌套边界的全部依赖都会在这一层输出。
    await act(() => {
      resolveText('qux');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="default" />
          <link rel="stylesheet" href="qux" data-precedence="default" />
        </head>
        <body>
          <div>loading...</div>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          <link rel="preload" href="baz" as="style" />
          <link rel="preload" href="qux" as="style" />
        </body>
      </html>,
    );

    // 我们将所有样式表加载,并确认内容被揭示
    await act(() => {
      const event = document.createEvent('Events');
      event.initEvent('load', true, true);
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach(
        el => {
          el.dispatchEvent(event);
        },
      );
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="baz" data-precedence="default" />
          <link rel="stylesheet" href="qux" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>
              <div>foo</div>
              <div>bar</div>
              <div>
                <div>baz</div>
              </div>
              <div>qux</div>
            </div>
          </div>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
          <link rel="preload" href="baz" as="style" />
          <link rel="preload" href="qux" as="style" />
        </body>
      </html>,
    );
  });

  /** shell的foo和晚到bar样式携带同组连接属性、带引号data值、未知属性及函数/符号非法值；两阶段DOM投影均保留合法值并过滤非法值，DEV记录未知/非法prop警告，晚到preload只带可用的连接属性。 */
  it('encodes attributes consistently whether resources are flushed in shell or in late boundaries', async () => {

    /** 同时构建shell foo与待unblock的bar样式，使用同一批合法/非法属性输入比较两种输出时机的编码和过滤。
     * @returns html文档与pending边界。 */
    function App() {
      return (
        <html>
          <head />
          <body>
            <div>
              <link
                // 这里显式渲染的是stylesheet资源，可携带合法DOM属性；对应自动preload仅保留预加载适用属性。
                // foo在shell输出，bar随晚到边界输出；两者都是stylesheet link。
                rel="stylesheet"
                href="foo"
                // 资源precedence转为data-precedence，用于后续分组插入顺序。
                precedence="default"
                // 一些标准的链接属性
                crossOrigin="anonymous"
                media="all"
                integrity="somehash"
                referrerPolicy="origin"
                // 数据和非标准属性，应进行冲刷。
                data-foo={'"quoted"'}
                nonStandardAttr="attr"
                properlyformattednonstandardattr="attr"
                // 应被过滤掉的属性，违反某些规则。
                onSomething="this should be removed b/c event handler"
                shouldnotincludefunctions={() => {}}
                norsymbols={Symbol('foo')}
              />
              <Suspense fallback={'loading...'}>
                <BlockedOn value="unblock">
                  <link
                    // 这里显式渲染的是stylesheet资源，可携带合法DOM属性；对应自动preload仅保留预加载适用属性。
                    // foo在shell输出，bar随晚到边界输出；两者都是stylesheet link。
                    rel="stylesheet"
                    href="bar"
                    // 这个 opt-in 属性使它被当作资源处理。
                    precedence="default"
                    // 一些标准的链接属性
                    crossOrigin="anonymous"
                    media="all"
                    integrity="somehash"
                    referrerPolicy="origin"
                    // 数据和非标准属性，应进行冲刷。
                    data-foo={'"quoted"'}
                    nonStandardAttr="attr"
                    properlyformattednonstandardattr="attr"
                    // 应被过滤掉的属性，违反某些规则。
                    onSomething="this should be removed b/c event handler"
                    shouldnotincludefunctions={() => {}}
                    norsymbols={Symbol('foo')}
                  />
                </BlockedOn>
              </Suspense>
            </div>
          </body>
        </html>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            href="foo"
            data-precedence="default"
            crossorigin="anonymous"
            media="all"
            integrity="somehash"
            referrerpolicy="origin"
            data-foo={'"quoted"'}
            nonstandardattr="attr"
            properlyformattednonstandardattr="attr"
          />
        </head>
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );
    assertConsoleErrorDev([
      'React does not recognize the `nonStandardAttr` prop on a DOM element. ' +
        'If you intentionally want it to appear in the DOM as a custom attribute, ' +
        'spell it as lowercase `nonstandardattr` instead. If you accidentally passed it from a ' +
        'parent component, remove it from the DOM element.\n' +
        '    in link (at **)\n' +
        '    in App (at **)',
      'Invalid values for props `shouldnotincludefunctions`, `norsymbols` on <link> tag. ' +
        'Either remove them from the element, or pass a string or number value to keep them in the DOM. ' +
        'For details, see https://react.dev/link/attribute-behavior \n' +
        '    in link (at **)\n' +
        '    in App (at **)',
    ]);

    // 现在我们冲刷样式表，以边界为边界。
    await act(() => {
      resolveText('unblock');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            href="foo"
            data-precedence="default"
            crossorigin="anonymous"
            media="all"
            integrity="somehash"
            referrerpolicy="origin"
            data-foo={'"quoted"'}
            nonstandardattr="attr"
            properlyformattednonstandardattr="attr"
          />
          <link
            rel="stylesheet"
            href="bar"
            data-precedence="default"
            crossorigin="anonymous"
            media="all"
            integrity="somehash"
            referrerpolicy="origin"
            data-foo={'"quoted"'}
            nonstandardattr="attr"
            properlyformattednonstandardattr="attr"
          />
        </head>
        <body>
          <div>loading...</div>
          <link
            rel="preload"
            as="style"
            href="bar"
            crossorigin="anonymous"
            media="all"
            integrity="somehash"
            referrerpolicy="origin"
          />
        </body>
      </html>,
    );
  });

  /** 嵌套A/AA/AAA/AAAA先解unblock、AA、AAAA而A/AAA仍pending，仅输出四份preload；解A并load先显示A/AA和AAA fallback，解AAA后加入AAA/AAAA样式并load显示全部，内联子边界依赖归父揭示。 */
  it('boundary stylesheet resource dependencies hoist to a parent boundary when flushed inline', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>
              <Suspense fallback="loading A...">
                <BlockedOn value="unblock">
                  <AsyncText text="A" />
                  <link rel="stylesheet" href="A" precedence="A" />
                  <Suspense fallback="loading AA...">
                    <AsyncText text="AA" />
                    <link rel="stylesheet" href="AA" precedence="AA" />
                    <Suspense fallback="loading AAA...">
                      <AsyncText text="AAA" />
                      <link rel="stylesheet" href="AAA" precedence="AAA" />
                      <Suspense fallback="loading AAAA...">
                        <AsyncText text="AAAA" />
                        <link rel="stylesheet" href="AAAA" precedence="AAAA" />
                      </Suspense>
                    </Suspense>
                  </Suspense>
                </BlockedOn>
              </Suspense>
            </div>
          </body>
        </html>,
      );
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading A...</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('unblock');
      resolveText('AAAA');
      resolveText('AA');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading A...</div>
          <link rel="preload" as="style" href="A" />
          <link rel="preload" as="style" href="AA" />
          <link rel="preload" as="style" href="AAA" />
          <link rel="preload" as="style" href="AAAA" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('A');
    });
    await act(() => {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
        const event = document.createEvent('Events');
        event.initEvent('load', true, true);
        l.dispatchEvent(event);
      });
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="A" data-precedence="A" />
          <link rel="stylesheet" href="AA" data-precedence="AA" />
        </head>
        <body>
          <div>
            {'A'}
            {'AA'}
            {'loading AAA...'}
          </div>
          <link rel="preload" as="style" href="A" />
          <link rel="preload" as="style" href="AA" />
          <link rel="preload" as="style" href="AAA" />
          <link rel="preload" as="style" href="AAAA" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('AAA');
    });
    await act(() => {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
        const event = document.createEvent('Events');
        event.initEvent('load', true, true);
        l.dispatchEvent(event);
      });
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="A" data-precedence="A" />
          <link rel="stylesheet" href="AA" data-precedence="AA" />
          <link rel="stylesheet" href="AAA" data-precedence="AAA" />
          <link rel="stylesheet" href="AAAA" data-precedence="AAAA" />
        </head>
        <body>
          <div>
            {'A'}
            {'AA'}
            {'AAA'}
            {'AAAA'}
          </div>
          <link rel="preload" as="style" href="A" />
          <link rel="preload" as="style" href="AA" />
          <link rel="preload" as="style" href="AAA" />
          <link rel="preload" as="style" href="AAAA" />
        </body>
      </html>,
    );
  });

  /** render中以缺省、foo、use-credentials、anonymous四种crossOrigin预加载字体；四link最终crossorigin都为空匿名值，foo另保留woff2 type，字体预加载强制匿名模式。 */
  it('always enforces crossOrigin "anonymous" for font preloads', async () => {

    /** 在render中声明四种font预加载crossOrigin输入并返回空文档；最终输出用于核对字体统一匿名模式。
     * @returns html/head/body。 */
    function App() {
      ReactDOM.preload('foo', {as: 'font', type: 'font/woff2'});
      ReactDOM.preload('bar', {as: 'font', crossOrigin: 'foo'});
      ReactDOM.preload('baz', {as: 'font', crossOrigin: 'use-credentials'});
      ReactDOM.preload('qux', {as: 'font', crossOrigin: 'anonymous'});
      return (
        <html>
          <head />
          <body />
        </html>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="font"
            href="foo"
            crossorigin=""
            type="font/woff2"
          />
          <link rel="preload" as="font" href="bar" crossorigin="" />
          <link rel="preload" as="font" href="baz" crossorigin="" />
          <link rel="preload" as="font" href="qux" crossorigin="" />
        </head>
        <body />
      </html>,
    );
  });

  /** 同一文档head与body深层都放带itemProp的meta/link/title/style/async脚本；SSR和hydrate后节点均留在原微数据位置、样式仍用precedence原属性，验证itemProp阻止资源化与提升。 */
  it('does not hoist anything with an itemprop prop', async () => {

    /** 在head和body微数据域内各返回六类带itemProp元素，防止按普通hoistable/resource处理，并供SSR与hydrate比较。
     * @returns 带itemScope的文档。 */
    function App() {
      return (
        <html>
          <head>
            <meta itemProp="outside" content="unscoped" />
            <link itemProp="link" rel="foo" href="foo" />
            <title itemProp="outside-title">title</title>
            <link
              itemProp="outside-stylesheet"
              rel="stylesheet"
              href="bar"
              precedence="default"
            />
            <style itemProp="outside-style" href="baz" precedence="default">
              outside style
            </style>
            <script itemProp="outside-script" async={true} src="qux" />
          </head>
          <body>
            <div itemScope={true}>
              <div>
                <meta itemProp="inside-meta" content="scoped" />
                <link itemProp="inside-link" rel="foo" href="foo" />
                <title itemProp="inside-title">title</title>
                <link
                  itemProp="inside-stylesheet"
                  rel="stylesheet"
                  href="bar"
                  precedence="default"
                />
                <style itemProp="inside-style" href="baz" precedence="default">
                  inside style
                </style>
                <script itemProp="inside-script" async={true} src="qux" />
              </div>
            </div>
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="outside" content="unscoped" />
          <link itemprop="link" rel="foo" href="foo" />
          <title itemprop="outside-title">title</title>
          <link
            itemprop="outside-stylesheet"
            rel="stylesheet"
            href="bar"
            precedence="default"
          />
          <style itemprop="outside-style" href="baz" precedence="default">
            outside style
          </style>
          <script itemprop="outside-script" async="" src="qux" />
        </head>
        <body>
          <div itemscope="">
            <div>
              <meta itemprop="inside-meta" content="scoped" />
              <link itemprop="inside-link" rel="foo" href="foo" />
              <title itemprop="inside-title">title</title>
              <link
                itemprop="inside-stylesheet"
                rel="stylesheet"
                href="bar"
                precedence="default"
              />
              <style itemprop="inside-style" href="baz" precedence="default">
                inside style
              </style>
              <script itemprop="inside-script" async="" src="qux" />
            </div>
          </div>
        </body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="outside" content="unscoped" />
          <link itemprop="link" rel="foo" href="foo" />
          <title itemprop="outside-title">title</title>
          <link
            itemprop="outside-stylesheet"
            rel="stylesheet"
            href="bar"
            precedence="default"
          />
          <style itemprop="outside-style" href="baz" precedence="default">
            outside style
          </style>
          <script itemprop="outside-script" async="" src="qux" />
        </head>
        <body>
          <div itemscope="">
            <div>
              <meta itemprop="inside-meta" content="scoped" />
              <link itemprop="inside-link" rel="foo" href="foo" />
              <title itemprop="inside-title">title</title>
              <link
                itemprop="inside-stylesheet"
                rel="stylesheet"
                href="bar"
                precedence="default"
              />
              <style itemprop="inside-style" href="baz" precedence="default">
                inside style
              </style>
              <script itemprop="inside-script" async="" src="qux" />
            </div>
          </div>
        </body>
      </html>,
    );
  });

  /** document根把itemProp=foo的meta直接置于html下；等待后DEV同时断言不能提升微数据元素的定位警告与非法HTML嵌套警告。 */
  it('warns if you render <meta> tag with itemProp outside <body> or <head>', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <meta itemProp="foo" />
      </html>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <meta> outside the main document if it has an `itemProp` prop. ' +
        '`itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. ' +
        'If you were intending for React to hoist this <meta> remove the `itemProp` prop. ' +
        'Otherwise, try moving this tag into the <head> or <body> of the Document.\n' +
        '    in html (at **)',
      'In HTML, <meta> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '>   <meta itemProp="foo">' +
        '\n' +
        '\n    in meta (at **)',
    ]);
  });

  /** document根把带itemProp的title直接置于html下；DEV断言微数据定位和title不能作为html直接子项两条警告，未断言资源提升成功。 */
  it('warns if you render a <title> tag with itemProp outside <body> or <head>', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <title itemProp="foo">title</title>
      </html>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <title> outside the main document if it has an `itemProp` prop. ' +
        '`itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. ' +
        'If you were intending for React to hoist this <title> remove the `itemProp` prop. ' +
        'Otherwise, try moving this tag into the <head> or <body> of the Document.\n' +
        '    in html (at **)',
      'In HTML, <title> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '>   <title itemProp="foo">' +
        '\n' +
        '\n    in title (at **)',
    ]);
  });

  /** document根把带itemProp的style直接置于html下；DEV断言微数据定位与非法嵌套两条警告，提示保持其itemScope语义位置。 */
  it('warns if you render a <style> tag with itemProp outside <body> or <head>', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <style itemProp="foo">style</style>
      </html>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <style> outside the main document if it has an `itemProp` prop. ' +
        '`itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. ' +
        'If you were intending for React to hoist this <style> remove the `itemProp` prop. ' +
        'Otherwise, try moving this tag into the <head> or <body> of the Document.\n' +
        '    in html (at **)',
      'In HTML, <style> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '>   <style itemProp="foo">' +
        '\n' +
        '\n    in style (at **)',
    ]);
  });

  /** document根把带itemProp的link直接置于html下；DEV断言微数据定位与link/html嵌套警告，itemProp不可走普通hoistable路径。 */
  it('warns if you render a <link> tag with itemProp outside <body> or <head>', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <link itemProp="foo" />
      </html>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <link> outside the main document if it has an `itemProp` prop. ' +
        '`itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. ' +
        'If you were intending for React to hoist this <link> remove the `itemProp` prop. ' +
        'Otherwise, try moving this tag into the <head> or <body> of the Document.\n' +
        '    in html (at **)',
      'In HTML, <link> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '>   <link itemProp="foo">\n' +
        '\n' +
        '    in link (at **)',
    ]);
  });

  /** document根把带itemProp的script置于html下；DEV断言微数据定位、非法嵌套及trusted-types开启时的客户端script提示，测试只检查诊断。 */
  it('warns if you render a <script> tag with itemProp outside <body> or <head>', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <script itemProp="foo" />
      </html>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Cannot render a <script> outside the main document if it has an `itemProp` prop. ' +
        '`itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. ' +
        'If you were intending for React to hoist this <script> remove the `itemProp` prop. ' +
        'Otherwise, try moving this tag into the <head> or <body> of the Document.\n' +
        '    in html (at **)',
      'In HTML, <script> cannot be a child of <html>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <html>\n' +
        '>   <script itemProp="foo">\n' +
        '\n' +
        '    in script (at **)',
      ...(gate('enableTrustedTypesIntegration')
        ? [
            'Encountered a script tag while rendering React component. ' +
              'Scripts inside React components are never executed when rendering on the client. ' +
              'Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).\n' +
              '     in script (at **)',
          ]
        : []),
    ]);
  });

  /** SSR混合资源、普通host、itemProp、noscript后，在head/body多处注入style/div/async脚本；同树hydrate保持注入节点与资源，unmount后仅移除React管理的普通树，资源和跳过的第三方节点仍在。 */
  it('can hydrate resources and components in the head and body even if a browser or 3rd party script injects extra html nodes', async () => {
    // 这是一个 hydration 压力测试：在 <head> 和 <body> 已被第三方脚本或扩展修改的环境中，对
    // hoistable 元素、hoistable 资源与 host component 的复杂组合进行 hydration。

    /** 混合html外资源、head普通host、body微数据节点与深层div；相同树用于SSR/hydrate/unmount的第三方注入压力场景。
     * @returns 含文档singleton及外部hoistable的Fragment。 */
    function App() {
      return (
        <>
          <link rel="foo" href="foo" />
          <script async={true} src="rendered" />
          <link rel="stylesheet" href="stylesheet" precedence="default" />
          <html itemScope={true}>
            <head>
              {/* 组件 */}
              <link rel="stylesheet" href="stylesheet" />
              <script src="sync rendered" data-meaningful="" />
              <style>{'body { background-color: red; }'}</style>
              <script src="async rendered" async={true} onLoad={() => {}} />
              <noscript>
                <meta name="noscript" content="noscript" />
              </noscript>
              <link rel="foo" href="foo" onLoad={() => {}} />
            </head>
            <body>
              {/* 带itemProp的普通宿主节点，保持微数据位置 */}
              <meta name="foo" content="foo" itemProp="a prop" />
              {/* 常规可提升的 */}
              <meta name="foo" content="foo" />
              {/* 常规可提升的 */}
              <title>title</title>
              <div itemScope={true}>
                <div>
                  <div>deep hello</div>
                  {/* 带itemProp的普通宿主节点，保持微数据位置 */}
                  <meta name="foo" content="foo" itemProp="a prop" />
                </div>
              </div>
            </body>
          </html>
          <link rel="foo" href="foo" />
        </>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html itemscope="">
        <head>
          {/* 提升的资源和元素 */}
          <link rel="stylesheet" href="stylesheet" data-precedence="default" />
          <script async="" src="rendered" />
          <link rel="foo" href="foo" />
          <meta name="foo" content="foo" />
          <title>title</title>
          <link rel="foo" href="foo" />
          {/* 渲染宿主组件 */}
          <link rel="stylesheet" href="stylesheet" />
          <script src="sync rendered" data-meaningful="" />
          <style>{'body { background-color: red; }'}</style>
          <script src="async rendered" async="" />
          <noscript>&lt;meta name="noscript" content="noscript"&gt;</noscript>
          <link rel="foo" href="foo" />
        </head>
        <body>
          <meta name="foo" content="foo" itemprop="a prop" />
          <div itemscope="">
            <div>
              <div>deep hello</div>
              <meta name="foo" content="foo" itemprop="a prop" />
            </div>
          </div>
        </body>
      </html>,
    );

    // 在 head/body 的开头、中间和末尾注入一些 style、div 与 script。
    const injectedStyle = document.createElement('style');
    injectedStyle.textContent = 'body { background-color: blue; }';
    document.head.prepend(injectedStyle.cloneNode(true));
    document.head.appendChild(injectedStyle.cloneNode(true));
    document.body.prepend(injectedStyle.cloneNode(true));
    document.body.appendChild(injectedStyle.cloneNode(true));

    const injectedDiv = document.createElement('div');
    document.head.prepend(injectedDiv);
    document.head.appendChild(injectedDiv.cloneNode(true));
    // 不在 body 开头插入 <div>，因为这会与 hydration 冲突。Hydration 仍主要按标签匹配，而 <div>
    // 没有足够的属性来区分注入节点与渲染节点。若 body 已被前置一个 <div>，同时应用也把 <div> 渲染
    // 为 body 的第一个子节点，就会冲突。这是罕见边缘情况；即使发生，回退到客户端渲染也应正确修补 DOM。
    document.body.appendChild(injectedDiv.cloneNode(true));

    const injectedScript = document.createElement('script');
    injectedScript.setAttribute('async', '');
    injectedScript.setAttribute('src', 'injected');
    document.head.prepend(injectedScript);
    document.head.appendChild(injectedScript.cloneNode(true));
    document.body.prepend(injectedScript.cloneNode(true));
    document.body.appendChild(injectedScript.cloneNode(true));

    // 同一App hydrate后React结构保持，rendered与async rendered脚本仍在，第三方注入节点也保留。
    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html itemscope="">
        <head>
          <script async="" src="injected" />
          <div />
          <style>{'body { background-color: blue; }'}</style>
          <link rel="stylesheet" href="stylesheet" data-precedence="default" />
          <script async="" src="rendered" />
          <link rel="foo" href="foo" />
          <meta name="foo" content="foo" />
          <title>title</title>
          <link rel="foo" href="foo" />
          <link rel="stylesheet" href="stylesheet" />
          <script src="sync rendered" data-meaningful="" />
          <style>{'body { background-color: red; }'}</style>
          <script src="async rendered" async="" />
          <noscript>&lt;meta name="noscript" content="noscript"&gt;</noscript>
          <link rel="foo" href="foo" />
          <style>{'body { background-color: blue; }'}</style>
          <div />
          <script async="" src="injected" />
        </head>
        <body>
          <script async="" src="injected" />
          <style>{'body { background-color: blue; }'}</style>
          <meta name="foo" content="foo" itemprop="a prop" />
          <div itemscope="">
            <div>
              <div>deep hello</div>
              <meta name="foo" content="foo" itemprop="a prop" />
            </div>
          </div>
          <style>{'body { background-color: blue; }'}</style>
          <div />
          <script async="" src="injected" />
        </body>
      </html>,
    );

    // 卸载后会保留这些节点：
    // 1. Hoisted 资源（卸载时不清理，以应对 streaming Suspense 与导航之间的竞态）；
    // 2. 注入浏览器、用于提示资源加载但不直接关联 Fiber 的 preload；
    // 3. React 在 hydration 期间跳过的节点。
    root.unmount();
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="injected" />
          <div />
          <style>{'body { background-color: blue; }'}</style>
          <link rel="stylesheet" href="stylesheet" data-precedence="default" />
          <script async="" src="rendered" />
          <style>{'body { background-color: blue; }'}</style>
          <div />
          <script async="" src="injected" />
        </head>
        <body>
          <script async="" src="injected" />
          <style>{'body { background-color: blue; }'}</style>
          <style>{'body { background-color: blue; }'}</style>
          <div />
          <script async="" src="injected" />
        </body>
      </html>,
    );
  });

  /** SSR同步与async两份noModule脚本，分别保留body与提升到head；DOM投影只有这两份script而无preload，验证noModule不生成脚本预加载。 */
  it('does not preload nomodule scripts', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <script src="foo" noModule={true} data-meaningful="" />
            <script async={true} src="bar" noModule={true} data-meaningful="" />
          </body>
        </html>,
      ).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="bar" nomodule="" data-meaningful="" />
        </head>
        <body>
          <script src="foo" nomodule="" data-meaningful="" />
        </body>
      </html>,
    );
  });

  /** transition首次添加foo stylesheet与hello，render后只有preload且容器空；preload load后插入stylesheet仍不提交，stylesheet load后hello立即出现，区分两种加载完成。 */
  it('can delay commit until css resources load', async () => {
    const root = ReactDOMClient.createRoot(container);
    expect(getMeaningfulChildren(container)).toBe(undefined);
    React.startTransition(() => {
      root.render(
        <>
          <link rel="stylesheet" href="foo" precedence="default" />
          <div>hello</div>
        </>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(container)).toBe(undefined);
    expect(getMeaningfulChildren(document.head)).toEqual(
      <link rel="preload" as="style" href="foo" />,
    );

    loadPreloads();
    assertLog(['load preload: foo']);

    // 我们期望样式表现在插入，但提交还没有发生。
    expect(getMeaningfulChildren(container)).toBe(undefined);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="foo" data-precedence="default" />,
      <link rel="preload" as="style" href="foo" />,
    ]);

    loadStylesheets();
    assertLog(['load stylesheet: foo']);

    // 我们期望提交在样式表加载后立即完成。
    expect(getMeaningfulChildren(container)).toEqual(<div>hello</div>);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="foo" data-precedence="default" />,
      <link rel="preload" as="style" href="foo" />,
    ]);
  });

  // https://github.com/facebook/react/issues/27585

  /** SSR first/second样式，再客户端添加third并完成load；随后transition再引用一次first，head仍按first/second/third且各一份，不把已插入资源移动到组末。 */
  it('does not reinsert already inserted stylesheets during a delayed commit', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <link rel="stylesheet" href="first" precedence="default" />
            <link rel="stylesheet" href="second" precedence="default" />
            server
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="first" data-precedence="default" />
          <link rel="stylesheet" href="second" data-precedence="default" />
        </head>
        <body>server</body>
      </html>,
    );

    const root = ReactDOMClient.createRoot(document.body);
    expect(getMeaningfulChildren(container)).toBe(undefined);
    root.render(
      <>
        <link rel="stylesheet" href="first" precedence="default" />
        <link rel="stylesheet" href="third" precedence="default" />
        <div>client</div>
      </>,
    );
    await waitForAll([]);
    await act(() => {
      loadPreloads();
      loadStylesheets();
    });
    await assertLog([
      'load preload: third',
      'load stylesheet: first',
      'load stylesheet: second',
      'load stylesheet: third',
    ]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="first" data-precedence="default" />
          <link rel="stylesheet" href="second" data-precedence="default" />
          <link rel="stylesheet" href="third" data-precedence="default" />
          <link rel="preload" href="third" as="style" />
        </head>
        <body>
          <div>client</div>
        </body>
      </html>,
    );

    // 在过渡中，我们添加了一个对已经加载资源的另一个引用
    // https://github.com/facebook/react/issues/27585
    React.startTransition(() => {
      root.render(
        <>
          <link rel="stylesheet" href="first" precedence="default" />
          <link rel="stylesheet" href="third" precedence="default" />
          <div>client</div>
          <link rel="stylesheet" href="first" precedence="default" />
        </>,
      );
    });
    await waitForAll([]);
    // 旧回归曾把first重插到second/third之后；此处断言first/second/third原顺序不变。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="first" data-precedence="default" />
          <link rel="stylesheet" href="second" data-precedence="default" />
          <link rel="stylesheet" href="third" data-precedence="default" />
          <link rel="preload" href="third" as="style" />
        </head>
        <body>
          <div>client</div>
        </body>
      </html>,
    );
  });

  /** it.skip未执行：原设计transition等foo/bar样式，foo preload成功、bar preload失败后插入两样式，最终bar error/foo load允许hello提交；保留TODO所述失败崩溃状态，不把这些期望写成已验证行为。 */
  // eslint-disable-next-line jest/no-disabled-tests

  it.skip('can delay commit until css resources error', async () => {
    // TODO：此测试会失败并导致 Jest 崩溃；恢复执行前需先查明原因。
    const root = ReactDOMClient.createRoot(container);
    expect(getMeaningfulChildren(container)).toBe(undefined);
    React.startTransition(() => {
      root.render(
        <>
          <link rel="stylesheet" href="foo" precedence="default" />
          <link rel="stylesheet" href="bar" precedence="default" />
          <div>hello</div>
        </>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(container)).toBe(undefined);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="preload" as="style" href="foo" />,
      <link rel="preload" as="style" href="bar" />,
    ]);

    loadPreloads(['foo']);
    errorPreloads(['bar']);
    assertLog(['load preload: foo', 'error preload: bar']);

    // 我们期望样式表现在插入，但提交还没有发生。
    expect(getMeaningfulChildren(container)).toBe(undefined);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="foo" data-precedence="default" />,
      <link rel="stylesheet" href="bar" data-precedence="default" />,
      <link rel="preload" as="style" href="foo" />,
      <link rel="preload" as="style" href="bar" />,
    ]);

    errorStylesheets(['bar']);

    loadStylesheets(['foo']);
    assertLog(['load stylesheet: foo', 'error stylesheet: bar']);

    // 我们期望提交在样式表加载后立即完成。
    expect(getMeaningfulChildren(container)).toEqual(<div>hello</div>);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="foo" data-precedence="default" />,
      <link rel="stylesheet" href="bar" data-precedence="default" />,
      <link rel="preload" as="style" href="foo" />,
      <link rel="preload" as="style" href="bar" />,
    ]);
  });

  /** SSR shell已有foo样式，hydrate及后续hello2更新无需人工load即可提交；再加新bar时hello3等待preload和stylesheet两阶段load，foo无需重新加载。 */
  it('assumes stylesheets that load in the shell loaded already', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <link rel="stylesheet" href="foo" precedence="default" />
            hello
          </body>
        </html>,
      ).pipe(writable);
    });

    let root;
    React.startTransition(() => {
      root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <link rel="stylesheet" href="foo" precedence="default" />
            hello
          </body>
        </html>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>hello</body>
      </html>,
    );

    React.startTransition(() => {
      root.render(
        <html>
          <body>
            <link rel="stylesheet" href="foo" precedence="default" />
            hello2
          </body>
        </html>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>hello2</body>
      </html>,
    );

    React.startTransition(() => {
      root.render(
        <html>
          <body>
            <link rel="stylesheet" href="foo" precedence="default" />
            hello3
            <link rel="stylesheet" href="bar" precedence="default" />
          </body>
        </html>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello2</body>
      </html>,
    );

    loadPreloads();
    assertLog(['load preload: bar']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello2</body>
      </html>,
    );

    loadStylesheets(['bar']);
    assertLog(['load stylesheet: bar']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello3</body>
      </html>,
    );
  });

  /** foo transition只输出preload且提交挂起，普通根更新改用bar并完成其load后显示hello2；稍后foo preload load不改变UI，再transition重引foo可直接显示hello3，旧preload成功状态可复用。 */
  it('can interrupt a suspended commit with a new update', async () => {

    /** 将children放进html/body包装，根更新依次替换foo/bar资源及文本，用于中断悬置commit。
     * @param props children为本轮文本与样式资源。
     * @returns 完整文档。 */
    function App({children}) {
      return (
        <html>
          <body>{children}</body>
        </html>
      );
    }
    const root = ReactDOMClient.createRoot(document);

    // 先执行初始渲染。此后插入内容会挂起，除非它们包裹在一个新的 Suspense boundary 中。
    root.render(<App />);
    await waitForAll([]);

    // 插入一个样式表. 这将暂停,因为这是一个过渡.
    React.startTransition(() => {
      root.render(
        <App>
          hello
          <link rel="stylesheet" href="foo" precedence="default" />
        </App>,
      );
    });
    await waitForAll([]);
    // 虽然提交已暂停，但已插入预加载。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
        </head>
        <body />
      </html>,
    );

    // 在样式表加载之前,请紧急更新. 这将插入一个不同的样式表,并取消第一个. 这张样式表不会被暂停, 尽
    // 管尚未加载， 因为这是一个紧急的更新.
    root.render(
      <App>
        hello2
        {null}
        <link rel="stylesheet" href="bar" precedence="default" />
      </App>,
    );
    await waitForAll([]);
    await act(() => {
      loadPreloads(['bar']);
      loadStylesheets(['bar']);
    });
    await assertLog(['load preload: bar', 'load stylesheet: bar']);

    // "bar" 样式表已插入。尽管相应更新已被取代，"foo" preload 仍然存在。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello2</body>
      </html>,
    );

    // 随着 "foo" 完成加载, 没有任何事情发生。 因为 "foo" 在最近一次根更新中未被包含。 然而, 如果我
    // 们在后面插入 "foo"， 它应该立即提交，而无需暂停。 因为它已经预先加载。
    loadPreloads(['foo']);
    assertLog(['load preload: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello2</body>
      </html>,
    );

    // 现在再次插入 "foo"。
    React.startTransition(() => {
      root.render(
        <App>
          hello3
          <link rel="stylesheet" href="foo" precedence="default" />
          <link rel="stylesheet" href="bar" precedence="default" />
        </App>,
      );
    });
    await waitForAll([]);
    // 由于 "foo" 已预先加载，因此没有暂停提交。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello3</body>
      </html>,
    );

    loadStylesheets(['foo']);
    assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>hello3</body>
      </html>,
    );
  });

  /** 空文档后同步在Suspense加入foo样式，load后显示hello；再同步加bar时旧内容隐藏、fallback出现，bar load后恢复旧div。中间fallback/preload检查仅在alwaysThrottleRetries gate成立时执行。 */
  it('will put a Suspense boundary into fallback if it contains a stylesheet not loaded during a sync update', async () => {

    /** 提供稳定html/body结构，children内的Suspense同步引入样式并在未加载时回退。
     * @param props children为本轮边界。
     * @returns 完整文档。 */
    function App({children}) {
      return (
        <html>
          <body>{children}</body>
        </html>
      );
    }
    const root = ReactDOMClient.createRoot(document);

    await clientAct(() => {
      root.render(<App />);
    });
    await waitForAll([]);

    await clientAct(() => {
      root.render(
        <App>
          <Suspense fallback="loading...">
            <div>
              hello
              <link rel="stylesheet" href="foo" precedence="default" />
            </div>
          </Suspense>
        </App>,
      );
    });
    await waitForAll([]);

    if (gate(flags => flags.alwaysThrottleRetries)) {
      // 虽然提交已暂停，但已插入预加载。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" href="foo" as="style" />
          </head>
          <body>loading...</body>
        </html>,
      );

      loadPreloads(['foo']);
      assertLog(['load preload: foo']);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="preload" href="foo" as="style" />
          </head>
          <body>loading...</body>
        </html>,
      );
    }

    loadStylesheets(['foo']);
    assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
        </head>
        <body>
          <div>hello</div>
        </body>
      </html>,
    );

    await clientAct(() => {
      root.render(
        <App>
          <Suspense fallback="loading...">
            <div>
              hello
              <link rel="stylesheet" href="foo" precedence="default" />
              <link rel="stylesheet" href="bar" precedence="default" />
            </div>
          </Suspense>
        </App>,
      );
    });
    await waitForAll([]);
    if (gate(flags => flags.alwaysThrottleRetries)) {
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="preload" href="foo" as="style" />
            <link rel="preload" href="bar" as="style" />
          </head>
          <body>
            <div style="display: none;">hello</div>loading...
          </body>
        </html>,
      );

      loadPreloads(['bar']);
      assertLog(['load preload: bar']);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="stylesheet" href="bar" data-precedence="default" />
            <link rel="preload" href="foo" as="style" />
            <link rel="preload" href="bar" as="style" />
          </head>
          <body>
            <div style="display: none;">hello</div>loading...
          </body>
        </html>,
      );
    }
    loadStylesheets(['bar']);
    assertLog(['load stylesheet: bar']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="bar" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="bar" as="style" />
        </head>
        <body>
          <div style="">hello</div>
        </body>
      </html>,
    );
  });

  /** SSR head中手动写带data-precedence的foo样式但未派load，客户端另一个root在Suspense内引用同URL资源；直接显示hello world且无preload，已有无pending证据的样式被视为已加载。 */
  it('will assume stylesheets already in the document have loaded if it cannot confirm it is not yet loaded', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>
            <div id="foo" />
          </body>
        </html>,
      ).pipe(writable);
    });

    const root = ReactDOMClient.createRoot(document.querySelector('#foo'));

    root.render(
      <div>
        <Suspense fallback="loading...">
          <link rel="stylesheet" href="foo" precedence="default" />
          hello world
        </Suspense>
      </div>,
    );

    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>
          <div id="foo">
            <div>hello world</div>
          </div>
        </body>
      </html>,
    );
  });

  /** 晚到SSR边界已插foo stylesheet但未load，另一hydrate组件从服务端null改为客户端hello client且引用同资源；load前两部分都不更新，load后记录局部hydration mismatch并重建，最终同时显示服务端hello world与客户端内容。 */
  it('will assume wait for loading stylesheets to load before continuing', async () => {
    let ssr = true;

    /** 依据闭包ssr标志，SSR时返回null，客户端改为foo资源及hello client；刻意制造局部hydrate差异并复用正在加载的晚到样式。
     * @returns null或资源/文本Fragment。 */
    function Component() {
      if (ssr) {
        return null;
      } else {
        return (
          <>
            <link rel="stylesheet" href="foo" precedence="default" />
            <div>hello client</div>
          </>
        );
      }
    }

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <div>
              <Suspense fallback="loading...">
                <BlockedOn value="reveal">
                  <link rel="stylesheet" href="foo" precedence="default" />
                  <div>hello world</div>
                </BlockedOn>
              </Suspense>
            </div>
            <div>
              <Suspense fallback="loading 2...">
                <Component />
              </Suspense>
            </div>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>loading...</div>
          <div />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('reveal');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>
          <div>loading...</div>
          <div />
          <link rel="preload" href="foo" as="style" />
        </body>
      </html>,
    );

    ssr = false;

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>
          <div>
            <Suspense fallback="loading...">
              <BlockedOn value="reveal">
                <link rel="stylesheet" href="foo" precedence="default" />
                <div>hello world</div>
              </BlockedOn>
            </Suspense>
          </div>
          <div>
            <Suspense fallback="loading 2...">
              <Component />
            </Suspense>
          </div>
        </body>
      </html>,
    );
    await waitForAll([]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>
          <div>loading...</div>
          <div />
          <link rel="preload" href="foo" as="style" />
        </body>
      </html>,
    );

    loadStylesheets();
    assertLog(['load stylesheet: foo']);
    await waitForAll([]);
    assertConsoleErrorDev([
      "Error: Hydration failed because the server rendered HTML didn't match the client. " +
        'As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:\n\n' +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\n' +
        'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\n' +
        'https://react.dev/link/hydration-mismatch\n\n' +
        '  <html>\n' +
        '    <body>\n' +
        '      <div>\n' +
        '      <div>\n' +
        '        <Suspense fallback="loading 2...">\n' +
        '          <Component>\n' +
        '            <link>\n' +
        '+           <div>' +
        '\n    in <stack>',
    ]);
    jest.runAllTimers();

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
        </head>
        <body>
          <div>
            <div>hello world</div>
          </div>
          <div>
            <div>hello client</div>
          </div>
          <link rel="preload" href="foo" as="style" />
        </body>
      </html>,
    );
  });

  /** 初始body为initial，显式preload route.css并先派load；transition再引用该stylesheet可直接提交next，不必等待stylesheet load，之后load不重复插资源。 */
  it('does not suspend a transition on a stylesheet whose preload has already loaded', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <body>
          <Suspense fallback="loading...">initial</Suspense>
        </body>
      </html>,
    );
    await waitForAll([]);

    ReactDOM.preload('route.css', {as: 'style'});
    expect(getMeaningfulChildren(document.head)).toEqual(
      <link rel="preload" href="route.css" as="style" />,
    );
    expect(getMeaningfulChildren(document.body)).toEqual('initial');

    loadPreloads(['route.css']);
    assertLog(['load preload: route.css']);

    React.startTransition(() => {
      root.render(
        <html>
          <body>
            <Suspense fallback="loading...">
              <link rel="stylesheet" href="route.css" precedence="default" />
              next
            </Suspense>
          </body>
        </html>,
      );
    });
    await waitForAll([]);

    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="route.css" data-precedence="default" />,
      <link rel="preload" href="route.css" as="style" />,
    ]);
    expect(getMeaningfulChildren(document.body)).toEqual('next');

    loadStylesheets(['route.css']);
    assertLog(['load stylesheet: route.css']);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="route.css" data-precedence="default" />,
      <link rel="preload" href="route.css" as="style" />,
    ]);
    expect(getMeaningfulChildren(document.body)).toEqual('next');
  });

  /** 先显式preload但尚未load，transition引用route.css后仍显示initial；preload load只插stylesheet，stylesheet load后才显示next，与预加载已经完成路径形成对照。 */
  it('suspends a transition on a stylesheet whose preload has not loaded yet', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <body>
          <Suspense fallback="loading...">initial</Suspense>
        </body>
      </html>,
    );
    await waitForAll([]);

    ReactDOM.preload('route.css', {as: 'style'});
    expect(getMeaningfulChildren(document.head)).toEqual(
      <link rel="preload" href="route.css" as="style" />,
    );
    expect(getMeaningfulChildren(document.body)).toEqual('initial');

    React.startTransition(() => {
      root.render(
        <html>
          <body>
            <Suspense fallback="loading...">
              <link rel="stylesheet" href="route.css" precedence="default" />
              next
            </Suspense>
          </body>
        </html>,
      );
    });
    await waitForAll([]);

    expect(getMeaningfulChildren(document.head)).toEqual(
      <link rel="preload" href="route.css" as="style" />,
    );
    expect(getMeaningfulChildren(document.body)).toEqual('initial');

    loadPreloads(['route.css']);
    assertLog(['load preload: route.css']);
    await waitForAll([]);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="route.css" data-precedence="default" />,
      <link rel="preload" href="route.css" as="style" />,
    ]);
    expect(getMeaningfulChildren(document.body)).toEqual('initial');

    loadStylesheets(['route.css']);
    assertLog(['load stylesheet: route.css']);
    await waitForAll([]);
    expect(getMeaningfulChildren(document.head)).toEqual([
      <link rel="stylesheet" href="route.css" data-precedence="default" />,
      <link rel="preload" href="route.css" as="style" />,
    ]);
    expect(getMeaningfulChildren(document.body)).toEqual('next');
  });

  /** 两个独立root都transition等待公共foo与各自one/two；仅load foo/two让第二root先显示two，第一root仍空；再load one第一root显示one，公共资源一份且两提交依赖独立解锁。 */
  it('can suspend commits on more than one root for the same resource at the same time', async () => {
    document.body.innerHTML = '';
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');
    document.body.appendChild(container1);
    document.body.appendChild(container2);

    const root1 = ReactDOMClient.createRoot(container1);
    const root2 = ReactDOMClient.createRoot(container2);

    React.startTransition(() => {
      root1.render(
        <div>
          one
          <link rel="stylesheet" href="foo" precedence="default" />
          <link rel="stylesheet" href="one" precedence="default" />
        </div>,
      );
    });
    await waitForAll([]);
    React.startTransition(() => {
      root2.render(
        <div>
          two
          <link rel="stylesheet" href="foo" precedence="default" />
          <link rel="stylesheet" href="two" precedence="default" />
        </div>,
      );
    });
    await waitForAll([]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="one" as="style" />
          <link rel="preload" href="two" as="style" />
        </head>
        <body>
          <div />
          <div />
        </body>
      </html>,
    );

    loadPreloads(['foo', 'two']);
    assertLog(['load preload: foo', 'load preload: two']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="two" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="one" as="style" />
          <link rel="preload" href="two" as="style" />
        </head>
        <body>
          <div />
          <div />
        </body>
      </html>,
    );

    loadStylesheets(['foo', 'two']);
    assertLog(['load stylesheet: foo', 'load stylesheet: two']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="two" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="one" as="style" />
          <link rel="preload" href="two" as="style" />
        </head>
        <body>
          <div />
          <div>
            <div>two</div>
          </div>
        </body>
      </html>,
    );

    loadPreloads();
    loadStylesheets();
    assertLog(['load preload: one', 'load stylesheet: one']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="stylesheet" href="two" data-precedence="default" />
          <link rel="stylesheet" href="one" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
          <link rel="preload" href="one" as="style" />
          <link rel="preload" href="two" as="style" />
        </head>
        <body>
          <div>
            <div>one</div>
          </div>
          <div>
            <div>two</div>
          </div>
        </body>
      </html>,
    );
  });

  /** foo样式transition仅留下preload，假定时器推进50秒仍显示空body，再推进10秒超时插stylesheet并显示hello；随后迟到load不改DOM，验证60秒兜底提交而非真实网络耗时。 */
  it('stylesheets block render, with a really long timeout', async () => {

    /** 透传children到html/body，给60秒样式等待上限提供稳定文档包装。
     * @param props children为待提交文本与stylesheet。
     * @returns html文档。 */
    function App({children}) {
      return (
        <html>
          <body>{children}</body>
        </html>
      );
    }
    const root = ReactDOMClient.createRoot(document);
    root.render(<App />);
    React.startTransition(() => {
      root.render(
        <App>
          hello
          <link rel="stylesheet" href="foo" precedence="default" />
        </App>,
      );
    });
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
        </head>
        <body />
      </html>,
    );

    // 提前50秒. 尽管如此,过渡仍暂停.
    jest.advanceTimersByTime(50000);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="style" />
        </head>
        <body />
      </html>,
    );

    // 提前10秒. 已过一分钟。 在这个时候, 肯定有什么事情发生了, 因此，我们超时并允许未样式化的内容
    // 显示。
    jest.advanceTimersByTime(10000);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
        </head>
        <body>hello</body>
      </html>,
    );

    // 我们将在提交完成后加载这些，以确保没有错误发生，并且没有新的插入。
    loadPreloads(['foo']);
    loadStylesheets(['foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" href="foo" as="style" />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  /** 初始(empty)，transition A等待样式，再transition B取代；两个preload都留在head，统一派load仅B插stylesheet并提交B，废弃A不恢复UI。 */
  it('can interrupt a suspended commit with a new transition', async () => {

    /** 透传children到html/body，先挂载empty再分别transition到A/B，隔离两个互相替代的悬置提交。
     * @param props children为各轮资源与文本。
     * @returns html文档。 */
    function App({children}) {
      return (
        <html>
          <body>{children}</body>
        </html>
      );
    }
    const root = ReactDOMClient.createRoot(document);
    root.render(<App>(empty)</App>);

    // 开始过渡到"A"
    React.startTransition(() => {
      root.render(
        <App>
          A
          <link rel="stylesheet" href="A" precedence="default" />
        </App>,
      );
    });
    await waitForAll([]);

    // "A" 尚未加载，因此仍显示初始 UI；不过它的 preload 已插入 head。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="A" as="style" />
        </head>
        <body>(empty)</body>
      </html>,
    );

    // 打断"A"的转型,用一个新的"B"
    React.startTransition(() => {
      root.render(
        <App>
          B
          <link rel="stylesheet" href="B" precedence="default" />
        </App>,
      );
    });
    await waitForAll([]);

    // "B" 尚未加载，因此仍显示初始 UI；它的 preload 现在也位于 head 中。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="A" as="style" />
          <link rel="preload" href="B" as="style" />
        </head>
        <body>(empty)</body>
      </html>,
    );

    // 完成加载
    loadPreloads();
    loadStylesheets();
    assertLog(['load preload: A', 'load preload: B', 'load stylesheet: B']);
    // 现在 “B” 的 Transition 已结束。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="B" data-precedence="default" />
          <link rel="preload" href="A" as="style" />
          <link rel="preload" href="B" as="style" />
        </head>
        <body>B</body>
      </html>,
    );
  });

  /** SSR Throws的Oops被Suspense转为Loading且onError记日志；hydrate中class边界改用含A stylesheet的错误回退，先仅preload并保留Loading，clientAct派样式load后显示Oops和一份A资源。 */
  it('loading a stylesheet as part of an error boundary UI, during initial render', async () => {

    /** 客户端捕获Oops后渲染A样式资源与error.message，观察错误回退自身也需等CSS；SSR错误由外部Fizz/Suspense处理。 */
    class ErrorBoundary extends React.Component {

      /** error初值null透传正常children，派生错误后选择样式化错误回退。 */
      state = {error: null};

      /** 将后代错误转换为error状态补丁。
       * @param error Throws抛出的Oops异常。
       * @returns error字段。 */
      static getDerivedStateFromError(error) {
        return {error};
      }

      /** 正常时返回children，错误时返回A资源与message；未执行实际网络请求。
       * @returns 正常子树或含资源的错误Fragment。 */
      render() {
        const error = this.state.error;
        if (error !== null) {
          return (
            <>
              <link rel="stylesheet" href="A" precedence="default" />
              {error.message}
            </>
          );
        }
        return this.props.children;
      }
    }

    /** 无条件抛Oops，服务端Suspense与客户端class边界分别接手。
     * @throws Oops异常。 */
    function Throws() {
      throw new Error('Oops!');
    }

    /** 文档body内class边界包住Suspense/Throws；同一组件树用于SSR fallback与hydrate错误屏幕。
     * @returns html/head自动补建的文档树。 */
    function App() {
      return (
        <html>
          <body>
            <ErrorBoundary>
              <Suspense fallback="Loading...">
                <Throws />
              </Suspense>
            </ErrorBoundary>
          </body>
        </html>
      );
    }

    // 初始服务器渲染。由于某处抛错，会显示 Suspense fallback。
    await act(() => {
      renderToPipeableStream(<App />, {

        /** 记录Fizz捕获的服务端错误message，不返回digest或修改错误边界状态。
         * @param x Fizz的Oops错误。 */
        onError(x) {
          Scheduler.log('Caught server error: ' + x.message);
        },
      }).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>Loading...</body>
      </html>,
    );
    assertLog(['Caught server error: Oops!']);

    // 对树进行 hydration。错误边界会捕获错误并尝试显示错误屏幕；但错误屏幕包含样式表，因此提交应
    // 挂起到该样式表加载完成。
    ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);

    // preload 已插入；错误屏幕已完成 render，但尚未提交到 DOM。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link as="style" href="A" rel="preload" />
        </head>
        <body>Loading...</body>
      </html>,
    );

    // 完成加载样式表。 必须解锁提交,并且显示错误屏幕.
    await clientAct(() => loadStylesheets());
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link data-precedence="default" href="A" rel="stylesheet" />
          <link as="style" href="A" rel="preload" />
        </head>
        <body>Oops!</body>
      </html>,
    );
  });

  /** Component先显式preload foo，边界等待blocked再渲染同URL样式；解文本并load样式后head只有一份原preload和一份stylesheet，body显示hello，不补第二preload。 */
  it('will not flush a preload for a new rendered Stylesheet Resource if one was already flushed', async () => {

    /** 先显式preload foo，返回等待blocked后渲染同URLstylesheet的边界，用于避免晚到资源重复生成preload。
     * @returns div与等待边界。 */
    function Component() {
      ReactDOM.preload('foo', {as: 'style'});
      return (
        <div>
          <Suspense fallback="loading...">
            <BlockedOn value="blocked">
              <link rel="stylesheet" href="foo" precedence="default" />
              hello
            </BlockedOn>
          </Suspense>
        </div>
      );
    }
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Component />
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="style" href="foo" />
        </head>
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );
    await act(() => {
      resolveText('blocked');
    });
    await act(loadStylesheets);
    assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <link rel="preload" as="style" href="foo" />
        </head>
        <body>
          <div>hello</div>
        </body>
      </html>,
    );
  });

  /** shell先由Component显式preload foo，解blocked后Preinit调用同URL style preinit；本例DOM期望仍仅一份preload而body已显示hello，核对重复预加载输出，未断言第二个stylesheet节点。 */
  it('will not flush a preload for a new preinitialized Stylesheet Resource if one was already flushed', async () => {

    /** 先显式preload foo，返回等待blocked后执行Preinit的边界，对比预加载与晚到预初始化的去重。
     * @returns div/边界树。 */
    function Component() {
      ReactDOM.preload('foo', {as: 'style'});
      return (
        <div>
          <Suspense fallback="loading...">
            <BlockedOn value="blocked">
              <Preinit />
              hello
            </BlockedOn>
          </Suspense>
        </div>
      );
    }

    /** 在解除文本等待后的render里preinit foo style，无UI输出；断言只观察后续流中的资源提示。
     * @returns undefined。 */
    function Preinit() {
      ReactDOM.preinit('foo', {as: 'style'});
    }
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Component />
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="style" href="foo" />
        </head>
        <body>
          <div>loading...</div>
        </body>
      </html>,
    );
    await act(() => {
      resolveText('blocked');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="style" href="foo" />
        </head>
        <body>
          <div>hello</div>
        </body>
      </html>,
    );
  });

  /** SSR已有foo stylesheet、bar async脚本、baz font preload，客户端ClientApp分别preload同URL；提交后head三节点不增加，容器显示foo，底层资源存在时复用。 */
  it('will not insert a preload if the underlying resource already exists in the Document', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <head>
            <link rel="stylesheet" href="foo" precedence="default" />
            <script async={true} src="bar" />
            <link rel="preload" href="baz" as="font" />
          </head>
          <body>
            <div id="container" />
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <script async="" src="bar" />
          <link rel="preload" href="baz" as="font" />
        </head>
        <body>
          <div id="container" />
        </body>
      </html>,
    );

    container = document.getElementById('container');

    /** 对SSR已存在的style/script/font各发同URL preload，再返回foo文本，观察客户端是否多插link。
     * @returns foo。 */
    function ClientApp() {
      ReactDOM.preload('foo', {as: 'style'});
      ReactDOM.preload('bar', {as: 'script'});
      ReactDOM.preload('baz', {as: 'font'});
      return 'foo';
    }

    const root = ReactDOMClient.createRoot(container);

    await clientAct(() => root.render(<ClientApp />));
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="default" />
          <script async="" src="bar" />
          <link rel="preload" href="baz" as="font" />
        </head>
        <body>
          <div id="container">foo</div>
        </body>
      </html>,
    );
  });

  /** SSR重复调用image preload，分别按href、srcSet、srcSet+sizes去重，只有sizes时仍按href；非image忽略图像参数。hydrate保持四条，客户端isClient轮再加三种client键，核对完整输出集合。 */
  it('uses imageSrcSet and imageSizes when keying image preloads', async () => {

    /** 提交多组重复预加载输入，image按srcSet/sizes组合而无srcSet时按href；isClient轮再追加client组，非image参数作忽略对照。
     * @param props isClient为true时追加客户端URL组。
     * @returns hello文档。 */
    function App({isClient}) {
      // 将根据 href 属性在没有 imageSrcSet 属性时进行操作。
      ReactDOM.preload('foo', {as: 'image'});
      ReactDOM.preload('foo', {as: 'image'});

      // 将基于 `imageSrcSet` 和 `imageSizes`。
      ReactDOM.preload('foo', {as: 'image', imageSrcSet: 'fooset'});
      ReactDOM.preload('foo2', {as: 'image', imageSrcSet: 'fooset'});

      // 将基于 `imageSrcSet` 和 `imageSizes`。
      ReactDOM.preload('foo', {
        as: 'image',
        imageSrcSet: 'fooset',
        imageSizes: 'foosizes',
      });
      ReactDOM.preload('foo2', {
        as: 'image',
        imageSrcSet: 'fooset',
        imageSizes: 'foosizes',
      });

      // 将根据 href 属性而不是 imageSrcSet 和 imageSizes 属性。 这些应该与第一个预加载匹配，并且不应
      // 该生成新的预加载标签。
      ReactDOM.preload('foo', {as: 'image', imageSizes: 'foosizes'});
      ReactDOM.preload('foo', {as: 'image', imageSizes: 'foosizes'});

      // 这些预装是为了某种东西,而不是图像.
      ReactDOM.preload('bar', {as: 'somethingelse'});
      ReactDOM.preload('bar', {
        as: 'somethingelse',
        imageSrcSet: 'makes no sense',
      });
      ReactDOM.preload('bar', {
        as: 'somethingelse',
        imageSrcSet: 'makes no sense',
        imageSizes: 'makes no sense',
      });

      if (isClient) {
        // 将根据 href 属性在没有 imageSrcSet 属性时进行操作。
        ReactDOM.preload('client', {as: 'image'});
        ReactDOM.preload('client', {as: 'image'});

        // 将基于 `imageSrcSet` 和 `imageSizes`。
        ReactDOM.preload('client', {as: 'image', imageSrcSet: 'clientset'});
        ReactDOM.preload('client2', {as: 'image', imageSrcSet: 'clientset'});

        // 将基于 `imageSrcSet` 和 `imageSizes`。
        ReactDOM.preload('client', {
          as: 'image',
          imageSrcSet: 'clientset',
          imageSizes: 'clientsizes',
        });
        ReactDOM.preload('client2', {
          as: 'image',
          imageSrcSet: 'clientset',
          imageSizes: 'clientsizes',
        });

        // 将根据 href 属性而不是 imageSrcSet 和 imageSizes 属性来键。 这些应该与第一个预加载匹配，并且
        // 不应该生成新的预加载标签。
        ReactDOM.preload('client', {as: 'image', imageSizes: 'clientsizes'});
        ReactDOM.preload('client', {as: 'image', imageSizes: 'clientsizes'});
      }

      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="image" href="foo" />
          <link rel="preload" as="image" imagesrcset="fooset" />
          <link
            rel="preload"
            as="image"
            imagesrcset="fooset"
            imagesizes="foosizes"
          />
          <link rel="preload" as="somethingelse" href="bar" />
        </head>
        <body>hello</body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="image" href="foo" />
          <link rel="preload" as="image" imagesrcset="fooset" />
          <link
            rel="preload"
            as="image"
            imagesrcset="fooset"
            imagesizes="foosizes"
          />
          <link rel="preload" as="somethingelse" href="bar" />
        </head>
        <body>hello</body>
      </html>,
    );

    root.render(<App isClient={true} />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="image" href="foo" />
          <link rel="preload" as="image" imagesrcset="fooset" />
          <link
            rel="preload"
            as="image"
            imagesrcset="fooset"
            imagesizes="foosizes"
          />
          <link rel="preload" as="somethingelse" href="bar" />
          <link rel="preload" as="image" href="client" />
          <link rel="preload" as="image" imagesrcset="clientset" />
          <link
            rel="preload"
            as="image"
            imagesrcset="clientset"
            imagesizes="clientsizes"
          />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  /** SSR与客户端新预加载都使用srcSet/sizes及no-referrer；hydrate复用server项，后续isClient更新仅追加client项，两个link均保留referrerpolicy。 */
  it('should handle referrerPolicy on image preload', async () => {

    /** 预加载server响应式图片且设置no-referrer；isClient真时再声明对应client项。
     * @param props isClient控制是否新增client资源。
     * @returns hello文档。 */
    function App({isClient}) {
      ReactDOM.preload('/server', {
        as: 'image',
        imageSrcSet: '/server',
        imageSizes: '100vw',
        referrerPolicy: 'no-referrer',
      });

      if (isClient) {
        ReactDOM.preload('/client', {
          as: 'image',
          imageSrcSet: '/client',
          imageSizes: '100vw',
          referrerPolicy: 'no-referrer',
        });
      }

      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            referrerpolicy="no-referrer"
          />
        </head>
        <body>hello</body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            referrerpolicy="no-referrer"
          />
        </head>
        <body>hello</body>
      </html>,
    );

    root.render(<App isClient={true} />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            referrerpolicy="no-referrer"
          />
          <link
            rel="preload"
            as="image"
            imagesrcset="/client"
            imagesizes="100vw"
            referrerpolicy="no-referrer"
          />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  /** 显式预加载script/a/b，同时渲染普通、lazy及不同srcSet/sizes图像；普通a/c/d自动预加载并排前，lazy b2不生成，显式b仍保留，比较图片发现与调用API的顺序。 */
  it('can emit preloads for non-lazy images that are rendered', async () => {

    /** 显式声明script/a/b预加载并返回含普通、lazy、srcSet/sizes变化的img，用于检查自动提示去重与排序。
     * @returns 图片文档。 */
    function App() {
      ReactDOM.preload('script', {as: 'script'});
      ReactDOM.preload('a', {as: 'image'});
      ReactDOM.preload('b', {as: 'image'});
      return (
        <html>
          <body>
            <img src="a" />
            <img src="b" loading="lazy" />
            <img src="b2" loading="lazy" />
            <img src="c" srcSet="srcsetc" />
            <img src="d" srcSet="srcsetd" sizes="sizesd" />
            <img src="d" srcSet="srcsetd" sizes="sizesd2" />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    // 非懒加载图片在前。 然后随意预装,像脚本和惰的图像
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="a" as="image" />
          <link rel="preload" as="image" imagesrcset="srcsetc" />
          <link
            rel="preload"
            as="image"
            imagesrcset="srcsetd"
            imagesizes="sizesd"
          />
          <link
            rel="preload"
            as="image"
            imagesrcset="srcsetd"
            imagesizes="sizesd2"
          />
          <link rel="preload" href="script" as="script" />
          <link rel="preload" href="b" as="image" />
        </head>
        <body>
          <img src="a" />
          <img src="b" loading="lazy" />
          <img src="b2" loading="lazy" />
          <img src="c" srcset="srcsetc" />
          <img src="d" srcset="srcsetd" sizes="sizesd" />
          <img src="d" srcset="srcsetd" sizes="sizesd2" />
        </body>
      </html>,
    );
  });

  /** 标题称lazy，但实际两个img都用fetchPriority=low，没有loading=lazy；仅显式preload的a出现在head，b无自动preload，验证低优先级抑制自动图片提示。 */
  it('Does not preload lazy images', async () => {

    /** 显式preload a并渲染两张fetchPriority=low图片；本夹具没有lazy loading属性，b用于观察低优先级自动提示抑制。
     * @returns 两张low图片的文档。 */
    function App() {
      ReactDOM.preload('a', {as: 'image'});
      return (
        <html>
          <body>
            <img src="a" fetchPriority="low" />
            <img src="b" fetchPriority="low" />
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="image" href="a" />
        </head>
        <body>
          <img src="a" fetchpriority="low" />
          <img src="b" fetchpriority="low" />
        </body>
      </html>,
    );
  });

  /** 先显式预加载1/9/10为high，再发现普通、auto、high、low图片；前三项加七个自动项占默认高序队列，显式high的12仍排前，11与auto/low提示排后，低优先级5low不自动预加载。 */
  it('preloads up to 10 suspensey images as high priority when fetchPriority is not specified', async () => {

    /** 预置三条high与auto/low图片提示，再返回普通/auto/high/low图像，比较默认十项高序预算与显式high超出预算的排序。
     * @returns 图片集合文档。 */
    function App() {
      ReactDOM.preload('1', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preload('auto', {as: 'image'});
      ReactDOM.preload('low', {as: 'image', fetchPriority: 'low'});
      ReactDOM.preload('9', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preload('10', {as: 'image', fetchPriority: 'high'});
      return (
        <html>
          <body>
            {/* 跳过 1 */}
            <img src="2" />
            <img src="3" fetchPriority="auto" />
            <img src="4" fetchPriority="high" />
            <img src="5" />
            <img src="5low" fetchPriority="low" />
            <img src="6" />
            <img src="7" />
            <img src="8" />
            <img src="9" />
            {/* 跳过 10 */}
            <img src="11" />
            <img src="12" fetchPriority="high" />
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          {/* 我们首先看到预加载调用，这些调用被放入高优先级图像队列中。 */}
          <link rel="preload" as="image" href="1" fetchpriority="high" />
          <link rel="preload" as="image" href="9" fetchpriority="high" />
          <link rel="preload" as="image" href="10" fetchpriority="high" />
          {/* 接下来我们看到,多达7张图像符合高优先级图像排列的条件. */}
          <link rel="preload" as="image" href="2" />
          <link rel="preload" as="image" href="3" fetchpriority="auto" />
          <link rel="preload" as="image" href="4" fetchpriority="high" />
          <link rel="preload" as="image" href="5" />
          <link rel="preload" as="image" href="6" />
          <link rel="preload" as="image" href="7" />
          <link rel="preload" as="image" href="8" />
          {/* 接着是显式高优先级、因而进入高优先级图片队列的图片。 */}
          <link rel="preload" as="image" href="12" fetchpriority="high" />
          {/* 我们接着看到没有进入高优先级图像队列的剩余预加载。 */}
          <link rel="preload" as="image" href="auto" />
          <link rel="preload" as="image" href="low" fetchpriority="low" />
          <link rel="preload" as="image" href="11" />
        </head>
        <body>
          {/* 跳过 1 */}
          <img src="2" />
          <img src="3" fetchpriority="auto" />
          <img src="4" fetchpriority="high" />
          <img src="5" />
          <img src="5low" fetchpriority="low" />
          <img src="6" />
          <img src="7" />
          <img src="8" />
          <img src="9" />
          {/* 跳过 10 */}
          <img src="11" />
          <img src="12" fetchpriority="high" />
        </body>
      </html>,
    );
  });

  /** 先preload a/b，再渲染12张普通图与a的low/普通/high重复实例；前十普通图在前，a被至少一处high提升到stylesheet之前且link保留首份无fetchpriority属性，b/11/12排后，验证队列提升与资源去重。 */
  it('can promote images to high priority when at least one instance specifies a high fetchPriority', async () => {

    /** 先声明a/b普通图片提示，再返回十二张普通图片和a的多种priority实例及样式，观察十项预算后的同资源队列提升。
     * @returns 图片与资源文档。 */
    function App() {
      // 若 a 最终位于比 b 更高优先级的队列中，它会先被冲刷。
      ReactDOM.preload('a', {as: 'image'});
      ReactDOM.preload('b', {as: 'image'});
      return (
        <html>
          <body>
            <link rel="stylesheet" href="foo" precedence="default" />
            <img src="1" />
            <img src="2" />
            <img src="3" />
            <img src="4" />
            <img src="5" />
            <img src="6" />
            <img src="7" />
            <img src="8" />
            <img src="9" />
            <img src="10" />
            <img src="11" />
            <img src="12" />
            <img src="a" fetchPriority="low" />
            <img src="a" />
            <img src="a" fetchPriority="high" />
            <img src="a" />
            <img src="a" />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          {/* 前 10 张高优先级图片就是最先渲染的 10 张图片。 */}
          <link rel="preload" as="image" href="1" />
          <link rel="preload" as="image" href="2" />
          <link rel="preload" as="image" href="3" />
          <link rel="preload" as="image" href="4" />
          <link rel="preload" as="image" href="5" />
          <link rel="preload" as="image" href="6" />
          <link rel="preload" as="image" href="7" />
          <link rel="preload" as="image" href="8" />
          <link rel="preload" as="image" href="9" />
          <link rel="preload" as="image" href="10" />
          {/*
            图片 "a" 被渲染了多次；其中至少一次带 fetchPriority="high"，所以最终进入高优先级队列。
          */}
          <link rel="preload" as="image" href="a" />
          {/* 样式表位于高优先级图像和常规预加载之间。 */}
          <link rel="stylesheet" href="foo" data-precedence="default" />
          {/* 剩余的在常规优先级下预加载的图像 */}
          <link rel="preload" as="image" href="b" />
          <link rel="preload" as="image" href="11" />
          <link rel="preload" as="image" href="12" />
        </head>
        <body>
          <img src="1" />
          <img src="2" />
          <img src="3" />
          <img src="4" />
          <img src="5" />
          <img src="6" />
          <img src="7" />
          <img src="8" />
          <img src="9" />
          <img src="10" />
          <img src="11" />
          <img src="12" />
          <img src="a" fetchpriority="low" />
          <img src="a" />
          <img src="a" fetchpriority="high" />
          <img src="a" />
          <img src="a" />
        </body>
      </html>,
    );
  });

  /** 显式preload ss1及ss2/s2，再渲染四张srcSet/sizes图片；head输出四个响应式键且不带href，前两项与API调用去重，后两项由img自动发现。 */
  it('preloads from rendered images properly use srcSet and sizes', async () => {

    /** 显式声明ss1、ss2/s2图像提示，再渲染相同两项与ss3、ss4/s4新项，检查srcSet/sizes键和去重。
     * @returns 四图文档。 */
    function App() {
      ReactDOM.preload('1', {as: 'image', imageSrcSet: 'ss1'});
      ReactDOM.preload('2', {
        as: 'image',
        imageSrcSet: 'ss2',
        imageSizes: 's2',
      });
      return (
        <html>
          <body>
            <img src="1" srcSet="ss1" />
            <img src="2" srcSet="ss2" sizes="s2" />
            <img src="3" srcSet="ss3" />
            <img src="4" srcSet="ss4" sizes="s4" />
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" as="image" imagesrcset="ss1" />
          <link rel="preload" as="image" imagesrcset="ss2" imagesizes="s2" />
          <link rel="preload" as="image" imagesrcset="ss3" />
          <link rel="preload" as="image" imagesrcset="ss4" imagesizes="s4" />
        </head>
        <body>
          <img src="1" srcset="ss1" />
          <img src="2" srcset="ss2" sizes="s2" />
          <img src="3" srcset="ss3" />
          <img src="4" srcset="ss4" sizes="s4" />
        </body>
      </html>,
    );
  });

  /** 四张img分别在src或srcSet使用data:前缀，包含src=data但srcSet普通和src普通但srcSet=data的对照；head保持空，原img属性保留，data输入不生成自动预加载。 */
  it('should not preload images that have a data URIs for src or srcSet', async () => {

    /** 返回四种src/srcSet含data前缀的组合，让自动图片预加载跳过这些内联输入。
     * @returns 图片文档。 */
    function App() {
      return (
        <html>
          <body>
            <img src="data:1" />
            <img src="data:2" srcSet="ss2" />
            <img srcSet="data:3a, data:3b 2x" />
            <img src="4" srcSet="data:4a, data4b 2x" />
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <img src="data:1" />
          <img src="data:2" srcset="ss2" />
          <img srcset="data:3a, data:3b 2x" />
          <img src="4" srcset="data:4a, data4b 2x" />
        </body>
      </html>,
    );
  });

  // https://github.com/vercel/next.js/discussions/54799

  /** 两个picture分别含普通img与webp source+jpg fallback；SSR保留picture/source结构且head无preload，避免以img fallback替代picture候选选择。 */
  it('omits preloads when an <img> is inside a <picture>', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <picture>
              <img src="foo" />
            </picture>
            <picture>
              <source type="image/webp" srcSet="webpsrc" />
              <img src="jpg fallback" />
            </picture>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <picture>
            <img src="foo" />
          </picture>
          <picture>
            <source type="image/webp" srcset="webpsrc" />
            <img src="jpg fallback" />
          </picture>
        </body>
      </html>,
    );
  });

  // 修复：https://github.com/facebook/react/issues/27910

  /** 普通foo图片旁边的noscript内有bar图片；head仅foo preload，noscript内容作为转义文本保留，没有bar提示，验证noscript上下文抑制资源发现。 */
  it('omits preloads for images inside noscript tags', async () => {

    /** 返回普通foo与noscript内bar图片，以普通自动提示对照被抑制的noscript上下文。
     * @returns 文档。 */
    function App() {
      return (
        <html>
          <body>
            <img src="foo" />
            <noscript>
              <img src="bar" />
            </noscript>
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" href="foo" as="image" />
        </head>
        <body>
          <img src="foo" />
          <noscript>&lt;img src="bar"&gt;</noscript>
        </body>
      </html>,
    );
  });

  /** SSR/server与后续client响应式preload分别带print和screen媒体条件；hydrate复用server项，isClient轮追加client项，两条link保持各自media，未模拟图片媒体实际下载。 */
  it('should handle media on image preload', async () => {

    /** 声明server响应式图片与print媒体条件，isClient轮再声明client与screen条件。
     * @param props isClient控制是否追加client预加载。
     * @returns hello文档。 */
    function App({isClient}) {
      ReactDOM.preload('/server', {
        as: 'image',
        imageSrcSet: '/server',
        imageSizes: '100vw',
        media: 'print and (min-width: 768px)',
      });

      if (isClient) {
        ReactDOM.preload('/client', {
          as: 'image',
          imageSrcSet: '/client',
          imageSizes: '100vw',
          media: 'screen and (max-width: 480px)',
        });
      }

      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            media="print and (min-width: 768px)"
          />
        </head>
        <body>hello</body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            media="print and (min-width: 768px)"
          />
        </head>
        <body>hello</body>
      </html>,
    );

    root.render(<App isClient={true} />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="preload"
            as="image"
            imagesrcset="/server"
            imagesizes="100vw"
            media="print and (min-width: 768px)"
          />
          <link
            rel="preload"
            as="image"
            imagesrcset="/client"
            imagesizes="100vw"
            media="screen and (max-width: 480px)"
          />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  /** 先preload foo为外链style，随后同href渲染内联style；DEV报同键预加载/内联冲突，head仍含内联style与原preload，body hello保留，测试诊断与实际输出共存。 */
  it('should warn if you preload a stylesheet and then render a style tag with the same href', async () => {
    const style = 'body { color: red; }';

    /** 先把foo作为外链style预加载，再同键返回内联CSS，制造DEV资源形式冲突。
     * @returns hello与内联style文档。 */
    function App() {
      ReactDOM.preload('foo', {as: 'style'});
      return (
        <html>
          <body>
            hello
            <style precedence="default" href="foo">
              {style}
            </style>
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    assertConsoleErrorDev([
      'React encountered a hoistable style tag for the same href as a preload: "foo". ' +
        'When using a style tag to inline styles you should not also preload it as a stylsheet.\n' +
        '    in style (at **)\n' +
        '    in App (at **)',
    ]);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <style data-precedence="default" data-href="foo">
            {style}
          </style>
          <link rel="preload" as="style" href="foo" />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  /** 覆盖shell/late/later发现时机与preload/preinit/渲染的style、script、module三类组合；逐阶段核对旧资源不补重复preload、晚到style按组进入head而script流入body，派样式load后hydrate补缺失的两个preinit样式并显示Late/Later。 */
  it('should preload only once even if you discover a stylesheet, script, or moduleScript late', async () => {

    /** 构造shell内preinit/preload/直接资源的交叉组合，并返回等待late/later的两个边界；URL前后缀表示首次提示与实际资源发现的时机。
     * @returns shell资源与两pending边界的文档。 */
    function App() {
      // 我们首先初始化一些资源。
      ReactDOM.preinit('shell preinit/shell', {as: 'style'});
      ReactDOM.preinit('shell preinit/shell', {as: 'script'});
      ReactDOM.preinitModule('shell preinit/shell', {as: 'script'});

      // 发起所有 shell preload。
      ReactDOM.preload('shell preinit/shell', {as: 'style'});
      ReactDOM.preload('shell preinit/shell', {as: 'script'});
      ReactDOM.preloadModule('shell preinit/shell', {as: 'script'});

      ReactDOM.preload('shell/shell preinit', {as: 'style'});
      ReactDOM.preload('shell/shell preinit', {as: 'script'});
      ReactDOM.preloadModule('shell/shell preinit', {as: 'script'});

      ReactDOM.preload('shell/shell render', {as: 'style'});
      ReactDOM.preload('shell/shell render', {as: 'script'});
      ReactDOM.preloadModule('shell/shell render');

      ReactDOM.preload('shell/late preinit', {as: 'style'});
      ReactDOM.preload('shell/late preinit', {as: 'script'});
      ReactDOM.preloadModule('shell/late preinit');

      ReactDOM.preload('shell/late render', {as: 'style'});
      ReactDOM.preload('shell/late render', {as: 'script'});
      ReactDOM.preloadModule('shell/late render');

      // 我们稍后初始化那些应该由后续创建的。
      ReactDOM.preinit('shell/shell preinit', {as: 'style'});
      ReactDOM.preinit('shell/shell preinit', {as: 'script'});
      ReactDOM.preinitModule('shell/shell preinit');

      ReactDOM.preinit('late/shell preinit', {as: 'style'});
      ReactDOM.preinit('late/shell preinit', {as: 'script'});
      ReactDOM.preinitModule('late/shell preinit');
      return (
        <html>
          <body>
            <link
              rel="stylesheet"
              precedence="default"
              href="shell/shell render"
            />
            <script async={true} src="shell/shell render" />
            <script type="module" async={true} src="shell/shell render" />
            <link
              rel="stylesheet"
              precedence="default"
              href="late/shell render"
            />
            <script async={true} src="late/shell render" />
            <script type="module" async={true} src="late/shell render" />
            <Suspense fallback="late...">
              <BlockedOn value="late">
                <Late />
              </BlockedOn>
            </Suspense>
            <Suspense fallback="later...">
              <BlockedOn value="later">
                <Later />
              </BlockedOn>
            </Suspense>
          </body>
        </html>
      );
    }

    /** late文本解锁后为later资源发预加载，为已在shell出现的资源重复提示，再preinit shell/late组并直接渲染对应资源。
     * @returns Late文本与style/普通脚本/module脚本Fragment。 */
    function Late() {
      ReactDOM.preload('late/later preinit', {as: 'style'});
      ReactDOM.preload('late/later preinit', {as: 'script'});
      ReactDOM.preloadModule('late/later preinit');

      ReactDOM.preload('late/later render', {as: 'style'});
      ReactDOM.preload('late/later render', {as: 'script'});
      ReactDOM.preloadModule('late/later render');

      ReactDOM.preload('late/shell preinit', {as: 'style'});
      ReactDOM.preload('late/shell preinit', {as: 'script'});
      ReactDOM.preloadModule('late/shell preinit');

      ReactDOM.preload('late/shell render', {as: 'style'});
      ReactDOM.preload('late/shell render', {as: 'script'});
      ReactDOM.preloadModule('late/shell render');

      // 后期 preinit 不会真正冲刷，因此 DOM 中不会出现该 stylesheet，但应能看到该资源的 preload。
      ReactDOM.preinit('shell/late preinit', {as: 'style'});
      ReactDOM.preinit('shell/late preinit', {as: 'script'});
      ReactDOM.preinitModule('shell/late preinit');
      return (
        <>
          Late
          <link
            rel="stylesheet"
            precedence="default"
            href="shell/late render"
          />
          <script async={true} src="shell/late render" />
          <script type="module" async={true} src="shell/late render" />
        </>
      );
    }

    /** 最后一个文本解锁后preinit late/later组并直接渲染同阶段资源，对比已发preload是否重复。
     * @returns Later文本与三类资源Fragment。 */
    function Later() {
      // 后期 preinit 不会真正冲刷，因此 DOM 中不会出现该 stylesheet，但应能看到该资源的 preload。
      ReactDOM.preinit('late/later preinit', {as: 'style'});
      ReactDOM.preinit('late/later preinit', {as: 'script'});
      ReactDOM.preinitModule('late/later preinit');
      return (
        <>
          Later
          <link
            rel="stylesheet"
            precedence="default"
            href="late/later render"
          />
          <script async={true} src="late/later render" />
          <script type="module" async={true} src="late/later render" />
        </>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell preinit/shell"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell render"
          />
          <script async="" src="shell preinit/shell" />
          <script async="" src="shell preinit/shell" type="module" />
          <script async="" src="shell/shell preinit" />
          <script async="" src="shell/shell preinit" type="module" />
          <script async="" src="late/shell preinit" />
          <script async="" src="late/shell preinit" type="module" />
          <script async="" src="shell/shell render" />
          <script async="" src="shell/shell render" type="module" />
          <script async="" src="late/shell render" />
          <script async="" src="late/shell render" type="module" />
          <link rel="preload" as="style" href="shell/late preinit" />
          <link rel="preload" as="script" href="shell/late preinit" />
          <link rel="modulepreload" href="shell/late preinit" />
          <link rel="preload" as="style" href="shell/late render" />
          <link rel="preload" as="script" href="shell/late render" />
          <link rel="modulepreload" href="shell/late render" />
        </head>
        <body>
          {'late...'}
          {'later...'}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('late');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell preinit/shell"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell render"
          />
          {/* 从这里 */}
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/late render"
          />
          {/**
           * 到这里：该节点由 boundary completion 指令提升。preload 已在 shell 中发出，但因为这里按
           * precedence 在客户端插入，所以仍会出现在下方。"shell/late preinit" 只有随 shell 一起冲刷
           * 才会出现，因此这里观察不到。
           */}
          <script async="" src="shell preinit/shell" />
          <script async="" src="shell preinit/shell" type="module" />
          <script async="" src="shell/shell preinit" />
          <script async="" src="shell/shell preinit" type="module" />
          <script async="" src="late/shell preinit" />
          <script async="" src="late/shell preinit" type="module" />
          <script async="" src="shell/shell render" />
          <script async="" src="shell/shell render" type="module" />
          <script async="" src="late/shell render" />
          <script async="" src="late/shell render" type="module" />
          <link rel="preload" as="style" href="shell/late preinit" />
          <link rel="preload" as="script" href="shell/late preinit" />
          <link rel="modulepreload" href="shell/late preinit" />
          <link rel="preload" as="style" href="shell/late render" />
          <link rel="preload" as="script" href="shell/late render" />
          <link rel="modulepreload" href="shell/late render" />
        </head>
        <body>
          {'late...'}
          {'later...'}
          {/* 从这里 */}
          <script async="" src="shell/late preinit" />
          <script async="" src="shell/late preinit" type="module" />
          <script async="" src="shell/late render" />
          <script async="" src="shell/late render" type="module" />
          <link rel="preload" as="style" href="late/later preinit" />
          <link rel="preload" as="script" href="late/later preinit" />
          <link rel="modulepreload" href="late/later preinit" />
          <link rel="preload" as="style" href="late/later render" />
          <link rel="preload" as="script" href="late/later render" />
          <link rel="modulepreload" href="late/later render" />
          {/**
           * 到这里：这些资源在 boundary 冲刷期间流入 body。按流式队列优先级先发 script，再发 preload。
           * 另请注意，late/shell 资源若已在 shell 中发出、之后才调用 preload，文档中根本不会出现 preload。
           */}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('later');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell preinit/shell"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/late render"
          />
          {/* 从这里 */}
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/later render"
          />
          {/**
           * 到这里：该节点由 boundary completion 指令提升。preload 已在 shell 中发出，但因为这里按
           * precedence 在客户端插入，所以仍会出现在下方。"late/later preinit" 只有随 shell 一起冲刷
           * 才会出现，因此这里观察不到。
           */}
          <script async="" src="shell preinit/shell" />
          <script async="" src="shell preinit/shell" type="module" />
          <script async="" src="shell/shell preinit" />
          <script async="" src="shell/shell preinit" type="module" />
          <script async="" src="late/shell preinit" />
          <script async="" src="late/shell preinit" type="module" />
          <script async="" src="shell/shell render" />
          <script async="" src="shell/shell render" type="module" />
          <script async="" src="late/shell render" />
          <script async="" src="late/shell render" type="module" />
          <link rel="preload" as="style" href="shell/late preinit" />
          <link rel="preload" as="script" href="shell/late preinit" />
          <link rel="modulepreload" href="shell/late preinit" />
          <link rel="preload" as="style" href="shell/late render" />
          <link rel="preload" as="script" href="shell/late render" />
          <link rel="modulepreload" href="shell/late render" />
        </head>
        <body>
          {'late...'}
          {'later...'}
          <script async="" src="shell/late preinit" />
          <script async="" src="shell/late preinit" type="module" />
          <script async="" src="shell/late render" />
          <script async="" src="shell/late render" type="module" />
          <link rel="preload" as="style" href="late/later preinit" />
          <link rel="preload" as="script" href="late/later preinit" />
          <link rel="modulepreload" href="late/later preinit" />
          <link rel="preload" as="style" href="late/later render" />
          <link rel="preload" as="script" href="late/later render" />
          <link rel="modulepreload" href="late/later render" />
          {/* 从这里 */}
          <script async="" src="late/later preinit" />
          <script async="" src="late/later preinit" type="module" />
          <script async="" src="late/later render" />
          <script async="" src="late/later render" type="module" />
          {/**
           * 到这里：这些资源在 boundary 冲刷期间流入 body。按流式队列优先级先发 script，再发 preload。
           */}
        </body>
      </html>,
    );
    loadStylesheets();
    // 先冲刷样式，再冲刷 boundary。
    await 0;
    await 0;
    jest.runAllTimers();
    assertLog([
      'load stylesheet: shell preinit/shell',
      'load stylesheet: shell/shell preinit',
      'load stylesheet: late/shell preinit',
      'load stylesheet: shell/shell render',
      'load stylesheet: late/shell render',
      'load stylesheet: shell/late render',
      'load stylesheet: late/later render',
    ]);

    ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell preinit/shell"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/shell render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/late render"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/later render"
          />
          {/* 从这里 */}
          <link
            rel="stylesheet"
            data-precedence="default"
            href="shell/late preinit"
          />
          <link
            rel="stylesheet"
            data-precedence="default"
            href="late/later preinit"
          />
          {/**
           * 到这里：hydration 发生时，客户端渲染会补入缺失的两个 preinit stylesheet。之所以如此，只是
           * 因为客户端重复调用了 preinit。
           */}
          <script async="" src="shell preinit/shell" />
          <script async="" src="shell preinit/shell" type="module" />
          <script async="" src="shell/shell preinit" />
          <script async="" src="shell/shell preinit" type="module" />
          <script async="" src="late/shell preinit" />
          <script async="" src="late/shell preinit" type="module" />
          <script async="" src="shell/shell render" />
          <script async="" src="shell/shell render" type="module" />
          <script async="" src="late/shell render" />
          <script async="" src="late/shell render" type="module" />
          <link rel="preload" as="style" href="shell/late preinit" />
          <link rel="preload" as="script" href="shell/late preinit" />
          <link rel="modulepreload" href="shell/late preinit" />
          <link rel="preload" as="style" href="shell/late render" />
          <link rel="preload" as="script" href="shell/late render" />
          <link rel="modulepreload" href="shell/late render" />
        </head>
        <body>
          {'Late'}
          {'Later'}
          <script async="" src="shell/late preinit" />
          <script async="" src="shell/late preinit" type="module" />
          <script async="" src="shell/late render" />
          <script async="" src="shell/late render" type="module" />
          <link rel="preload" as="style" href="late/later preinit" />
          <link rel="preload" as="script" href="late/later preinit" />
          <link rel="modulepreload" href="late/later preinit" />
          <link rel="preload" as="style" href="late/later render" />
          <link rel="preload" as="script" href="late/later render" />
          <link rel="modulepreload" href="late/later render" />
          <script async="" src="late/later preinit" />
          <script async="" src="late/later preinit" type="module" />
          <script async="" src="late/later render" />
          <script async="" src="late/later render" type="module" />
        </body>
      </html>,
    );
  });

  /** 三个边界的fallback含meta/title/link及内层已完成边界；首两primary随shell显示时head仅primary1/2，第三fallback的可提升项不输出，解second后primary3替换fallback且晚到meta留body，断言fallback hoistables被忽略。 */
  it('does not flush hoistables for fallbacks', async () => {

    /** 并列三个primary/fallback组合，fallback内放不同hoistable与已完成嵌套边界，测试只提升primary发现的资源。
     * @returns html文档。 */
    function App() {
      return (
        <html>
          <body>
            <Suspense
              fallback={
                <>
                  <div>fallback1</div>
                  <meta name="fallback1" />
                  <title>foo</title>
                </>
              }>
              <>
                <div>primary1</div>
                <meta name="primary1" />
              </>
            </Suspense>
            <Suspense
              fallback={
                <>
                  <div>fallback2</div>
                  <meta name="fallback2" />
                  <link rel="foo" href="bar" />
                </>
              }>
              <>
                <div>primary2</div>
                <BlockedOn value="first">
                  <meta name="primary2" />
                </BlockedOn>
              </>
            </Suspense>
            <Suspense
              fallback={
                <>
                  <div>fallback3</div>
                  <meta name="fallback3" />
                  <Suspense fallback="deep">
                    <div>deep fallback ... primary content</div>
                    <meta name="deep fallback" />
                  </Suspense>
                </>
              }>
              <>
                <div>primary3</div>
                <BlockedOn value="second">
                  <meta name="primary3" />
                </BlockedOn>
              </>
            </Suspense>
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
      resolveText('first');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta name="primary1" />
          <meta name="primary2" />
        </head>
        <body>
          <div>primary1</div>
          <div>primary2</div>
          <div>fallback3</div>
          <div>deep fallback ... primary content</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('second');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta name="primary1" />
          <meta name="primary2" />
        </head>
        <body>
          <div>primary1</div>
          <div>primary2</div>
          <div>primary3</div>
          <meta name="primary3" />
        </body>
      </html>,
    );
  });

  /** 外层primary等待release，而fallback内Suspense已完成并含nested primary meta；输出fallback div但不输出其meta，head却保留外层已发现的primary1 meta，解release后body换primary1，区分fallback与primary资源归属。 */
  it('avoids flushing hoistables from completed boundaries nested inside fallbacks', async () => {

    /** 外边界primary等待release，fallback内边界立即完成；两路径meta不同，观察已完成fallback也不会冲刷可提升元素。
     * @returns 嵌套边界文档。 */
    function App() {
      return (
        <html>
          <body>
            <Suspense
              fallback={
                <Suspense
                  fallback={
                    <>
                      <div>nested fallback1</div>
                      <meta name="nested fallback1" />
                    </>
                  }>
                  <>
                    <div>nested primary1</div>
                    <meta name="nested primary1" />
                  </>
                </Suspense>
              }>
              <BlockedOn value="release" />
              <>
                <div>primary1</div>
                <meta name="primary1" />
              </>
            </Suspense>
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          {/* 内容 hoistables 发出的主要内容。 */}
          <meta name="primary1" />
        </head>
        <body>
          {/*
            fallback 内容会发出，但 hoistable 不会；即使它们位于已经 resolve 的嵌套 Suspense boundary 中也是如此。
          */}
          <div>nested primary1</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('release');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <meta name="primary1" />
        </head>
        <body>
          <div>primary1</div>
        </body>
      </html>,
    );
  });

  /** App先preinit foo脚本再use未解promise，使整个文档preamble未就绪；首轮JSDOM原container完全保持，解promise后才整文档替换并输出foo脚本，资源不能先于文档前导冲刷。 */
  it('should never flush hoistables before the preamble', async () => {
    let resolve;
    const promise = new Promise(res => {
      resolve = res;
    });

    /** render先preinit foo脚本，再use尚未完成的promise，阻住html前导；promise解锁后返回hello文档。
     * @returns html文档；等待阶段由use挂起。 */
    function App() {
      ReactDOM.preinit('foo', {as: 'script'});
      React.use(promise);
      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    // 我们保证默认的 JSDOM 仍然完好无损。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container" />
        </body>
      </html>,
    );

    await act(() => {
      resolve();
    });

    // 我们断言 DOM 已被完全替换，因为流中输出了起始 <html> 标签。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <script async="" src="foo" />
        </head>
        <body>hello</body>
      </html>,
    );
  });

  describe('ReactDOM.prefetchDNS(href)', () => {

    /** App重复prefetchDNS同URL并传空options/crossOrigin错误第二参数；SSR与hydrate各仅一条foo且DEV报两种参数警告，客户端换bar只追加一条bar，DNS提示按href去重。 */
    it('creates a dns-prefetch resource when called', async () => {

      /** 重复prefetchDNS url并故意传两个当前禁用的options输入，跨SSR/hydrate/URL更新观察去重和诊断。
       * @param props url为DNS提示href。
       * @returns hello world文档。 */
      function App({url}) {
        ReactDOM.prefetchDNS(url);
        ReactDOM.prefetchDNS(url);
        ReactDOM.prefetchDNS(url, {});
        ReactDOM.prefetchDNS(url, {crossOrigin: 'use-credentials'});
        return (
          <html>
            <body>hello world</body>
          </html>
        );
      }

      await act(() => {
        renderToPipeableStream(<App url="foo" />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.\n' +
          '    in App (at **)',
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. ' +
          'Browsers do not perform DNS queries using CORS and setting this attribute ' +
          'on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just ' +
          'a single string argument, `href`.\n' +
          '    in App (at **)',
      ]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="dns-prefetch" href="foo" />
          </head>
          <body>hello world</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(document, <App url="foo" />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.\n' +
          '    in App (at **)',
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. ' +
          'Browsers do not perform DNS queries using CORS and setting this attribute ' +
          'on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just ' +
          'a single string argument, `href`.\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="dns-prefetch" href="foo" />
          </head>
          <body>hello world</body>
        </html>,
      );

      root.render(<App url="bar" />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.\n' +
          '    in App (at **)',
        'ReactDOM.prefetchDNS(): Expected only one argument, `href`, ' +
          'but encountered something with type "object" as a second argument instead. ' +
          'This argument is reserved for future options and is currently disallowed. ' +
          'It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. ' +
          'Browsers do not perform DNS queries using CORS and setting this attribute ' +
          'on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just ' +
          'a single string argument, `href`.\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="dns-prefetch" href="foo" />
            <link rel="dns-prefetch" href="bar" />
          </head>
          <body>hello world</body>
        </html>,
      );
    });
  });

  /** 外边界等待两个锁，内fallback分别含completed inner与in fallback inner样式，前者由Unblock在render解锁primary；外层完成并load后head只插仍可见fallback样式，已完成fallback的资源不成为揭示依赖。 */
  it('does not wait for stylesheets of completed fallbacks', async () => {

    /** render中直接resolveText(value)让内层primary完成，避免已显示后又被替换的fallback资源阻塞外层。
     * @param props value为待解锁缓存键。
     * @returns null。 */
    function Unblock({value}) {
      resolveText(value);
      return null;
    }

    /** 外边界等两个文本锁，内层分别有已完成与仍可见fallback的style，区分哪些资源随最终揭示需要安装。
     * @returns 嵌套Suspense文档。 */
    function App() {
      return (
        <html>
          <body>
            <Suspense fallback="loading...">
              <div>hello world</div>
              <BlockedOn value="unblock inner boundaries">
                <Suspense
                  fallback={
                    <>
                      <link
                        rel="stylesheet"
                        href="completed inner"
                        precedence="default"
                      />
                      <div>inner fallback</div>
                      <Unblock value="completed inner" />
                    </>
                  }>
                  <BlockedOn value="completed inner" />
                  <div>inner boundary</div>
                </Suspense>
                <Suspense
                  fallback={
                    <>
                      <link
                        rel="stylesheet"
                        href="in fallback inner"
                        precedence="default"
                      />
                      <div>inner blocked fallback</div>
                    </>
                  }>
                  <BlockedOn value="in fallback inner" />
                  <div>inner blocked boundary</div>
                </Suspense>
              </BlockedOn>
              <BlockedOn value="complete root" />
            </Suspense>
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );

    await act(async () => {
      resolveText('unblock inner boundaries');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          loading...
          <link rel="preload" href="completed inner" as="style" />
          <link rel="preload" href="in fallback inner" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('completed inner');
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          loading...
          <link rel="preload" href="completed inner" as="style" />
          <link rel="preload" href="in fallback inner" as="style" />
        </body>
      </html>,
    );

    await act(() => {
      resolveText('complete root');
    });
    await act(() => {
      loadStylesheets();
    });
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            href="in fallback inner"
            data-precedence="default"
          />
        </head>
        <body>
          <div>hello world</div>
          <div>inner boundary</div>
          <div>inner blocked fallback</div>
          <link rel="preload" href="completed inner" as="style" />
          <link rel="preload" href="in fallback inner" as="style" />
        </body>
      </html>,
    );
  });

  /** enableSuspenseList下forwards/visible列表先由外层bar锁阻塞；解foo后CSS已插但未load，解bar/baz仍各行fallback，foo样式load后foo/bar/baz一起显示，后行受首行CSS揭示顺序约束。 */
  // @gate enableSuspenseList

  it('delays "forwards" SuspenseList rows until the css of previous rows have completed', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="loading...">
              <SuspenseList revealOrder="forwards" tail="visible">
                <Suspense fallback="loading foo...">
                  <BlockedOn value="foo">
                    <link rel="stylesheet" href="foo" precedence="foo" />
                    foo
                  </BlockedOn>
                </Suspense>
                <Suspense fallback="loading bar...">bar</Suspense>
                <BlockedOn value="bar">
                  <Suspense fallback="loading baz...">
                    <BlockedOn value="baz">baz</BlockedOn>
                  </Suspense>
                </BlockedOn>
              </SuspenseList>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );

    // 解锁foo文本，让CSS资源被发现；此时尚未派stylesheet load。
    await act(() => {
      resolveText('foo');
    });

    // "bar" 仍在阻塞整个列表
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'loading...'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );

    // 解锁内加载状态
    await act(() => {
      resolveText('bar');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'loading foo...'}
          {'loading bar...'}
          {'loading baz...'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );

    // 解决最后一个边界
    await act(() => {
      resolveText('baz');
    });

    // 在第一行的 CSS 中仍然被封锁
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'loading foo...'}
          {'loading bar...'}
          {'loading baz...'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );

    await act(() => {
      loadStylesheets();
    });
    await assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          {'baz'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );
  });

  /** enableSuspenseList下together列表第一行等foo文本与样式，第二行bar已完成；解foo只插CSS与preload而两行仍fallback，样式load后共同显示foo/bar。 */
  // @gate enableSuspenseList

  it('delays "together" SuspenseList rows until the css of previous rows have completed', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <SuspenseList revealOrder="together">
              <Suspense fallback="loading foo...">
                <BlockedOn value="foo">
                  <link rel="stylesheet" href="foo" precedence="foo" />
                  foo
                </BlockedOn>
              </Suspense>
              <Suspense fallback="loading bar...">bar</Suspense>
            </SuspenseList>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'loading foo...'}
          {'loading bar...'}
        </body>
      </html>,
    );

    await act(() => {
      resolveText('foo');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'loading foo...'}
          {'loading bar...'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );

    await act(() => {
      loadStylesheets();
    });
    await assertLog(['load stylesheet: foo']);
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="foo" data-precedence="foo" />
        </head>
        <body>
          {'foo'}
          {'bar'}
          <link as="style" href="foo" rel="preload" />
        </body>
      </html>,
    );
  });

  describe('ReactDOM.preconnect(href, { crossOrigin })', () => {

    /** 同URL重复preconnect，分别不带crossOrigin、匿名和use-credentials，布尔true引DEV警告；SSR/hydrate只有三种模式各一条，换bar又加三条，连接提示按URL和模式区分。 */
    it('creates a preconnect resource when called', async () => {

      /** 重复preconnect url并给出无模式/布尔/匿名/凭证输入，用于比较模式键、非法类型警告与新URL追加。
       * @param props url为连接提示目标。
       * @returns hello world文档。 */
      function App({url}) {
        ReactDOM.preconnect(url);
        ReactDOM.preconnect(url);
        ReactDOM.preconnect(url, {crossOrigin: true});
        ReactDOM.preconnect(url, {crossOrigin: ''});
        ReactDOM.preconnect(url, {crossOrigin: 'anonymous'});
        ReactDOM.preconnect(url, {crossOrigin: 'use-credentials'});
        return (
          <html>
            <body>hello world</body>
          </html>
        );
      }

      await act(() => {
        renderToPipeableStream(<App url="foo" />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) ' +
          'to be a string but encountered something with type "boolean" instead. ' +
          'Try removing this option or passing a string value instead.\n' +
          '    in App (at **)',
      ]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preconnect" href="foo" />
            <link rel="preconnect" href="foo" crossorigin="" />
            <link rel="preconnect" href="foo" crossorigin="use-credentials" />
          </head>
          <body>hello world</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(document, <App url="foo" />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) ' +
          'to be a string but encountered something with type "boolean" instead. ' +
          'Try removing this option or passing a string value instead.\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preconnect" href="foo" />
            <link rel="preconnect" href="foo" crossorigin="" />
            <link rel="preconnect" href="foo" crossorigin="use-credentials" />
          </head>
          <body>hello world</body>
        </html>,
      );

      root.render(<App url="bar" />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) ' +
          'to be a string but encountered something with type "boolean" instead. ' +
          'Try removing this option or passing a string value instead.\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preconnect" href="foo" />
            <link rel="preconnect" href="foo" crossorigin="" />
            <link rel="preconnect" href="foo" crossorigin="use-credentials" />
            <link rel="preconnect" href="bar" />
            <link rel="preconnect" href="bar" crossorigin="" />
            <link rel="preconnect" href="bar" crossorigin="use-credentials" />
          </head>
          <body>hello world</body>
        </html>,
      );
    });
  });

  describe('ReactDOM.preload(href, { as: ... })', () => {

    /** SSR render先preload foo style，blocked解锁后子组件发bar script提示进入body；hydrate中render/insertion/layout/passive分别再提示foo/bar/font/baz/qux，foo/bar去重且新增字体匿名，比较各阶段都可发提示。 */
    it('creates a preload resource when called', async () => {

      /** 在shell render中发foo style preload，并等待blocked后让子组件发晚到script提示。
       * @returns 文档与等待边界。 */
      function App() {
        ReactDOM.preload('foo', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="blocked">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }

      /** 解锁后render发bar script preload并返回hello div，晚到提示随body流输出。
       * @returns hello div。 */
      function Component() {
        ReactDOM.preload('bar', {as: 'script'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('blocked');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" as="script" href="bar" />
          </body>
        </html>,
      );

      /** render提示foo与font，insertion/layout/passive分别提示bar/baz/qux；hydrate相同hello树并观察旧提示复用和新项插入。
       * @returns 文档树。 */
      function ClientApp() {
        ReactDOM.preload('foo', {as: 'style'});
        ReactDOM.preload('font', {as: 'font', type: 'font/woff2'});
        React.useInsertionEffect(() => ReactDOM.preload('bar', {as: 'script'}));
        React.useLayoutEffect(() => ReactDOM.preload('baz', {as: 'font'}));
        React.useEffect(() => ReactDOM.preload('qux', {as: 'style'}));
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }
      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="style" href="foo" />
            <link
              rel="preload"
              as="font"
              href="font"
              crossorigin=""
              type="font/woff2"
            />
            <link rel="preload" as="font" href="baz" crossorigin="" />
            <link rel="preload" as="style" href="qux" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" as="script" href="bar" />
          </body>
        </html>,
      );
    });

    /** SSR先preload foo style带credentials/integrity/low，再render同URL stylesheet但未给连接属性；最终stylesheet继承credentials和integrity、不带fetchpriority且无独立preload。本例未构造script资源，标题范围较广。 */
    it('can seed connection props for stylesheet and script resources', async () => {

      /** 先给foo style预加载设置连接属性，再直接渲染缺省连接属性的foo stylesheet，观察资源吸收preload的CORS/integrity。
       * @returns hello与stylesheet文档。 */
      function App() {
        ReactDOM.preload('foo', {
          as: 'style',
          crossOrigin: 'use-credentials',
          integrity: 'some hash',
          fetchPriority: 'low',
        });
        return (
          <html>
            <body>
              <div>hello</div>
              <link rel="stylesheet" href="foo" precedence="default" />
            </body>
          </html>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="foo"
              data-precedence="default"
              crossorigin="use-credentials"
              integrity="some hash"
            />
          </head>
          <body>
            <div>hello</div>
          </body>
        </html>,
      );
    });

    /** App依次preload缺参、空href、null options、缺as与字符串as=foo；DEV断言前四种错误，非空as字符串foo未在此期望额外警告，核对当前参数校验边界。 */
    it('warns if you do not pass in a valid href argument or options argument', async () => {

      /** 构造四种缺失/类型错误preload参数及非空as字符串foo；测试诊断当前公开参数校验。
       * @returns foo div。 */
      function App() {
        ReactDOM.preload();
        ReactDOM.preload('');
        ReactDOM.preload('foo', null);
        ReactDOM.preload('foo', {});
        ReactDOM.preload('foo', {as: 'foo'});
        return <div>foo</div>;
      }

      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an ' +
          '`options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag. ' +
          'The `href` argument encountered was `undefined`. ' +
          'The `options` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an ' +
          '`options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag. ' +
          'The `href` argument encountered was an empty string. ' +
          'The `options` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an ' +
          '`options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag. ' +
          'The `options` argument encountered was `null`.\n' +
          '    in App (at **)',
        'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an ' +
          '`options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag. ' +
          'The `as` option encountered was `undefined`.\n' +
          '    in App (at **)',
      ]);
    });

    /** SSR组件提示high script、low style、auto style三URL，再hydrate以client后缀新增三项；head六link各保留fetchpriority对应值，验证属性输出而非真实网络优先调度。 */
    it('supports fetchPriority', async () => {

      /** 按isServer选server/client URL，声明high script与low/auto style预加载，比较两端属性。
       * @param props isServer为SSR后缀选择标志。
       * @returns hello文本。 */
      function Component({isServer}) {
        ReactDOM.preload(isServer ? 'highserver' : 'highclient', {
          as: 'script',
          fetchPriority: 'high',
        });
        ReactDOM.preload(isServer ? 'lowserver' : 'lowclient', {
          as: 'style',
          fetchPriority: 'low',
        });
        ReactDOM.preload(isServer ? 'autoserver' : 'autoclient', {
          as: 'style',
          fetchPriority: 'auto',
        });
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component isServer={true} />
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="preload"
              as="script"
              href="highserver"
              fetchpriority="high"
            />
            <link
              rel="preload"
              as="style"
              href="lowserver"
              fetchpriority="low"
            />
            <link
              rel="preload"
              as="style"
              href="autoserver"
              fetchpriority="auto"
            />
          </head>
          <body>hello</body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Component />
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="preload"
              as="script"
              href="highserver"
              fetchpriority="high"
            />
            <link
              rel="preload"
              as="style"
              href="lowserver"
              fetchpriority="low"
            />
            <link
              rel="preload"
              as="style"
              href="autoserver"
              fetchpriority="auto"
            />
            <link
              rel="preload"
              as="script"
              href="highclient"
              fetchpriority="high"
            />
            <link
              rel="preload"
              as="style"
              href="lowclient"
              fetchpriority="low"
            />
            <link
              rel="preload"
              as="style"
              href="autoclient"
              fetchpriority="auto"
            />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** 片段SSR预加载server脚本nonce=abc，link随流进入container；hydrate新client URL则在head追加nonce相同提示，旧body提示仍保留。 */
    it('supports nonce', async () => {

      /** 给脚本preload加nonce=abc，URL随props改变，让片段SSR与hydrate提示位置及nonce都可观察。
       * @param props url为server/client资源键。
       * @returns hello文本。 */
      function App({url}) {
        ReactDOM.preload(url, {as: 'script', nonce: 'abc'});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(<App url="server" />).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <div id="container">
              <link rel="preload" as="script" href="server" nonce="abc" />
              hello
            </div>
          </body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(container, <App url="client" />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="preload" as="script" href="client" nonce="abc" />
          </head>
          <body>
            <div id="container">
              <link rel="preload" as="script" href="server" nonce="abc" />
              hello
            </div>
          </body>
        </html>,
      );
    });
  });

  describe('ReactDOM.preloadModule(href, options)', () => {

    /** preloadModule覆盖默认script、显式script、CORS、integrity与serviceworker；SSR五项在container中，hydrate不同browser前缀在head再加五项，script默认省略as而非script保留as。 */
    it('preloads scripts as modules', async () => {

      /** 按ssr选URL前缀，声明默认/显式script与CORS/integrity/serviceworker的模块预加载输入。
       * @param props ssr控制前缀，不切换API实现本身。
       * @returns hello div。 */
      function App({ssr}) {
        const prefix = ssr ? 'ssr ' : 'browser ';
        ReactDOM.preloadModule(prefix + 'plain');
        ReactDOM.preloadModule(prefix + 'default', {as: 'script'});
        ReactDOM.preloadModule(prefix + 'cors', {
          crossOrigin: 'use-credentials',
        });
        ReactDOM.preloadModule(prefix + 'integrity', {integrity: 'some hash'});
        ReactDOM.preloadModule(prefix + 'serviceworker', {as: 'serviceworker'});
        return <div>hello</div>;
      }
      await act(() => {
        renderToPipeableStream(<App ssr={true} />).pipe(writable);
      });
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <link rel="modulepreload" href="ssr plain" />
          <link rel="modulepreload" href="ssr default" />
          <link
            rel="modulepreload"
            href="ssr cors"
            crossorigin="use-credentials"
          />
          <link
            rel="modulepreload"
            href="ssr integrity"
            integrity="some hash"
          />
          <link
            rel="modulepreload"
            href="ssr serviceworker"
            as="serviceworker"
          />
          <div>hello</div>
        </div>,
      );

      ReactDOMClient.hydrateRoot(container, <App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="modulepreload" href="browser plain" />
            <link rel="modulepreload" href="browser default" />
            <link
              rel="modulepreload"
              href="browser cors"
              crossorigin="use-credentials"
            />
            <link
              rel="modulepreload"
              href="browser integrity"
              integrity="some hash"
            />
            <link
              rel="modulepreload"
              href="browser serviceworker"
              as="serviceworker"
            />
          </head>
          <body>
            <div id="container">
              <link rel="modulepreload" href="ssr plain" />
              <link rel="modulepreload" href="ssr default" />
              <link
                rel="modulepreload"
                href="ssr cors"
                crossorigin="use-credentials"
              />
              <link
                rel="modulepreload"
                href="ssr integrity"
                integrity="some hash"
              />
              <link
                rel="modulepreload"
                href="ssr serviceworker"
                as="serviceworker"
              />
              <div>hello</div>
            </div>
          </body>
        </html>,
      );
    });

    /** 模块预加载high/low/auto三项在SSR使用server后缀，hydrate使用client后缀；六modulepreload均保留各fetchpriority，已有server项仍在。 */
    it('supports fetchPriority', async () => {

      /** 按isServer选URL后缀，对模块提示分别给high/low/auto优先属性。
       * @param props isServer控制server/client键。
       * @returns hello。 */
      function Component({isServer}) {
        const suffix = isServer ? 'server' : 'client';
        ReactDOM.preloadModule('high' + suffix, {
          fetchPriority: 'high',
        });
        ReactDOM.preloadModule('low' + suffix, {
          fetchPriority: 'low',
        });
        ReactDOM.preloadModule('auto' + suffix, {
          fetchPriority: 'auto',
        });
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component isServer={true} />
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="modulepreload" href="highserver" fetchpriority="high" />
            <link rel="modulepreload" href="lowserver" fetchpriority="low" />
            <link rel="modulepreload" href="autoserver" fetchpriority="auto" />
          </head>
          <body>hello</body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Component />
          </body>
        </html>,
      );
      await waitForAll([]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="modulepreload" href="highserver" fetchpriority="high" />
            <link rel="modulepreload" href="lowserver" fetchpriority="low" />
            <link rel="modulepreload" href="autoserver" fetchpriority="auto" />
            <link rel="modulepreload" href="highclient" fetchpriority="high" />
            <link rel="modulepreload" href="lowclient" fetchpriority="low" />
            <link rel="modulepreload" href="autoclient" fetchpriority="auto" />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** SSR对两个不同serviceworker URL使用同as；两份modulepreload均输出且保留serviceworker属性，去重不只按as类型。 */
    it('preloads multiple non-script modules with the same as type', async () => {

      /** 声明两个serviceworker不同URL的modulepreload，检查相同as不会错误合并资源。
       * @returns hello div。 */
      function App() {
        ReactDOM.preloadModule('serviceworker one', {as: 'serviceworker'});
        ReactDOM.preloadModule('serviceworker two', {as: 'serviceworker'});
        return <div>hello</div>;
      }

      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });

      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <link
            rel="modulepreload"
            href="serviceworker one"
            as="serviceworker"
          />
          <link
            rel="modulepreload"
            href="serviceworker two"
            as="serviceworker"
          />
          <div>hello</div>
        </div>,
      );
    });

    /** SSR preloadModule ssr module携nonce=abc进入片段container；hydrate browser module在head生成新提示，nonce继续保留。 */
    it('supports nonce', async () => {

      /** 按ssr选前缀，给modulepreload写nonce=abc，跨SSR/hydrate观察独立URL资源。
       * @param props ssr控制URL前缀。
       * @returns hello div。 */
      function App({ssr}) {
        const prefix = ssr ? 'ssr ' : 'browser ';
        ReactDOM.preloadModule(prefix + 'module', {nonce: 'abc'});
        return <div>hello</div>;
      }
      await act(() => {
        renderToPipeableStream(<App ssr={true} />).pipe(writable);
      });
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <link rel="modulepreload" href="ssr module" nonce="abc" />
          <div>hello</div>
        </div>,
      );

      ReactDOMClient.hydrateRoot(container, <App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document.head)).toEqual(
        <link rel="modulepreload" href="browser module" nonce="abc" />,
      );
    });

    /** 模块预加载缺href、函数href、空href及布尔options/as分别产生五条DEV警告；有效href的1/2即使options或as错误仍输出默认modulepreload，客户端createRoot再跑也产生同类诊断。 */
    it('warns if you provide invalid arguments', async () => {

      /** 提供三种无效href及布尔options/as；有效URL1/2仍可落到默认模块提示，测试警告与输出不是同一拒绝条件。
       * @returns hello div。 */
      function App() {
        ReactDOM.preloadModule();
        ReactDOM.preloadModule(() => {});
        ReactDOM.preloadModule('');
        ReactDOM.preloadModule('1', true);
        ReactDOM.preloadModule('2', {as: true});
        return <div>hello</div>;
      }
      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was something with type "function".\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was an empty string.\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `options` argument encountered was something with type "boolean".\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally,' +
          ' an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `as` option encountered was something with type "boolean".\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <link rel="modulepreload" href="1" />
          <link rel="modulepreload" href="2" />
          <div>hello</div>
        </div>,
      );

      const root = ReactDOMClient.createRoot(
        document.getElementById('container'),
      );
      root.render(<App />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, ' +
          'an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was something with type "function".\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an ' +
          '`options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `href` argument encountered was an empty string.\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an ' +
          '`options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `options` argument encountered was something with type "boolean".\n' +
          '    in App (at **)',
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an ' +
          '`options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag. ' +
          'The `as` option encountered was something with type "boolean".\n' +
          '    in App (at **)',
      ]);
    });
  });

  describe('ReactDOM.preinit(href, { as: ... })', () => {

    /** shell preinit foo style立即输出stylesheet，bar锁后才调用的preinit只发body preload而不阻塞hello；hydrate中重新preinit bar在head补stylesheet，核对服务端晚提示与客户端实际初始化的不同。 */
    it('creates a stylesheet resource when ReactDOM.preinit(..., {as: "style" }) is called', async () => {

      /** shell中preinit foo stylesheet，body边界等bar后再执行另一style preinit，比较先后输出能力。
       * @returns 带等待边界的文档。 */
      function App() {
        ReactDOM.preinit('foo', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="bar">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }

      /** 解bar文本后在server render调用bar style preinit，返回hello；晚preinit不把当前边界声明为CSS依赖。
       * @returns hello div。 */
      function Component() {
        ReactDOM.preinit('bar', {as: 'style'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('bar');
      });
      // 这是因为 "bar" 样式表在这里没有被看到，因为 ReactDOM.preinit 并不是关于编码一个资源依赖，而
      // 是提示一个资源将在不久的将来被使用。 如果我们在服务器上调用 preinit 在 shell 冲刷之后，我们
      // 所能做的就是发出一个 preload，因为任何与该资源相关的冲刷 Suspense boundary 实际上都不依赖于该
      // 资源，所以我们不想基于该资源何时加载来延迟展示。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" href="bar" as="style" />
          </body>
        </html>,
      );

      /** hydrate render重新preinit bar style，让服务端仅发preload的资源在客户端补成stylesheet。
       * @returns 已完成hello文档。 */
      function ClientApp() {
        ReactDOM.preinit('bar', {as: 'style'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }

      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="stylesheet" href="bar" data-precedence="default" />
          </head>
          <body>
            <div>hello</div>
            <link rel="preload" href="bar" as="style" />
          </body>
        </html>,
      );
    });

    /** 客户端App首次passive effect调用foo style preinit；等待effect后head有default stylesheet，body foo保留，API可在render外以ownerDocument插资源。 */
    it('creates a stylesheet resource in the ownerDocument when ReactDOM.preinit(..., {as: "style" }) is called outside of render on the client', async () => {

      /** 首次passive effect中preinit foo style，验证客户端render外入口仍选ownerDocument。
       * @returns body为foo的文档。 */
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'style'});
        }, []);
        return (
          <html>
            <body>foo</body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>foo</body>
        </html>,
      );
    });

    /** 主文档App passive preinit foo，shadow portal内组件render preinit bar；head顺序bar、foo，shadow仅有div shadow而无样式，验证此API使用ownerDocument而非当前shadow资源根。 */
    it('creates a stylesheet resource in the ownerDocument when ReactDOM.preinit(..., {as: "style" }) is called in shadowRoot', async () => {
      // 这里是在验证既有行为，但也说明不宜在 shadowRoot 内调用 preinit；我们断言的正是实际应用中应
      // 避免的行为。
      const shadow = document.body.attachShadow({mode: 'open'});

      /** portal render内preinit bar style；资源进入ownerDocument.head，未进入shadowRoot。
       * @returns null。 */
      function ShadowComponent() {
        ReactDOM.preinit('bar', {as: 'style'});
        return null;
      }

      /** passive preinit foo，并portal ShadowComponent到shadow，比较两调用位置的资源归属。
       * @returns 主文档foo与shadow portal。 */
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'style'});
        }, []);
        return (
          <html>
            <body>
              foo
              {ReactDOM.createPortal(
                <div>
                  <ShadowComponent />
                  shadow
                </div>,
                shadow,
              )}
            </body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="bar" data-precedence="default" />
            <link rel="stylesheet" href="foo" data-precedence="default" />
          </head>
          <body>foo</body>
        </html>,
      );
      expect(getMeaningfulChildren(shadow)).toEqual(<div>shadow</div>);
    });

    /** shell preinit foo script进入head，解bar锁后late preinit bar script随流进入body；hydrate再次preinit bar不重复插脚本，普通hello树正确保留。 */
    it('creates a script resource when ReactDOM.preinit(..., {as: "script" }) is called', async () => {

      /** shell preinit foo script，等待bar文本后让子组件preinit晚到bar script。
       * @returns pending边界文档。 */
      function App() {
        ReactDOM.preinit('foo', {as: 'script'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="bar">
                  <Component />
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }

      /** bar解锁后preinit bar script并返回hello；脚本随晚到流进入body。
       * @returns hello div。 */
      function Component() {
        ReactDOM.preinit('bar', {as: 'script'});
        return <div>hello</div>;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('bar');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>
            <div>hello</div>
            <script async="" src="bar" />
          </body>
        </html>,
      );

      /** hydrate时再preinit bar script，验证与body已有同URL资源复用。
       * @returns hello文档。 */
      function ClientApp() {
        ReactDOM.preinit('bar', {as: 'script'});
        return (
          <html>
            <body>
              <Suspense fallback="loading...">
                <div>hello</div>
              </Suspense>
            </body>
          </html>
        );
      }

      ReactDOMClient.hydrateRoot(document, <ClientApp />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>
            <div>hello</div>
            <script async="" src="bar" />
          </body>
        </html>,
      );
    });

    /** 客户端App passive effect里preinit foo script；等待后head有async foo，body foo未变，render外也可初始化脚本。 */
    it('creates a script resource when ReactDOM.preinit(..., {as: "script" }) is called outside of render on the client', async () => {

      /** passive effect中preinit foo script，测试客户端render外资源登记。
       * @returns foo文档。 */
      function App() {
        React.useEffect(() => {
          ReactDOM.preinit('foo', {as: 'script'});
        }, []);
        return (
          <html>
            <body>foo</body>
          </html>
        );
      }

      const root = ReactDOMClient.createRoot(document);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" />
          </head>
          <body>foo</body>
        </html>,
      );
    });

    /** style/script preinit的缺href、空href、null options、缺as和as=foo依次产生五条DEV错误；合法as限定style/script，比普通preload的非空字符串校验更窄。 */
    it('warns if you do not pass in a valid href argument or options argument', async () => {

      /** 以缺失或非法href/options/as构造五种preinit诊断输入，as=foo不属于style/script支持域。
       * @returns foo div。 */
      function App() {
        ReactDOM.preinit();
        ReactDOM.preinit('');
        ReactDOM.preinit('foo', null);
        ReactDOM.preinit('foo', {});
        ReactDOM.preinit('foo', {as: 'foo'});
        return <div>foo</div>;
      }

      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string ' +
          'but encountered `undefined` instead.\n' +
          '    in App (at **)',
        'ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string ' +
          'but encountered an empty string instead.\n' +
          '    in App (at **)',
        'ReactDOM.preinit(): Expected the `options` argument (second) to be an object with an `as` ' +
          'property describing the type of resource to be preinitialized but encountered `null` instead.\n' +
          '    in App (at **)',
        'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain ' +
          'a valid value describing the type of resource to be preinitialized but encountered `undefined` instead. ' +
          'Valid values for `as` are "style" and "script".\n' +
          '    in App (at **)',
        'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain ' +
          'a valid value describing the type of resource to be preinitialized but encountered "foo" instead. ' +
          'Valid values for `as` are "style" and "script".\n' +
          '    in App (at **)',
      ]);
    });

    /** SSR preinit foo script自身nonce=R4nD0m且render options同nonce；hydrate新bar资源同nonce，head两script各保留nonce，验证资源选项传递。 */
    it('accepts a `nonce` option for `as: "script"`', async () => {

      /** 按src preinit脚本并显式设置资源nonce，SSR与hydrate分别发现不同URL。
       * @param props src为脚本URL。
       * @returns hello。 */
      function Component({src}) {
        ReactDOM.preinit(src, {as: 'script', nonce: 'R4nD0m'});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component src="foo" />
            </body>
          </html>,
          {
            nonce: 'R4nD0m',
          },
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" nonce="R4nD0m" />
          </head>
          <body>hello</body>
        </html>,
      );

      await clientAct(() => {
        ReactDOMClient.hydrateRoot(
          document,
          <html>
            <body>
              <Component src="bar" />
            </body>
          </html>,
        );
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" nonce="R4nD0m" />
            <script async="" src="bar" nonce="R4nD0m" />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** SSR preinit foo script integrity=foo hash，再hydrate新bar/bar hash；head保留两async脚本各自integrity，render options nonce没有自动写入这些用户资源。 */
    it('accepts an `integrity` option for `as: "script"`', async () => {

      /** 按src/hash preinit script，给每个资源单独写integrity，不继承render options nonce。
       * @param props src为URL，hash为对应integrity字符串。
       * @returns hello。 */
      function Component({src, hash}) {
        ReactDOM.preinit(src, {as: 'script', integrity: hash});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component src="foo" hash="foo hash" />
            </body>
          </html>,
          {
            nonce: 'R4nD0m',
          },
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" integrity="foo hash" />
          </head>
          <body>hello</body>
        </html>,
      );

      await clientAct(() => {
        ReactDOMClient.hydrateRoot(
          document,
          <html>
            <body>
              <Component src="bar" hash="bar hash" />
            </body>
          </html>,
        );
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="foo" integrity="foo hash" />
            <script async="" src="bar" integrity="bar hash" />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** SSR preinit foo style integrity=foo hash，再hydrate bar/bar hash；head两default stylesheet各保留integrity，本例render options nonce未出现在样式link。 */
    it('accepts an `integrity` option for `as: "style"`', async () => {

      /** 按src/hash preinit style，检查同组样式link的integrity跨SSR/hydrate输出。
       * @param props src为样式URL，hash为对应integrity字符串。
       * @returns hello。 */
      function Component({src, hash}) {
        ReactDOM.preinit(src, {as: 'style', integrity: hash});
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component src="foo" hash="foo hash" />
            </body>
          </html>,
          {
            nonce: 'R4nD0m',
          },
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="foo"
              integrity="foo hash"
              data-precedence="default"
            />
          </head>
          <body>hello</body>
        </html>,
      );
      await clientAct(() => {
        ReactDOMClient.hydrateRoot(
          document,
          <html>
            <body>
              <Component src="bar" hash="bar hash" />
            </body>
          </html>,
        );
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="foo"
              integrity="foo hash"
              data-precedence="default"
            />
            <link
              rel="stylesheet"
              href="bar"
              integrity="bar hash"
              data-precedence="default"
            />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** preinit high script与low/auto style，SSR/server三项及hydrate/client三项均保留fetchpriority；style按default组排在script前，比较属性而非浏览器下载顺序。 */
    it('supports fetchPriority', async () => {

      /** 按isServer选URL后缀，preinit high脚本与low/auto样式，将优先属性传到实际资源而非仅提示。
       * @param props isServer决定资源URL。
       * @returns hello。 */
      function Component({isServer}) {
        ReactDOM.preinit(isServer ? 'highserver' : 'highclient', {
          as: 'script',
          fetchPriority: 'high',
        });
        ReactDOM.preinit(isServer ? 'lowserver' : 'lowclient', {
          as: 'style',
          fetchPriority: 'low',
        });
        ReactDOM.preinit(isServer ? 'autoserver' : 'autoclient', {
          as: 'style',
          fetchPriority: 'auto',
        });
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component isServer={true} />
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="lowserver"
              fetchpriority="low"
              data-precedence="default"
            />
            <link
              rel="stylesheet"
              href="autoserver"
              fetchpriority="auto"
              data-precedence="default"
            />
            <script async="" src="highserver" fetchpriority="high" />
          </head>
          <body>hello</body>
        </html>,
      );
      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Component />
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="lowserver"
              fetchpriority="low"
              data-precedence="default"
            />
            <link
              rel="stylesheet"
              href="autoserver"
              fetchpriority="auto"
              data-precedence="default"
            />
            <link
              rel="stylesheet"
              href="lowclient"
              fetchpriority="low"
              data-precedence="default"
            />
            <link
              rel="stylesheet"
              href="autoclient"
              fetchpriority="auto"
              data-precedence="default"
            />
            <script async="" src="highserver" fetchpriority="high" />
            <script async="" src="highclient" fetchpriority="high" />
          </head>
          <body>hello</body>
        </html>,
      );
    });
  });

  describe('ReactDOM.preinitModule(href, options)', () => {

    /** 模块preinit覆盖默认/显式script、CORS、integrity与非法style；SSR只输出四async module脚本，非法项警告且不输出，hydrate新browser键在head加四项并重复对应DEV诊断。 */
    it('creates a script module resources', async () => {

      /** 按ssr选前缀，preinitModule默认/显式script、CORS、integrity并以style作非法as输入，比较SSR与hydrate实际脚本输出。
       * @param props ssr只控制URL前缀。
       * @returns hello div。 */
      function App({ssr}) {
        const prefix = ssr ? 'ssr ' : 'browser ';
        ReactDOM.preinitModule(prefix + 'plain');
        ReactDOM.preinitModule(prefix + 'default', {as: 'script'});
        ReactDOM.preinitModule(prefix + 'cors', {
          crossOrigin: 'use-credentials',
        });
        ReactDOM.preinitModule(prefix + 'integrity', {integrity: 'some hash'});
        ReactDOM.preinitModule(prefix + 'warning', {as: 'style'});
        return <div>hello</div>;
      }
      await act(() => {
        renderToPipeableStream(<App ssr={true} />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `as` option encountered was "style".\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <script type="module" src="ssr plain" async="" />
          <script type="module" src="ssr default" async="" />
          <script
            type="module"
            src="ssr cors"
            crossorigin="use-credentials"
            async=""
          />
          <script
            type="module"
            src="ssr integrity"
            integrity="some hash"
            async=""
          />
          <div>hello</div>
        </div>,
      );

      ReactDOMClient.hydrateRoot(container, <App />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `as` option encountered was "style".\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script type="module" src="browser plain" async="" />
            <script type="module" src="browser default" async="" />
            <script
              type="module"
              src="browser cors"
              crossorigin="use-credentials"
              async=""
            />
            <script
              type="module"
              src="browser integrity"
              integrity="some hash"
              async=""
            />
          </head>
          <body>
            <div id="container">
              <script type="module" src="ssr plain" async="" />
              <script type="module" src="ssr default" async="" />
              <script
                type="module"
                src="ssr cors"
                crossorigin="use-credentials"
                async=""
              />
              <script
                type="module"
                src="ssr integrity"
                integrity="some hash"
                async=""
              />
              <div>hello</div>
            </div>
          </body>
        </html>,
      );
    });

    /** preinitModule high/low/auto分别使用server与client URL；SSR三脚本与hydrate三新脚本均为async module并保留fetchpriority，验证实际资源属性传递。 */
    it('supports fetchPriority', async () => {

      /** 按isServer选后缀，初始化high/low/auto三个模块脚本。
       * @param props isServer决定server/client资源键。
       * @returns hello。 */
      function Component({isServer}) {
        const suffix = isServer ? 'server' : 'client';
        ReactDOM.preinitModule('high' + suffix, {
          fetchPriority: 'high',
        });
        ReactDOM.preinitModule('low' + suffix, {
          fetchPriority: 'low',
        });
        ReactDOM.preinitModule('auto' + suffix, {
          fetchPriority: 'auto',
        });
        return 'hello';
      }

      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Component isServer={true} />
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script
              type="module"
              src="highserver"
              fetchpriority="high"
              async=""
            />
            <script
              type="module"
              src="lowserver"
              fetchpriority="low"
              async=""
            />
            <script
              type="module"
              src="autoserver"
              fetchpriority="auto"
              async=""
            />
          </head>
          <body>hello</body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Component />
          </body>
        </html>,
      );
      await waitForAll([]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script
              type="module"
              src="highserver"
              fetchpriority="high"
              async=""
            />
            <script
              type="module"
              src="lowserver"
              fetchpriority="low"
              async=""
            />
            <script
              type="module"
              src="autoserver"
              fetchpriority="auto"
              async=""
            />
            <script
              type="module"
              src="highclient"
              fetchpriority="high"
              async=""
            />
            <script
              type="module"
              src="lowclient"
              fetchpriority="low"
              async=""
            />
            <script
              type="module"
              src="autoclient"
              fetchpriority="auto"
              async=""
            />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** preinitModule缺href、函数、空串、布尔options、布尔as产生五条DEV警告且不生成脚本；客户端createRoot再执行同输入也报五类，区别于preloadModule对有效href的默认提示输出。 */
    it('warns if you provide invalid arguments', async () => {

      /** 构造五种无效模块初始化参数，检查DEV诊断且不输出对应script。
       * @returns hello div。 */
      function App() {
        ReactDOM.preinitModule();
        ReactDOM.preinitModule(() => {});
        ReactDOM.preinitModule('');
        ReactDOM.preinitModule('1', true);
        ReactDOM.preinitModule('2', {as: true});
        return <div>hello</div>;
      }
      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });
      assertConsoleErrorDev([
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was something with type "function".\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was an empty string.\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `options` argument encountered was something with type "boolean".\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `as` option encountered was something with type "boolean".\n' +
          '    in App (at **)',
      ]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div id="container">
          <div>hello</div>
        </div>,
      );

      const root = ReactDOMClient.createRoot(
        document.getElementById('container'),
      );
      root.render(<App />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was `undefined`.\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was something with type "function".\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `href` argument encountered was an empty string.\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `options` argument encountered was something with type "boolean".\n' +
          '    in App (at **)',
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` ' +
          'string and, optionally, an `options` object with a valid `as` property. ' +
          'The `as` option encountered was something with type "boolean".\n' +
          '    in App (at **)',
      ]);
    });
  });

  describe('Stylesheet Resources', () => {

    /** SSR body内aresource stylesheet带precedence=foo，输出提升到head并转data-precedence，body只保留hello world div。 */
    it('treats link rel stylesheet elements as a stylesheet resource when it includes a precedence when server rendering', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <link rel="stylesheet" href="aresource" precedence="foo" />
              <div>hello world</div>
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="aresource" data-precedence="foo" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
      );
    });

    /** 客户端同样从body声明aresource/foo资源，等待并模拟preload和stylesheet load；最后head只有stylesheet、body为hello world，验证客户端资源分类与提升。 */
    it('treats link rel stylesheet elements as a stylesheet resource when it includes a precedence when client rendering', async () => {
      const root = ReactDOMClient.createRoot(document);
      root.render(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="aresource" precedence="foo" />
            <div>hello world</div>
          </body>
        </html>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog([
        'load preload: aresource',
        'load stylesheet: aresource',
      ]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="aresource" data-precedence="foo" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
      );
    });

    /** SSR已提升aresource/foo，再hydrate相同树；head一份资源、body hello world保持，资源不会按body普通link参与重复节点匹配。 */
    it('treats link rel stylesheet elements as a stylesheet resource when it includes a precedence when hydrating', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <link rel="stylesheet" href="aresource" precedence="foo" />
              <div>hello world</div>
            </body>
          </html>,
        );
        pipe(writable);
      });
      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="aresource" precedence="foo" />
            <div>hello world</div>
          </body>
        </html>,
      );
      await waitForAll([]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="aresource" data-precedence="foo" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
      );
    });

    /** SSR发现foo1/default1/foo2后head按foo组再default组；hydrate新bar1、foo3、default2并load，既有组尾加入各新项，bar新组最后，旧资源仍保留。 */
    it('hoists stylesheet resources to the correct precedence', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <link rel="stylesheet" href="foo1" precedence="foo" />
              <link rel="stylesheet" href="default1" precedence="default" />
              <link rel="stylesheet" href="foo2" precedence="foo" />
              <div>hello world</div>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo1" data-precedence="foo" />
            <link rel="stylesheet" href="foo2" data-precedence="foo" />
            <link rel="stylesheet" href="default1" data-precedence="default" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="bar1" precedence="bar" />
            <link rel="stylesheet" href="foo3" precedence="foo" />
            <link rel="stylesheet" href="default2" precedence="default" />
            <div>hello world</div>
          </body>
        </html>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog([
        'load preload: bar1',
        'load preload: foo3',
        'load preload: default2',
        'load stylesheet: foo1',
        'load stylesheet: foo2',
        'load stylesheet: foo3',
        'load stylesheet: default1',
        'load stylesheet: default2',
        'load stylesheet: bar1',
      ]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo1" data-precedence="foo" />
            <link rel="stylesheet" href="foo2" data-precedence="foo" />
            <link rel="stylesheet" href="foo3" data-precedence="foo" />
            <link rel="stylesheet" href="default1" data-precedence="default" />
            <link rel="stylesheet" href="default2" data-precedence="default" />
            <link rel="stylesheet" href="bar1" data-precedence="bar" />
            <link rel="preload" as="style" href="bar1" />
            <link rel="preload" as="style" href="foo3" />
            <link rel="preload" as="style" href="default2" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
      );
    });

    /** 客户端挂载并load foo样式后，根更新删除最后一个link引用；head仍保留foo资源，body hello world不变，当前释放引用不回收资源节点。 */
    it('retains styles even after the last referring Resource unmounts', async () => {
      // 在未来实现某种垃圾回收机制前，本测试始终成立。
      const root = ReactDOMClient.createRoot(document);

      root.render(
        <html>
          <head />
          <body>
            hello world
            <link rel="stylesheet" href="foo" precedence="foo" />
          </body>
        </html>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog(['load preload: foo', 'load stylesheet: foo']);

      root.render(
        <html>
          <head />
          <body>hello world</body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="foo" />
          </head>
          <body>hello world</body>
        </html>,
      );
    });

    /** SSR foo/bar样式和server文本，hydrate以client文本及qux/foo造成重建并load；最终foo/bar旧样式仍保留，qux在新组追加，body换client；仅收集恢复错误，未断言其条数。 */
    it('retains styles even when a new html, head, and/body mount', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <link rel="stylesheet" href="foo" precedence="foo" />
              <link rel="stylesheet" href="bar" precedence="bar" />
              server
            </body>
          </html>,
        );
        pipe(writable);
      });
      const errors = [];
      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <head>
            <link rel="stylesheet" href="qux" precedence="qux" />
            <link rel="stylesheet" href="foo" precedence="foo" />
          </head>
          <body>client</body>
        </html>,
        {

          /** 只把hydration恢复错误message放入errors数组；此用例后面没有对数组作断言。
           * @param error 恢复路径提供的错误对象。 */
          onRecoverableError(error) {
            errors.push(error.message);
          },
        },
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog([
        'load preload: qux',
        'load stylesheet: foo',
        'load stylesheet: bar',
        'load stylesheet: qux',
      ]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="foo" />
            <link rel="stylesheet" href="bar" data-precedence="bar" />
            <link rel="stylesheet" href="qux" data-precedence="qux" />
          </head>
          <body>client</body>
        </html>,
      );
    });

    /** 客户端head key从1变2，资源从foo/bar改foo/baz；加载后旧bar仍在，新baz及其preload追加，核对head remount保留资源且这次仍保留晚插preload。 */
    it('retains styles in head through head remounts', async () => {
      const root = ReactDOMClient.createRoot(document);
      root.render(
        <html>
          <head key={1} />
          <body>
            <link rel="stylesheet" href="foo" precedence="foo" />
            <link rel="stylesheet" href="bar" precedence="bar" />
            {null}
            hello
          </body>
        </html>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog([
        'load preload: foo',
        'load preload: bar',
        'load stylesheet: foo',
        'load stylesheet: bar',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="foo" />
            <link rel="stylesheet" href="bar" data-precedence="bar" />
          </head>
          <body>hello</body>
        </html>,
      );

      root.render(
        <html>
          <head key={2} />
          <body>
            <link rel="stylesheet" href="foo" precedence="foo" />
            {null}
            <link rel="stylesheet" href="baz" precedence="baz" />
            hello
          </body>
        </html>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog(['load preload: baz', 'load stylesheet: baz']);

      // head重挂保留foo/bar资源，插入baz；下面断言仍有新baz的preload。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="foo" />
            <link rel="stylesheet" href="bar" data-precedence="bar" />
            <link rel="stylesheet" href="baz" data-precedence="baz" />
            <link rel="preload" href="baz" as="style" />
          </head>
          <body>hello</body>
        </html>,
      );
    });

    /** 主root与shadow portal各引用同foo但不同precedence/额外属性；document与shadow各有独立stylesheet，人工分别派load，shadow资源保留自身属性，作用域间不合并同URL样式。 */
    it('can support styles inside portals to a shadowRoot', async () => {
      const shadow = document.body.attachShadow({mode: 'open'});
      const root = ReactDOMClient.createRoot(container);
      root.render(
        <>
          <link rel="stylesheet" href="foo" precedence="default" />
          {ReactDOM.createPortal(
            <div>
              <link
                rel="stylesheet"
                href="foo"
                data-extra-prop="foo"
                precedence="different"
              />
              shadow
            </div>,
            shadow,
          )}
          container
        </>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
        loadStylesheetsFrom(shadow);
      });
      await assertLog([
        'load preload: foo',
        'load stylesheet: foo',
        'load stylesheet: foo',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="preload" href="foo" as="style" />
          </head>
          <body>
            <div id="container">container</div>
          </body>
        </html>,
      );
      expect(getMeaningfulChildren(shadow)).toEqual([
        <link
          rel="stylesheet"
          href="foo"
          data-precedence="different"
          data-extra-prop="foo"
        />,
        <div>shadow</div>,
      ]);
    });

    /** 多个portal目标位于同shadowRoot的不同元素，同时主文档也引用foo；shadow内按one/two/three组统一去重排序foo/baz/bar/qux，主head仅自身foo样式及共享预加载提示，内部目标不各建资源库。 */
    it('can support styles inside portals to an element in shadowRoots', async () => {
      const template = document.createElement('template');
      template.innerHTML =
        "<div><div id='shadowcontainer1'></div><div id='shadowcontainer2'></div></div>";
      const shadow = document.body.attachShadow({mode: 'open'});
      shadow.appendChild(template.content);

      const shadowContainer1 = shadow.getElementById('shadowcontainer1');
      const shadowContainer2 = shadow.getElementById('shadowcontainer2');
      const root = ReactDOMClient.createRoot(container);
      root.render(
        <>
          <link rel="stylesheet" href="foo" precedence="default" />
          {ReactDOM.createPortal(
            <div>
              <link rel="stylesheet" href="foo" precedence="one" />
              <link rel="stylesheet" href="bar" precedence="two" />1
            </div>,
            shadow,
          )}
          {ReactDOM.createPortal(
            <div>
              <link rel="stylesheet" href="foo" precedence="one" />
              <link rel="stylesheet" href="baz" precedence="one" />2
            </div>,
            shadowContainer1,
          )}
          {ReactDOM.createPortal(
            <div>
              <link rel="stylesheet" href="bar" precedence="two" />
              <link rel="stylesheet" href="qux" precedence="three" />3
            </div>,
            shadowContainer2,
          )}
          container
        </>,
      );
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
        loadStylesheetsFrom(shadow);
        loadStylesheetsFrom(shadowContainer2);
        loadStylesheetsFrom(shadowContainer2);
      });
      await assertLog([
        'load preload: foo',
        'load preload: bar',
        'load preload: baz',
        'load preload: qux',
        'load stylesheet: foo',
        'load stylesheet: foo',
        'load stylesheet: baz',
        'load stylesheet: bar',
        'load stylesheet: qux',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="foo" data-precedence="default" />
            <link rel="preload" href="foo" as="style" />
            <link rel="preload" href="bar" as="style" />
            <link rel="preload" href="baz" as="style" />
            <link rel="preload" href="qux" as="style" />
          </head>
          <body>
            <div id="container">container</div>
          </body>
        </html>,
      );
      expect(getMeaningfulChildren(shadow)).toEqual([
        <link rel="stylesheet" href="foo" data-precedence="one" />,
        <link rel="stylesheet" href="baz" data-precedence="one" />,
        <link rel="stylesheet" href="bar" data-precedence="two" />,
        <link rel="stylesheet" href="qux" data-precedence="three" />,
        <div>
          <div id="shadowcontainer1">
            <div>2</div>
          </div>
          <div id="shadowcontainer2">
            <div>3</div>
          </div>
        </div>,
        <div>1</div>,
      ]);
    });

    /** SSR含换行preload与反斜杠样式，再客户端渲染含引号/选择器片段的不同href；load日志和DOM表明原资源复用而特殊href新增独立项，查询转义不误命中旧style。 */
    it('escapes hrefs when selecting matching elements in the document when rendering Resources', async () => {

      /** SSR声明普通与换行style预加载、普通与反斜杠样式，并留客户端容器，作为特殊选择器键复用对照。
       * @returns 文档。 */
      function App() {
        ReactDOM.preload('preload', {as: 'style'});
        ReactDOM.preload('with\nnewline', {as: 'style'});
        return (
          <html>
            <head />
            <body>
              <link rel="stylesheet" href="style" precedence="style" />
              <link rel="stylesheet" href="with\slashes" precedence="style" />
              <div id="container" />
            </body>
          </html>
        );
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      container = document.getElementById('container');
      const root = ReactDOMClient.createRoot(container);

      /** 重复提示已存在URL，并返回含引号选择器片段的新样式与原反斜杠样式，验证特殊href不误匹配普通style。
       * @returns foo div与两样式。 */
      function ClientApp() {
        ReactDOM.preload('preload', {as: 'style'});
        ReactDOM.preload('with\nnewline', {as: 'style'});
        return (
          <div>
            <link
              rel="stylesheet"
              href={'style"][rel="stylesheet'}
              precedence="style"
            />
            <link rel="stylesheet" href="with\slashes" precedence="style" />
            foo
          </div>
        );
      }
      root.render(<ClientApp />);
      await waitForAll([]);
      await act(() => {
        loadPreloads();
        loadStylesheets();
      });
      await assertLog([
        'load preload: preload',
        'load preload: with\nnewline',
        'load preload: style"][rel="stylesheet',
        'load stylesheet: style',
        'load stylesheet: with\\slashes',
        'load stylesheet: style"][rel="stylesheet',
      ]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="style" data-precedence="style" />
            <link
              rel="stylesheet"
              href="with\slashes"
              data-precedence="style"
            />
            <link
              rel="stylesheet"
              href={'style"][rel="stylesheet'}
              data-precedence="style"
            />
            <link rel="preload" as="style" href="preload" />
            <link rel="preload" href={'with\nnewline'} as="style" />
            <link rel="preload" href={'style"][rel="stylesheet'} as="style" />
          </head>
          <body>
            <div id="container">
              <div>foo</div>
            </div>
          </body>
        </html>,
      );
    });

    /** SSR先放普通preload/style、反斜杠及换行URL，客户端API再提示含引号选择器片段的URL并preinit同反斜杠项；最终特殊URL各独立、已存在项去重，验证API匹配选择器转义。 */
    it('escapes hrefs when selecting matching elements in the document when using preload and preinit', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <link rel="preload" href="preload" as="style" />
              <link rel="stylesheet" href="style" precedence="style" />
              <link rel="stylesheet" href="with\slashes" precedence="style" />
              <link rel="preload" href={'with\nnewline'} as="style" />
              <div id="container" />
            </body>
          </html>,
        );
        pipe(writable);
      });

      /** 客户端通过preload/preinit提示含选择器片段、反斜杠和换行URL，比较转义查询与已存在节点去重。
       * @returns foo div。 */
      function App() {
        ReactDOM.preload('preload"][rel="preload', {as: 'style'});
        ReactDOM.preinit('style"][rel="stylesheet', {
          as: 'style',
          precedence: 'style',
        });
        ReactDOM.preinit('with\\slashes', {
          as: 'style',
          precedence: 'style',
        });
        ReactDOM.preload('with\nnewline', {as: 'style'});
        return <div>foo</div>;
      }

      container = document.getElementById('container');
      const root = ReactDOMClient.createRoot(container);
      root.render(<App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="style" data-precedence="style" />
            <link
              rel="stylesheet"
              href="with\slashes"
              data-precedence="style"
            />
            <link
              rel="stylesheet"
              href={'style"][rel="stylesheet'}
              data-precedence="style"
            />
            <link rel="preload" as="style" href="preload" />
            <link rel="preload" href={'with\nnewline'} as="style" />
            <link rel="preload" href={'preload"][rel="preload'} as="style" />
          </head>
          <body>
            <div id="container">
              <div>foo</div>
            </div>
          </body>
        </html>,
      );
    });

    /** SSR与客户端都在SVG path和foreignObject分别放foo/bar样式；SVG命名空间foo留原位，foreignObject恢复HTML上下文后bar被提升到head，不能把整个svg后代都视作禁用资源。 */
    it('does not create stylesheet resources when inside an <svg> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <svg>
                <path>
                  <link rel="stylesheet" href="foo" precedence="default" />
                </path>
                <foreignObject>
                  <link rel="stylesheet" href="bar" precedence="default" />
                </foreignObject>
              </svg>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="stylesheet" href="bar" data-precedence="default" />
          </head>
          <body>
            <svg>
              <path>
                <link rel="stylesheet" href="foo" precedence="default" />
              </path>
              <foreignobject />
            </svg>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <svg>
            <path>
              <link rel="stylesheet" href="foo" precedence="default" />
            </path>
            <foreignObject>
              <link rel="stylesheet" href="bar" precedence="default" />
            </foreignObject>
          </svg>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          <svg>
            <path>
              <link rel="stylesheet" href="foo" precedence="default" />
            </path>
            <foreignobject />
          </svg>
        </div>,
      );
    });

    /** SSR noscript中的样式link作为转义文本保留且head空；客户端重渲染noscript为空不创建子link或资源，验证两端不同noscript处理都不提升样式。 */
    it('does not create stylesheet resources when inside a <noscript> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <noscript>
                <link rel="stylesheet" href="foo" precedence="default" />
              </noscript>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <noscript>
              &lt;link rel="stylesheet" href="foo" precedence="default"&gt;
            </noscript>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <noscript>
            <link rel="stylesheet" href="foo" precedence="default" />
          </noscript>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          {/* 在客户端，<noscript> 从不渲染子组件。 */}
          <noscript />
        </div>,
      );
    });

    /** SSR依次用缺/空href、load/error监听及disabled=false使precedence样式不具备资源资格，断言对应七条DEV警告；hydrate带双监听普通link再报冲突，disabled是否为false仍以属性存在为条件。 */
    it('warns if you provide a `precedence` prop with other props that invalidate the creation of a stylesheet resource', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <link rel="stylesheet" precedence="default" />
              <link rel="stylesheet" href="" precedence="default" />
              <link
                rel="stylesheet"
                href="foo"
                precedence="default"
                onLoad={() => {}}
                onError={() => {}}
              />
              <link
                rel="stylesheet"
                href="foo"
                precedence="default"
                onLoad={() => {}}
              />
              <link
                rel="stylesheet"
                href="foo"
                precedence="default"
                onError={() => {}}
              />
              <link
                rel="stylesheet"
                href="foo"
                precedence="default"
                disabled={false}
              />
            </body>
          </html>,
        ).pipe(writable);
      });
      assertConsoleErrorDev(
        [
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and ' +
            'expected the `href` prop to be a non-empty string but ecountered `undefined` instead. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the ' +
            '`precedence` prop ensure there is a non-empty string `href` prop as well, ' +
            'otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and ' +
            'expected the `href` prop to be a non-empty string but ecountered an empty string instead. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the ' +
            '`precedence` prop ensure there is a non-empty string `href` prop as well, ' +
            'otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
          'An empty string ("") was passed to the href attribute. ' +
            'To fix this, either do not render the element at all or ' +
            'pass null to href instead of an empty string.\n' +
            '    in link (at **)',
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and ' +
            '`onLoad` and `onError` props. The presence of loading and error handlers indicates ' +
            'an intent to manage the stylesheet loading state from your from your Component code ' +
            'and React will not hoist or deduplicate this stylesheet. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the ' +
            '`precedence` prop remove the `onLoad` and `onError` props, otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and ' +
            '`onLoad` prop. The presence of loading and error handlers indicates an intent to ' +
            'manage the stylesheet loading state from your from your Component code and ' +
            'React will not hoist or deduplicate this stylesheet. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the ' +
            '`precedence` prop remove the `onLoad` prop, otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and `onError` prop. ' +
            'The presence of loading and error handlers indicates an intent to manage the stylesheet loading state ' +
            'from your from your Component code and React will not hoist or deduplicate this stylesheet. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` ' +
            'prop remove the `onError` prop, otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
          'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and a `disabled` prop. ' +
            'The presence of the `disabled` prop indicates an intent to manage the stylesheet active state from ' +
            'your from your Component code and React will not hoist or deduplicate this stylesheet. ' +
            'If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` ' +
            'prop remove the `disabled` prop, otherwise remove the `precedence` prop.\n' +
            '    in link (at **)',
        ].filter(Boolean),
      );

      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <link
              rel="stylesheet"
              href="foo"
              precedence="default"
              onLoad={() => {}}
              onError={() => {}}
            />
          </body>
        </html>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'React encountered a <link rel="stylesheet" href="foo" ... /> with a `precedence` ' +
          'prop that also included the `onLoad` and `onError` props. ' +
          'The presence of loading and error handlers indicates an intent to manage the stylesheet ' +
          'loading state from your from your Component code and React will not hoist or deduplicate this stylesheet. ' +
          'If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` ' +
          'prop remove the `onLoad` and `onError` props, otherwise remove the `precedence` prop.\n' +
          '    in body (at **)',
      ]);
    });

    /** 两个pending边界同时依赖print与all样式，matchMedia夹具仅all匹配；解文本后都保持loading，只派all stylesheet load即可同时显示foo/bar，print未load不阻塞揭示。 */
    it('will not block displaying a Suspense boundary on a stylesheet with media that does not match', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="block">
                  foo
                  <link
                    rel="stylesheet"
                    href="print"
                    media="print"
                    precedence="print"
                  />
                  <link
                    rel="stylesheet"
                    href="all"
                    media="all"
                    precedence="all"
                  />
                </BlockedOn>
              </Suspense>
              <Suspense fallback="loading...">
                <BlockedOn value="block">
                  bar
                  <link
                    rel="stylesheet"
                    href="print"
                    media="print"
                    precedence="print"
                  />
                  <link
                    rel="stylesheet"
                    href="all"
                    media="all"
                    precedence="all"
                  />
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            {'loading...'}
            {'loading...'}
          </body>
        </html>,
      );

      await act(() => {
        resolveText('block');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="print"
              media="print"
              data-precedence="print"
            />
            <link
              rel="stylesheet"
              href="all"
              media="all"
              data-precedence="all"
            />
          </head>
          <body>
            {'loading...'}
            {'loading...'}
            <link rel="preload" href="print" media="print" as="style" />
            <link rel="preload" href="all" media="all" as="style" />
          </body>
        </html>,
      );

      await act(() => {
        const allStyle = document.querySelector('link[href="all"]');
        const event = document.createEvent('Events');
        event.initEvent('load', true, true);
        allStyle.dispatchEvent(event);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link
              rel="stylesheet"
              href="print"
              media="print"
              data-precedence="print"
            />
            <link
              rel="stylesheet"
              href="all"
              media="all"
              data-precedence="all"
            />
          </head>
          <body>
            {'foo'}
            {'bar'}
            <link rel="preload" href="print" media="print" as="style" />
            <link rel="preload" href="all" media="all" as="style" />
          </body>
        </html>,
      );
    });
  });

  describe('Style Resource', () => {

    /** SSR body内style带href=foo/precedence=foo及CSS；输出head style改为data-href/data-precedence，body为空，验证内联资源提升。 */
    it('treats <style href="..." precedence="..."> elements as a style resource when server rendering', async () => {
      const css = `
body {
  background-color: red;
}`;
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <style href="foo" precedence="foo">
                {css}
              </style>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {css}
            </style>
          </head>
          <body />
        </html>,
      );
    });

    /** pending文本边界解锁时直接插红色foo内联style并显示loaded，无外链load等待；hydrate复用foo，再根更新添加绿色baz/foo与蓝色bar/bar，head按组排列foo、baz、bar。 */
    it('can insert style resources as part of a boundary reveal', async () => {
      const cssRed = `
body {
  background-color: red;
}`;
      const cssBlue = `
body {
background-color: blue;
}`;
      const cssGreen = `
body {
background-color: green;
}`;
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="blocked">
                  <style href="foo" precedence="foo">
                    {cssRed}
                  </style>
                  loaded
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>loading...</body>
        </html>,
      );

      await act(() => {
        resolveText('blocked');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <Suspense fallback="loading...">
              <style href="foo" precedence="foo">
                {cssRed}
              </style>
              loaded
            </Suspense>
          </body>
        </html>,
      );
      await waitForAll([]);

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );

      root.render(
        <html>
          <body>
            <Suspense fallback="loading...">
              <style href="foo" precedence="foo">
                {cssRed}
              </style>
              loaded
            </Suspense>
            <style href="bar" precedence="bar">
              {cssBlue}
            </style>
            <style href="baz" precedence="foo">
              {cssGreen}
            </style>
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="foo">
              {cssRed}
            </style>
            <style data-href="baz" data-precedence="foo">
              {cssGreen}
            </style>
            <style data-href="bar" data-precedence="bar">
              {cssBlue}
            </style>
          </head>
          <body>loaded</body>
        </html>,
      );
    });

    /** 边界先等first再等second，解first仅早冲刷foo style到body并加media=not all；解second后foo/bar移入head并去临时media，body显示两div，区分资源早发与边界揭示。 */
    it('can emit styles early when a partial boundary flushes', async () => {
      const css = 'body { background-color: red; }';
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense>
                <BlockedOn value="first">
                  <div>first</div>
                  <style href="foo" precedence="default">
                    {css}
                  </style>
                  <BlockedOn value="second">
                    <div>second</div>
                    <style href="bar" precedence="default">
                      {css}
                    </style>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );

      await act(() => {
        resolveText('first');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <style data-href="foo" data-precedence="default" media="not all">
              {css}
            </style>
          </body>
        </html>,
      );

      await act(() => {
        resolveText('second');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="default">
              {css}
            </style>
            <style data-href="bar" data-precedence="default">
              {css}
            </style>
          </head>
          <body>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    /** first解锁后唯一foo内联style以media=not all发到body，second解锁不发现任何新style；仍将已早发foo提升到head并显示两个div，完成指令不能依赖本轮新CSS存在。 */
    it('can hoist styles flushed early even when no other style dependencies are flushed on completion', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense fallback="loading...">
                <BlockedOn value="first">
                  <style href="foo" precedence="default">
                    some css
                  </style>
                  <div>first</div>
                  <BlockedOn value="second">
                    <div>second</div>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>loading...</body>
        </html>,
      );

      // 当我们解析时，我们首先冲刷样式标签，因为样式标签已经准备好，但我们还没有准备好冲刷整个边界并
      // 揭示它。
      await act(() => {
        resolveText('first');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            loading...
            <style data-href="foo" data-precedence="default" media="not all">
              some css
            </style>
          </body>
        </html>,
      );

      // 第二次 resolve 时冲刷其余 boundary segment 并显示 boundary。尽管本轮没有冲刷其他样式，
      // style 标签仍会在显示过程中被提升。
      await act(() => {
        resolveText('second');
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo" data-precedence="default">
              some css
            </style>
          </head>
          <body>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    /** shell与两个晚阶段各发现default/foo多条内联规则，SSR按阶段与组分别合并CSS及空格分隔data-href；hydrate复用旧合并组并给新16/17各插独立style，客户端不重新合并规则。 */
    it('can emit multiple style rules into a single style tag for a given precedence', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <style href="1" precedence="default">
                1
              </style>
              <style href="2" precedence="foo">
                foo2
              </style>
              <style href="3" precedence="default">
                3
              </style>
              <style href="4" precedence="default">
                4
              </style>
              <style href="5" precedence="foo">
                foo5
              </style>
              <div>initial</div>
              <Suspense fallback="loading...">
                <BlockedOn value="first">
                  <style href="6" precedence="default">
                    6
                  </style>
                  <style href="7" precedence="foo">
                    foo7
                  </style>
                  <style href="8" precedence="default">
                    8
                  </style>
                  <style href="9" precedence="default">
                    9
                  </style>
                  <style href="10" precedence="foo">
                    foo10
                  </style>
                  <div>first</div>
                  <BlockedOn value="second">
                    <style href="11" precedence="default">
                      11
                    </style>
                    <style href="12" precedence="foo">
                      foo12
                    </style>
                    <style href="13" precedence="default">
                      13
                    </style>
                    <style href="14" precedence="default">
                      14
                    </style>
                    <style href="15" precedence="foo">
                      foo15
                    </style>
                    <div>second</div>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
        ).pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
          </head>
          <body>
            <div>initial</div>loading...
          </body>
        </html>,
      );

      // 第一次 resolve 时，style 标签已就绪所以会先被冲刷，但此时尚不能冲刷并显示整个边界。
      await act(() => {
        resolveText('first');
      });
      await act(() => {
        resolveText('second');
      });

      // 部分样式组早于整个 boundary 就绪，因此一就绪便发出；其余样式在 boundary 完成时就绪，也会
      // 被合并成组。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="6 8 9" data-precedence="default">
              689
            </style>
            <style data-href="11 13 14" data-precedence="default">
              111314
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
            <style data-href="7 10" data-precedence="foo">
              foo7foo10
            </style>
            <style data-href="12 15" data-precedence="foo">
              foo12foo15
            </style>
          </head>
          <body>
            <div>initial</div>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );

      // 客户端插入的 style 标签不会分组，但可与已分组的样式集进行 hydration。
      ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <style href="1" precedence="default">
              1
            </style>
            <style href="2" precedence="foo">
              foo2
            </style>
            <style href="16" precedence="default">
              16
            </style>
            <style href="17" precedence="default">
              17
            </style>
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="1 3 4" data-precedence="default">
              134
            </style>
            <style data-href="6 8 9" data-precedence="default">
              689
            </style>
            <style data-href="11 13 14" data-precedence="default">
              111314
            </style>
            <style data-href="16" data-precedence="default">
              16
            </style>
            <style data-href="17" data-precedence="default">
              17
            </style>
            <style data-href="2 5" data-precedence="foo">
              foo2foo5
            </style>
            <style data-href="7 10" data-precedence="foo">
              foo7foo10
            </style>
            <style data-href="12 15" data-precedence="foo">
              foo12foo15
            </style>
          </head>
          <body>
            <div>initial</div>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });

    /** SSR style资源href含空格foo bar；DEV断言空间会破坏客户端data-href键匹配的警告，未执行后续hydrate失败验证。 */
    it('warns if you render a <style> with an href with a space on the server', async () => {
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <style href="foo bar" precedence="default">
                style
              </style>
            </body>
          </html>,
        ).pipe(writable);
      });
      assertConsoleErrorDev([
        'React expected the `href` prop for a <style> tag opting into hoisting semantics ' +
          'using the `precedence` prop to not have any spaces but ecountered spaces instead. ' +
          'using spaces in this prop will cause hydration of this style to fail on the client. ' +
          'The href for the <style> where this ocurred is "foo bar".\n' +
          '    in style (at **)',
      ]);
    });

    /** 两个文本锁控制内联样式晚发，render options显式nonce.style且各style也带nonce；first阶段合并foo/bar以临时media发body，second阶段提升head并追加baz，两阶段所有输出style保留R4nD0m。 */
    it('can emit styles with nonce', async () => {
      const nonce = 'R4nD0m';
      const fooCss = '.foo { color: hotpink; }';
      const barCss = '.bar { background-color: blue; }';
      const bazCss = '.baz { border: 1px solid black; }';
      await act(() => {
        renderToPipeableStream(
          <html>
            <body>
              <Suspense>
                <BlockedOn value="first">
                  <div>first</div>
                  <style href="foo" precedence="default" nonce={nonce}>
                    {fooCss}
                  </style>
                  <style href="bar" precedence="default" nonce={nonce}>
                    {barCss}
                  </style>
                  <BlockedOn value="second">
                    <div>second</div>
                    <style href="baz" precedence="default" nonce={nonce}>
                      {bazCss}
                    </style>
                  </BlockedOn>
                </BlockedOn>
              </Suspense>
            </body>
          </html>,
          {nonce: {style: nonce}},
        ).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );

      await act(() => {
        resolveText('first');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <style
              data-href="foo bar"
              data-precedence="default"
              media="not all"
              nonce={nonce}>
              {`${fooCss}${barCss}`}
            </style>
          </body>
        </html>,
      );

      await act(() => {
        resolveText('second');
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <style data-href="foo bar" data-precedence="default" nonce={nonce}>
              {`${fooCss}${barCss}`}
            </style>
            <style data-href="baz" data-precedence="default" nonce={nonce}>
              {bazCss}
            </style>
          </head>
          <body>
            <div>first</div>
            <div>second</div>
          </body>
        </html>,
      );
    });
  });

  describe('Script Resources', () => {

    /** SSR/hydrate四种脚本：无监听async foo提升head，带onLoad async bar、普通baz、defer qux保留body；unmount后只留foo资源，普通宿主脚本被移除，资源与host生命周期不同。 */
    it('treats async scripts without onLoad or onError as Resources', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <head />
            <body>
              <script src="foo" async={true} />
              <script src="bar" async={true} onLoad={() => {}} />
              <script src="baz" data-meaningful="" />
              <script src="qux" defer={true} data-meaningful="" />
              hello world
            </body>
          </html>,
        );
        pipe(writable);
      });
      // 无 onLoad/onError 的 async script 作为资源提升到 head。带 onLoad 的 bar 留在 body，
      // 与普通 script 一样走 HostComponent hydration；它不会被转为共享资源。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script src="foo" async="" />
          </head>
          <body>
            <script src="bar" async="" />
            <script src="baz" data-meaningful="" />
            <script src="qux" defer="" data-meaningful="" />
            hello world
          </body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <head />
          <body>
            <script src="foo" async={true} />
            <script src="bar" async={true} onLoad={() => {}} />
            <script src="baz" data-meaningful="" />
            <script src="qux" defer={true} data-meaningful="" />
            hello world
          </body>
        </html>,
      );
      await waitForAll([]);
      // hydration 后 bar 仍位于 body，其位置与服务端输出一致。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script src="foo" async="" />
          </head>
          <body>
            <script src="bar" async="" />
            <script src="baz" data-meaningful="" />
            <script src="qux" defer="" data-meaningful="" />
            hello world
          </body>
        </html>,
      );

      root.unmount();
      // 卸载时应保留 singleton 及其内部未清理的内容。foo script 是资源，所以会保留；其他 script
      // 是常规 HostComponent，因此会卸载并从 DOM 中移除。
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script src="foo" async="" />
          </head>
          <body />
        </html>,
      );
    });

    /** SSR与客户端在SVG path内foo及foreignObject内bar声明async脚本；foo留SVG原位，bar恢复HTML上下文被提升head，SVG限制不扩展到foreignObject中的HTML子树。 */
    it('does not create script resources when inside an <svg> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <svg>
                <path>
                  <script async={true} src="foo" />
                </path>
                <foreignObject>
                  <script async={true} src="bar" />
                </foreignObject>
              </svg>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <script async="" src="bar" />
          </head>
          <body>
            <svg>
              <path>
                <script async="" src="foo" />
              </path>
              <foreignobject />
            </svg>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <svg>
            <path>
              <script async={true} src="foo" />
            </path>
            <foreignObject>
              <script async={true} src="bar" />
            </foreignObject>
          </svg>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          <svg>
            <path>
              <script async="" src="foo" />
            </path>
            <foreignobject />
          </svg>
        </div>,
      );
    });

    /** SSR noscript内async脚本仅为转义文本且head空；客户端noscript不创建子脚本，验证两端不会从该上下文生成共享脚本资源。 */
    it('does not create script resources when inside a <noscript> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <noscript>
                <script async={true} src="foo" />
              </noscript>
            </body>
          </html>,
        );
        pipe(writable);
      });
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <noscript>
              &lt;script async="" src="foo"&gt;&lt;/script&gt;
            </noscript>
          </body>
        </html>,
      );

      const root = ReactDOMClient.createRoot(document.body);
      root.render(
        <div>
          <noscript>
            <script async={true} src="foo" />
          </noscript>
        </div>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document.body)).toEqual(
        <div>
          {/* 在客户端，<noscript> 从不渲染子组件。 */}
          <noscript />
        </div>,
      );
    });
  });

  describe('Hoistables', () => {

    /** SSR body meta提升head，hydrate相同name/data/content不增节点；根更新删meta后head为空，普通可提升meta随引用卸载而删除。 */
    it('can hoist meta tags on the server and hydrate them on the client', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <meta name="foo" data-foo="data" content="bar" />
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <meta name="foo" data-foo="data" content="bar" />
          </head>
          <body />
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <meta name="foo" data-foo="data" content="bar" />
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <meta name="foo" data-foo="data" content="bar" />
          </head>
          <body />
        </html>,
      );

      root.render(
        <html>
          <body />
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );
    });

    /** 客户端container内div声明meta，head收到完整meta而div为空；更新为无meta div后head投影undefined，验证客户端提升与移除。 */
    it('can hoist meta tags on the client', async () => {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <meta name="foo" data-foo="data" content="bar" />
          </div>,
        );
      });
      await waitForAll([]);

      expect(getMeaningfulChildren(document.head)).toEqual(
        <meta name="foo" data-foo="data" content="bar" />,
      );
      expect(getMeaningfulChildren(container)).toEqual(<div />);

      root.render(<div />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document.head)).toEqual(undefined);
    });

    /** SSR body的非stylesheet rel=foo link提升head，hydrate保留原属性，根更新删除引用后head清空，区别于长留的CSS资源。 */
    it('can hoist link (non-stylesheet) tags on the server and hydrate them on the client', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <link rel="foo" data-foo="data" href="foo" />
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="foo" data-foo="data" href="foo" />
          </head>
          <body />
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <link rel="foo" data-foo="data" href="foo" />
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="foo" data-foo="data" href="foo" />
          </head>
          <body />
        </html>,
      );

      root.render(
        <html>
          <body />
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );
    });

    /** 客户端div内普通rel=foo link提升head并保留data/href，div空；删除引用后head为空，提升不改变普通节点卸载语义。 */
    it('can hoist link (non-stylesheet) tags on the client', async () => {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <link rel="foo" data-foo="data" href="foo" />
          </div>,
        );
      });
      await waitForAll([]);

      expect(getMeaningfulChildren(document.head)).toEqual(
        <link rel="foo" data-foo="data" href="foo" />,
      );
      expect(getMeaningfulChildren(container)).toEqual(<div />);

      root.render(<div />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document.head)).toEqual(undefined);
    });

    /** SSR body title提升head且保留文本/data，hydrate复用；根更新去title后head清空，验证title提升/匹配/卸载。 */
    it('can hoist title tags on the server and hydrate them on the client', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <title data-foo="foo">a title</title>
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <title data-foo="foo">a title</title>
          </head>
          <body />
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <title data-foo="foo">a title</title>
          </body>
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <title data-foo="foo">a title</title>
          </head>
          <body />
        </html>,
      );

      root.render(
        <html>
          <body />
        </html>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body />
        </html>,
      );
    });

    /** 客户端div内title提升head而container div空；更新为无title div后head投影undefined，普通title引用移除时清理。 */
    it('can hoist title tags on the client', async () => {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <title data-foo="foo">a title</title>
          </div>,
        );
      });
      await waitForAll([]);

      expect(getMeaningfulChildren(document.head)).toEqual(
        <title data-foo="foo">a title</title>,
      );
      expect(getMeaningfulChildren(container)).toEqual(<div />);

      root.render(<div />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document.head)).toEqual(undefined);
    });

    /** SSR body声明混合普通link/meta/title与显式preload/preconnect/DNS提示，最后才声明viewport/charset；head排序charset先、viewport次，其余按本例发现顺序，显式提示不自动按API资源队列重排。 */
    it('prioritizes ordering for certain hoistables over others when rendering on the server', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <link rel="foo" href="foo" />
              <meta name="bar" />
              <title>a title</title>
              <link rel="preload" href="foo" as="style" />
              <link rel="preconnect" href="bar" />
              <link rel="dns-prefetch" href="baz" />
              <meta name="viewport" />
              <meta charSet="utf-8" />
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            {/* 字符集处理的第一步。 */}
            <meta charset="utf-8" />
            {/* 接着是 viewport meta */}
            <meta name="viewport" />
            {/* 其余一切最后 */}
            <link rel="foo" href="foo" />
            <meta name="bar" />
            <title>a title</title>
            <link rel="preload" href="foo" as="style" />
            <link rel="preconnect" href="bar" />
            <link rel="dns-prefetch" href="baz" />
          </head>
          <body />
        </html>,
      );
    });

    /** meta before/after分别位于html元素前后；SSR与hydrate均移入head且顺序保留，根更新两处改null后head清空，支持文档singleton外声明普通hoistable。 */
    it('supports rendering hoistables outside of <html> scope', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <>
            <meta name="before" />
            <html>
              <body>foo</body>
            </html>
            <meta name="after" />
          </>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <meta name="before" />
            <meta name="after" />
          </head>
          <body>foo</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(
        document,
        <>
          <meta name="before" />
          <html>
            <body>foo</body>
          </html>
          <meta name="after" />
        </>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <meta name="before" />
            <meta name="after" />
          </head>
          <body>foo</body>
        </html>,
      );

      root.render(
        <>
          {null}
          <html>
            <body>foo</body>
          </html>
          {null}
        </>,
      );
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>foo</body>
        </html>,
      );
    });

    /** 同href/content而rel/name不同的link/meta分shell和release后两阶段发现；hydrate期间插入第三方同href/content节点，解release后保留第三方并正确管理晚到元素，unmount只移React节点，第三方留body。 */
    it('can hydrate hoistable tags inside late suspense boundaries', async () => {

      /** 用相同href/content但不同rel/name区分多组普通hoistable，部分待release后发现；跨SSR/hydrate/unmount观察晚到匹配及第三方同类节点保留。
       * @returns 含shell/late两批hoistable的文档。 */
      function App() {
        return (
          <html>
            <body>
              <link rel="rel1" href="linkhref" />
              <link rel="rel2" href="linkhref" />
              <meta name="name1" content="metacontent" />
              <meta name="name2" content="metacontent" />
              <Suspense fallback="loading...">
                <link rel="rel3" href="linkhref" />
                <link rel="rel4" href="linkhref" />
                <meta name="name3" content="metacontent" />
                <meta name="name4" content="metacontent" />
                <BlockedOn value="release">
                  <link rel="rel5" href="linkhref" />
                  <link rel="rel6" href="linkhref" />
                  <meta name="name5" content="metacontent" />
                  <meta name="name6" content="metacontent" />
                  <div>hello world</div>
                </BlockedOn>
              </Suspense>
            </body>
          </html>
        );
      }
      await act(() => {
        renderToPipeableStream(<App />).pipe(writable);
      });

      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="rel1" href="linkhref" />
            <link rel="rel2" href="linkhref" />
            <meta name="name1" content="metacontent" />
            <meta name="name2" content="metacontent" />
            <link rel="rel3" href="linkhref" />
            <link rel="rel4" href="linkhref" />
            <meta name="name3" content="metacontent" />
            <meta name="name4" content="metacontent" />
          </head>
          <body>loading...</body>
        </html>,
      );

      const root = ReactDOMClient.hydrateRoot(document, <App />);
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="rel1" href="linkhref" />
            <link rel="rel2" href="linkhref" />
            <meta name="name1" content="metacontent" />
            <meta name="name2" content="metacontent" />
            <link rel="rel3" href="linkhref" />
            <link rel="rel4" href="linkhref" />
            <meta name="name3" content="metacontent" />
            <meta name="name4" content="metacontent" />
          </head>
          <body>loading...</body>
        </html>,
      );

      const thirdPartyLink = document.createElement('link');
      thirdPartyLink.setAttribute('href', 'linkhref');
      thirdPartyLink.setAttribute('rel', '3rdparty');
      document.body.prepend(thirdPartyLink);

      const thirdPartyMeta = document.createElement('meta');
      thirdPartyMeta.setAttribute('content', 'metacontent');
      thirdPartyMeta.setAttribute('name', '3rdparty');
      document.body.prepend(thirdPartyMeta);

      await act(() => {
        resolveText('release');
      });
      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <link rel="rel1" href="linkhref" />
            <link rel="rel2" href="linkhref" />
            <meta name="name1" content="metacontent" />
            <meta name="name2" content="metacontent" />
            <link rel="rel3" href="linkhref" />
            <link rel="rel4" href="linkhref" />
            <meta name="name3" content="metacontent" />
            <meta name="name4" content="metacontent" />
          </head>
          <body>
            <meta name="3rdparty" content="metacontent" />
            <link rel="3rdparty" href="linkhref" />
            <div>hello world</div>
            <link rel="rel5" href="linkhref" />
            <link rel="rel6" href="linkhref" />
            <meta name="name5" content="metacontent" />
            <meta name="name6" content="metacontent" />
          </body>
        </html>,
      );

      root.unmount();
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head />
          <body>
            <meta name="3rdparty" content="metacontent" />
            <link rel="3rdparty" href="linkhref" />
          </body>
        </html>,
      );
    });

    /** SSR SVG与path里title/meta/link都不提升，foreignObject中同类元素恢复HTML上下文而在head出现；本例只断言head这三项，未直接比较SVG原位节点。 */
    it('does not hoist inside an <svg> context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <svg>
                <title>svg title</title>
                <link rel="svg link" href="a" />
                <meta name="svg meta" />
                <path>
                  <title>deep svg title</title>
                  <meta name="deep svg meta" />
                  <link rel="deep svg link" href="a" />
                </path>
                <foreignObject>
                  <title>hoistable title</title>
                  <meta name="hoistable" />
                  <link rel="hoistable" href="a" />
                </foreignObject>
              </svg>
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document.head)).toEqual([
        <title>hoistable title</title>,
        <meta name="hoistable" />,
        <link rel="hoistable" href="a" />,
      ]);
    });

    /** body普通title/link/meta旁有noscript内同类元素；SSR head只含普通三项，noscript内容不贡献hoistable，本例未测试客户端noscript。 */
    it('does not hoist inside noscript context', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <title>title</title>
              <link rel="link" href="a" />
              <meta name="meta" />
              <noscript>
                <title>noscript title</title>
                <link rel="noscript link" href="a" />
                <meta name="noscript meta" />
              </noscript>
            </body>
          </html>,
        );
        pipe(writable);
      });

      expect(getMeaningfulChildren(document.head)).toEqual([
        <title>title</title>,
        <link rel="link" href="a" />,
        <meta name="meta" />,
      ]);
    });

    /** SSR title先于html/head singleton，body server文本；hydrate保持同title但改client造成恢复，最终head仍有foo title、body client；errors仅收集未断言内容。 */
    it('can render a title before a singleton even if that singleton clears its contents', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <>
            <title>foo</title>
            <html>
              <head />
              <body>
                <div>server</div>
              </body>
            </html>
          </>,
        );
        pipe(writable);
      });

      const errors = [];
      ReactDOMClient.hydrateRoot(
        document,
        <>
          <title>foo</title>
          <html>
            <head />
            <body>
              <div>client</div>
            </body>
          </html>
        </>,
        {

          /** 收集文本不匹配导致的hydrate恢复错误message；此用例最终只检查title与body，不断言errors数组。
           * @param err 恢复路径错误。 */
          onRecoverableError(err) {
            errors.push(err.message);
          },
        },
      );

      await waitForAll([]);
      expect(getMeaningfulChildren(document)).toEqual(
        <html>
          <head>
            <title>foo</title>
          </head>
          <body>
            <div>client</div>
          </body>
        </html>,
      );
    });

    /** 客户端在container根先渲染title文本和data-foo，再更新两者；head输出从a title/foo改another title/bar，验证已提升title属性及文本可更新。 */
    it('can update title tags', async () => {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<title data-foo="foo">a title</title>);
      });
      await waitForAll([]);

      expect(getMeaningfulChildren(document.head)).toEqual(
        <title data-foo="foo">a title</title>,
      );

      await act(() => {
        root.render(<title data-foo="bar">another title</title>);
      });
      await waitForAll([]);
      expect(getMeaningfulChildren(document.head)).toEqual(
        <title data-foo="bar">another title</title>,
      );
    });
  });

  /** shell同步完成的中层边界含CSS资源而最内文本pending；原始流不含Middle Fallback，DOM显示Inner Fallback，解content后直接显示Async Content，无需人工CSS load，验证shell CSS不额外outline中层。 */
  it('does not outline a boundary with suspensey CSS when flushing the shell', async () => {
    // 冲刷 shell 时，带 precedence 的 stylesheet 会在 <head> 中发出，本就会阻塞绘制，因此无需把
    // boundary 设为 outlined——那只会无谓显示更高层 fallback。应改为内联 boundary，以显示最内层
    // fallback。
    let streamedContent = '';
    writable.on('data', chunk => (streamedContent += chunk));

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="Outer Fallback">
              <Suspense fallback="Middle Fallback">
                <link rel="stylesheet" href="style.css" precedence="default" />
                <Suspense fallback="Inner Fallback">
                  <BlockedOn value="content">Async Content</BlockedOn>
                </Suspense>
              </Suspense>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    // middle boundary 应已内联（而非 outlined），所以流式 HTML 中不应出现 middle fallback 文本。
    expect(streamedContent).not.toContain('Middle Fallback');

    // stylesheet 位于 head 中并阻塞绘制，此时最内层 fallback 可见。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="style.css" data-precedence="default" />
        </head>
        <body>Inner Fallback</body>
      </html>,
    );

    // 解析异步内容（流）——无需加载 CSS，因为样式表已经在头部了。
    await act(() => {
      resolveText('content');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="style.css" data-precedence="default" />
        </head>
        <body>Async Content</body>
      </html>,
    );
  });

  /** 根先等shell，解锁后晚到中层CSS边界被outline，原始流含Middle Fallback；CSS load后改Inner Fallback，再解content显示Async Content，区分晚到资源依赖与内层文本依赖。 */
  it('outlines a boundary with suspensey CSS when flushing a streamed completion', async () => {
    // boundary 通过流完成（而非作为 shell 的一部分）时，suspensey CSS 应使其变为 outlined。这样父级
    // 内容可先显示，CSS 则另行加载。
    let streamedContent = '';
    writable.on('data', chunk => (streamedContent += chunk));

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <Suspense fallback="Root Fallback">
              <BlockedOn value="shell">
                <Suspense fallback="Outer Fallback">
                  <Suspense fallback="Middle Fallback">
                    <link
                      rel="stylesheet"
                      href="style.css"
                      precedence="default"
                    />
                    <Suspense fallback="Inner Fallback">
                      <BlockedOn value="content">Async Content</BlockedOn>
                    </Suspense>
                  </Suspense>
                </Suspense>
              </BlockedOn>
            </Suspense>
          </body>
        </html>,
      ).pipe(writable);
    });

    // shell 正在显示 root fallback
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head />
        <body>Root Fallback</body>
      </html>,
    );

    // 解除 shell 阻塞后内容流入。CSS 通过流到达而不在 shell head 中，因此 middle boundary 应变为 outlined。
    streamedContent = '';
    await act(() => {
      resolveText('shell');
    });

    // boundary 已变为 outlined，因此流式 HTML 中应出现 middle fallback。
    expect(streamedContent).toContain('Middle Fallback');

    // CSS 必须先加载，boundary 才能显示；在此之前 middle fallback 可见。
    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="style.css" data-precedence="default" />
        </head>
        <body>
          {'Middle Fallback'}
          <link rel="preload" href="style.css" as="style" />
        </body>
      </html>,
    );

    // 加载样式表 — 现在中间边界可以揭示
    await act(() => {
      loadStylesheets();
    });
    assertLog(['load stylesheet: style.css']);

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="style.css" data-precedence="default" />
        </head>
        <body>
          {'Inner Fallback'}
          <link rel="preload" href="style.css" as="style" />
        </body>
      </html>,
    );

    // 解析异步内容
    await act(() => {
      resolveText('content');
    });

    expect(getMeaningfulChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="style.css" data-precedence="default" />
        </head>
        <body>
          {'Async Content'}
          <link rel="preload" href="style.css" as="style" />
        </body>
      </html>,
    );
  });

  /** enableViewTransition下shell中边界同时有CSS与图片；只检查原始流包含Image Fallback，验证图片令边界仍outline。此例没有派图片load、检查最终揭示或动画执行。 */
  // @gate enableViewTransition

  it('still outlines a boundary with a suspensey image inside a ViewTransition when flushing the shell', async () => {
    // stylesheet 本就会从 <head> 阻塞绘制；与之不同，ViewTransition 内的图片会变为 outlined，以便
    // 以动画显示，即使在 shell 冲刷期间也是如此。
    const ViewTransition = React.ViewTransition;

    let streamedContent = '';
    writable.on('data', chunk => (streamedContent += chunk));

    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <ViewTransition>
              <Suspense fallback="Image Fallback">
                <link rel="stylesheet" href="style.css" precedence="default" />
                <img src="large-image.jpg" />
                <div>Content</div>
              </Suspense>
            </ViewTransition>
          </body>
        </html>,
      ).pipe(writable);
    });

    // suspensey 图片要求通过 outlined 支持动画显示，即使在 shell 冲刷期间也应如此。
    expect(streamedContent).toContain('Image Fallback');
  });
});
