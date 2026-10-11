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

  /** 以 form 或 submitter 找到表单并派发可取消 submit；被阻止则结束，否则从 submitter/表单读取 URL，非 javascript 协议抛模拟导航错误；不执行真实导航。 */
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

  /** 读 Web 流至 done并按块 Buffer 解码，整体 parse 后调用插节点/执行脚本 helper；此调用没有 await helper 的返回结果，不模拟增量解析。 */
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

  /** SSR 函数 action 表单与 foo=bar 输入，水合绑定 ref 后提交；action 收到 bar，验证服务端函数 action 标记可接上客户端处理。 */
  it('should allow passing a function to form action during SSR', async () => {
    const ref = React.createRef();
    let foo;

    /** 读取提交 FormData 的 foo，供函数表单 action 衔接验证。 */
    function action(formData) {
      foo = formData.get('foo');
    }

    /** 函数 action 表单含 foo 默认值与 ref，供水合后实际 submit。 */
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

  /** SSR 同表单 input/button 分别 save/delete formAction，水合后分别提交；只有对应处理器读取 Hello，根 action 从不调用，验证 submitter 覆盖根 action。 */
  it('should allow passing a function to an input/button formAction', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let rootActionCalled = false;
    let savedTitle = null;
    let deletedTitle = null;

    /** 标记根 action 被调用，作为 submitter 覆盖失败的哨兵。 */
    function action(formData) {
      rootActionCalled = true;
    }

    /** 读取 title 写 savedTitle，供 input submitter 验证。 */
    function saveItem(formData) {
      savedTitle = formData.get('title');
    }

    /** 读取 title 写 deletedTitle，供 button submitter 验证。 */
    function deleteItem(formData) {
      deletedTitle = formData.get('title');
    }

    /** 同表单配置不同 input/button 函数 formAction，root action只作为 fallback。 */
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

  /** SSR action 为函数、水合改成字符串 action；开发报告未修补属性 mismatch并区分 function/string，验证单向类型变化诊断。 */
  it('should warn when passing a function action during SSR and string during hydration', async () => {

    /** 空函数用于 SSR action 标记，场景关注函数转字符串属性差异而不提交。 */
    function action(formData) {}

    /** isClient 时把函数 action 改为字符串，保持其余输入一致。 */
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

  /** SSR action 为字符串、水合改为函数；当前用例只执行水合而没有警告断言，记录该理想诊断尚未覆盖，不能说明已出现警告。 */
  it('should ideally warn when passing a string during SSR and function during hydration', async () => {

    /** 提供空客户端函数 action，使 SSR字符串到函数变化可水合。 */
    function action(formData) {}

    /** 按 isClient 在字符串与函数间切换，当前只检查流程可执行。 */
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

  /** 函数 action/formAction SSR 后水合，再更新为 URL 并指定 POST/target/enctype；验证函数协议强制的提交属性清除、显式字符串属性恢复，非输入用户值重置。 */
  it('should reset form fields after you update away from hydrated function', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();

    /** 空函数用于建立服务端函数提交协议，本例不执行提交。 */
    function action(formData) {}

    /** 更新时切换函数到 URL，显式设 form POST/input target/button enctype，供检查协议属性恢复。 */
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

  /** 函数 action/formAction SSR 后水合，更新为 undefined；form/input/button 的 action与强制 method/enctype/name/target 全部去除，验证移除函数协议的属性清理。 */
  it('should reset form fields after you remove a hydrated function', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();

    /** 空函数用于初始 SSR函数 action 元数据。 */
    function action(formData) {}

    /** 更新时移除 form及两 submitter 的 action，检查强制提交属性清理。 */
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

  /** 函数 action 与显式 DELETE、formTarget、text/plain 冲突，SSR 报覆盖警告、水合报属性差异；更新为字符串后这些显式属性恢复，验证即使前后 prop 值相同也恢复原提交元数据。 */
  it('should restore the form fields even if they were incorrectly set', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();

    /** 空函数 action 配合冲突提交属性，制造 SSR覆盖与更新恢复场景。 */
    function action(formData) {}

    /** 函数/字符串切换期间保持 DELETE/elsewhere/text/plain prop，要求从强制协议中恢复它们。 */
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

  /** App 只读取 useFormStatus.pending，SSR与水合均显示 false；验证没有活动提交时的初始状态，不覆盖 submit pending。 */
  it('useFormStatus is not pending during server render', async () => {

    /** 返回 useFormStatus.pending 初始值，未创建活动表单提交。 */
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

  /** 函数 action SSR 注入提交捕获脚本，在 hydrateRoot 前提交 foo=bar；水合后 action 收到 bar，验证尚无 React 监听时提交数据可排队后交付。 */
  it('should replay a form action after hydration', async () => {
    let foo;

    /** 读 foo，检验预水合提交重放的 FormData 内容。 */
    function action(formData) {
      foo = formData.get('foo');
    }

    /** SSR函数表单触发预水合提交脚本，保留 foo默认值。 */
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

    // 水合后队列交给已连接的客户端 action，使用提交时保存的 FormData。
    expect(foo).toBe('bar');
  });

  /** 水合前分别提交 input save 与 button delete；水合后两处理器均收到 Hello、根 action 未调用，验证预水合队列保留 submitter action 选择。 */
  it('should replay input/button formAction', async () => {
    let rootActionCalled = false;
    let savedTitle = null;
    let deletedTitle = null;

    /** 标记根 action；重放 submitter action 时应保持 false。 */
    function action(formData) {
      rootActionCalled = true;
    }

    /** 记录 input submitter 重放的 title。 */
    function saveItem(formData) {
      savedTitle = formData.get('title');
    }

    /** 记录 button submitter 重放的 title。 */
    function deleteItem(formData) {
      deletedTitle = formData.get('title');
    }

    /** 为预水合阶段提供两个不同 formAction 的 submitter。 */
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

  /** useOptimistic(hi) 从未派发乐观更新，SSR与水合都显示 hi；验证初始 passthrough 值。 */
  it('useOptimistic returns passthrough value', async () => {

    /** 读取 useOptimistic 的初始 passthrough 值，不调用派发函数。 */
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

  /** useActionState(action,0) 不提交，SSR与水合都输出 0；验证默认初始状态，不覆盖 action 执行或 pending。 */
  it('useActionState returns initial state', async () => {

    /** 异步原样返回 state，本例不派发，只提供 useActionState 所需 action。 */
    async function action(state) {
      return state;
    }

    /** 返回 useActionState 的初始 0状态，不渲染提交控件。 */
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

  /** action.$$FORM_ACTION 返回 POST/multipart/self及 prefix hidden fields；SSR 属性与隐藏数据精确匹配，水合后提交读取 foo=bar，验证渐进增强编码与客户端衔接。 */
  it('can provide a custom action on the server for actions', async () => {
    const ref = React.createRef();
    let foo;

    /** 读取 foo，验证服务端自定义编码水合后的真实客户端处理。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    /** 以服务端分配 prefix构造隐藏 FormData，返回函数 name URL、POST/multipart/self 元数据；this 是原 action 函数。 */
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

    /** form使用自定义编码 action，空 Suspense 与用户输入用于检验附加 hidden 协议不影响水合。 */
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

  /** input/button 使用自定义 $$FORM_ACTION，分别输出提交属性与各自 prefix 隐藏字段；水合后用户 hidden foo 身份/name保持且两种提交均读取 bar，验证 submitter 编码和 hydration 跳过协议字段。 */
  it('can provide a custom action on buttons the server for actions', async () => {
    const hiddenRef = React.createRef();
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let foo;

    /** 读取 foo，用于两个自定义编码 submitter 的提交。 */
    function action(formData) {
      foo = formData.get('foo');
    }
    /** 按各 submitter 的 prefix编码额外字段，返回同一 action name及POST/multipart/self。 */
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

    /** 用户 hidden foo 与input/button自定义 formAction同树，检验协议字段插入及提交元数据。 */
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

  /** 自定义函数 form action 在普通 hidden bar 前注入协议隐藏字段；水合仍复用原 bar 节点、值 baz且仅一份，提交可执行 action，验证开头附加 hidden 不错配用户字段。 */
  it('can hydrate hidden fields in the beginning of a form', async () => {
    const hiddenRef = React.createRef();

    let invoked = false;

    /** 标记是否调用 action，确认跳过协议隐藏字段后客户端函数仍连接。 */
    function action(formData) {
      invoked = true;
    }
    /** 返回空 URL及POST/multipart编码，并按 prefix添加额外 hidden 数据。 */
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

    /** 把用户 hidden bar放在实际 children 开头，供水合跳过提前注入的协议字段时复用。 */
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
