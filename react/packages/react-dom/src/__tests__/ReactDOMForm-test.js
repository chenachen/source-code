/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

global.IS_REACT_ACT_ENVIRONMENT = true;

// 当前 JSDOM 版本尚未实现事件派发，因此这里提供 polyfill。
const NativeFormData = global.FormData;
/** `FormDataPolyfill`：封装当前用例复用的操作、回调或断言步骤。 */
const FormDataPolyfill = function FormData(form, submitter) {
  const formData = new NativeFormData(form, submitter);
  const formDataEvent = new Event('formdata', {
    bubbles: true,
    cancelable: false,
  });
  formDataEvent.formData = formData;
  form.dispatchEvent(formDataEvent);
  return formData;
};
NativeFormData.prototype.constructor = FormDataPolyfill;
global.FormData = FormDataPolyfill;

describe('ReactDOMForm', () => {
  let act;
  let container;
  let React;
  let ReactDOM;
  let ReactDOMClient;
  let Scheduler;
  let assertLog;
  let assertConsoleErrorDev;
  let waitForThrow;
  let useState;
  let Suspense;
  let startTransition;
  let useTransition;
  let use;
  let textCache;
  let useFormStatus;
  let useActionState;
  let requestFormReset;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    waitForThrow = require('internal-test-utils').waitForThrow;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    useState = React.useState;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
    useTransition = React.useTransition;
    use = React.use;
    useFormStatus = ReactDOM.useFormStatus;
    requestFormReset = ReactDOM.requestFormReset;
    container = document.createElement('div');
    document.body.appendChild(container);

    textCache = new Map();

    if (__VARIANT__) {
      const originalConsoleError = console.error;
      console.error = (error, ...args) => {
        if (
          typeof error !== 'string' ||
          error.indexOf('ReactDOM.useFormState has been renamed') === -1
        ) {
          originalConsoleError(error, ...args);
        }
      };
      // API 删除后移除。
      useActionState = ReactDOM.useFormState;
    } else {
      useActionState = React.useActionState;
    }
  });

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
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
      thenable.pings.forEach(t => t(text));
    }
  }

  /** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);
      const thenable = {
        pings: [],
        /** `readText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** `getText`：封装当前用例复用的操作、回调或断言步骤。 */
  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        /** `getText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      return thenable;
    } else {
      switch (record.status) {
        case 'pending':
          return record.value;
        case 'rejected':
          return Promise.reject(record.value);
        case 'resolved':
          return Promise.resolve(record.value);
      }
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `submit`：封装当前用例复用的操作、回调或断言步骤。 */
  async function submit(submitter) {
    await act(() => {
      const form = submitter.form || submitter;
      if (!submitter.form) {
        submitter = undefined;
      }
      const submitEvent = new Event('submit', {
        bubbles: true,
        cancelable: true,
      });
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
    });
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should allow passing a function to form action」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接表单宿主状态、ReactDOMSharedInternals 与提交后受控值恢复路径。
   */
  it('should allow passing a function to form action', async () => {
    const ref = React.createRef();
    let foo;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      foo = formData.get('foo');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form action={action} ref={ref}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>,
      );
    });

    await submit(ref.current);

    expect(foo).toBe('bar');

    // 尝试更新 action。

    /** `action2`：封装当前用例复用的操作、回调或断言步骤。 */
    function action2(formData) {
      foo = formData.get('foo') + '2';
    }

    await act(async () => {
      root.render(
        <form action={action2} ref={ref}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>,
      );
    });

    await submit(ref.current);

    expect(foo).toBe('bar2');
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

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
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
        </form>,
      );
    });

    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe(null);

    await submit(inputRef.current);
    expect(savedTitle).toBe('Hello');
    expect(deletedTitle).toBe(null);
    savedTitle = null;

    await submit(buttonRef.current);
    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe('Hello');
    deletedTitle = null;

    // 尝试更新各个 action。

    /** `saveItem2`：封装当前用例复用的操作、回调或断言步骤。 */
    function saveItem2(formData) {
      savedTitle = formData.get('title') + '2';
    }

    /** `deleteItem2`：封装当前用例复用的操作、回调或断言步骤。 */
    function deleteItem2(formData) {
      deletedTitle = formData.get('title') + '2';
    }

    await act(async () => {
      root.render(
        <form action={action}>
          <input type="text" name="title" defaultValue="Hello" />
          <input
            type="submit"
            formAction={saveItem2}
            value="Save"
            ref={inputRef}
          />
          <button formAction={deleteItem2} ref={buttonRef}>
            Delete
          </button>
        </form>,
      );
    });

    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe(null);

    await submit(inputRef.current);
    expect(savedTitle).toBe('Hello2');
    expect(deletedTitle).toBe(null);
    savedTitle = null;

    await submit(buttonRef.current);
    expect(savedTitle).toBe(null);
    expect(deletedTitle).toBe('Hello2');

    expect(rootActionCalled).toBe(false);
  });

  /** 测试场景：验证「should allow preventing default to block the action」描述的渲染、交互或错误处理结果。 */
  it('should allow preventing default to block the action', async () => {
    const ref = React.createRef();
    let actionCalled = false;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      actionCalled = true;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form action={action} ref={ref} onSubmit={e => e.preventDefault()}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>,
      );
    });

    await submit(ref.current);

    expect(actionCalled).toBe(false);
  });

  /** 测试场景：验证「should submit the inner of nested forms」描述的渲染、交互或错误处理结果。 */
  it('should submit the inner of nested forms', async () => {
    const ref = React.createRef();
    let data;

    /** `outerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function outerAction(formData) {
      data = formData.get('data') + 'outer';
    }
    /** `innerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function innerAction(formData) {
      data = formData.get('data') + 'inner';
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      // 这不是有效 HTML，但仍覆盖这种边界情况。
      root.render(
        <form action={outerAction}>
          <input type="text" name="data" defaultValue="outer" />
          <form action={innerAction} ref={ref}>
            <input type="text" name="data" defaultValue="inner" />
          </form>
        </form>,
      );
    });
    assertConsoleErrorDev([
      'In HTML, <form> cannot be a descendant of <form>.\n' +
        'This will cause a hydration error.\n' +
        '\n' +
        '> <form action={function outerAction}>\n' +
        '    <input>\n' +
        '>   <form action={function innerAction} ref={{current:null}}>\n' +
        '\n    in form (at **)',
    ]);

    await submit(ref.current);

    expect(data).toBe('innerinner');
  });

  /** 测试场景：验证「should submit once if one root is nested inside the other」描述的渲染、交互或错误处理结果。 */
  it('should submit once if one root is nested inside the other', async () => {
    const ref = React.createRef();
    let outerCalled = 0;
    let innerCalled = 0;
    let bubbledSubmit = false;

    /** `outerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function outerAction(formData) {
      outerCalled++;
    }

    /** `innerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function innerAction(formData) {
      innerCalled++;
    }

    const innerContainerRef = React.createRef();
    const outerRoot = ReactDOMClient.createRoot(container);
    await act(async () => {
      outerRoot.render(
        // 嵌套表单不是有效 HTML，但仍覆盖这种边界情况。
        <div onSubmit={() => (bubbledSubmit = true)}>
          <form action={outerAction}>
            <div ref={innerContainerRef} />
          </form>
        </div>,
      );
    });

    const innerRoot = ReactDOMClient.createRoot(innerContainerRef.current);
    await act(async () => {
      innerRoot.render(
        <form action={innerAction} ref={ref}>
          <input type="text" name="data" defaultValue="inner" />
        </form>,
      );
    });

    await submit(ref.current);

    expect(bubbledSubmit).toBe(true);
    expect(outerCalled).toBe(0);
    expect(innerCalled).toBe(1);
  });

  /** 测试场景：验证「should submit once if a portal is nested inside its own root」描述的渲染、交互或错误处理结果。 */
  it('should submit once if a portal is nested inside its own root', async () => {
    const ref = React.createRef();
    let outerCalled = 0;
    let innerCalled = 0;
    let bubbledSubmit = false;

    /** `outerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function outerAction(formData) {
      outerCalled++;
    }

    /** `innerAction`：封装当前用例复用的操作、回调或断言步骤。 */
    function innerAction(formData) {
      innerCalled++;
    }

    const innerContainer = document.createElement('div');
    const innerContainerRef = React.createRef();
    const outerRoot = ReactDOMClient.createRoot(container);
    await act(async () => {
      outerRoot.render(
        // 嵌套表单不是有效 HTML，但仍覆盖这种边界情况。
        <div onSubmit={() => (bubbledSubmit = true)}>
          <form action={outerAction}>
            <div ref={innerContainerRef} />
            {ReactDOM.createPortal(
              <form action={innerAction} ref={ref}>
                <input type="text" name="data" defaultValue="inner" />
              </form>,
              innerContainer,
            )}
          </form>
        </div>,
      );
    });

    innerContainerRef.current.appendChild(innerContainer);

    await submit(ref.current);

    expect(bubbledSubmit).toBe(true);
    expect(outerCalled).toBe(0);
    expect(innerCalled).toBe(1);
  });

  /** 测试场景：验证「can read the clicked button in the formdata event」描述的渲染、交互或错误处理结果。 */
  it('can read the clicked button in the formdata event', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    const outsideButtonRef = React.createRef();
    const imageButtonRef = React.createRef();
    let button;
    let buttonX;
    let buttonY;
    let title;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      button = formData.get('button');
      buttonX = formData.get('button.x');
      buttonY = formData.get('button.y');
      title = formData.get('title');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <>
          <form action={action}>
            <input type="text" name="title" defaultValue="hello" />
            <input type="submit" name="button" value="save" />
            <input type="submit" name="button" value="delete" ref={inputRef} />
            <button name="button" value="edit" ref={buttonRef}>
              Edit
            </button>
            <input
              type="image"
              name="button"
              href="/some/image.png"
              ref={imageButtonRef}
            />
          </form>
          <form id="form" action={action}>
            <input type="text" name="title" defaultValue="hello" />
          </form>
          <button
            form="form"
            name="button"
            value="outside"
            ref={outsideButtonRef}>
            Button outside form
          </button>
          ,
        </>,
      );
    });

    container.addEventListener('formdata', e => {
      // 以某种方式在 formdata 事件中处理。
      if (e.formData.get('button') === 'delete') {
        e.formData.delete('title');
      }
    });

    await submit(inputRef.current);

    expect(button).toBe('delete');
    expect(title).toBe(null);

    await submit(buttonRef.current);

    expect(button).toBe('edit');
    expect(title).toBe('hello');

    await submit(outsideButtonRef.current);

    expect(button).toBe('outside');
    expect(title).toBe('hello');

    await submit(imageButtonRef.current);

    expect(button).toBe(null);
    expect(buttonX).toBe('0');
    expect(buttonY).toBe('0');
    expect(title).toBe('hello');
  });

  /** 测试场景：验证「excludes the submitter name when the submitter is a function action」描述的渲染、交互或错误处理结果。 */
  it('excludes the submitter name when the submitter is a function action', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let button;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      // 函数形式的 action 不能控制 name，因为它可能由服务端控制；必须确保该 name 不会进入 FormData。
      button = formData.get('button');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form>
          <input
            type="submit"
            name="button"
            value="delete"
            ref={inputRef}
            formAction={action}
          />
          <button
            name="button"
            value="edit"
            ref={buttonRef}
            formAction={action}>
            Edit
          </button>
        </form>,
      );
    });
    assertConsoleErrorDev([
      'Cannot specify a "name" prop for a button that specifies a function as a formAction. ' +
        'React needs it to encode which action should be invoked. ' +
        'It will get overridden.\n' +
        '    in input (at **)',
    ]);

    await submit(inputRef.current);

    expect(button).toBe(null);

    await submit(buttonRef.current);

    expect(button).toBe(null);

    // 确保类型字段已正确恢复
    expect(inputRef.current.getAttribute('type')).toBe('submit');
    expect(buttonRef.current.getAttribute('type')).toBe(null);
  });

  /** 测试场景：验证「allows a non-function formaction to override a function one」描述的渲染、交互或错误处理结果。 */
  it('allows a non-function formaction to override a function one', async () => {
    const ref = React.createRef();
    let actionCalled = false;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      actionCalled = true;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form action={action}>
          <input
            type="submit"
            formAction="http://example.com/submit"
            ref={ref}
          />
        </form>,
      );
    });

    let nav;
    try {
      await submit(ref.current);
    } catch (x) {
      nav = x.message;
    }
    expect(nav).toBe('Navigate to: http://example.com/submit');
    expect(actionCalled).toBe(false);
  });

  /** 测试场景：验证「allows a non-react html formaction to be invoked」描述的渲染、交互或错误处理结果。 */
  it('allows a non-react html formaction to be invoked', async () => {
    let actionCalled = false;

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    function action(formData) {
      actionCalled = true;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form
          action={action}
          dangerouslySetInnerHTML={{
            __html: `
            <input
              type="submit"
              formAction="http://example.com/submit"
            />
          `,
          }}
        />,
      );
    });

    const node = container.getElementsByTagName('input')[0];
    let nav;
    try {
      await submit(node);
    } catch (x) {
      nav = x.message;
    }
    expect(nav).toBe('Navigate to: http://example.com/submit');
    expect(actionCalled).toBe(false);
  });

  /** 测试场景：验证「form actions are transitions」描述的渲染、交互或错误处理结果。 */
  it('form actions are transitions', async () => {
    const formRef = React.createRef();

    /** `Status`：封装当前用例复用的操作、回调或断言步骤。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, setState] = useState('Initial');
      return (
        <form action={() => setState('Updated')} ref={formRef}>
          <Status />
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={state} />
          </Suspense>
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await resolveText('Initial');
    await act(() => root.render(<App />));
    assertLog(['Initial']);
    expect(container.textContent).toBe('Initial');

    // form action 会隐式包裹在 startTransition 中，因此这里应当挂起。
    await submit(formRef.current);
    assertLog(['Pending...', 'Suspend! [Updated]', 'Loading...']);
    expect(container.textContent).toBe('Pending...Initial');

    await act(() => resolveText('Updated'));
    assertLog(['Updated']);
    expect(container.textContent).toBe('Updated');
  });

  /** 测试场景：验证「multiple form actions」描述的渲染、交互或错误处理结果。 */
  it('multiple form actions', async () => {
    const formRef = React.createRef();

    /** `Status`：封装当前用例复用的操作、回调或断言步骤。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, setState] = useState(0);
      return (
        <form action={() => setState(n => n + 1)} ref={formRef}>
          <Status />
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={'Count: ' + state} />
          </Suspense>
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await resolveText('Count: 0');
    await act(() => root.render(<App />));
    assertLog(['Count: 0']);
    expect(container.textContent).toBe('Count: 0');

    // 更新。
    await submit(formRef.current);
    assertLog(['Pending...', 'Suspend! [Count: 1]', 'Loading...']);
    expect(container.textContent).toBe('Pending...Count: 0');

    await act(() => resolveText('Count: 1'));
    assertLog(['Count: 1']);
    expect(container.textContent).toBe('Count: 1');

    // 再次更新。
    await submit(formRef.current);
    assertLog(['Pending...', 'Suspend! [Count: 2]', 'Loading...']);
    expect(container.textContent).toBe('Pending...Count: 1');

    await act(() => resolveText('Count: 2'));
    assertLog(['Count: 2']);
    expect(container.textContent).toBe('Count: 2');
  });

  /** 测试场景：验证「form actions can be asynchronous」描述的渲染、交互或错误处理结果。 */
  it('form actions can be asynchronous', async () => {
    const formRef = React.createRef();

    /** `Status`：封装当前用例复用的操作、回调或断言步骤。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, setState] = useState('Initial');
      return (
        <form
          action={async () => {
            Scheduler.log('Async action started');
            await getText('Wait');
            startTransition(() => setState('Updated'));
          }}
          ref={formRef}>
          <Status />
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={state} />
          </Suspense>
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await resolveText('Initial');
    await act(() => root.render(<App />));
    assertLog(['Initial']);
    expect(container.textContent).toBe('Initial');

    await submit(formRef.current);
    assertLog(['Async action started', 'Pending...']);

    await act(() => resolveText('Wait'));
    assertLog(['Suspend! [Updated]', 'Loading...']);
    expect(container.textContent).toBe('Pending...Initial');

    await act(() => resolveText('Updated'));
    assertLog(['Updated']);
    expect(container.textContent).toBe('Updated');
  });

  /** 测试场景：验证「sync errors in form actions can be captured by an error boundary」描述的渲染、交互或错误处理结果。 */
  it('sync errors in form actions can be captured by an error boundary', async () => {
    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const formRef = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <ErrorBoundary>
          <form
            action={() => {
              throw new Error('Oh no!');
            }}
            ref={formRef}>
            <Text text="Everything is fine" />
          </form>
        </ErrorBoundary>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Everything is fine']);
    expect(container.textContent).toBe('Everything is fine');

    await submit(formRef.current);
    assertLog(['Oh no!', 'Oh no!']);
    expect(container.textContent).toBe('Oh no!');
  });

  /** 测试场景：验证「async errors in form actions can be captured by an error boundary」描述的渲染、交互或错误处理结果。 */
  it('async errors in form actions can be captured by an error boundary', async () => {
    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const formRef = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <ErrorBoundary>
          <form
            action={async () => {
              Scheduler.log('Async action started');
              await getText('Wait');
              throw new Error('Oh no!');
            }}
            ref={formRef}>
            <Text text="Everything is fine" />
          </form>
        </ErrorBoundary>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Everything is fine']);
    expect(container.textContent).toBe('Everything is fine');

    await submit(formRef.current);
    assertLog(['Async action started']);
    expect(container.textContent).toBe('Everything is fine');

    await act(() => resolveText('Wait'));
    assertLog(['Oh no!', 'Oh no!']);
    expect(container.textContent).toBe('Oh no!');
  });

  /** 测试场景：验证「useFormStatus reads the status of a pending form action」描述的渲染、交互或错误处理结果。 */
  it('useFormStatus reads the status of a pending form action', async () => {
    const formRef = React.createRef();

    /** `Status`：封装当前用例复用的操作、回调或断言步骤。 */
    function Status() {
      const {pending, data, action, method} = useFormStatus();
      if (!pending) {
        return <Text text="No pending action" />;
      } else {
        const foo = data.get('foo');
        return (
          <Text
            text={`Pending action ${action.name}: foo is ${foo}, method is ${method}`}
          />
        );
      }
    }

    /** `myAction`：封装当前用例复用的操作、回调或断言步骤。 */
    async function myAction() {
      Scheduler.log('Async action started');
      await getText('Wait');
      Scheduler.log('Async action finished');
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form action={myAction} ref={formRef}>
          <input type="text" name="foo" defaultValue="bar" />
          <Status />
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['No pending action']);
    expect(container.textContent).toBe('No pending action');

    await submit(formRef.current);
    assertLog([
      'Async action started',
      'Pending action myAction: foo is bar, method is get',
    ]);
    expect(container.textContent).toBe(
      'Pending action myAction: foo is bar, method is get',
    );

    await act(() => resolveText('Wait'));
    assertLog(['Async action finished', 'No pending action']);
  });

  /** 测试场景：验证「should error if submitting a form manually」描述的渲染、交互或错误处理结果。 */
  it('should error if submitting a form manually', async () => {
    const ref = React.createRef();

    let error = null;
    let result = null;

    /** `emulateForceSubmit`：封装当前用例复用的操作、回调或断言步骤。 */
    function emulateForceSubmit(submitter) {
      const form = submitter.form || submitter;
      const action =
        (submitter && submitter.getAttribute('formaction')) || form.action;
      try {
        if (!/\s*javascript:/i.test(action)) {
          throw new Error('Navigate to: ' + action);
        } else {
          // eslint-disable-next-line no-new-func
          result = Function(action.slice(11))();
        }
      } catch (x) {
        error = x;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <form
          action={() => {}}
          ref={ref}
          onSubmit={e => {
            e.preventDefault();
            emulateForceSubmit(e.target);
          }}>
          <input type="text" name="foo" defaultValue="bar" />
        </form>,
      );
    });

    // 这会提交表单；提交先被阻塞，随后再次提交。这是较常见的写法，但除非使用 requestSubmit()，否则不支持此模式。
    await submit(ref.current);
    expect(result).toBe(null);
    expect(error.message).toContain(
      'A React form was unexpectedly submitted. If you called form.submit()',
    );
  });

  /** 测试场景：验证「useActionState updates state asynchronously and queues multiple actions」描述的渲染、交互或错误处理结果。 */
  it('useActionState updates state asynchronously and queues multiple actions', async () => {
    let actionCounter = 0;
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    async function action(state, type) {
      actionCounter++;

      Scheduler.log(`Async action started [${actionCounter}]`);
      await getText(`Wait [${actionCounter}]`);

      switch (type) {
        case 'increment':
          return state + 1;
        case 'decrement':
          return state - 1;
        default:
          return state;
      }
    }

    let dispatch;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, _dispatch, isPending] = useActionState(action, 0);
      dispatch = _dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['0']);
    expect(container.textContent).toBe('0');

    await act(() => startTransition(() => dispatch('increment')));
    assertLog(['Async action started [1]', 'Pending 0']);
    expect(container.textContent).toBe('Pending 0');

    // 再派发几个 action；前一个完成前，后续 action 都不会开始。
    await act(() => startTransition(() => dispatch('increment')));
    await act(() => startTransition(() => dispatch('decrement')));
    await act(() => startTransition(() => dispatch('increment')));
    assertLog([]);

    // 每个 action 都在前一个完成后立即开始。注意：这些 action 更新同一队列并相互纠缠，因此 React 不会在它们之间渲染；这是预期行为。
    await act(() => resolveText('Wait [1]'));
    assertLog(['Async action started [2]']);
    await act(() => resolveText('Wait [2]'));
    assertLog(['Async action started [3]']);
    await act(() => resolveText('Wait [3]'));
    assertLog(['Async action started [4]']);
    await act(() => resolveText('Wait [4]'));

    // 最后一个 action 完成后，即可渲染结果。
    assertLog(['2']);
    expect(container.textContent).toBe('2');
  });

  /** 测试场景：验证「useActionState supports inline actions」描述的渲染、交互或错误处理结果。 */
  it('useActionState supports inline actions', async () => {
    let increment;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({stepSize}) {
      const [state, dispatch, isPending] = useActionState(async prevState => {
        return prevState + stepSize;
      }, 0);
      increment = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    // 初始渲染
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App stepSize={1} />));
    assertLog(['0']);

    // 执行一个 action；它会按 stepSize prop 的定义将 state 增加 1。
    await act(() => startTransition(() => increment()));
    assertLog(['Pending 0', '1']);

    // 现在把 stepSize prop 增加到 10；后续每一步都会增加 10。
    await act(() => root.render(<App stepSize={10} />));
    assertLog(['1']);

    // 再次递增，state 应增加 10。
    await act(() => startTransition(() => increment()));
    assertLog(['Pending 1', '11']);
  });

  /** 测试场景：验证「useActionState: dispatch throws if called during render」描述的渲染、交互或错误处理结果。 */
  it('useActionState: dispatch throws if called during render', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState(async () => {}, 0);
      dispatch();
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
      await waitForThrow('Cannot update action state while rendering.');
    });
  });

  /** 测试场景：验证「useActionState: queues multiple actions and runs them in order」描述的渲染、交互或错误处理结果。 */
  it('useActionState: queues multiple actions and runs them in order', async () => {
    let action;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState(
        async (s, a) => await getText(a),
        'A',
      );
      action = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['A']);

    await act(() => startTransition(() => action('B')));
    // 第一次 dispatch 会更新 pending 状态。
    assertLog(['Pending A']);
    await act(() => startTransition(() => action('C')));
    await act(() => startTransition(() => action('D')));
    assertLog([]);

    await act(() => resolveText('B'));
    await act(() => resolveText('C'));
    await act(() => resolveText('D'));

    assertLog(['D']);
    expect(container.textContent).toBe('D');
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'useActionState: when calling a queued action, uses the implementation ' +
      'that was current at the time it was dispatched, not the most recent one',
    async () => {
      let action;
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({throwIfActionIsDispatched}) {
        const [state, dispatch, isPending] = useActionState(async (s, a) => {
          if (throwIfActionIsDispatched) {
            throw new Error('Oops!');
          }
          return await getText(a);
        }, 'Initial');
        action = dispatch;
        return <Text text={state + (isPending ? ' (pending)' : '')} />;
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<App throwIfActionIsDispatched={false} />));
      assertLog(['Initial']);

      // 派发两个 action。第一个是异步 action，因此会迫使第二个进入异步队列。
      await act(() => startTransition(() => action('First action')));
      assertLog(['Initial (pending)']);
      // 这个动作将在第一个动作完成后运行。
      await act(() => startTransition(() => action('Second action')));

      // 第一个 action 仍处于 pending 时更新 prop。这会改变内联 action 实现，但不应影响已经入队的 action。
      await act(() => root.render(<App throwIfActionIsDispatched={true} />));
      assertLog(['Initial (pending)']);

      // 完成两个操作。
      await act(() => resolveText('First action'));
      await act(() => resolveText('Second action'));
      assertLog(['Second action']);

      // 确认我们再次发送另一个动作时， 它使用了更新的动作实现。
      await expect(
        act(() => startTransition(() => action('Third action'))),
      ).rejects.toThrow('Oops!');
    },
  );

  /** 测试场景：验证「useActionState: works if action is sync」描述的渲染、交互或错误处理结果。 */
  it('useActionState: works if action is sync', async () => {
    let increment;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({stepSize}) {
      const [state, dispatch, isPending] = useActionState(prevState => {
        return prevState + stepSize;
      }, 0);
      increment = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    // 初始渲染
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App stepSize={1} />));
    assertLog(['0']);

    // 执行一个 action；它会按 stepSize prop 的定义将 state 增加 1。
    await act(() => startTransition(() => increment()));
    assertLog(['Pending 0', '1']);

    // 现在把 stepSize prop 增加到 10；后续每一步都会增加 10。
    await act(() => root.render(<App stepSize={10} />));
    assertLog(['1']);

    // 再次递增，state 应增加 10。
    await act(() => startTransition(() => increment()));
    assertLog(['Pending 1', '11']);
  });

  /** 测试场景：验证「useActionState: can mix sync and async actions」描述的渲染、交互或错误处理结果。 */
  it('useActionState: can mix sync and async actions', async () => {
    let action;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState((s, a) => a, 'A');
      action = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['A']);

    await act(() => startTransition(() => action(getText('B'))));
    // 第一次 dispatch 会更新 pending 状态。
    assertLog(['Pending A']);
    await act(() => startTransition(() => action('C')));
    await act(() => startTransition(() => action(getText('D'))));
    await act(() => startTransition(() => action('E')));
    assertLog([]);

    await act(() => resolveText('B'));
    await act(() => resolveText('D'));
    assertLog(['E']);
    expect(container.textContent).toBe('E');
  });

  /** 测试场景：验证「useActionState: error handling (sync action)」描述的渲染、交互或错误处理结果。 */
  it('useActionState: error handling (sync action)', async () => {
    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState((s, a) => {
        if (a.endsWith('!')) {
          throw new Error(a);
        }
        return a;
      }, 'A');
      action = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      ),
    );
    assertLog(['A']);

    await act(() => startTransition(() => action('Oops!')));
    assertLog([
      // action 已开始，错误尚未抛出。
      'Pending A',
      // 现在动作运行并抛出错误。
      'Caught an error: Oops!',
      'Caught an error: Oops!',
    ]);
    expect(container.textContent).toBe('Caught an error: Oops!');
  });

  /** 测试场景：验证「useActionState: error handling (async action)」描述的渲染、交互或错误处理结果。 */
  it('useActionState: error handling (async action)', async () => {
    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState(async (s, a) => {
        const text = await getText(a);
        if (text.endsWith('!')) {
          throw new Error(text);
        }
        return text;
      }, 'A');
      action = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      ),
    );
    assertLog(['A']);

    await act(() => startTransition(() => action('Oops!')));
    // 第一次 dispatch 会更新 pending 状态。
    assertLog(['Pending A']);
    await act(() => resolveText('Oops!'));
    assertLog(['Caught an error: Oops!', 'Caught an error: Oops!']);
    expect(container.textContent).toBe('Caught an error: Oops!');
  });

  /** 测试场景：验证「useActionState: when an action errors, subsequent actions are canceled」描述的渲染、交互或错误处理结果。 */
  it('useActionState: when an action errors, subsequent actions are canceled', async () => {
    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, dispatch, isPending] = useActionState(async (s, a) => {
        Scheduler.log('Start action: ' + a);
        const text = await getText(a);
        if (text.endsWith('!')) {
          throw new Error(text);
        }
        return text;
      }, 'A');
      action = dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      ),
    );
    assertLog(['A']);

    await act(() => startTransition(() => action('Oops!')));
    assertLog(['Start action: Oops!', 'Pending A']);

    // 在将要报错的 action 后再排入一个 action。
    await act(() => startTransition(() => action('Should never run')));
    assertLog([]);

    // 第一次 dispatch 会更新 pending 状态。
    await act(() => resolveText('Oops!'));
    assertLog(['Caught an error: Oops!', 'Caught an error: Oops!']);
    expect(container.textContent).toBe('Caught an error: Oops!');

    // 尝试再派发一个 action；它也不应执行。
    await act(() =>
      startTransition(() => action('This also should never run')),
    );
    assertLog([]);
    expect(container.textContent).toBe('Caught an error: Oops!');
  });

  /** 测试场景：验证「useActionState works in StrictMode」描述的渲染、交互或错误处理结果。 */
  it('useActionState works in StrictMode', async () => {
    let actionCounter = 0;
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    async function action(state, type) {
      actionCounter++;

      Scheduler.log(`Async action started [${actionCounter}]`);
      await getText(`Wait [${actionCounter}]`);

      switch (type) {
        case 'increment':
          return state + 1;
        case 'decrement':
          return state - 1;
        default:
          return state;
      }
    }

    let dispatch;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, _dispatch, isPending] = useActionState(action, 0);
      dispatch = _dispatch;
      const pending = isPending ? 'Pending ' : '';
      return <Text text={pending + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      ),
    );
    assertLog(['0']);
    expect(container.textContent).toBe('0');

    await act(() => startTransition(() => dispatch('increment')));
    assertLog(['Async action started [1]', 'Pending 0']);
    expect(container.textContent).toBe('Pending 0');

    await act(() => resolveText('Wait [1]'));
    assertLog(['1']);
    expect(container.textContent).toBe('1');
  });

  /** 测试场景：验证「useActionState does not wrap action in a transition unless dispatch is in a transition」描述的渲染、交互或错误处理结果。 */
  it('useActionState does not wrap action in a transition unless dispatch is in a transition', async () => {
    let dispatch;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, _dispatch] = useActionState(() => {
        return state + 1;
      }, 0);
      dispatch = _dispatch;
      return <AsyncText text={'Count: ' + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <App />
        </Suspense>,
      ),
    );
    assertLog([
      'Suspend! [Count: 0]',
      'Loading...',
      // 预热阶段
      'Suspend! [Count: 0]',
    ]);
    await act(() => resolveText('Count: 0'));
    assertLog(['Count: 0']);

    // 在 transition 外派发；这会触发 loading 状态。
    await act(() => dispatch());
    assertLog([
      'Suspend! [Count: 1]',
      'Loading...',
      // 预热阶段
      'Suspend! [Count: 1]',
    ]);
    expect(container.textContent).toBe('Loading...');

    await act(() => resolveText('Count: 1'));
    assertLog(['Count: 1']);
    expect(container.textContent).toBe('Count: 1');

    // 现在在 transition 内派发；这次不会触发 loading 状态。
    await act(() => startTransition(() => dispatch()));
    assertLog(['Count: 1', 'Suspend! [Count: 2]', 'Loading...']);
    expect(container.textContent).toBe('Count: 1');

    await act(() => resolveText('Count: 2'));
    assertLog(['Count: 2']);
    expect(container.textContent).toBe('Count: 2');
  });

  /** 测试场景：验证「useActionState warns if async action is dispatched outside of a transition」描述的渲染、交互或错误处理结果。 */
  it('useActionState warns if async action is dispatched outside of a transition', async () => {
    let dispatch;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [state, _dispatch] = useActionState(async () => {
        return state + 1;
      }, 0);
      dispatch = _dispatch;
      return <AsyncText text={'Count: ' + state} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog([
      'Suspend! [Count: 0]',
      // 预热阶段
      'Suspend! [Count: 0]',
    ]);
    await act(() => resolveText('Count: 0'));
    assertLog(['Count: 0']);

    // 在过渡之外发送。
    await act(() => dispatch());
    assertConsoleErrorDev([
      'An async function with useActionState was called outside of a transition. ' +
        'This is likely not what you intended (for example, isPending will not update ' +
        'correctly). Either call the returned function inside startTransition, or pass it ' +
        'to an `action` or `formAction` prop.',
    ]);
    assertLog([
      'Suspend! [Count: 1]',
      // 预热阶段
      'Suspend! [Count: 1]',
    ]);
    expect(container.textContent).toBe('Count: 0');
  });

  /** 测试场景：验证「uncontrolled form inputs are reset after the action completes」描述的渲染、交互或错误处理结果。 */
  it('uncontrolled form inputs are reset after the action completes', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const divRef = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({promiseForUsername}) {
      // 让这里挂起，以模拟 RSC 流式传输。
      const username = use(promiseForUsername);

      return (
        <form
          ref={formRef}
          action={async formData => {
            const rawUsername = formData.get('username');
            const normalizedUsername = rawUsername.trim().toLowerCase();

            Scheduler.log(`Async action started`);
            await getText('Wait');

            // 更新应用以使用新数据。 这类似于从根重新渲染，使用新的 RSC 数据。
            startTransition(() => {
              root.render(
                <App promiseForUsername={getText(normalizedUsername)} />,
              );
            });
          }}>
          <input
            ref={inputRef}
            text="text"
            name="username"
            defaultValue={username}
          />
          <div ref={divRef}>
            <Text text={'Current username: ' + username} />
          </div>
        </form>
      );
    }

    // 初始渲染
    const root = ReactDOMClient.createRoot(container);
    const promiseForInitialUsername = getText('(empty)');
    await resolveText('(empty)');
    await act(() =>
      root.render(<App promiseForUsername={promiseForInitialUsername} />),
    );
    assertLog(['Current username: (empty)']);
    expect(divRef.current.textContent).toEqual('Current username: (empty)');

    // 修改未受控 input，使其 DOM 值进入 dirty 状态。
    inputRef.current.value = '  AcdLite  ';

    // 提交表单。 这会引发异步操作.
    await submit(formRef.current);
    assertLog(['Async action started']);
    expect(inputRef.current.value).toBe('  AcdLite  ');

    // 完成异步 action：它会用来自 `server` 的新数据触发根级重渲染，并发生挂起。
    // 此时还不能重置表单，因为必须先更新 `defaultValue`，所以要等待渲染完成。
    await act(() => resolveText('Wait'));
    assertLog([]);
    // DOM input 仍处于 dirty 状态。
    expect(inputRef.current.value).toBe('  AcdLite  ');
    // React 树处于挂起状态。
    expect(divRef.current.textContent).toEqual('Current username: (empty)');

    // 解除挂起并完成渲染；现在应重置表单。
    await act(() => resolveText('acdlite'));
    assertLog(['Current username: acdlite']);
    // 表单被重置为从服务器获取的新值。
    expect(inputRef.current.value).toBe('acdlite');
    expect(divRef.current.textContent).toEqual('Current username: acdlite');
  });

  /** 测试场景：验证「should fire onReset on automatic form reset」描述的渲染、交互或错误处理结果。 */
  it('should fire onReset on automatic form reset', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();

    let setValue;
    const defaultValue = 0;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({promiseForUsername}) {
      const [value, _setValue] = useState(defaultValue);
      setValue = _setValue;

      return (
        <form
          ref={formRef}
          action={async formData => {
            Scheduler.log(`Async action started`);
            await getText('Wait');
          }}
          onReset={() => {
            setValue(defaultValue);
          }}>
          <input
            ref={inputRef}
            text="text"
            name="amount"
            value={value}
            onChange={event => setValue(event.currentTarget.value)}
          />
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));

    // 把受控 input 改为 dirty 状态。
    await act(() => setValue('3'));
    expect(inputRef.current.value).toEqual('3');

    // 提交表单。 这会引发异步操作.
    await submit(formRef.current);
    assertLog(['Async action started']);

    // 我们还没有重置。
    expect(inputRef.current.value).toEqual('3');

    // action 完成；onReset 已触发，并已手动重置各值。
    await act(() => resolveText('Wait'));
    assertLog([]);
    expect(inputRef.current.value).toEqual('0');
  });

  /** 测试场景：验证「requestFormReset schedules a form reset after transition completes」描述的渲染、交互或错误处理结果。 */
  it('requestFormReset schedules a form reset after transition completes', async () => {
    // 此测试与上一个相同，区别是表单由 userspace action 更新，而不是内置 form action。

    const formRef = React.createRef();
    const inputRef = React.createRef();
    const divRef = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({promiseForUsername}) {
      // 让这里挂起，以模拟 RSC 流式传输。
      const username = use(promiseForUsername);

      return (
        <form ref={formRef}>
          <input
            ref={inputRef}
            text="text"
            name="username"
            defaultValue={username}
          />
          <div ref={divRef}>
            <Text text={'Current username: ' + username} />
          </div>
        </form>
      );
    }

    // 初始渲染
    const root = ReactDOMClient.createRoot(container);
    const promiseForInitialUsername = getText('(empty)');
    await resolveText('(empty)');
    await act(() =>
      root.render(<App promiseForUsername={promiseForInitialUsername} />),
    );
    assertLog(['Current username: (empty)']);
    expect(divRef.current.textContent).toEqual('Current username: (empty)');

    // 修改未受控 input，使其 DOM 值进入 dirty 状态。
    inputRef.current.value = '  AcdLite  ';

    // 这是 userspace action，不会触发真实表单提交。实际用途是通过 onSubmit 实现自定义 action prop，同时保留内置表单重置行为。
    await act(() => {
      startTransition(async () => {
        const form = formRef.current;
        const formData = new FormData(form);
        requestFormReset(form);

        const rawUsername = formData.get('username');
        const normalizedUsername = rawUsername.trim().toLowerCase();

        Scheduler.log(`Async action started`);
        await getText('Wait');

        // 更新应用以使用新数据。 这类似于从根重新渲染，使用新的 RSC 数据。
        startTransition(() => {
          root.render(<App promiseForUsername={getText(normalizedUsername)} />);
        });
      });
    });
    assertLog(['Async action started']);
    expect(inputRef.current.value).toBe('  AcdLite  ');

    // 完成异步 action：它会用来自 `server` 的新数据触发根级重渲染，并发生挂起。
    // 此时还不能重置表单，因为必须先更新 `defaultValue`，所以要等待渲染完成。
    await act(() => resolveText('Wait'));
    assertLog([]);
    // DOM input 仍处于 dirty 状态。
    expect(inputRef.current.value).toBe('  AcdLite  ');
    // React 树处于挂起状态。
    expect(divRef.current.textContent).toEqual('Current username: (empty)');

    // 解除挂起并完成渲染；现在应重置表单。
    await act(() => resolveText('acdlite'));
    assertLog(['Current username: acdlite']);
    // 表单被重置为从服务器获取的新值。
    expect(inputRef.current.value).toBe('acdlite');
    expect(divRef.current.textContent).toEqual('Current username: acdlite');
  });

  /** 测试场景：验证「parallel form submissions do not throw」描述的渲染、交互或错误处理结果。 */
  it('parallel form submissions do not throw', async () => {
    const formRef = React.createRef();
    let resolve = null;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      /** `App.submitForm`：封装当前用例复用的操作、回调或断言步骤。 */
      async function submitForm() {
        Scheduler.log('Action');
        if (!resolve) {
          await new Promise(res => {
            resolve = res;
          });
        }
      }
      return <form ref={formRef} action={submitForm} />;
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));

    // 开始第一个表单提交
    await act(async () => {
      formRef.current.requestSubmit();
    });
    assertLog(['Action']);

    // 第一个 form action 仍处于 pending 时再次提交表单。
    await act(async () => {
      formRef.current.requestSubmit();
      resolve(); // 兑现 Promise，使第一个表单 action 得以完成。
    });
    assertLog(['Action']);
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'requestFormReset works with inputs that are not descendants ' +
      'of the form element',
    async () => {
      // 此测试与上一个相同，区别是 input 不是 form 子节点，而是通过 <input form="myform" /> 与之关联。

      const formRef = React.createRef();
      const inputRef = React.createRef();
      const divRef = React.createRef();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({promiseForUsername}) {
        // 让这里挂起，以模拟 RSC 流式传输。
        const username = use(promiseForUsername);

        return (
          <>
            <form id="myform" ref={formRef} />
            <input
              form="myform"
              ref={inputRef}
              text="text"
              name="username"
              defaultValue={username}
            />
            <div ref={divRef}>
              <Text text={'Current username: ' + username} />
            </div>
          </>
        );
      }

      // 初始渲染
      const root = ReactDOMClient.createRoot(container);
      const promiseForInitialUsername = getText('(empty)');
      await resolveText('(empty)');
      await act(() =>
        root.render(<App promiseForUsername={promiseForInitialUsername} />),
      );
      assertLog(['Current username: (empty)']);
      expect(divRef.current.textContent).toEqual('Current username: (empty)');

      // 修改未受控 input，使其 DOM 值进入 dirty 状态。
      inputRef.current.value = '  AcdLite  ';

      // 这是 userspace action，不会触发真实表单提交。实际用途是通过 onSubmit 实现自定义 action prop，同时保留内置表单重置行为。
      await act(() => {
        startTransition(async () => {
          const form = formRef.current;
          const formData = new FormData(form);
          requestFormReset(form);

          const rawUsername = formData.get('username');
          const normalizedUsername = rawUsername.trim().toLowerCase();

          Scheduler.log(`Async action started`);
          await getText('Wait');

          // 更新应用以使用新数据。 这类似于从根重新渲染，使用新的 RSC 数据。
          startTransition(() => {
            root.render(
              <App promiseForUsername={getText(normalizedUsername)} />,
            );
          });
        });
      });
      assertLog(['Async action started']);
      expect(inputRef.current.value).toBe('  AcdLite  ');

      // 完成异步 action：它会用来自 `server` 的新数据触发根级重渲染，并发生挂起。
      // 此时还不能重置表单，因为必须先更新 `defaultValue`，所以要等待渲染完成。
      await act(() => resolveText('Wait'));
      assertLog([]);
      // DOM input 仍处于 dirty 状态。
      expect(inputRef.current.value).toBe('  AcdLite  ');
      // React 树处于挂起状态。
      expect(divRef.current.textContent).toEqual('Current username: (empty)');

      // 解除挂起并完成渲染；现在应重置表单。
      await act(() => resolveText('acdlite'));
      assertLog(['Current username: acdlite']);
      // 表单被重置为从服务器获取的新值。
      expect(inputRef.current.value).toBe('acdlite');
      expect(divRef.current.textContent).toEqual('Current username: acdlite');
    },
  );

  /** 测试场景：验证「reset multiple forms in the same transition」描述的渲染、交互或错误处理结果。 */
  it('reset multiple forms in the same transition', async () => {
    const formRefA = React.createRef();
    const formRefB = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({promiseForA, promiseForB}) {
      // 让这些内容挂起，以模拟 RSC 流式传输。
      const a = use(promiseForA);
      const b = use(promiseForB);
      return (
        <>
          <form ref={formRefA}>
            <input type="text" name="inputName" defaultValue={a} />
          </form>
          <form ref={formRefB}>
            <input type="text" name="inputName" defaultValue={b} />
          </form>
        </>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    const initialPromiseForA = getText('A1');
    const initialPromiseForB = getText('B1');
    await resolveText('A1');
    await resolveText('B1');
    await act(() =>
      root.render(
        <App
          promiseForA={initialPromiseForA}
          promiseForB={initialPromiseForB}
        />,
      ),
    );

    // 修改未受控 inputs，使其 DOM 值进入 dirty 状态。
    formRefA.current.elements.inputName.value = '       A2       ';
    formRefB.current.elements.inputName.value = '       B2       ';

    // 触发一个异步操作，该操作更新并重置两个表单。
    await act(() => {
      startTransition(async () => {
        const currentA = formRefA.current.elements.inputName.value;
        const currentB = formRefB.current.elements.inputName.value;

        requestFormReset(formRefA.current);
        requestFormReset(formRefB.current);

        Scheduler.log('Async action started');
        await getText('Wait');

        // 假装服务器对数据做了什么。
        const normalizedA = currentA.trim();
        const normalizedB = currentB.trim();

        // 更新应用以使用新数据。 这类似于从根重新渲染，使用新的 RSC 数据。
        startTransition(() => {
          root.render(
            <App
              promiseForA={getText(normalizedA)}
              promiseForB={getText(normalizedB)}
            />,
          );
        });
      });
    });
    assertLog(['Async action started']);

    // 完成异步 action：它会用来自 `server` 的新数据触发根级重渲染，并发生挂起。
    // 此时还不能重置这些表单，因为必须先更新 `defaultValue`，所以要等待渲染完成。
    await act(() => resolveText('Wait'));

    // DOM inputs 仍处于 dirty 状态。
    expect(formRefA.current.elements.inputName.value).toBe('       A2       ');
    expect(formRefB.current.elements.inputName.value).toBe('       B2       ');

    // 解除挂起并完成渲染；现在应重置这些表单。
    await act(() => {
      resolveText('A2');
      resolveText('B2');
    });
    // 表单被重置为从服务器获取的新值。
    expect(formRefA.current.elements.inputName.value).toBe('A2');
    expect(formRefB.current.elements.inputName.value).toBe('B2');
  });

  /** 测试场景：验证「requestFormReset throws if the form is not managed by React」描述的渲染、交互或错误处理结果。 */
  it('requestFormReset throws if the form is not managed by React', async () => {
    container.innerHTML = `
      <form id="myform">
        <input id="input" type="text" name="greeting" />
      </form>
    `;

    const form = document.getElementById('myform');
    const input = document.getElementById('input');

    input.value = 'Hi!!!!!!!!!!!!!';

    expect(() => requestFormReset(form)).toThrow('Invalid form element.');
    // 表单未重置。
    expect(input.value).toBe('Hi!!!!!!!!!!!!!');

    // 确认普通的表单重置仍可正常工作。
    form.reset();
    expect(input.value).toBe('');
  });

  /** 测试场景：验证「requestFormReset throws on a non-form DOM element」描述的渲染、交互或错误处理结果。 */
  it('requestFormReset throws on a non-form DOM element', async () => {
    const root = ReactDOMClient.createRoot(container);
    const ref = React.createRef();
    await act(() => root.render(<div ref={ref}>Hi</div>));
    const div = ref.current;
    expect(div.textContent).toBe('Hi');

    expect(() => requestFormReset(div)).toThrow('Invalid form element.');
  });

  /** 测试场景：验证「warns if requestFormReset is called outside of a transition」描述的渲染、交互或错误处理结果。 */
  it('warns if requestFormReset is called outside of a transition', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <form ref={formRef}>
          <input ref={inputRef} type="text" defaultValue="Initial" />
        </form>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));

    // 修改未受控 input，使其 DOM 值进入 dirty 状态。
    inputRef.current.value = '  Updated  ';

    // 触发一个异步操作，该操作更新并重置两个表单。
    await act(() => {
      startTransition(async () => {
        Scheduler.log('Action started');
        await getText('Wait 1');
        Scheduler.log('Request form reset');

        // 这发生在一次 `await` 之后，且未包在 startTransition 中，因此会同步调度，而不会随 transition 调度。这几乎肯定是错误用法，所以开发环境会记录警告。
        requestFormReset(formRef.current);

        await getText('Wait 2');
        Scheduler.log('Action finished');
      });
    });
    assertLog(['Action started']);
    expect(inputRef.current.value).toBe('  Updated  ');

    // 这会触发同步 requestFormReset，并产生警告。
    await act(() => resolveText('Wait 1'));
    assertConsoleErrorDev([
      'requestFormReset was called outside a transition or action. ' +
        'To fix, move to an action, or wrap with startTransition.',
    ]);
    assertLog(['Request form reset']);

    // 尽管 action 尚未完成，表单仍被重置。
    expect(inputRef.current.value).toBe('Initial');
  });

  /** 测试场景：验证「regression: submitter's formAction prop is coerced correctly before checking if it exists」描述的渲染、交互或错误处理结果。 */
  it("regression: submitter's formAction prop is coerced correctly before checking if it exists", async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({submitterAction}) {
      return (
        <form action={() => Scheduler.log('Form action')}>
          <button ref={buttonRef} type="submit" formAction={submitterAction} />
        </form>
      );
    }

    const buttonRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <App submitterAction={() => Scheduler.log('Button action')} />,
      ),
    );
    await submit(buttonRef.current);
    assertLog(['Button action']);

    // 没有 button action 时，应触发 form action。
    await act(() => root.render(<App submitterAction={null} />));
    await submit(buttonRef.current);
    assertLog(['Form action']);

    // Symbol 会被强制转换为 null，因此应触发 form action。
    await act(() => root.render(<App submitterAction={Symbol()} />));
    assertConsoleErrorDev([
      'Invalid value for prop `formAction` on <button> tag. ' +
        'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
        'For details, see https://react.dev/link/attribute-behavior \n' +
        '    in button (at **)\n' +
        '    in App (at **)',
    ]);
    await submit(buttonRef.current);
    assertLog(['Form action']);

    // Boolean 会被强制转换为 null，因此应触发 form action。
    await act(() => root.render(<App submitterAction={true} />));
    await submit(buttonRef.current);
    assertLog(['Form action']);

    // submitter 上的字符串应阻止 form action 触发，并改为触发原生行为。
    await act(() => root.render(<App submitterAction="https://react.dev/" />));
    await expect(submit(buttonRef.current)).rejects.toThrow(
      'Navigate to: https://react.dev/',
    );
  });

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'useFormStatus is activated if startTransition is called ' +
      'inside preventDefault-ed submit event',
    async () => {
      /** `Output`：封装当前用例复用的操作、回调或断言步骤。 */
      function Output({value}) {
        const {pending} = useFormStatus();
        return <Text text={pending ? `${value} (pending...)` : value} />;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({value}) {
        const [, startFormTransition] = useTransition();

        /** `App.onSubmit`：封装当前用例复用的操作、回调或断言步骤。 */
        function onSubmit(event) {
          event.preventDefault();
          startFormTransition(async () => {
            const updatedValue = event.target.elements.search.value;
            Scheduler.log('Action started');
            await getText('Wait');
            Scheduler.log('Action finished');
            startTransition(() => root.render(<App value={updatedValue} />));
          });
        }
        return (
          <form ref={formRef} onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              name="search"
              defaultValue={value}
            />
            <div ref={outputRef}>
              <Output value={value} />
            </div>
          </form>
        );
      }

      const formRef = React.createRef();
      const inputRef = React.createRef();
      const outputRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<App value="Initial" />));
      assertLog(['Initial']);

      // 把 input 更新为不同的值。
      inputRef.current.value = 'Updated';

      // 提交表单。
      await submit(formRef.current);
      // 表单进入待处理状态。
      assertLog(['Action started', 'Initial (pending...)']);
      expect(outputRef.current.textContent).toBe('Initial (pending...)');

      // 提交仍处于 pending 时再次更新 input，以检查 action 完成后表单是否会重置。
      inputRef.current.value = 'Updated again after submission';

      // 完成异步 action。
      await act(() => resolveText('Wait'));
      assertLog(['Action finished', 'Updated']);
      expect(outputRef.current.textContent).toBe('Updated');

      // 确认表单没有自动重置；若要启用此行为，应调用 requestFormReset(formRef.current)。
      expect(inputRef.current.value).toBe('Updated again after submission');
    },
  );

  /** 测试场景：验证「useFormStatus is not activated if startTransition is not called」描述的渲染、交互或错误处理结果。 */
  it('useFormStatus is not activated if startTransition is not called', async () => {
    /** `Output`：封装当前用例复用的操作、回调或断言步骤。 */
    function Output({value}) {
      const {pending} = useFormStatus();

      return (
        <Text
          text={
            pending
              ? 'Should be unreachable! This test should never activate the pending state.'
              : value
          }
        />
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({value}) {
      /** `App.onSubmit`：封装当前用例复用的操作、回调或断言步骤。 */
      async function onSubmit(event) {
        event.preventDefault();
        const updatedValue = event.target.elements.search.value;
        Scheduler.log('Async event handler started');
        await getText('Wait');
        Scheduler.log('Async event handler finished');
        startTransition(() => root.render(<App value={updatedValue} />));
      }
      return (
        <form ref={formRef} onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            name="search"
            defaultValue={value}
          />
          <div ref={outputRef}>
            <Output value={value} />
          </div>
        </form>
      );
    }

    const formRef = React.createRef();
    const inputRef = React.createRef();
    const outputRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App value="Initial" />));
    assertLog(['Initial']);

    // 把 input 更新为不同的值。
    inputRef.current.value = 'Updated';

    // 提交表单。
    await submit(formRef.current);
    // 与之前的测试不同, 使用 startTransition来手动发送操作, 这项测试使用了常规的事件处理器, 所以
    // useFormStatus 没有激活。
    assertLog(['Async event handler started']);
    expect(outputRef.current.textContent).toBe('Initial');

    // 提交仍处于 pending 时再次更新 input，以检查 action 完成后表单是否会重置。
    inputRef.current.value = 'Updated again after submission';

    // 完成异步 action。
    await act(() => resolveText('Wait'));
    assertLog(['Async event handler finished', 'Updated']);
    expect(outputRef.current.textContent).toBe('Updated');

    // 确认表单没有自动重置；若要启用此行为，应调用 requestFormReset(formRef.current)。
    expect(inputRef.current.value).toBe('Updated again after submission');
  });

  /** 测试场景：验证「useFormStatus is not activated if event is not preventDefault-ed」描述的渲染、交互或错误处理结果。 */
  it('useFormStatus is not activated if event is not preventDefault-ed', async () => {
    /** `Output`：封装当前用例复用的操作、回调或断言步骤。 */
    function Output({value}) {
      const {pending} = useFormStatus();
      return <Text text={pending ? `${value} (pending...)` : value} />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({value}) {
      const [, startFormTransition] = useTransition();

      /** `App.onSubmit`：封装当前用例复用的操作、回调或断言步骤。 */
      function onSubmit(event) {
        // 此事件未调用 preventDefault，因此会执行默认表单提交，useFormStatus 也不会激活。
        startFormTransition(async () => {
          const updatedValue = event.target.elements.search.value;
          Scheduler.log('Action started');
          await getText('Wait');
          Scheduler.log('Action finished');
          startTransition(() => root.render(<App value={updatedValue} />));
        });
      }
      return (
        <form ref={formRef} onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            name="search"
            defaultValue={value}
          />
          <div ref={outputRef}>
            <Output value={value} />
          </div>
        </form>
      );
    }

    const formRef = React.createRef();
    const inputRef = React.createRef();
    const outputRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App value="Initial" />));
    assertLog(['Initial']);

    // 把 input 更新为不同的值。
    inputRef.current.value = 'Updated';

    // 提交表单应触发默认导航行为。
    await expect(submit(formRef.current)).rejects.toThrow(
      'Navigate to: http://localhost/',
    );

    // useFormStatus Hook 未激活。
    assertLog(['Action started', 'Initial']);
    expect(outputRef.current.textContent).toBe('Initial');
  });

  /** 测试场景：验证「useFormStatus coerces the value of the "action" prop」描述的渲染、交互或错误处理结果。 */
  it('useFormStatus coerces the value of the "action" prop', async () => {
    /** `Status`：封装当前用例复用的操作、回调或断言步骤。 */
    function Status() {
      const {pending, action} = useFormStatus();

      if (pending) {
        Scheduler.log(action);
        return 'Pending';
      } else {
        return 'Not pending';
      }
    }

    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form({action}) {
      const [, startFormTransition] = useTransition();

      /** `Form.onSubmit`：封装当前用例复用的操作、回调或断言步骤。 */
      function onSubmit(event) {
        event.preventDefault();
        // 安排一个空的操作，只是为了触发待处理的状态。
        startFormTransition(async () => {});
      }
      return (
        <form ref={formRef} action={action} onSubmit={onSubmit}>
          <Status />
        </form>
      );
    }

    const formRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    // 符号被转换为 null。
    await act(() => root.render(<Form action={Symbol()} />));
    assertConsoleErrorDev([
      'Invalid value for prop `action` on <form> tag. ' +
        'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
        'For details, see https://react.dev/link/attribute-behavior \n' +
        '    in form (at **)\n' +
        '    in Form (at **)',
    ]);
    await submit(formRef.current);
    assertLog([null]);

    // 布尔值会被转换为 null。
    await act(() => root.render(<Form action={true} />));
    await submit(formRef.current);
    assertLog([null]);

    // String 原样传递。
    await act(() => root.render(<Form action="https://react.dev" />));
    await submit(formRef.current);
    assertLog(['https://react.dev']);

    // Function 原样传递。
    /** `actionFn`：封装当前用例复用的操作、回调或断言步骤。 */
    const actionFn = () => {};
    await act(() => root.render(<Form action={actionFn} />));
    await submit(formRef.current);
    assertLog([actionFn]);

    // 除非启用 Trusted Types，否则其他值都会调用 toString。
    /** `MyAction`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyAction {
      /** `MyAction.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return 'stringified action';
      }
    }
    const instance = new MyAction();

    await act(() => root.render(<Form action={instance} />));
    await submit(formRef.current);
    assertLog(
      gate('enableTrustedTypesIntegration')
        ? [instance]
        : ['stringified action'],
    );
  });

  /** 测试场景：验证「form actions should retain status when nested state changes」描述的渲染、交互或错误处理结果。 */
  it('form actions should retain status when nested state changes', async () => {
    const formRef = React.createRef();

    let rerenderUnrelatedStatus;
    /** `UnrelatedStatus`：封装当前用例复用的操作、回调或断言步骤。 */
    function UnrelatedStatus() {
      const {pending} = useFormStatus();
      const [counter, setCounter] = useState(0);
      rerenderUnrelatedStatus = () => setCounter(n => n + 1);
      Scheduler.log(`[unrelated form] pending: ${pending}, state: ${counter}`);
    }

    let rerenderTargetStatus;
    /** `TargetStatus`：封装当前用例复用的操作、回调或断言步骤。 */
    function TargetStatus() {
      const {pending} = useFormStatus();
      const [counter, setCounter] = useState(0);
      Scheduler.log(`[target form] pending: ${pending}, state: ${counter}`);
      rerenderTargetStatus = () => setCounter(n => n + 1);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      /** `App.action`：封装当前用例复用的操作、回调或断言步骤。 */
      async function action() {
        return new Promise(resolve => {
          // 永不兑现。
        });
      }

      return (
        <>
          <form action={action} ref={formRef}>
            <input type="submit" />
            <TargetStatus />
          </form>
          <form>
            <UnrelatedStatus />
          </form>
        </>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));

    assertLog([
      '[target form] pending: false, state: 0',
      '[unrelated form] pending: false, state: 0',
    ]);

    await submit(formRef.current);

    assertLog(['[target form] pending: true, state: 0']);

    await act(() => rerenderTargetStatus());

    assertLog(['[target form] pending: true, state: 1']);

    await act(() => rerenderUnrelatedStatus());

    assertLog(['[unrelated form] pending: false, state: 1']);
  });
});
