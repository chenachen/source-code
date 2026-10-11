/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 空onChange夹具，接收事件但不改变外部状态且无返回值；让受控value转换测试不混入缺处理器警告。 */
function emptyFunction() {}

describe('ReactDOMTextarea', () => {
  let React;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;
  let assertConsoleErrorDev;

  let renderTextarea;

  const ReactFeatureFlags = require('shared/ReactFeatureFlags');

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    /** 异步渲染指定component到传入root，等待act完成并返回container首节点；手动同步defaultValue且去掉开头换行，补偿jsdom与真实HTML解析器的差异。 */
    renderTextarea = async function (component, container, root) {
      await act(() => {
        root.render(component);
      });

      const node = container.firstChild;

// 修正 jsdom 的特殊行为：真实解析器会去掉开头的换行，这里需要手动处理。
      node.defaultValue = node.innerHTML.replace(/^\n/, '');
      return node;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 给定非受控textarea defaultValue=giraffe，先换gorilla，再用户写cat并换monkey；断言当前值依次仍giraffe、cat，验证defaultValue不覆盖已建立的实时值。 */
  it('should allow setting `defaultValue`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue="giraffe" />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    // 改变 `defaultValue` 没有任何效果.
    await renderTextarea(<textarea defaultValue="gorilla" />, container, root);
    expect(node.value).toEqual('giraffe');

    node.value = 'cat';

    await renderTextarea(<textarea defaultValue="monkey" />, container, root);
    expect(node.value).toEqual('cat');
  });

  /** 给定空根，以数字0作为defaultValue挂载；断言value为字符串0，验证假值仍参与初始化转换。 */
  it('should display `defaultValue` of number 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={0} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 给定空根，以bigint 0n作为defaultValue挂载；断言value为字符串0，验证大整数转换。 */
  it('should display `defaultValue` of bigint 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={0n} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 给定空根，以false作为defaultValue挂载；断言value为字符串false，验证默认值保留布尔字符串。 */
  it('should display "false" for `defaultValue` of `false`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea defaultValue={false} />,
      container,
      root,
    );

    expect(node.value).toBe('false');
  });

  /** 给定toString返回foobar的对象作为defaultValue；挂载后断言value=foobar，验证支持对象转换。 */
  it('should display "foobar" for `defaultValue` of `objToString`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const objToString = {
      /** 返回foobar，为defaultValue对象提供确定的字符串转换结果。 */
      toString: function () {
        return 'foobar';
      },
    };
    const node = await renderTextarea(
      <textarea defaultValue={objToString} />,
      container,
      root,
    );

    expect(node.value).toBe('foobar');
  });

  /** 给定defaultValue=foo的textarea，连续改为bar、noise；断言defaultValue=noise，验证默认值property更新，与实时value语义区分。 */
  it('should set defaultValue', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="foo" />);
    });
    await act(() => {
      root.render(<textarea defaultValue="bar" />);
    });
    await act(() => {
      root.render(<textarea defaultValue="noise" />);
    });

    expect(container.firstChild.defaultValue).toBe('noise');
  });

  /** 给定value=giraffe且onChange为空处理器的受控textarea；挂载后断言不存在value attribute，验证textarea值通过property和文本初始化。 */
  it('should not render value as an attribute', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.getAttribute('value')).toBe(null);
  });

  /** 给定受控value数字0和onChange；挂载后断言value字符串0，验证0不会被视为空值。 */
  it('should display `value` of number 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value={0} onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('0');
  });

  /** 给定非受控defaultValue=foo，更新为空串；断言defaultValue为空，验证显式清空默认值。 */
  it('should update defaultValue to empty string', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue={'foo'} />);
    });

    await act(() => {
      root.render(<textarea defaultValue={''} />);
    });

    expect(container.firstChild.defaultValue).toBe('');
  });

  /** 给定受控value=giraffe，更新gorilla；断言实时value跟随两次props，验证受控更新。 */
  it('should allow setting `value` to `giraffe`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value="gorilla" onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('gorilla');
  });

  /** 给定createElement包装器计数textarea.value setter，挂载value空串/readOnly；断言赋值0次，验证初始空值不引发冗余写入；此例并未实际传required或运行Firefox。 */
  it('will not initially assign an empty value (covers case where firefox throws a validation error when required attribute is set)', async () => {
    const container = document.createElement('div');

    let counter = 0;
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      /** createElement包装器接收标签type并转发原始参数，返回真实元素；仅textarea安装计数访问器，afterEach恢复mock。 */
      function (type) {
        const el = originalCreateElement.apply(this, arguments);
        let value = '';
        if (type === 'textarea') {
          Object.defineProperty(el, 'value', {
            /** 返回createElement包装器闭包中的textarea当前值，供初始化逻辑比较是否需要赋值。 */
            get: function () {
              return value;
            },
            /** 接收val并转换为字符串保存，同时递增counter；用于测量初始空值是否触发DOM setter。 */
            set: function (val) {
              value = String(val);
              counter++;
            },
          });
        }
        return el;
      },
    );

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="" readOnly={true} />);
    });

    expect(counter).toEqual(0);
  });

  /** 给定textarea defaultValue=1，服务端renderToString再解析；断言innerHTML为1而defaultValue attribute缺失，验证SSR用文本输出初值。 */
  it('should render defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(<textarea defaultValue="1" />);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.innerHTML).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 给定textarea受控value=1及onChange，SSR后解析；断言innerHTML为1、defaultValue attribute缺失，验证value的SSR文本表达。 */
  it('should render value for SSR', () => {
    const element = <textarea value="1" onChange={function () {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.innerHTML).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 给定受控giraffe，更新value=true；断言value变为字符串true，验证受控布尔转换。 */
  it('should allow setting `value` to `true`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value={true} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('true');
  });

  /** 给定受控giraffe，更新value=false；断言value变为字符串false，验证受控假值转换。 */
  it('should allow setting `value` to `false`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<textarea value={false} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('false');
  });

  /** 给定受控giraffe，更新为toString返回foo的对象；断言value=foo，验证更新转换。 */
  it('should allow setting `value` to `objToString`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    const objToString = {
      /** 返回foo，为受控value的对象更新提供确定转换结果。 */
      toString: function () {
        return 'foo';
      },
    };

    await act(() => {
      root.render(<textarea value={objToString} onChange={emptyFunction} />);
    });

    expect(node.value).toEqual('foo');
  });

  /** 给定已挂载giraffe与valueOf抛TypeError的TemporalLike，更新为该对象；断言act拒绝prod message且DEV说明表单值需先转字符串，验证转换失败传播。 */
  it('should throw when value is set to a Temporal-like object', async () => {
    /** 模拟Temporal类对象：valueOf拒绝隐式转换、toString可显式返回日期文本；用来区分可字符串化对象与禁止隐式转换的错误。 */
    class TemporalLike {
      /** 无参数且始终抛TypeError(prod message)，模拟Temporal的数值原始值转换限制并验证act拒绝传播。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** 返回2020-01-01；即使显式字符串方法存在，valueOf抛错仍阻止本例的隐式拼接转换。 */
      toString() {
        return '2020-01-01';
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="giraffe" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('giraffe');

    /** 将TemporalLike写入已挂载textarea并等待act；返回可能拒绝的Promise，供rejects核对TypeError及DEV转换诊断。 */
    const test = async () => {
      await act(() => {
        root.render(
          <textarea value={new TemporalLike()} onChange={emptyFunction} />,
        );
      });
    };
    await expect(test).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in textarea (at **',
    ]);
  });

  /** 给定非受控defaultValue=0，更新defaultValue=1；断言实时value仍0，验证默认更新不覆盖当前值，标题并不表示value变成1。 */
  it('should take updates to `defaultValue` for uncontrolled textarea', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');

    await act(() => {
      root.render(<textarea defaultValue="1" />);
    });

    expect(node.value).toBe('0');
  });

  /** 给定非受控defaultValue=0，后续改为children=1；断言实时value仍0，验证旧当前值保留。 */
  it('should take updates to children in lieu of `defaultValue` for uncontrolled textarea', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');

    await act(() => {
      root.render(<textarea>1</textarea>);
    });

    expect(node.value).toBe('0');
  });

  /** 给定受控value=a并安装值访问器spy，先重渲染a再改b；断言setter次数0再1，验证仅实际不同值才写DOM。 */
  it('should not incur unnecessary DOM mutations', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="a" onChange={emptyFunction} />);
    });

    const node = container.firstChild;
    let nodeValue = 'a';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {
      /** 返回闭包nodeValue，模拟真实DOM.value读取，让写入spy能区分相同值与改变值。 */
      get: function () {
        return nodeValue;
      },
      /** 接收newValue并写回闭包nodeValue；与外层jest.fn组合，同时记录写入次数和模拟DOM当前值。 */
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<textarea value="a" onChange={emptyFunction} />);
    });

    expect(nodeValueSetter).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<textarea value="b" onChange={emptyFunction} />);
    });

    expect(nodeValueSetter).toHaveBeenCalledTimes(1);
  });

  /** 给定接入document的受控value数字0，绕过tracker写giraffe后派input；断言恢复0，验证事件收尾的受控恢复；finally移除测试容器。 */
  it('should properly control a value of number `0`', async () => {
    const setUntrackedValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    ).set;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);

    try {
      const node = await renderTextarea(
        <textarea value={0} onChange={emptyFunction} />,
        container,
        root,
      );

      setUntrackedValue.call(node, 'giraffe');
      node.dispatchEvent(
        new Event('input', {bubbles: true, cancelable: false}),
      );
      expect(node.value).toBe('0');
    } finally {
      document.body.removeChild(container);
    }
  });

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 给定disableTextareaChildren开启，children为giraffe后换gorilla；断言DEV建议value/defaultValue且实时值两次为空，验证禁用旧children初值。 */
    it('should ignore children content', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>giraffe</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');

      await act(() => {
        root.render(<textarea>gorilla</textarea>);
      });

      expect(node.value).toEqual('');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 给定禁用textarea children，defaultValue=dragon同时children=monkey；挂载后断言警告和value=dragon，验证默认值仍生效。 */
    it('should receive defaultValue and still ignore children content', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const node = await renderTextarea(
        <textarea defaultValue="dragon">monkey</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('dragon');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 给定允许旧children路径，初始giraffe后换gorilla；断言警告且value仍giraffe，验证children仅提供初始默认值。 */
    it('should treat children like `defaultValue`', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const node = await renderTextarea(
        <textarea>giraffe</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      expect(node.value).toBe('giraffe');

      await act(() => {
        root.render(<textarea>gorilla</textarea>);
      });

      expect(node.value).toEqual('giraffe');
    });
  }

  /** 给定受控kitten，切为非受控defaultValue=gorilla；断言value仍kitten，验证模式切换保留当前值。 */
  it('should keep value when switching to uncontrolled element if not changed', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="kitten" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('kitten');

    await act(() => {
      root.render(<textarea defaultValue="gorilla" />);
    });

    expect(node.value).toEqual('kitten');
  });

  /** 给定受控kitten先更新puppies，再切非受控defaultValue=gorilla；断言value保留puppies，验证最后受控值保留。 */
  it('should keep value when switching to uncontrolled element if changed', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const node = await renderTextarea(
      <textarea value="kitten" onChange={emptyFunction} />,
      container,
      root,
    );

    expect(node.value).toBe('kitten');

    await act(() => {
      root.render(<textarea value="puppies" onChange={emptyFunction} />);
    });

    expect(node.value).toBe('puppies');

    await act(() => {
      root.render(<textarea defaultValue="gorilla" />);
    });

    expect(node.value).toEqual('puppies');
  });

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 给定禁用children路径，挂载数字17子内容；断言警告及value空串，验证忽略数字children。 */
    it('should ignore numbers as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{17}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 给定允许children路径，挂载数字17子内容；断言警告及value字符串17，验证旧路径的数字初值转换。 */
    it('should allow numbers as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{17}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('17');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 给定禁用children路径，挂载false子内容；断言警告及value空串，验证忽略布尔children。 */
    it('should ignore booleans as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{false}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 给定允许children路径，挂载false子内容；断言警告及value字符串false，验证textarea旧路径区别于普通children布尔过滤。 */
    it('should allow booleans as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const node = await renderTextarea(
        <textarea>{false}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('false');
    });
  }

  if (ReactFeatureFlags.disableTextareaChildren) {
    /** 给定禁用children路径，挂载可转字符串对象；断言警告及value空串，验证对象children不提供初值。 */
    it('should ignore objects as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const obj = {
        /** 返回sharkswithlasers的对象转换夹具；禁用children时该对象不成为textarea初值。 */
        toString: function () {
          return 'sharkswithlasers';
        },
      };
      const node = await renderTextarea(
        <textarea>{obj}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 给定允许children路径，挂载toString返回sharkswithlasers的对象；断言警告及该value，验证旧路径对象转换。 */
    it('should allow objects as children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      const obj = {
        /** 返回sharkswithlasers的对象转换夹具；允许旧children路径时该结果成为textarea初值。 */
        toString: function () {
          return 'sharkswithlasers';
        },
      };
      const node = await renderTextarea(
        <textarea>{obj}</textarea>,
        container,
        root,
      );
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      expect(node.value).toBe('sharkswithlasers');
    });
  }

  if (!ReactFeatureFlags.disableTextareaChildren) {
    /** 给定允许children路径，先挂载两个文本子节点再单个strong元素；断言前者拒绝至多一个child，后者成功且value为[object Object]，验证数量限制而非所有元素都抛错。 */
    it('should throw with multiple or invalid children', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(async () => {
        await act(() => {
          root.render(
            <textarea>
              {'hello'}
              {'there'}
            </textarea>,
          );
        });
      }).rejects.toThrow('<textarea> can only have at most one child');
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      let node;
      await expect(
        (async () =>
          (node = await renderTextarea(
            <textarea>
              <strong />
            </textarea>,
            container,
            root,
          )))(),
      ).resolves.not.toThrow();
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);

      expect(node.value).toBe('[object Object]');
    });
  }

  /** 给定已挂载空textarea，act内unmount根；等待完成无异常，验证卸载路径；没有额外DOM终态断言。 */
  it('should unmount', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea />);
    });

    await act(() => {
      root.unmount();
    });
  });

  /** 给定空根，连续两次渲染value=null；断言首轮DEV建议空串或undefined，验证null值诊断去重。 */
  it('should warn if value is null', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={null} />);
    });
    assertConsoleErrorDev([
      '`value` prop on `textarea` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` ' +
        'for uncontrolled components.\n' +
        '    in textarea (at **)',
    ]);

    await act(() => {
      root.render(<textarea value={null} />);
    });
  });

  /** 给定同时value=foo/defaultValue=bar/readOnly的夹具，两根分别挂载；断言首轮互斥警告，第二根不再报同警告，验证受控/非受控诊断去重。 */
  it('should warn if value and defaultValue are specified', async () => {
    /** 返回同时value/defaultValue且readOnly的非法配置；避免缺onChange诊断干扰互斥警告及跨根去重测试。 */
    const InvalidComponent = () => (
      <textarea value="foo" defaultValue="bar" readOnly={true} />
    );
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<InvalidComponent />);
    });
    assertConsoleErrorDev([
      'InvalidComponent contains a textarea with both value and defaultValue props. ' +
        'Textarea elements must be either controlled or uncontrolled ' +
        '(specify either the value prop, or the defaultValue prop, but not ' +
        'both). Decide between using a controlled or uncontrolled textarea ' +
        'and remove one of these props. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in textarea (at **)\n' +
        '    in InvalidComponent (at **)',
    ]);

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<InvalidComponent />);
    });
  });

  /** 给定无value的textarea，挂载卸载后在新根传value=undefined；两次act完成不出现预期外诊断，验证两种非受控写法无需onChange。 */
  it('should not warn about missing onChange in uncontrolled textareas', async () => {
    const container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<textarea />);
    });

    await act(() => {
      root.unmount();
    });
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<textarea value={undefined} />);
    });
  });

  /** 给定App count=0及恒定textarea value=foo，安装defaultValue访问器spy后setState(count=1)；立即断言setter0次。此例未再次awaitact，该断言限定即时窗口，不证明后续提交终态。 */
  it('does not set textContent if value is unchanged', async () => {
    const container = document.createElement('div');
    let node;
    let instance;
    // 设置 textarea 的 defaultValue 等价于设置 textContent，也是当前采用的实现；因此可观察
    // defaultValue 是否被设置，判断 textContent 是否重新创建。
    // https://html.spec.whatwg.org/#the-textarea-element
    let defaultValue;
    /** defaultValue setter spy保存传入值；测试用它作为textarea文本重写的观测点。 */
    const set = jest.fn(value => {
      defaultValue = value;
    });
    /** defaultValue getter spy返回保存值，保证安装访问器后仍能读取原默认值。 */
    const get = jest.fn(value => {
      return defaultValue;
    });
    /** 保存自身实例与textarea引用的类夹具；count更新父节点和data-count，textarea的受控value保持foo，以便监测默认值赋入。 */
    class App extends React.Component {
      /** count初始0用于触发无关更新，text初始foo但render直接使用固定foo；不要把text字段当成该测试的更新输入。 */
      state = {count: 0, text: 'foo'};
      /** 挂载后把实例赋给外部instance，以允许测试从类状态更新入口触发count变化。 */
      componentDidMount() {
        instance = this;
      }
      /** 返回count span与固定value=foo的textarea；ref保存节点，data-count变化使宿主更新可被观察而不改变表单值。 */
      render() {
        return (
          <div>
            <span>{this.state.count}</span>
            <textarea
              ref={n => (node = n)}
              value="foo"
              onChange={emptyFunction}
              data-count={this.state.count}
            />
          </div>
        );
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    defaultValue = node.defaultValue;
    Object.defineProperty(node, 'defaultValue', {get, set});
    instance.setState({count: 1});
    expect(set.mock.calls.length).toBe(0);
  });

  describe('When given a Symbol value', () => {
    /** 给定Symbol value及onChange，首挂textarea；断言非法value警告与实时value空串，验证Symbol过滤。 */
    it('treats initial Symbol value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea value={Symbol('foobar')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定Symbol children及onChange，首挂textarea；断言children用法警告与value空串，验证Symbol不能形成初始文本。 */
    it('treats initial Symbol children as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea onChange={() => {}}>{Symbol('foo')}</textarea>);
      });
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定受控value=foo，更新为Symbol；断言非法value警告和value空串，验证更新也过滤Symbol。 */
    it('treats updated Symbol value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value="foo" onChange={() => {}} />);
      });

      await act(() => {
        root.render(<textarea value={Symbol('foo')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定Symbol defaultValue，首挂textarea；断言value空串，验证默认值过滤；本例没有断言默认值警告。 */
    it('treats initial Symbol defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea defaultValue={Symbol('foobar')} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('');
    });

    /** 给定非受控defaultValue=foo，更新为Symbol；断言value仍foo，验证无效默认值更新不覆盖实时值，标题不意味着实时值变空。 */
    it('treats updated Symbol defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue="foo" />);
      });

      await act(() => {
        root.render(<textarea defaultValue={Symbol('foobar')} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('foo');
    });
  });

  describe('When given a function value', () => {
    /** 给定函数value及onChange，首挂textarea；断言非法value警告与value空串，验证函数过滤。 */
    it('treats initial function value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定函数children及onChange，首挂textarea；断言children用法警告与value空串，验证函数不能提供初始值。 */
    it('treats initial function children as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea onChange={() => {}}>{() => {}}</textarea>);
      });
      assertConsoleErrorDev([
        'Use the `defaultValue` or `value` props instead of setting children on <textarea>.\n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定受控value=foo，更新为函数；断言非法value警告与value空串，验证更新过滤。 */
    it('treats updated function value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<textarea value="foo" onChange={() => {}} />);
      });

      await act(() => {
        root.render(<textarea value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <textarea> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in textarea (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
    });

    /** 给定函数defaultValue，首挂textarea；断言value空串，验证默认值函数过滤；本例未检查警告。 */
    it('treats initial function defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue={() => {}} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('');
    });

    /** 给定非受控defaultValue=foo，更新为函数；断言实时value仍foo，验证默认值更新与当前值分离。 */
    it('treats updated function defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<textarea defaultValue="foo" />);
      });

      await act(() => {
        root.render(<textarea defaultValue={() => {}} />);
      });

      const node = container.firstChild;

      // TODO：`defaultValue` 是一个保留的属性，且不会进行验证。 检查警告时.
      expect(node.value).toBe('foo');
    });
  });

  /** 给定defaultValue=0并检查value/defaultValue都为0，删除defaultValue prop；断言默认值property为空串，验证旧默认值清除。 */
  it('should remove previous `defaultValue`', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<textarea />);
    });

    expect(node.defaultValue).toBe('');
  });

  /** 给定defaultValue=0，更新为null；断言defaultValue为空串，验证null与缺失默认值等价。 */
  it('should treat `defaultValue={null}` as missing', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea defaultValue="0" />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<textarea defaultValue={null} />);
    });

    expect(node.defaultValue).toBe('');
  });

  /** 给定value=undefined且无onChange，挂载textarea；断言act成功完成，验证非受控输入不进入缺handler诊断。 */
  it('should not warn about missing onChange if value is undefined', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value={undefined} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 给定value=something和onChange spy，挂载textarea；断言act成功完成，验证受控字段具备处理器的合法配置。 */
  it('should not warn about missing onChange if onChange is set', async () => {
    const change = jest.fn();
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" onChange={change} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 给定value=something、disabled=true且无onChange，挂载；断言act成功完成，验证禁用字段可免handler诊断。 */
  it('should not warn about missing onChange if disabled is true', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" disabled={true} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 给定value=something、readOnly=true且无onChange，挂载；断言act成功完成，验证readOnly豁免；标题说value未设与实际输入不同。 */
  it('should not warn about missing onChange if value is not set', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<textarea value="something" readOnly={true} />);
      }),
    ).resolves.not.toThrow();
  });

  /** 给定value=false且无onChange，挂载；断言只读字段DEV提示，验证false仍是受控值。 */
  it('should warn about missing onChange if value is false', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={false} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 给定value数字0且无onChange，挂载；断言只读字段DEV提示，验证数字0仍要求处理器或readOnly。 */
  it('should warn about missing onChange if value is 0', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value={0} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 给定value字符串0且无onChange，挂载；断言只读字段DEV提示，验证字符串受控检查。 */
  it('should warn about missing onChange if value is "0"', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="0" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });

  /** 给定value空串且无onChange，挂载；断言只读字段DEV提示，验证空串属于显式受控值。 */
  it('should warn about missing onChange if value is ""', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea value="" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in textarea (at **)',
    ]);
  });
});
