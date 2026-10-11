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

// JSDOM 的 FormData 构造器不会派发 formdata 事件；这里补上该事件供提交测试使用。
/** 保存环境原生FormData构造器；模块级polyfill只补jsdom未派发的formdata事件，保留原构造数据规则。 */
const NativeFormData = global.FormData;
/** FormData构造器包装绑定；用原生form/submitter构造数据后派不可取消且冒泡的formdata，再返回可被监听器改写的同一对象。 */
const FormDataPolyfill = /** 保留函数名FormData的包装构造器；接收form与可选submitter，返回原生FormData对象而非this，供事件插件和测试共用。 */ function FormData(form, submitter) {
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
      /** 接收error及其余console参数；variant调用旧useFormState时只过滤API改名提示，其余转发捕获的原console.error，避免掩盖测试预期诊断。 */
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

  /** 按text键把缓存从缺失或pending改resolved并保存文本；pending时逐个唤醒注册pings，使等待action或Suspense重试继续。 */
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

  /** 读取text缓存；resolved返回文本，pending记录Suspend并抛thenable，rejected抛错误；缺失时创建可唤醒thenable后抛出，模拟资源挂起。 */
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
        /** 接收resolve回调；pending时加入pings，已解决时用微任务传回文本，避免同步兑现造成重入；resolveText统一唤醒。 */
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

  /** 获取text对应异步值而不主动抛挂起；缺失创建thenable，pending返回它，resolved/rejected返回兑现/拒绝Promise，供await或use消费。 */
  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        /** 给getText生成的thenable注册resolve；未完成时缓存回调，完成后微任务回传newRecord.value，供action等待资源。 */
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

  /** 接收text，写Scheduler日志并返回同一文本；把render发生与DOM最终内容分别作为可观察证据。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 接收text先readText；仅资源解决后记日志并返回文本，pending时抛thenable让最近Suspense处理。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** 异步模拟提交指定form或submitter，等待act处理；派可取消冒泡submit并附submitter，取消后返回，否则读取formaction/action并用Navigate错误模拟非javascript默认导航。 */
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

  /** 给定form函数action和foo=bar的非受控input，提交后更新action再提交；断言保存foo为bar再bar2，验证FormData传入与最新action替换。 */
  it('should allow passing a function to form action', async () => {
    const ref = React.createRef();
    let foo;

    /** 接收提交FormData，把foo字段保存到外部foo，返回undefined；用于证明函数action收到非受控字段。 */
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

    /** 读取FormData.foo加后缀2并保存，无返回状态；用差异证明更新后的action实际被调用。 */
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

  /** 给定form根action及input/button各自函数formAction，逐个提交后替换两处理器再提交；断言保存/删除分别读Hello再Hello2且根action未调用，验证submitter优先。 */
  it('should allow passing a function to an input/button formAction', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let rootActionCalled = false;
    let savedTitle = null;
    let deletedTitle = null;

    /** 接收FormData但只标记rootActionCalled；它是submitter覆盖时不应运行的form根action。 */
    function action(formData) {
      rootActionCalled = true;
    }

    /** 把FormData.title保存到savedTitle，不改deletedTitle，隔离input submitter的处理分支。 */
    function saveItem(formData) {
      savedTitle = formData.get('title');
    }

    /** 把FormData.title保存到deletedTitle，不改savedTitle，隔离button submitter分支。 */
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

    /** 读取title并加后缀2保存，用于验证input formAction更新后的实现。 */
    function saveItem2(formData) {
      savedTitle = formData.get('title') + '2';
    }

    /** 读取title并加后缀2保存，用于验证button formAction更新后的实现。 */
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

  /** 给定函数action与onSubmit.preventDefault，提交表单；断言actionCalled=false，验证取消默认事件阻止内建action。 */
  it('should allow preventing default to block the action', async () => {
    const ref = React.createRef();
    let actionCalled = false;

    /** 接收FormData后标记actionCalled；preventDefault测试用false终态证明该action未执行。 */
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

  /** 给定无效HTML的嵌套form及内外data字段，提交内表单；断言嵌套警告、结果innerinner，验证仅内层action读取内FormData。 */
  it('should submit the inner of nested forms', async () => {
    const ref = React.createRef();
    let data;

    /** 读取data字段加outer并保存；非法嵌套表单中若错误选外action，会产生可识别结果。 */
    function outerAction(formData) {
      data = formData.get('data') + 'outer';
    }
    /** 读取内FormData.data并加inner保存；innerinner证明内表单及内action同时被选中。 */
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

  /** 给定内根容器放在外form中，提交内form；断言submit冒泡到外div、外action0次内action1次，验证跨根事件不重复调用form action。 */
  it('should submit once if one root is nested inside the other', async () => {
    const ref = React.createRef();
    let outerCalled = 0;
    let innerCalled = 0;
    let bubbledSubmit = false;

    /** 递增外action次数；内根提交时预期不运行，用于检测跨根双调用。 */
    function outerAction(formData) {
      outerCalled++;
    }

    /** 递增内action次数；内根提交预期仅一次，即使submit向外冒泡。 */
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

  /** 给定portal form宿主插入其根内另一form，提交portal；断言冒泡存在但仅内action一次，验证portal逻辑路径与DOM嵌套不会双提交。 */
  it('should submit once if a portal is nested inside its own root', async () => {
    const ref = React.createRef();
    let outerCalled = 0;
    let innerCalled = 0;
    let bubbledSubmit = false;

    /** 递增外form action次数；portal内form提交时预期为0，用于区分DOM嵌套与有效action归属。 */
    function outerAction(formData) {
      outerCalled++;
    }

    /** 递增portal内action次数，预期一次；外层onSubmit仍可观察事件冒泡。 */
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

  /** 给定多个submitter及formdata监听按delete删除title，依次提交input/button/外部关联button/image；断言button为delete/edit/outside，title相应null或hello，image无button但坐标0/0，验证提交者数据与formdata改写。 */
  it('can read the clicked button in the formdata event', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    const outsideButtonRef = React.createRef();
    const imageButtonRef = React.createRef();
    let button;
    let buttonX;
    let buttonY;
    let title;

    /** 从FormData保存button、button.x/y及title；分辨各种submitter以及formdata监听删除title后的结果。 */
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
      // 根据提交按钮的值删除 title，验证 formdata 监听器修改后的数据传给 action。
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

  /** 给定带name的input/button使用函数formAction，提交两者；断言name用法警告、FormData.button都null且type恢复原状态，验证React保留submitter编码字段。 */
  it('excludes the submitter name when the submitter is a function action', async () => {
    const inputRef = React.createRef();
    const buttonRef = React.createRef();
    let button;

    /** 读取button字段保存；函数formAction占用name编码，本例预期字段不进入用户FormData。 */
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

  /** 给定form函数action但submit input用URL formAction，提交；捕获模拟Navigate错误且根action未调用，验证字符串覆盖函数并走默认导航。 */
  it('allows a non-function formaction to override a function one', async () => {
    const ref = React.createRef();
    let actionCalled = false;

    /** 只标记form action是否调用；URL submitter覆盖应使该标记保持false。 */
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

  /** 给定form函数action与原始HTML插入的URL formAction input，提交；断言Navigate到指定URL、根action未调用，验证非React管理的submitter属性也参与默认行为。 */
  it('allows a non-react html formaction to be invoked', async () => {
    let actionCalled = false;

    /** 只标记根form action；原始HTML submitter提供URL时应走默认导航，不进入本函数。 */
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

  /** 给定Initial资源已就绪且form action更新到未就绪Updated，提交；断言Pending...Initial保留旧内容，资源完成后Updated，验证内建action为transition。 */
  it('form actions are transitions', async () => {
    const formRef = React.createRef();

    /** 读取祖先form的pending；pending返回可记录Pending...的Text，否则返回null，显示transition等待窗口。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** 保存Initial字符串state；返回action更新Updated、Status和Suspense AsyncText，使未就绪新资源验证旧内容保留。 */
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

  /** 给定Count0就绪且action自增，连续两次提交并分别完成Count1/2资源；断言每轮pending保留前值、结束后1/2，验证多轮独立表单transition。 */
  it('multiple form actions', async () => {
    const formRef = React.createRef();

    /** 读取pending并返回Pending...或null；为两轮Count transition观测起止。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** 保存数字count初值0，action使用函数state更新加1；AsyncText按Count字符串资源挂起，分辨每轮提交。 */
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

  /** 给定异步action先等Wait再transition更新Updated，提交并分步兑现；断言启动、pending及挂起日志，等待期间保留Initial，Updated就绪后提交，验证异步action与后续渲染共同决定完成。 */
  it('form actions can be asynchronous', async () => {
    const formRef = React.createRef();

    /** 读取异步form action的pending，pending显示Text；覆盖action await和后续资源渲染两段等待。 */
    function Status() {
      const {pending} = useFormStatus();
      return pending ? <Text text="Pending..." /> : null;
    }

    /** 保存Initial状态；async action先等Wait，再用startTransition设Updated，返回含Status/Suspense的form以保留旧内容。 */
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

  /** 给定ErrorBoundary包住同步抛Oh no!的form action，提交；断言两次错误文本render日志及DOM=Oh no!，验证action错误转交边界。 */
  it('sync errors in form actions can be captured by an error boundary', async () => {
    /** 捕获同步form action错误的类边界；error初始null，错误后返回message文本而非原children。 */
    class ErrorBoundary extends React.Component {
      /** 保存捕获error，null表示继续渲染children；message作为DOM恢复结果。 */
      state = {error: null};
      /** 接收捕获error并返回新state片段，不直接改实例或DOM。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 根据error返回Text(message)或children，日志用于识别边界恢复render。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const formRef = React.createRef();

    /** 返回由ErrorBoundary包住的form；action同步抛Oh no!，正常子内容为Everything is fine。 */
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

  /** 给定异步action等待Wait后抛Oh no!，提交时内容保持Everything is fine；兑现后断言错误fallback文本与日志，验证Promise拒绝转交边界。 */
  it('async errors in form actions can be captured by an error boundary', async () => {
    /** 捕获异步action拒绝的类边界，保留原children直到error进入状态，然后显示message。 */
    class ErrorBoundary extends React.Component {
      /** error初始null；异步action拒绝后更新为错误对象用于fallback。 */
      state = {error: null};
      /** 把捕获error返回为state片段，使后续render读取message。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 无error时返回children，有error时返回带message日志的Text。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const formRef = React.createRef();

    /** 返回等待Wait后抛Oh no!的async form action及正常Text，区分提交启动与异步拒绝时点。 */
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

  /** 给定myAction异步等待及foo=bar input，提交；断言pending状态包含action名、foo=bar、method=get，完成后恢复No pending action，验证useFormStatus整组提交数据。 */
  it('useFormStatus reads the status of a pending form action', async () => {
    const formRef = React.createRef();

    /** 读取pending/data/action/method；无待办显示No pending action，有待办读取foo及action.name构造文本，验证祖先form提供的整组状态。 */
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

    /** 记录异步action起止并等待Wait资源，无state返回值；useFormStatus应在等待期间暴露该函数及提交数据。 */
    async function myAction() {
      Scheduler.log('Async action started');
      await getText('Wait');
      Scheduler.log('Async action finished');
    }

    /** 返回myAction form、foo=bar默认input和Status；formRef让测试通过实际提交入口激活pending。 */
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

  /** 给定函数action但onSubmit阻止后强制执行DOM action中的javascript，提交；断言result仍null且捕获unexpectedly submitted消息，验证手动form.submit式调用的保护脚本。 */
  it('should error if submitting a form manually', async () => {
    const ref = React.createRef();

    let error = null;
    let result = null;

    /** 模拟绕过submit事件的强制导航：读取formaction/action，非javascript抛Navigate，javascript用Function执行并捕获error/result到外部变量；供保护脚本测试。 */
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

  /** 给定useActionState初值0和逐次等待的增减action，transition内排增/增/减/增；断言仅首动作立即启动，依次兑现后后续按1→4启动、无中间提交，最后DOM=2，验证串行队列及纠缠。 */
  it('useActionState updates state asynchronously and queues multiple actions', async () => {
    let actionCounter = 0;
    /** 接收上个state和increment/decrement payload，递增启动计数并等待编号Wait；按类型返回新state，串行队列每项可被单独兑现。 */
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
    /** 注册初值0的useActionState，导出dispatch并按isPending返回Pending加state文本，观察排队期间不提交中间值。 */
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

  /** 给定内联异步action按stepSize累加，先step1派发再改step10派发；断言日志Pending0→1、Pending1→11，验证后续dispatch采用最新闭包。 */
  it('useActionState supports inline actions', async () => {
    let increment;
    /** 接收stepSize并注册内联async action，对prevState加本轮闭包步长；导出dispatch并返回pending/state文本。 */
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

  /** 给定App在render调用useActionState dispatch，挂载并waitForThrow；断言Cannot update action state while rendering，验证禁止render阶段派发。 */
  it('useActionState: dispatch throws if called during render', async () => {
    /** 注册action后在render立即dispatch，刻意触发禁止render派发错误；下面的Text只有不抛错时才可返回。 */
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

  /** 给定初值A与等待目标资源的action，transition排B/C/D并依次兑现；断言仅首dispatch显示Pending A，最后日志与DOM均D，验证顺序执行和最终批次提交。 */
  it('useActionState: queues multiple actions and runs them in order', async () => {
    let action;
    /** 注册等待payload对应资源的async action、初值A；导出dispatch并显示pending/state，检查B/C/D串行排队最终提交D。 */
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

  /** 给定旧action闭包不会抛错，排两个异步action后将prop切为会抛错；旧两项完成仍输出Second action，新Third action拒绝Oops!，验证队列记录派发时实现。 */
  it(
    'useActionState: when calling a queued action, uses the implementation ' +
      'that was current at the time it was dispatched, not the most recent one',
    async () => {
      let action;
      /** 接收throwIfActionIsDispatched，把该prop封入内联action；action等待payload或抛Oops，导出dispatch并显示pending，用于比较派发时实现与最新闭包。 */
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

  /** 给定同步内联action按stepSize累加，step1派发后改step10再派发；断言0→Pending0→1→Pending1→11，验证同步action也遵循pending状态及最新实现。 */
  it('useActionState: works if action is sync', async () => {
    let increment;
    /** 接收stepSize并以同步action累计prevState；导出dispatch，返回pending/state，验证同步返回值也通过action状态机制。 */
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

  /** 给定action直接返回payload，交替排thenable B、字符串C、thenable D、字符串E；兑现B/D后断言最终E且无中间日志，验证同步与异步结果可串行混合。 */
  it('useActionState: can mix sync and async actions', async () => {
    let action;
    /** 初值A，action直接返回payload字符串或thenable；导出dispatch并显示pending/state，构造混合同步/异步结果队列。 */
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

  /** 给定边界包住同步action且感叹号payload会抛错，transition派Oops!；断言先Pending A再两次fallback日志、DOM错误文本，验证同步action错误状态。 */
  it('useActionState: error handling (sync action)', async () => {
    /** 捕获同步useActionState错误的边界，错误后用Caught an error文本代替children。 */
    class ErrorBoundary extends React.Component {
      /** error初始null，捕获后持有action错误对象供fallback读取。 */
      state = {error: null};
      /** 返回捕获error的state片段，交由React应用恢复状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 无error返回children，有error返回包含message的Text，供日志与DOM断言。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** 注册遇感叹号payload就抛错的同步action，初值A；导出dispatch并返回pending/state，验证错误从action进入边界。 */
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

  /** 给定边界包住等待资源后检查感叹号的action，派Oops!并兑现；断言等待时Pending A，完成后fallback与DOM错误，验证异步拒绝恢复。 */
  it('useActionState: error handling (async action)', async () => {
    /** 捕获异步useActionState拒绝的边界，保留children直到等待资源后的错误进入状态。 */
    class ErrorBoundary extends React.Component {
      /** 以null标识无错误，异步拒绝后保存error用于fallback。 */
      state = {error: null};
      /** 返回error state片段，使异步action拒绝进入后续render。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 错误时输出Caught an error与message，否则children；区分pending阶段与恢复终态。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** 注册await getText(payload)后遇感叹号抛错的action，初值A；导出dispatch并显示pending/state。 */
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

  /** 给定首action等待后抛错，随后排另一项；首项失败后断言仅边界fallback、后续无Start日志，失败后再dispatch也无日志，验证队列错误取消与失效。 */
  it('useActionState: when an action errors, subsequent actions are canceled', async () => {
    /** 队列错误取消测试的边界；首action错误后卸载原App并展示错误文本。 */
    class ErrorBoundary extends React.Component {
      /** 保存首action错误，null时App仍可显示初始或pending状态。 */
      state = {error: null};
      /** 返回捕获error供类状态恢复，不运行后续排队action。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 根据error返回Caught an error文本或children，用于核对取消后稳定fallback。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let action;
    /** 注册记录Start action并等待payload的async action；感叹号结果抛错，否则返回文本，导出dispatch用于失败前后继续排队。 */
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

    // 解除 action 的挂起后抛错，组件转入错误边界；已排队的后续 action 不再执行。
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

  /** 给定StrictMode下的异步累加action，transition派increment并兑现Wait1；断言action启动一次、Pending0后1，验证严格模式不会重复执行action副作用。 */
  it('useActionState works in StrictMode', async () => {
    let actionCounter = 0;
    /** StrictMode夹具中的异步累加action；按启动计数等待Wait，再按type返回state±1，启动日志用于检查副作用不重复。 */
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
    /** 在StrictMode内注册初值0的action并导出dispatch，返回pending/state文本；计数副作用由action而非render持有。 */
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

  /** 给定useActionState更新驱动AsyncText，先在transition外派发再在内派发；断言外部提交Loading...，内部挂起时保留Count1，资源就绪后Count2，验证dispatch上下文决定fallback提交。 */
  it('useActionState does not wrap action in a transition unless dispatch is in a transition', async () => {
    let dispatch;
    /** 注册使用闭包state加1的同步action，导出dispatch并返回AsyncText；是否包transition决定新资源挂起时fallback是否提交。 */
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

    // 在 transition 内派发后，重试渲染仍会记录 Loading...，但不会提交 fallback；已显示的 Count: 1 会保留到数据就绪。
    await act(() => startTransition(() => dispatch()));
    assertLog(['Count: 1', 'Suspend! [Count: 2]', 'Loading...']);
    expect(container.textContent).toBe('Count: 1');

    await act(() => resolveText('Count: 2'));
    assertLog(['Count: 2']);
    expect(container.textContent).toBe('Count: 2');
  });

  /** 给定异步action驱动AsyncText，直接在transition外dispatch；断言DEV上下文警告、Count1挂起日志但DOM保留Count0，验证错误调用提示；未兑现Count1。 */
  it('useActionState warns if async action is dispatched outside of a transition', async () => {
    let dispatch;
    /** 注册async action返回闭包state+1，导出dispatch并返回AsyncText；在transition外调用构造DEV提示及新资源挂起。 */
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

  /** 给定use读取username资源并提供非受控input，用户写带空白的AcdLite并提交；Wait完成后新资源仍挂起，断言脏值和旧文本保留，acdlite就绪后值与文本更新，验证自动reset等待新defaultValue提交。 */
  it('uncontrolled form inputs are reset after the action completes', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();
    const divRef = React.createRef();

    /** 接收promiseForUsername并用use读取；返回非受控默认username表单。async action读取/规范化提交数据、等Wait再transition重渲染新资源，重置需等待新defaultValue提交。 */
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

  /** 给定受控amount和onReset手动设回0，先setValue=3后提交异步action；断言等待时3、完成后0，验证自动表单reset会触发onReset并由用户更新受控state。 */
  it('should fire onReset on automatic form reset', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();

    let setValue;
    const defaultValue = 0;
    /** 保存受控amount state并导出setter，返回异步等待的form及onReset设回默认0；onChange同步事件当前值，使自动reset可通过用户state更新观察。 */
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

  /** 给定无内建action的非受控form，用户transition读取/规范化数据并requestFormReset；等待新username挂起时断言脏值保留，资源就绪后acdlite，验证显式reset与transition提交绑定。 */
  it('requestFormReset schedules a form reset after transition completes', async () => {
    // 此测试与上一个相同，区别是表单由 userspace action 更新，而不是内置 form action。

    const formRef = React.createRef();
    const inputRef = React.createRef();
    const divRef = React.createRef();

    /** 接收username Promise并读取后返回无内建action的form、默认input和Text；外部userspace transition显式requestFormReset，隔离reset请求与提交事件。 */
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

  /** 给定首次action等待外部resolver，requestSubmit后pending期间再次requestSubmit并兑现首项；两步各断言一个Action日志且act成功，验证并行表单提交不抛错。 */
  it('parallel form submissions do not throw', async () => {
    const formRef = React.createRef();
    let resolve = null;
    /** 返回action为submitForm的form并连接formRef；通过浏览器requestSubmit测试两次真实提交入口。 */
    function App() {
      /** 记录Action；只有resolver未设置时创建并等待Promise，把res保存供第二次提交时兑现；后续调用可立即完成。 */
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

  /** 给定input在form外通过form=myform关联，transition请求reset并异步更新默认username；断言等待保留脏值与旧内容、就绪后acdlite，验证reset覆盖关联元素而非只后代。 */
  it(
    'requestFormReset works with inputs that are not descendants ' +
      'of the form element',
    async () => {
      // 此测试与上一个相同，区别是 input 不是 form 子节点，而是通过 <input form="myform" /> 与之关联。

      const formRef = React.createRef();
      const inputRef = React.createRef();
      const divRef = React.createRef();

      /** 接收username Promise，用use读取后返回空form及通过form属性关联的外部input；Text显示资源值，检验reset包含非后代控件。 */
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

  /** 给定两个form的默认A1/B1，用户写带空白A2/B2，同一transition对两form请求reset并更新资源；断言挂起时两脏值保留，资源同时完成后A2/B2，验证多表单重置共享提交完成边界。 */
  it('reset multiple forms in the same transition', async () => {
    const formRefA = React.createRef();
    const formRefB = React.createRef();

    /** 接收A/B两Promise并use读取；返回两个独立form默认input，令同一transition必须等两资源更新后再重置。 */
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

  /** 给定原始innerHTML表单及脏输入，调用requestFormReset；断言Invalid form element且值未变，随后原生form.reset清空，验证API要求React管理。 */
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

  /** 给定React管理的div=Hi，调用requestFormReset(div)；断言Invalid form element，验证仅form宿主可重置。 */
  it('requestFormReset throws on a non-form DOM element', async () => {
    const root = ReactDOMClient.createRoot(container);
    const ref = React.createRef();
    await act(() => root.render(<div ref={ref}>Hi</div>));
    const div = ref.current;
    expect(div.textContent).toBe('Hi');

    expect(() => requestFormReset(div)).toThrow('Invalid form element.');
  });

  /** 给定脏非受控input，异步transition在await Wait1后直接请求reset再等Wait2；兑现Wait1后断言上下文警告且值已回Initial，验证await后需重新包transition；Wait2本例未兑现。 */
  it('warns if requestFormReset is called outside of a transition', async () => {
    const formRef = React.createRef();
    const inputRef = React.createRef();

    /** 返回默认Initial的非受控input表单并保存refs；外部action在await后requestFormReset，用于观察同步重置与上下文警告。 */
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

    // 启动异步 action；等待第一次 await 结束后再请求重置这个表单。
    await act(() => {
      startTransition(async () => {
        Scheduler.log('Action started');
        await getText('Wait 1');
        Scheduler.log('Request form reset');

        // await 后 transition 上下文已退出；此处没有再包 startTransition，requestFormReset 会同步调度并在开发环境警告。
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

  /** 给定button formAction先函数再null、Symbol、true、URL，逐次提交；断言函数优先，空或过滤值回退form action，Symbol警告、URL模拟导航，验证先coerce再决定覆盖。 */
  it("regression: submitter's formAction prop is coerced correctly before checking if it exists", async () => {
    /** 接收submitterAction，返回函数form action及带该覆盖prop的submit button；日志区分过滤值回退与函数/URL优先。 */
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

  /** 给定onSubmit.preventDefault且useTransition启动异步更新，用户写Updated提交后再改输入；断言表单pending激活、完成后输出Updated而输入保留后写值，验证手动transition状态不自动reset。 */
  it(
    'useFormStatus is activated if startTransition is called ' +
      'inside preventDefault-ed submit event',
    async () => {
      /** 接收value并读取form pending，返回value或带pending后缀的Text，观察preventDefault内transition提供的form状态。 */
      function Output({value}) {
        const {pending} = useFormStatus();
        return <Text text={pending ? `${value} (pending...)` : value} />;
      }

      /** 接收value，useTransition提供startFormTransition；返回关联input、Output及onSubmit，input默认值随新props变化但无自动reset。 */
      function App({value}) {
        const [, startFormTransition] = useTransition();

        /** 接收submit事件先preventDefault，在form transition同步区读search值；等待Wait后再包startTransition重渲染新App，pending激活但没有请求reset。 */
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

  /** 给定preventDefault的普通async onSubmit且未用transition启动handler，提交等待Wait；断言状态不pending、完成后输出Updated且输入保留后写值，验证普通异步事件不会激活form状态/reset。 */
  it('useFormStatus is not activated if startTransition is not called', async () => {
    /** 接收value并读取pending；若意外pending会输出不可达提示，否则正常Text，专门检测普通async事件是否误激活form状态。 */
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

    /** 接收value，返回普通async onSubmit、非受控input与Output；此handler开始时没有transition上下文。 */
    function App({value}) {
      /** 接收submit事件先取消默认行为，读取search并await Wait；完成后只给root.render包transition，不能倒推提交开始时form pending已激活。 */
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

  /** 给定onSubmit启动transition但未preventDefault，提交；断言模拟导航拒绝、日志Action started与Initial且状态不pending，验证未取消默认提交不关联useFormStatus。 */
  it('useFormStatus is not activated if event is not preventDefault-ed', async () => {
    /** 接收value并读取pending，显示后缀用于观察未preventDefault事件不会关联form状态。 */
    function Output({value}) {
      const {pending} = useFormStatus();
      return <Text text={pending ? `${value} (pending...)` : value} />;
    }

    /** 接收value并用useTransition启动器构造onSubmit；返回表单input和Output，刻意保留默认提交行为。 */
    function App({value}) {
      const [, startFormTransition] = useTransition();

      /** 接收事件但不preventDefault；启动async transition读search并等待，完成后root.render新App；提交助手因此仍模拟默认导航。 */
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

  /** 给定preventDefault且空transition用于激活status，逐次传Symbol/true/URL/函数/对象action；断言pending action依次null/null/原字符串/原函数/按TrustedTypes开关保留对象或转字符串，验证状态读取使用同样coercion。 */
  it('useFormStatus coerces the value of the "action" prop', async () => {
    /** 读取pending及action，pending时记录action并返回Pending，否则Not pending；直接比较coercion后状态值身份。 */
    function Status() {
      const {pending, action} = useFormStatus();

      if (pending) {
        Scheduler.log(action);
        return 'Pending';
      } else {
        return 'Not pending';
      }
    }

    /** 接收action并返回使用该prop的form和Status；useTransition仅用于在preventDefault事件内激活状态，不执行action本身。 */
    function Form({action}) {
      const [, startFormTransition] = useTransition();

      /** 取消默认submit并启动空async transition，使useFormStatus进入pending窗口以观察传入action的规范化值。 */
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
    /** 空函数action身份夹具，无副作用与返回值；submit被用户取消，status日志应保留该函数对象身份。 */
    const actionFn = () => {};
    await act(() => root.render(<Form action={actionFn} />));
    await submit(formRef.current);
    assertLog([actionFn]);

    // 除非启用 Trusted Types，否则其他值都会调用 toString。
    /** 可字符串化action对象夹具；TrustedTypes开关决定status保留对象还是使用toString结果。 */
    class MyAction {
      /** 返回stringified action，供非TrustedTypes路径的action值转换断言。 */
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

  /** 给定目标form永不完成action及旁边独立form，提交目标后分别自增两status内部counter；断言目标pending保持true且旁边保持false，验证嵌套state更新不会覆盖表单状态或跨form串扰。 */
  it('form actions should retain status when nested state changes', async () => {
    const formRef = React.createRef();

    let rerenderUnrelatedStatus;
    /** 读取旁边form pending及自身counter，导出自增函数并记录两者；本函数不返回内容，验证局部state不会读取目标form状态。 */
    function UnrelatedStatus() {
      const {pending} = useFormStatus();
      const [counter, setCounter] = useState(0);
      /** 把无关status的counter加1，不更新form action；供日志核对pending仍false。 */
      rerenderUnrelatedStatus = () => setCounter(n => n + 1);
      Scheduler.log(`[unrelated form] pending: ${pending}, state: ${counter}`);
    }

    let rerenderTargetStatus;
    /** 读取目标form pending及局部counter，导出自增函数并记录状态；即使counter更新，目标form action仍pending。 */
    function TargetStatus() {
      const {pending} = useFormStatus();
      const [counter, setCounter] = useState(0);
      Scheduler.log(`[target form] pending: ${pending}, state: ${counter}`);
      /** 仅递增目标status局部counter，测试期待form pending保持true。 */
      rerenderTargetStatus = () => setCounter(n => n + 1);
    }

    /** 返回目标form与旁边无action form，各有独立status后代；目标action永不兑现，固定待办窗口以测试局部更新。 */
    function App() {
      /** 返回永不兑现Promise的async action；只用于持续pending，不调用resolver或提交完成，避免状态窗口在测试中消失。 */
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
