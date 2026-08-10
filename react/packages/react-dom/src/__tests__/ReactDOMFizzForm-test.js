/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {insertNodesAndExecuteScripts} from '../test-utils/FizzTestUtils';
import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;

let act;
let serverAct;
let container;
let React;
let ReactDOMServer;
let ReactDOMClient;
let Suspense;
let useFormStatus;
let useOptimistic;
let useActionState;
let assertConsoleErrorDev;

describe('ReactDOMFizzForm', () => {
  beforeEach(() => {
    jest.resetModules();
    patchMessageChannel();
    React = require('react');
    ReactDOMServer = require('react-dom/server.browser');
    ReactDOMClient = require('react-dom/client');
    Suspense = React.Suspense;
    useFormStatus = require('react-dom').useFormStatus;
    useOptimistic = require('react').useOptimistic;
    act = require('internal-test-utils').act;
    serverAct = require('internal-test-utils').serverAct;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    container = document.createElement('div');
    document.body.appendChild(container);
    // TODO：也要测试旧 API；它会发出警告，因此需同时断言警告内容。
    // if (__VARIANT__) {
    // API 删除后移除。
    // useActionState = require('react-dom').useFormState;
    // }
    useActionState = require('react').useActionState;
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `submit`：封装当前用例复用的操作、回调或断言步骤。 */
  function submit(submitter) {
    const form = submitter.form || submitter;
    if (!submitter.form) {
      submitter = undefined;
    }
    const submitEvent = new Event('submit', {bubbles: true, cancelable: true});
    submitEvent.submitter = submitter;
    const returnValue = form.dispatchEvent(submitEvent);
    if (!returnValue) {
      return;
    }
    const action =
      (submitter && submitter.getAttribute('formaction')) || form.action;
    if (!/\s*javascript:/i.test(action)) {
      throw new Error('Navigate to: ' + action);
    }
  }

  /** `readIntoContainer`：封装当前用例复用的操作、回调或断言步骤。 */
  async function readIntoContainer(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      result += Buffer.from(value).toString('utf8');
    }
    const temp = document.createElement('div');
    temp.innerHTML = result;
    insertNodesAndExecuteScripts(temp, container, null);
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should allow passing a function to form action during SSR」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('should allow passing a function to form action during SSR', async () => {
    const ref = React.createRef();
    let foo;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action} ref={ref}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    submit(ref.current);

    expect(foo).toBe('bar');
  });

  /** 测试场景：验证「should allow passing a function to an input/button formAction」描述的渲染、交互或错误处理结果。 */
  it('should allow passing a function to an input/button formAction', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let rootActionCalled = false;
    let savedTitle = null;
    let deletedTitle = null;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      rootActionCalled = true;
    }

    /** `saveItem`：封装当前用例复用的操作、回调或断言步骤。 */
    function saveItem(formData) {
      savedTitle = formData.get('title');
    }

    /** `deleteItem`：封装当前用例复用的操作、回调或断言步骤。 */
    function deleteItem(formData) {
      deletedTitle = formData.get('title');
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action}>
          <input type="text" name="title" defaultValue="Hello" />
          <input
            type="submit"
            formAction={saveItem}
            value="Save"
            ref={inputRef}
          />
          <button formAction={deleteItem} ref={buttonRef}>
            Delete
          </button>
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe(null);

    submit(inputRef.current);
    expect(savedTitle).toBe('Hello');
    expect(deletedTitle).toBe(null);
    savedTitle = null;

    submit(buttonRef.current);
    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe('Hello');
    deletedTitle = null;

    expect(rootActionCalled).toBe(false);
  });

  /** 测试场景：验证「should warn when passing a function action during SSR and string during hydration」描述的渲染、交互或错误处理结果。 */
  it('should warn when passing a function action during SSR and string during hydration', async () => {
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {}
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <form action={isClient ? 'action' : action}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />);
    });
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n" +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\n' +
        'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\n' +
        'https://react.dev/link/hydration-mismatch\n\n' +
        '  <App isClient={true}>\n' +
        '    <form\n' +
        '+     action="action"\n' +
        '-     action="function"\n' +
        '    >\n' +
        '\n    in form (at **)' +
        '\n    in App (at **)',
    ]);
  });

  /** 测试场景：验证「should ideally warn when passing a string during SSR and function during hydration」描述的渲染、交互或错误处理结果。 */
  it('should ideally warn when passing a string during SSR and function during hydration', async () => {
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {}
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <form action={isClient ? action : 'action'}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    // 理想情况下这里应警告，因为只有客户端提供了无法与服务端标记对应的函数。
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />);
    });
  });

  /** 测试场景：验证「should reset form fields after you update away from hydrated function」描述的渲染、交互或错误处理结果。 */
  it('should reset form fields after you update away from hydrated function', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {}
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isUpdate}) {
      return (
        <form
          action={isUpdate ? 'action' : action}
          ref={formRef}
          method={isUpdate ? 'POST' : null}>
          <input
            type="submit"
            formAction={isUpdate ? 'action' : action}
            ref={inputRef}
            formTarget={isUpdate ? 'elsewhere' : null}
          />
          <button
            formAction={isUpdate ? 'action' : action}
            ref={buttonRef}
            formEncType={isUpdate ? 'multipart/form-data' : null}
          />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    let root;
    await act(async () => {
      root = ReactDOMClient.hydrateRoot(container, <App />);
    });
    await act(async () => {
      root.render(<App isUpdate={true} />);
    });
    expect(formRef.current.getAttribute('action')).toBe('action');
    expect(formRef.current.hasAttribute('encType')).toBe(false);
    expect(formRef.current.getAttribute('method')).toBe('POST');
    expect(formRef.current.hasAttribute('target')).toBe(false);

    expect(inputRef.current.getAttribute('formAction')).toBe('action');
    expect(inputRef.current.hasAttribute('name')).toBe(false);
    expect(inputRef.current.hasAttribute('formEncType')).toBe(false);
    expect(inputRef.current.hasAttribute('formMethod')).toBe(false);
    expect(inputRef.current.getAttribute('formTarget')).toBe('elsewhere');

    expect(buttonRef.current.getAttribute('formAction')).toBe('action');
    expect(buttonRef.current.hasAttribute('name')).toBe(false);
    expect(buttonRef.current.getAttribute('formEncType')).toBe(
      'multipart/form-data',
    );
    expect(buttonRef.current.hasAttribute('formMethod')).toBe(false);
    expect(buttonRef.current.hasAttribute('formTarget')).toBe(false);
  });

  /** 测试场景：验证「should reset form fields after you remove a hydrated function」描述的渲染、交互或错误处理结果。 */
  it('should reset form fields after you remove a hydrated function', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {}
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isUpdate}) {
      return (
        <form action={isUpdate ? undefined : action} ref={formRef}>
          <input
            type="submit"
            formAction={isUpdate ? undefined : action}
            ref={inputRef}
          />
          <button formAction={isUpdate ? undefined : action} ref={buttonRef} />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    let root;
    await act(async () => {
      root = ReactDOMClient.hydrateRoot(container, <App />);
    });
    await act(async () => {
      root.render(<App isUpdate={true} />);
    });
    expect(formRef.current.hasAttribute('action')).toBe(false);
    expect(formRef.current.hasAttribute('encType')).toBe(false);
    expect(formRef.current.hasAttribute('method')).toBe(false);
    expect(formRef.current.hasAttribute('target')).toBe(false);

    expect(inputRef.current.hasAttribute('formAction')).toBe(false);
    expect(inputRef.current.hasAttribute('name')).toBe(false);
    expect(inputRef.current.hasAttribute('formEncType')).toBe(false);
    expect(inputRef.current.hasAttribute('formMethod')).toBe(false);
    expect(inputRef.current.hasAttribute('formTarget')).toBe(false);

    expect(buttonRef.current.hasAttribute('formAction')).toBe(false);
    expect(buttonRef.current.hasAttribute('name')).toBe(false);
    expect(buttonRef.current.hasAttribute('formEncType')).toBe(false);
    expect(buttonRef.current.hasAttribute('formMethod')).toBe(false);
    expect(buttonRef.current.hasAttribute('formTarget')).toBe(false);
  });

  /** 测试场景：验证「should restore the form fields even if they were incorrectly set」描述的渲染、交互或错误处理结果。 */
  it('should restore the form fields even if they were incorrectly set', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {}
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isUpdate}) {
      return (
        <form
          action={isUpdate ? 'action' : action}
          ref={formRef}
          method="DELETE">
          <input
            type="submit"
            formAction={isUpdate ? 'action' : action}
            ref={inputRef}
            formTarget="elsewhere"
          />
          <button
            formAction={isUpdate ? 'action' : action}
            ref={buttonRef}
            formEncType="text/plain"
          />
        </form>
      );
    }

    // 指定额外表单字段在 DEV 中属于错误，但仍期望后续更新最终会修补它。
    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    assertConsoleErrorDev([
      'Cannot specify a encType or method for a form that specifies a function as the action. ' +
        'React provides those automatically. They will get overridden.\n' +
        '    in form (at **)\n' +
        '    in App (at **)',
      'Cannot specify a formTarget for a button that specifies a function as a formAction. ' +
        'The function will always be executed in the same window.\n' +
        '    in input (at **)\n' +
        '    in App (at **)',
    ]);
    let root;
    await act(async () => {
      root = ReactDOMClient.hydrateRoot(container, <App />);
    });
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n" +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\n' +
        'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\n' +
        'https://react.dev/link/hydration-mismatch\n\n' +
        '  <App>\n' +
        '    <form\n' +
        '      action={function action}\n' +
        '      ref={{current:null}}\n' +
        '+     method="DELETE"\n' +
        '-     method={null}\n' +
        '    >\n' +
        '      <input\n' +
        '        type="submit"\n' +
        '        formAction={function action}\n' +
        '        ref={{current:null}}\n' +
        '+       formTarget="elsewhere"\n' +
        '-       formTarget={null}\n' +
        '      >\n' +
        '      <button\n' +
        '        formAction={function action}\n' +
        '        ref={{current:null}}\n' +
        '+       formEncType="text/plain"\n' +
        '-       formEncType={null}\n' +
        '      >\n' +
        '\n    in input (at **)' +
        '\n    in App (at **)',
    ]);
    await act(async () => {
      root.render(<App isUpdate={true} />);
    });
    expect(formRef.current.getAttribute('action')).toBe('action');
    expect(formRef.current.hasAttribute('encType')).toBe(false);
    expect(formRef.current.getAttribute('method')).toBe('DELETE');
    expect(formRef.current.hasAttribute('target')).toBe(false);

    expect(inputRef.current.getAttribute('formAction')).toBe('action');
    expect(inputRef.current.hasAttribute('name')).toBe(false);
    expect(inputRef.current.hasAttribute('formEncType')).toBe(false);
    expect(inputRef.current.hasAttribute('formMethod')).toBe(false);
    expect(inputRef.current.getAttribute('formTarget')).toBe('elsewhere');

    expect(buttonRef.current.getAttribute('formAction')).toBe('action');
    expect(buttonRef.current.hasAttribute('name')).toBe(false);
    expect(buttonRef.current.getAttribute('formEncType')).toBe('text/plain');
    expect(buttonRef.current.hasAttribute('formMethod')).toBe(false);
    expect(buttonRef.current.hasAttribute('formTarget')).toBe(false);
  });

  /** 测试场景：验证「useFormStatus is not pending during server render」描述的渲染、交互或错误处理结果。 */
  it('useFormStatus is not pending during server render', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const {pending} = useFormStatus();
      return 'Pending: ' + pending;
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    expect(container.textContent).toBe('Pending: false');

    await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    expect(container.textContent).toBe('Pending: false');
  });

  /** 测试场景：验证「should replay a form action after hydration」描述的渲染、交互或错误处理结果。 */
  it('should replay a form action after hydration', async () => {
    let foo;
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);

    // 在水合之前派发事件。
    submit(container.getElementsByTagName('form')[0]);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    // 现在应该再播放了
    expect(foo).toBe('bar');
  });

  /** 测试场景：验证「should replay input/button formAction」描述的渲染、交互或错误处理结果。 */
  it('should replay input/button formAction', async () => {
    let rootActionCalled = false;
    let savedTitle = null;
    let deletedTitle = null;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      rootActionCalled = true;
    }

    /** `saveItem`：封装当前用例复用的操作、回调或断言步骤。 */
    function saveItem(formData) {
      savedTitle = formData.get('title');
    }

    /** `deleteItem`：封装当前用例复用的操作、回调或断言步骤。 */
    function deleteItem(formData) {
      deletedTitle = formData.get('title');
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action}>
          <input type="text" name="title" defaultValue="Hello" />
          <input type="submit" formAction={saveItem} value="Save" />
          <button formAction={deleteItem}>Delete</button>
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);

    submit(container.getElementsByTagName('input')[1]);
    submit(container.getElementsByTagName('button')[0]);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(savedTitle).toBe('Hello');
    expect(deletedTitle).toBe('Hello');
    expect(rootActionCalled).toBe(false);
  });

  /** 测试场景：验证「useOptimistic returns passthrough value」描述的渲染、交互或错误处理结果。 */
  it('useOptimistic returns passthrough value', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [optimisticState] = useOptimistic('hi');
      return optimisticState;
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    expect(container.textContent).toBe('hi');

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container.textContent).toBe('hi');
  });

  /** 测试场景：验证「useActionState returns initial state」描述的渲染、交互或错误处理结果。 */
  it('useActionState returns initial state', async () => {
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    async function action(state) {
      return state;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state] = useActionState(action, 0);
      return state;
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);
    expect(container.textContent).toBe('0');

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container.textContent).toBe('0');
  });

  /** 测试场景：验证「can provide a custom action on the server for actions」描述的渲染、交互或错误处理结果。 */
  it('can provide a custom action on the server for actions', async () => {
    const ref = React.createRef();
    let foo;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    action.$$FORM_ACTION = function (identifierPrefix) {
      const extraFields = new FormData();
      extraFields.append(identifierPrefix + 'hello', 'world');
      return {
        action: this.name,
        name: identifierPrefix,
        method: 'POST',
        encType: 'multipart/form-data',
        target: 'self',
        data: extraFields,
      };
    };
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action} ref={ref} method={null}>
          <Suspense />
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);

    const form = container.firstChild;
    expect(form.getAttribute('action')).toBe('action');
    expect(form.getAttribute('method')).toBe('POST');
    expect(form.getAttribute('enctype')).toBe('multipart/form-data');
    expect(form.getAttribute('target')).toBe('self');
    const formActionName = form.firstChild.getAttribute('name');
    expect(
      container
        .querySelector('input[name="' + formActionName + 'hello"]')
        .getAttribute('value'),
    ).toBe('world');

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    submit(ref.current);

    expect(foo).toBe('bar');
  });

  /** 测试场景：验证「can provide a custom action on buttons the server for actions」描述的渲染、交互或错误处理结果。 */
  it('can provide a custom action on buttons the server for actions', async () => {
    const hiddenRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let foo;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    action.$$FORM_ACTION = function (identifierPrefix) {
      const extraFields = new FormData();
      extraFields.append(identifierPrefix + 'hello', 'world');
      return {
        action: this.name,
        name: identifierPrefix,
        method: 'POST',
        encType: 'multipart/form-data',
        target: 'self',
        data: extraFields,
      };
    };
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form>
          <input type="hidden" name="foo" value="bar" ref={hiddenRef} />
          <input
            type="submit"
            formAction={action}
            method={null}
            ref={inputRef}
          />
          <button formAction={action} ref={buttonRef} target={null} />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);

    const input = container.getElementsByTagName('input')[1];
    const button = container.getElementsByTagName('button')[0];
    expect(input.getAttribute('formaction')).toBe('action');
    expect(input.getAttribute('formmethod')).toBe('POST');
    expect(input.getAttribute('formenctype')).toBe('multipart/form-data');
    expect(input.getAttribute('formtarget')).toBe('self');
    expect(button.getAttribute('formaction')).toBe('action');
    expect(button.getAttribute('formmethod')).toBe('POST');
    expect(button.getAttribute('formenctype')).toBe('multipart/form-data');
    expect(button.getAttribute('formtarget')).toBe('self');
    const inputName = input.getAttribute('name');
    const buttonName = button.getAttribute('name');
    expect(
      container
        .querySelector('input[name="' + inputName + 'hello"]')
        .getAttribute('value'),
    ).toBe('world');
    expect(
      container
        .querySelector('input[name="' + buttonName + 'hello"]')
        .getAttribute('value'),
    ).toBe('world');

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(hiddenRef.current.name).toBe('foo');

    submit(inputRef.current);

    expect(foo).toBe('bar');

    foo = null;

    submit(buttonRef.current);

    expect(foo).toBe('bar');
  });

  /** 测试场景：验证「can hydrate hidden fields in the beginning of a form」描述的渲染、交互或错误处理结果。 */
  it('can hydrate hidden fields in the beginning of a form', async () => {
    const hiddenRef = React.createRef();

    let invoked = false;
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      invoked = true;
    }
    action.$$FORM_ACTION = function (identifierPrefix) {
      const extraFields = new FormData();
      extraFields.append(identifierPrefix + 'hello', 'world');
      return {
        action: '',
        name: identifierPrefix,
        method: 'POST',
        encType: 'multipart/form-data',
        data: extraFields,
      };
    };
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={action}>
          <input type="hidden" name="bar" defaultValue="baz" ref={hiddenRef} />
          <input type="text" name="foo" defaultValue="bar" />
        </form>
      );
    }

    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<App />),
    );
    await readIntoContainer(stream);

    const barField = container.querySelector('[name=bar]');

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(hiddenRef.current).toBe(barField);

    expect(hiddenRef.current.name).toBe('bar');
    expect(hiddenRef.current.value).toBe('baz');

    expect(container.querySelectorAll('[name=bar]').length).toBe(1);

    submit(hiddenRef.current.form);

    expect(invoked).toBe(true);
  });
});
