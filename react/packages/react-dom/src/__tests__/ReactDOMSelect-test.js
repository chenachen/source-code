/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 修复 JSDOM。 setAttribute 应该在无法隐式转换为字符串的东西上抛出错误。
/** 保留Element原生setAttribute供包装器调用；包装前强制字符串拼接，使jsdom对禁止隐式转换的对象与浏览器一致。 */
const setAttribute = Element.prototype.setAttribute;
/** 接收attribute名称name和值value，以当前Element为this转发原始setAttribute并返回其结果；先拼接转换以暴露TemporalLike的valueOf错误。 */
Element.prototype.setAttribute = function (name, value) {
  // eslint-disable-next-line react-internal/safe-string-coercion
  return setAttribute.call(this, name, '' + value);
};

describe('ReactDOMSelect', () => {
  let React;
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;
  let assertConsoleErrorDev;

  /** 空onChange处理器，无状态变化和返回值；让受控选择测试只检验value/option而不混入缺handler提示。 */
  const noop = function () {};

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /** 给定三个option及defaultValue=giraffe，更新defaultValue=gorilla；断言value仍giraffe，验证非受控默认值仅初始化选择。 */
  it('should allow setting `defaultValue`', async () => {
    const stub = (
      <select defaultValue="giraffe">
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(<select defaultValue="gorilla">{options}</select>);
    });

    expect(node.value).toEqual('giraffe');
  });

  /** 给定无option的select defaultValue=dummy，调用包含act渲染的async包装器；同步not.toThrow断言未同步抛错。包装器Promise未被await，此断言不单独证明异步完成。 */
  it('should not throw with `defaultValue` and without children', () => {
    const stub = <select defaultValue="dummy" />;

    expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(stub);
      });
    }).not.toThrow();
  });

  /** 给定defaultValue=giraffe，用户把DOM.value改monkey后重渲染同元素；断言保持monkey，验证非受控选择不被重置。 */
  it('should not control when using `defaultValue`', async () => {
    const el = (
      <select defaultValue="giraffe">
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(el);
    });

    const node = container.firstChild;

    expect(node.value).toBe('giraffe');

    node.value = 'monkey';
    await act(() => {
      root.render(el);
    });

    // 非受控 select 首次挂载后不应再改变值。
    expect(node.value).toEqual('monkey');
  });

  /** 给定multiple默认选择giraffe/gorilla，默认数组更新为monkey；断言selected仍(false,true,true)，验证多选默认值不持续控制。 */
  it('should allow setting `defaultValue` with multiple', async () => {
    const stub = (
      <select multiple={true} defaultValue={['giraffe', 'gorilla']}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} defaultValue={['monkey']}>
          {options}
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项
  });

  /** 给定受控value=giraffe，更新gorilla；断言value随props变化，验证单选受控更新。 */
  it('should allow setting `value`', async () => {
    const stub = (
      <select value="giraffe" onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.value).toBe('giraffe');

    await act(() => {
      root.render(
        <select value="gorilla" onChange={noop}>
          {options}
        </select>,
      );
    });

    expect(node.value).toEqual('gorilla');
  });

  /** 给定空默认值且首两项disabled，挂载选项；断言首项未选、第三项选中，验证回退选中第一个未禁用项。 */
  it('should default to the first non-disabled option', async () => {
    const stub = (
      <select defaultValue="">
        <option disabled={true}>Disabled</option>
        <option disabled={true}>Still Disabled</option>
        <option>0</option>
        <option disabled={true}>Also Disabled</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;
    expect(node.options[0].selected).toBe(false);
    expect(node.options[2].selected).toBe(true);
  });

  /** 给定__proto__作为单选value及option值，更新gorilla；断言先选__proto__后gorilla，验证该键不会触发原型歧义。 */
  it('should allow setting `value` to __proto__', async () => {
    const stub = (
      <select value="__proto__" onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="__proto__">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.value).toBe('__proto__');

    await act(() => {
      root.render(
        <select value="gorilla" onChange={noop}>
          {options}
        </select>,
      );
    });

    expect(node.value).toEqual('gorilla');
  });

  /** 给定无option的受控select value=dummy，调用async渲染包装器；同步not.toThrow仅检查调用未同步抛错，测试没有await其Promise，避免按标题扩大异步保证。 */
  it('should not throw with `value` and without children', () => {
    const stub = <select value="dummy" onChange={noop} />;

    expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(stub);
      });
    }).not.toThrow();
  });

  /** 给定multiple受控选择giraffe/gorilla，更新数组为monkey；断言selected从(false,true,true)变(true,false,false)，验证多选全量更新。 */
  it('should allow setting `value` with multiple', async () => {
    const stub = (
      <select multiple={true} value={['giraffe', 'gorilla']} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} value={['monkey']} onChange={noop}>
          {options}
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(true); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定multiple数组含__proto__/gorilla，更新monkey；断言选择从(false,true,true)变(true,false,false)，验证特殊字符串键精确匹配。 */
  it('should allow setting `value` to __proto__ with multiple', async () => {
    const stub = (
      <select multiple={true} value={['__proto__', 'gorilla']} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="__proto__">A __proto__!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // __proto__
    expect(node.options[2].selected).toBe(true); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} value={['monkey']} onChange={noop}>
          {options}
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(true); // 猴子选项
    expect(node.options[1].selected).toBe(false); // __proto__
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定多选value=[12]且option为1/2/12；断言只12选中，验证集合按完整字符串匹配而非包含字符。 */
  it('should not select other options automatically', async () => {
    const stub = (
      <select multiple={true} value={['12']} onChange={noop}>
        <option value="1">one</option>
        <option value="2">two</option>
        <option value="12">twelve</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 值为 1 的选项
    expect(node.options[1].selected).toBe(false); // 值为 2 的选项
    expect(node.options[2].selected).toBe(true); // 值为 12 的选项
  });

  /** 给定受控多选value=[a,b]但初始无children，随后增加a/b/c；断言a/b选中、c未选，验证子option更新后重新应用受控选择。 */
  it('should reset child options selected when they are changed and `value` is set', async () => {
    const stub = <select multiple={true} value={['a', 'b']} onChange={noop} />;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    await act(() => {
      root.render(
        <select multiple={true} value={['a', 'b']} onChange={noop}>
          <option value="a">a</option>
          <option value="b">b</option>
          <option value="c">c</option>
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(true); // a
    expect(node.options[1].selected).toBe(true); // b
    expect(node.options[2].selected).toBe(false); // c
  });

  /** 给定value数组中的对象toString读取animal=giraffe，原对象改animal=monkey后重渲染；断言选择随字符串结果改变，验证对象转换不依赖身份变化。 */
  it('should allow setting `value` with `objectToString`', async () => {
    const objectToString = {
      animal: 'giraffe',
      /** 返回对象当前animal字段；改变该字段而保持对象身份，证明选项匹配按本轮字符串结果重新计算。 */
      toString: function () {
        return this.animal;
      },
    };

    const el = (
      <select multiple={true} value={[objectToString]} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(el);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项

    // 改变 `value` prop 后，选中项也应随之改变。
    objectToString.animal = 'monkey';

    const el2 = (
      <select multiple={true} value={[objectToString]}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );

    await act(() => {
      root.render(el2);
    });

    expect(node.options[0].selected).toBe(true); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定单选默认giraffe，切multiple并传默认数组giraffe/gorilla；断言后两项选中，验证multiple切换重新应用默认选择。 */
  it('should allow switching to multiple', async () => {
    const stub = (
      <select defaultValue="giraffe">
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} defaultValue={['giraffe', 'gorilla']}>
          {options}
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项
  });

  /** 给定多选默认giraffe/gorilla，切单选默认gorilla；断言只gorilla选中，验证多选转单选重置选择。 */
  it('should allow switching from multiple', async () => {
    const stub = (
      <select multiple={true} defaultValue={['giraffe', 'gorilla']}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项

    await act(() => {
      root.render(<select defaultValue="gorilla">{options}</select>);
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项
  });

  /** 给定size=2且无默认值的单选select，挂载三项；断言全未选、value空串、selectedIndex=-1，验证列表框初始无选择。 */
  it('does not select an item when size is initially set to greater than 1', async () => {
    const stub = (
      <select size="2">
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const select = container.firstChild;

    expect(select.options[0].selected).toBe(false);
    expect(select.options[1].selected).toBe(false);
    expect(select.options[2].selected).toBe(false);

    expect(select.value).toBe('');
    expect(select.selectedIndex).toBe(-1);
  });

  /** 给定受控giraffe，删除value prop；断言仍只giraffe选中，验证转非受控保留当前选择。 */
  it('should remember value when switching to uncontrolled', async () => {
    const stub = (
      <select value={'giraffe'} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项

    await act(() => {
      root.render(<select>{options}</select>);
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定受控giraffe先改gorilla，再删value；断言gorilla保持选中，验证保留最后一次受控选择。 */
  it('should remember updated value when switching to uncontrolled', async () => {
    const stub = (
      <select value={'giraffe'} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const options = stub.props.children;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;
    await act(() => {
      root.render(
        <select value="gorilla" onChange={noop}>
          {options}
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项

    await act(() => {
      root.render(<select>{options}</select>);
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(true); // 大猩猩选项
  });

  /** 给定受控value=giraffe，SSR并解析三项；断言各value及仅giraffe selected，验证服务端选择序列化。 */
  it('should support server-side rendering', () => {
    const stub = (
      <select value="giraffe" onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(stub);
    const options = container.firstChild.options;
    expect(options[0].value).toBe('monkey');
    expect(options[0].selected).toBe(false);
    expect(options[1].value).toBe('giraffe');
    expect(options[1].selected).toBe(true);
    expect(options[2].value).toBe('gorilla');
    expect(options[2].selected).toBe(false);
  });

  /** 给定defaultValue=giraffe，SSR并解析；断言三项value及仅giraffe选中，验证默认选择的服务端输出。 */
  it('should support server-side rendering with defaultValue', () => {
    const stub = (
      <select defaultValue="giraffe">
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(stub);
    const options = container.firstChild.options;
    expect(options[0].value).toBe('monkey');
    expect(options[0].selected).toBe(false);
    expect(options[1].value).toBe('giraffe');
    expect(options[1].selected).toBe(true);
    expect(options[2].value).toBe('gorilla');
    expect(options[2].selected).toBe(false);
  });

  /** 给定defaultValue=giraffe且option用dangerouslySetInnerHTML提供文本，SSR后解析；断言values和选择正确，验证原始内容不改变显式value匹配。 */
  it('should support server-side rendering with dangerouslySetInnerHTML', () => {
    const stub = (
      <select defaultValue="giraffe">
        <option
          value="monkey"
          dangerouslySetInnerHTML={{
            __html: 'A monkey!',
          }}>
          {undefined}
        </option>
        <option
          value="giraffe"
          dangerouslySetInnerHTML={{
            __html: 'A giraffe!',
          }}>
          {null}
        </option>
        <option
          value="gorilla"
          dangerouslySetInnerHTML={{
            __html: 'A gorilla!',
          }}
        />
      </select>
    );
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(stub);
    const options = container.firstChild.options;
    expect(options[0].value).toBe('monkey');
    expect(options[0].selected).toBe(false);
    expect(options[1].value).toBe('giraffe');
    expect(options[1].selected).toBe(true);
    expect(options[2].value).toBe('gorilla');
    expect(options[2].selected).toBe(false);
  });

  /** 给定multiple value=[giraffe,gorilla]，SSR后解析；断言后两项selected，验证多选服务端输出。 */
  it('should support server-side rendering with multiple', () => {
    const stub = (
      <select multiple={true} value={['giraffe', 'gorilla']} onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(stub);
    const options = container.firstChild.options;
    expect(options[0].value).toBe('monkey');
    expect(options[0].selected).toBe(false);
    expect(options[1].value).toBe('giraffe');
    expect(options[1].selected).toBe(true);
    expect(options[2].value).toBe('gorilla');
    expect(options[2].selected).toBe(true);
  });

  /** 给定multiple默认giraffe，移除再重加同key的giraffe option；断言重新添加后全部未选，验证非受控select不重新施加默认数组。 */
  it('should not control defaultValue if re-adding options', async () => {
    const container = document.createElement('div');

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <select multiple={true} defaultValue={['giraffe']}>
          <option key="monkey" value="monkey">
            A monkey!
          </option>
          <option key="giraffe" value="giraffe">
            A giraffe!
          </option>
          <option key="gorilla" value="gorilla">
            A gorilla!
          </option>
        </select>,
      );
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} defaultValue={['giraffe']}>
          <option key="monkey" value="monkey">
            A monkey!
          </option>
          <option key="gorilla" value="gorilla">
            A gorilla!
          </option>
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 大猩猩选项

    await act(() => {
      root.render(
        <select multiple={true} defaultValue={['giraffe']}>
          <option key="monkey" value="monkey">
            A monkey!
          </option>
          <option key="giraffe" value="giraffe">
            A giraffe!
          </option>
          <option key="gorilla" value="gorilla">
            A gorilla!
          </option>
        </select>,
      );
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定value=monkey且option文本含动态条件，更新giraffe；断言对应selected随value切换，验证动态children与显式option值共存。 */
  it('should support options with dynamic children', async () => {
    const container = document.createElement('div');

    let node;

    /** 接收value并返回受控select及文本随选择变化的option；ref保存节点，用显式value隔离动态children变化。 */
    function App({value}) {
      return (
        <select value={value} ref={n => (node = n)} onChange={noop}>
          <option key="monkey" value="monkey">
            A monkey {value === 'monkey' ? 'is chosen' : null}!
          </option>
          <option key="giraffe" value="giraffe">
            A giraffe {value === 'giraffe' && 'is chosen'}!
          </option>
          <option key="gorilla" value="gorilla">
            A gorilla {value === 'gorilla' && 'is chosen'}!
          </option>
        </select>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App value="monkey" />);
    });

    expect(node.options[0].selected).toBe(true); // 猴子选项
    expect(node.options[1].selected).toBe(false); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项

    await act(() => {
      root.render(<App value="giraffe" />);
    });

    expect(node.options[0].selected).toBe(false); // 猴子选项
    expect(node.options[1].selected).toBe(true); // 长颈鹿选项
    expect(node.options[2].selected).toBe(false); // 大猩猩选项
  });

  /** 给定单选value=null，连续渲染两次；断言首轮建议空串或undefined警告，验证null诊断与去重。 */
  it('should warn if value is null', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <select value={null}>
          <option value="test" />
        </select>,
      );
    });
    assertConsoleErrorDev([
      '`value` prop on `select` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` ' +
        'for uncontrolled components.\n' +
        '    in select (at **)',
    ]);

    await act(() => {
      root.render(
        <select value={null}>
          <option value="test" />
        </select>,
      );
    });
  });

  /** 给定App含两个selected=true的option，连续挂载更新；断言一次建议在select上设置value/defaultValue的警告，验证option selected用法诊断去重。 */
  it('should warn if selected is set on <option>', async () => {
    /** 返回两个selected=true的option，构造旧式option选择用法；重复渲染用于核对一次性警告。 */
    function App() {
      return (
        <select>
          <option selected={true} />
          <option selected={true} />
        </select>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertConsoleErrorDev([
      'Use the `defaultValue` or `value` props on <select> instead of ' +
        'setting `selected` on <option>.\n' +
        '    in option (at **)\n' +
        '    in App (at **)',
    ]);

    await act(() => {
      root.render(<App />);
    });
  });

  /** 给定multiple=true且value=null，两次渲染；断言一次建议空数组或undefined的警告，验证多选专用null提示。 */
  it('should warn if value is null and multiple is true', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <select value={null} multiple={true}>
          <option value="test" />
        </select>,
      );
    });
    assertConsoleErrorDev([
      '`value` prop on `select` should not be null. ' +
        'Consider using an empty array when `multiple` is ' +
        'set to `true` to clear the component or `undefined` ' +
        'for uncontrolled components.\n' +
        '    in select (at **)',
    ]);

    await act(() => {
      root.render(
        <select value={null} multiple={true}>
          <option value="test" />
        </select>,
      );
    });
  });

  /** 给定接入document的受控giraffe，派冒泡change并等待act；断言value仍giraffe，验证事件后的受控状态；finally移除容器。本例未先模拟不同选择。 */
  it('should refresh state on change', async () => {
    const stub = (
      <select value="giraffe" onChange={noop}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );
    const container = document.createElement('div');
    document.body.appendChild(container);

    try {
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(stub);
      });

      const node = container.firstChild;

      await act(() => {
        node.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: false}),
        );
      });

      expect(node.value).toBe('giraffe');
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 给定select同时value/defaultValue=giraffe且readOnly，两次render；断言一次互斥警告，验证受控/非受控诊断去重。 */
  it('should warn if value and defaultValue props are specified', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <select value="giraffe" defaultValue="giraffe" readOnly={true}>
          <option value="monkey">A monkey!</option>
          <option value="giraffe">A giraffe!</option>
          <option value="gorilla">A gorilla!</option>
        </select>,
      );
    });
    assertConsoleErrorDev([
      'Select elements must be either controlled or uncontrolled ' +
        '(specify either the value prop, or the defaultValue prop, but not ' +
        'both). Decide between using a controlled or uncontrolled select ' +
        'element and remove one of these props. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in select (at **)',
    ]);

    await act(() => {
      root.render(
        <select value="giraffe" defaultValue="giraffe" readOnly={true}>
          <option value="monkey">A monkey!</option>
          <option value="giraffe">A giraffe!</option>
          <option value="gorilla">A gorilla!</option>
        </select>,
      );
    });
  });

  /** 给定无value的select，挂载卸载后新根以value=undefined挂载；完成无预期外警告，验证非受控select无需onChange，标题中的textarea不属于本例。 */
  it('should not warn about missing onChange in uncontrolled textareas', async () => {
    const container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<select />);
    });

    await act(() => {
      root.unmount();
    });
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<select value={undefined} />);
    });
  });

  /** 给定受控select的onChange卸载根，派change并等待act；断言Promise不拒绝且容器为空，验证事件收尾面对已卸载节点仍安全。 */
  it('should be able to safely remove select onChange', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    /** change处理器卸载当前root；async返回Promise，事件后的act继续等待清理，验证受控恢复面对删除节点的边界。 */
    async function changeView() {
      root.unmount();
    }

    const stub = (
      <select value="giraffe" onChange={changeView}>
        <option value="monkey">A monkey!</option>
        <option value="giraffe">A giraffe!</option>
        <option value="gorilla">A gorilla!</option>
      </select>
    );

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    await expect(
      act(() => {
        node.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: false}),
        );
      }),
    ).resolves.not.toThrow();

    expect(container.firstChild).toBe(null);
  });

  /** 给定受控value=b且option位于optgroup内，挂载；断言只有b selected，验证options集合覆盖孙级option。 */
  it('should select grandchild options nested inside an optgroup', async () => {
    const stub = (
      <select value="b" onChange={noop}>
        <optgroup label="group">
          <option value="a">a</option>
          <option value="b">b</option>
          <option value="c">c</option>
        </optgroup>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // a
    expect(node.options[1].selected).toBe(true); // b
    expect(node.options[2].selected).toBe(false); // c
  });

  /** 给定允许legacy模式且Parent在ref容器嵌套ReactDOM.render受控select，用户改gorilla并派input、change；断言两步仍gorilla，change经Parent更新再嵌套渲染，验证嵌套受控根；最后移除容器。 */
  // @gate !disableLegacyMode
  it('should allow controlling `value` in a nested legacy render', async () => {
    let selectNode;

    /** legacy父组件夹具，在自己的ref容器内建立嵌套受控select；state.value经change更新后再次同步嵌套渲染。 */
    class Parent extends React.Component {
      /** 保存当前选中字符串，初始giraffe；嵌套select只从该状态读取受控value。 */
      state = {
        value: 'giraffe',
      };

      /** 父容器ref已连接后首次渲染嵌套select，确保ReactDOM.render有真实宿主容器。 */
      componentDidMount() {
        this._renderNested();
      }

      /** Parent状态提交后重渲染嵌套select，使其受控value反映最新选择。 */
      componentDidUpdate() {
        this._renderNested();
      }

      /** 接收change事件，把event.target.value写入Parent状态；下一次componentDidUpdate驱动嵌套根选择更新。 */
      _handleChange(event) {
        this.setState({value: event.target.value});
      }

      /** 把由Parent.state.value控制的select渲染到_nestingContainer；绑定change到本实例并保存selectNode供原生事件与value断言。 */
      _renderNested() {
        ReactDOM.render(
          <select
            onChange={this._handleChange.bind(this)}
            ref={n => (selectNode = n)}
            value={this.state.value}>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
            <option value="gorilla">A gorilla!</option>
          </select>,
          this._nestingContainer,
        );
      }

      /** 返回仅保存ref的div，作为独立legacy渲染的宿主容器；select由生命周期而非该返回树创建。 */
      render() {
        return <div ref={n => (this._nestingContainer = n)} />;
      }
    }

    const container = document.createElement('div');

    document.body.appendChild(container);

    ReactDOM.render(<Parent />, container);

    expect(selectNode.value).toBe('giraffe');

    selectNode.value = 'gorilla';

    let nativeEvent = document.createEvent('Event');
    nativeEvent.initEvent('input', true, true);
    selectNode.dispatchEvent(nativeEvent);

    expect(selectNode.value).toEqual('gorilla');

    nativeEvent = document.createEvent('Event');
    nativeEvent.initEvent('change', true, true);
    selectNode.dispatchEvent(nativeEvent);

    expect(selectNode.value).toEqual('gorilla');

    document.body.removeChild(container);
  });

  /** 给定multiple且未传value/defaultValue，挂载a/b/c；断言所有selected=false，验证多选默认不选择首项。 */
  it('should not select first option by default when multiple is set and no defaultValue is set', async () => {
    const stub = (
      <select multiple={true} onChange={noop}>
        <option value="a">a</option>
        <option value="b">b</option>
        <option value="c">c</option>
      </select>
    );
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(stub);
    });

    const node = container.firstChild;

    expect(node.options[0].selected).toBe(false); // a
    expect(node.options[1].selected).toBe(false); // b
    expect(node.options[2].selected).toBe(false); // c
  });

  describe('When given a Symbol value', () => {
    /** 给定select与首option都传Symbol value，首挂；断言option非法值警告与select.value=A Symbol!，验证过滤后回退到首项文本值。 */
    it('treats initial Symbol value as missing', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select onChange={noop} value={Symbol('foobar')}>
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      const node = container.firstChild;
      expect(node.value).toBe('A Symbol!');
    });

    /** 给定select选monkey且首option value为Symbol，更新select.value为Symbol；断言警告后值从monkey变A Symbol!，验证无效受控值回退选择。 */
    it('treats updated Symbol value as missing', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select onChange={noop} value="monkey">
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      let node = container.firstChild;
      expect(node.value).toBe('monkey');

      await act(() => {
        root.render(
          <select onChange={noop} value={Symbol('foobar')}>
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      node = container.firstChild;

      expect(node.value).toBe('A Symbol!');
    });

    /** 给定select/首option默认值为Symbol，首挂；断言option警告与value=A Symbol!，验证实际选择文本值，标题的空串不等于最终DOM.value。 */
    it('treats initial Symbol defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue={Symbol('foobar')}>
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      const node = container.firstChild;
      expect(node.value).toBe('A Symbol!');
    });

    /** 给定默认monkey的根，随后创建新容器新根以Symbol默认值首挂；断言先monkey再A Symbol!，验证无效默认值的首挂回退；实际没有同节点更新。 */
    it('treats updated Symbol defaultValue as an empty string', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue="monkey">
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      let node = container.firstChild;
      expect(node.value).toBe('monkey');

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue={Symbol('foobar')}>
            <option value={Symbol('foobar')}>A Symbol!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      node = container.firstChild;
      expect(node.value).toBe('A Symbol!');
    });
  });

  describe('When given a function value', () => {
    /** 给定select与首option的value为函数，首挂；断言option非法值警告与value=A function!，验证函数过滤后回退文本值。 */
    it('treats initial function value as missing', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select onChange={noop} value={() => {}}>
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      const node = container.firstChild;
      expect(node.value).toBe('A function!');
    });

    /** 给定函数defaultValue及函数option value，首挂；断言option警告与value=A function!，验证无效默认值首项回退而非最终空串。 */
    it('treats initial function defaultValue as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue={() => {}}>
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      const node = container.firstChild;
      expect(node.value).toBe('A function!');
    });

    /** 给定受控monkey和无效函数option value，更新select.value为函数；断言最终A function!，验证更新过滤后回退首项。 */
    it('treats updated function value as an empty string', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select onChange={noop} value="monkey">
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      let node = container.firstChild;
      expect(node.value).toBe('monkey');

      await act(() => {
        root.render(
          <select onChange={noop} value={() => {}}>
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      node = container.firstChild;
      expect(node.value).toBe('A function!');
    });

    /** 给定默认monkey，随后换新容器新根以函数默认值挂载；断言最终A function!，验证首挂回退；标题updated并不对应同一select更新。 */
    it('treats updated function defaultValue as an empty string', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue="monkey">
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <option> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in option (at **)',
      ]);

      let node = container.firstChild;
      expect(node.value).toBe('monkey');

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select defaultValue={() => {}}>
            <option value={() => {}}>A function!</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      node = container.firstChild;

      expect(node.value).toBe('A function!');
    });
  });

  describe('When given a Temporal.PlainDate-like value', () => {
    /** 模拟Temporal对象：valueOf抛TypeError而toString返回日期；各用例把它放在select或option值中，区分转换发生位置与挂载/更新错误次数。 */
    class TemporalLike {
      /** 始终抛TypeError(prod message)，模拟Temporal拒绝隐式原始值转换并成为rejects断言依据。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** 返回2020-01-01日期文本，说明显式字符串方法可用，但本例的隐式转换先调用抛错valueOf。 */
      toString() {
        return '2020-01-01';
      }
    }

    /** 给定select.value为valueOf抛错的TemporalLike，首挂；断言act拒绝TypeError(prod message)与两次表单字段转换警告，验证挂载重试中的select转换失败。 */
    it('throws when given a Temporal.PlainDate-like value (select)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value={new TemporalLike()}>
              <option value="2020-01-01">like a Temporal.PlainDate</option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定受控日期字符串但option.value为TemporalLike，首挂；断言TypeError与两次option attribute转换警告，验证option写入失败。 */
    it('throws when given a Temporal.PlainDate-like value (option)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value="2020-01-01">
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定select和option都用TemporalLike，首挂；断言TypeError及两次option转换警告，验证该路径先由子option失败。 */
    it('throws when given a Temporal.PlainDate-like value (both)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value={new TemporalLike()}>
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定正常受控monkey，更新select.value为TemporalLike；断言TypeError及一次表单字段转换警告，验证select更新失败。 */
    it('throws with updated Temporal.PlainDate-like value (select)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <select onChange={noop} value="monkey">
            <option value="2020-01-01">like a Temporal.PlainDate</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value={new TemporalLike()}>
              <option value="2020-01-01">like a Temporal.PlainDate</option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定正常option.value=donkey，更新该option为TemporalLike；断言TypeError及一次option转换警告，验证宿主属性更新错误传播。 */
    it('throws with updated Temporal.PlainDate-like value (option)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <select onChange={noop} value="2020-01-01">
            <option value="donkey">like a Temporal.PlainDate</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value="2020-01-01">
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定正常select和option同为donkey，更新两者为TemporalLike；断言AggregateError包含两个TypeError且分别有option与select警告，验证更新提交能收集两个失败。 */
    it('throws with updated Temporal.PlainDate-like value (both)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <select onChange={noop} value="donkey">
            <option value="donkey">like a Temporal.PlainDate</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value={new TemporalLike()}>
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(
        new AggregateError([
          new TypeError('prod message'),
          new TypeError('prod message'),
        ]),
      );
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定TemporalLike defaultValue及正常option，首挂；断言TypeError与两次表单转换警告，验证默认选择初始化失败。 */
    it('throws when given a Temporal.PlainDate-like defaultValue (select)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} defaultValue={new TemporalLike()}>
              <option value="2020-01-01">like a Temporal.PlainDate</option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定日期字符串defaultValue及TemporalLike option值，首挂；断言TypeError与两次option警告，验证默认选择也依赖子option属性转换成功。 */
    it('throws when given a Temporal.PlainDate-like defaultValue (option)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await expect(
        act(() => {
          root.render(
            <select onChange={noop} defaultValue="2020-01-01">
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定select defaultValue和option value都TemporalLike，首挂；断言TypeError及两次option警告，验证子option先失败。 */
    it('throws when given a Temporal.PlainDate-like defaultValue (both)', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} defaultValue={new TemporalLike()}>
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定正常defaultValue=monkey，之后换新容器/根用TemporalLike defaultValue挂载；断言TypeError与两次表单警告，验证首挂失败而非同节点默认值更新。 */
    it('throws with updated Temporal.PlainDate-like defaultValue (select)', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select onChange={noop} defaultValue="monkey">
            <option value="2020-01-01">like a Temporal.PlainDate</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} defaultValue={new TemporalLike()}>
              <option value="2020-01-01">like a Temporal.PlainDate</option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not TemporalLike. ' +
          'This value must be coerced to a string before using it here.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定正常defaultValue=monkey，之后换新根并实际传双TemporalLike value；断言TypeError及两次option警告，验证子option首挂失败；标题defaultValue更新与触发输入不同。 */
    it('throws with updated Temporal.PlainDate-like defaultValue (both)', async () => {
      let container = document.createElement('div');
      let root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <select onChange={noop} defaultValue="monkey">
            <option value="donkey">like a Temporal.PlainDate</option>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
          </select>,
        );
      });

      container = document.createElement('div');
      root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select onChange={noop} value={new TemporalLike()}>
              <option value={new TemporalLike()}>
                like a Temporal.PlainDate
              </option>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
            </select>,
          );
        }),
      ).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
        'The provided `value` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in option (at **)',
      ]);
    });

    /** 给定未传value/onChange的select及三项，挂载并等待act；断言成功，验证非受控配置免handler诊断。 */
    it('should not warn about missing onChange if value is not set', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
              <option value="gorilla">A gorilla!</option>
            </select>,
          );
        }),
      ).resolves.not.toThrow();
    });

    /** 给定value=undefined且无onChange，挂载三项select；断言act成功，验证undefined仍属非受控。 */
    it('should not throw an error about missing onChange if value is undefined', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select value={undefined}>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
              <option value="gorilla">A gorilla!</option>
            </select>,
          );
        }),
      ).resolves.not.toThrow();
    });

    /** 给定value=monkey及onChange spy，挂载select；断言act成功，验证受控配置具备处理器。 */
    it('should not warn about missing onChange if onChange is set', async () => {
      const change = jest.fn();
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select value="monkey" onChange={change}>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
              <option value="gorilla">A gorilla!</option>
            </select>,
          );
        }),
      ).resolves.not.toThrow();
    });

    /** 给定value=monkey、disabled=true且无onChange；断言act成功，验证禁用select豁免缺handler提示。 */
    it('should not warn about missing onChange if disabled is true', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <select value="monkey" disabled={true}>
              <option value="monkey">A monkey!</option>
              <option value="giraffe">A giraffe!</option>
              <option value="gorilla">A gorilla!</option>
            </select>,
          );
        }),
      ).resolves.not.toThrow();
    });

    /** 给定value=false且无onChange，挂载；断言只读字段警告，验证false仍为显式受控值。 */
    it('should warn about missing onChange if value is false', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select value={false}>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
            <option value="gorilla">A gorilla!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'You provided a `value` prop to a form ' +
          'field without an `onChange` handler. This will render a read-only ' +
          'field. If the field should be mutable use `defaultValue`. ' +
          'Otherwise, set `onChange`.\n    in select (at **)',
      ]);
    });

    /** 给定数字0 value且无onChange，挂载；断言只读字段警告，验证数字假值仍需处理器。 */
    it('should warn about missing onChange if value is 0', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select value={0}>
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
            <option value="gorilla">A gorilla!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'You provided a `value` prop to a form ' +
          'field without an `onChange` handler. This will render a read-only ' +
          'field. If the field should be mutable use `defaultValue`. ' +
          'Otherwise, set `onChange`.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定字符串0 value且无onChange，挂载；断言只读字段警告，验证字符串受控诊断。 */
    it('should warn about missing onChange if value is "0"', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select value="0">
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
            <option value="gorilla">A gorilla!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'You provided a `value` prop to a form ' +
          'field without an `onChange` handler. This will render a read-only ' +
          'field. If the field should be mutable use `defaultValue`. ' +
          'Otherwise, set `onChange`.\n' +
          '    in select (at **)',
      ]);
    });

    /** 给定空串value且无onChange，挂载；断言只读字段警告，验证空串并非缺失值。 */
    it('should warn about missing onChange if value is ""', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <select value="">
            <option value="monkey">A monkey!</option>
            <option value="giraffe">A giraffe!</option>
            <option value="gorilla">A gorilla!</option>
          </select>,
        );
      });
      assertConsoleErrorDev([
        'You provided a `value` prop to a form ' +
          'field without an `onChange` handler. This will render a read-only ' +
          'field. If the field should be mutable use `defaultValue`. ' +
          'Otherwise, set `onChange`.\n' +
          '    in select (at **)',
      ]);
    });
  });
});
