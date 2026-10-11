/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 保存补丁前的Element.setAttribute；包装方法先以默认hint强制转换value，再委托原方法，重现jsdom缺失的转换失败行为；本文件未自动恢复此补丁。 */
const setAttribute = Element.prototype.setAttribute;
/** 以原setAttribute为接收者方法调用，但先用字符串连接强制转换value，让jsdom与DOM属性的隐式转换失败行为一致；该补丁在此文件不自动恢复。 */
Element.prototype.setAttribute = function (name, value) {
  // eslint-disable-next-line react-internal/safe-string-coercion
  return setAttribute.call(this, name, '' + value);
};

describe('ReactDOM unknown attribute', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /** 先把unknown设为something，更新为givenValue后检查hasAttribute=false；验证无效/缺失值清除已存在attribute。 */
  async function testUnknownAttributeRemoval(givenValue) {
    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);

    await act(() => {
      root.render(<div unknown="something" />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe('something');

    await act(() => {
      root.render(<div unknown={givenValue} />);
    });

    expect(el.firstChild.hasAttribute('unknown')).toBe(false);
  }

  /** 先挂载unknown字符串，再更新givenValue并比对expectedDOMValue；分离初始化与更新属性路径。 */
  async function testUnknownAttributeAssignment(givenValue, expectedDOMValue) {
    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);

    await act(() => {
      root.render(<div unknown="something" />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe('something');

    await act(() => {
      root.render(<div unknown={givenValue} />);
    });

    expect(el.firstChild.getAttribute('unknown')).toBe(expectedDOMValue);
  }

  describe('unknown attributes', () => {
    /** 先挂载unknown=something再分别更新为null/undefined；attribute都应删除，验证缺值路径移除旧属性。 */
    it('removes values null and undefined', async () => {
      await testUnknownAttributeRemoval(null);
      await testUnknownAttributeRemoval(undefined);
    });

    /** 先挂载unknown字符串，再更新true并消费非布尔属性诊断，接着false；两个getAttribute均null且后者不再诊断，验证布尔无效值移除与按属性去重警告。 */
    it('changes values true, false to null, and also warns once', async () => {
      await testUnknownAttributeAssignment(true, null);
      assertConsoleErrorDev([
        'Received `true` for a non-boolean attribute `unknown`.\n\n' +
          'If you want to write it to the DOM, pass a string instead: ' +
          'unknown="true" or unknown={value.toString()}.\n' +
          '    in div (at **)',
      ]);
      await testUnknownAttributeAssignment(false, null);
    });

    /** unknown=something挂载后在下一次props中省略；attribute应不存在，验证diff旧属性清理。 */
    it('removes unknown attributes that were rendered but are now missing', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div unknown="something" />);
      });

      expect(el.firstChild.getAttribute('unknown')).toBe('something');

      await act(() => {
        root.render(<div />);
      });

      expect(el.firstChild.hasAttribute('unknown')).toBe(false);
    });

    /** 首次传已知布尔inert=true；getAttribute应为空字符串，验证布尔存在形式；本例标题虽称移除，断言实际覆盖true的属性添加。 */
    it('removes new boolean props', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div inert={true} />);
      });

      expect(el.firstChild.getAttribute('inert')).toBe(true ? '' : null);
    });

    /** 连续两次传inert空字符串；首次诊断且无attribute，再次不重复诊断，验证空字符串被视false及警告去重。 */
    it('warns once for empty strings in new boolean props', async () => {
      const el = document.createElement('div');
      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div inert="" />);
      });
      assertConsoleErrorDev([
        'Received an empty string for a boolean attribute `inert`. ' +
          'This will treat the attribute as if it were false. ' +
          'Either pass `false` to silence this warning, or ' +
          'pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.\n' +
          '    in div (at **)',
      ]);

      expect(el.firstChild.getAttribute('inert')).toBe(true ? null : '');

      // 警告只会打印一次。
      await act(() => {
        root.render(<div inert="" />);
      });
    });

    /** unknown初始为something后更新为a string；DOMattribute保留原文本，验证未知属性字符串透传。 */
    it('passes through strings', async () => {
      await testUnknownAttributeAssignment('a string', 'a string');
    });

    /** unknown依次以0/-1/42/9000.99单独更新；属性分别为对应字符串，验证数字强制字符串化。 */
    it('coerces numbers to strings', async () => {
      await testUnknownAttributeAssignment(0, '0');
      await testUnknownAttributeAssignment(-1, '-1');
      await testUnknownAttributeAssignment(42, '42');
      await testUnknownAttributeAssignment(9000.99, '9000.99');
    });

    /** unknown更新为NaN；DOM为NaN字符串并给NaN诊断，验证异常数值仍序列化。 */
    it('coerces NaN to strings and warns', async () => {
      await testUnknownAttributeAssignment(NaN, 'NaN');
      assertConsoleErrorDev([
        'Received NaN for the `unknown` attribute. ' +
          'If this is expected, cast the value to a string.\n' +
          '    in div (at **)',
      ]);
    });

    /** unknown更新为普通对象和自定义toString对象；DOM分别为[object Object]和lol，验证对象字符串化；此例无预期console诊断断言。 */
    it('coerces objects to strings and warns', async () => {
      const lol = {
        /** 返回lol作为对象的自定义DOM字符串表示，区别于默认[object Object]。 */
        toString() {
          return 'lol';
        },
      };

      await testUnknownAttributeAssignment({hello: 'world'}, '[object Object]');
      await testUnknownAttributeAssignment(lol, 'lol');
    });

    /** TemporalLike.valueOf抛TypeError但toString可成功；更新unknown应拒绝prod message且DEV提示不支持类型，验证采用字符串连接触发默认hint而不偷偷改为显式toString。 */
    it('throws with Temporal-like objects', async () => {
      /** 模拟Temporal默认原始值转换会抛错但显式文本转换可成功的对象，供React属性安全转换诊断。 */
      class TemporalLike {
        /** 默认hint的字符串连接先调用此方法并抛prod message，暴露框架应保留的转换错误。 */
        valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
          throw new TypeError('prod message');
        }
        /** 返回2020-01-01，说明对象并非完全不能输出文本，失败来自默认转换策略。 */
        toString() {
          return '2020-01-01';
        }
      }
      /** 把TemporalLike实例传入属性更新辅助器，返回其异步拒绝供错误断言。 */
      const test = () =>
        testUnknownAttributeAssignment(new TemporalLike(), null);

      await expect(test).rejects.toThrowError(new TypeError('prod message'));
      assertConsoleErrorDev([
        'The provided `unknown` attribute is an unsupported type TemporalLike.' +
          ' This value must be coerced to a string before using it here.\n' +
          '    in div (at **)',
      ]);
    });

    /** unknown从字符串更新Symbol(foo)；属性删除并诊断无效值，验证symbol不进入DOM强制转换。 */
    it('removes symbols and warns', async () => {
      await testUnknownAttributeRemoval(Symbol('foo'));
      assertConsoleErrorDev([
        'Invalid value for prop `unknown` on <div> tag. Either remove it ' +
          'from the element, or pass a string or number value to keep it ' +
          'in the DOM. For details, see https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);
    });

    /** unknown从字符串更新空函数；属性删除并诊断无效值，验证函数不是未知DOM属性的可序列化输入。 */
    it('removes functions and warns', async () => {
      await testUnknownAttributeRemoval(/** 作为未知属性的函数值输入，空函数无需执行；预期更新将此不可序列化值移除。 */ function someFunction() {});
      assertConsoleErrorDev([
        'Invalid value for prop `unknown` on <div> tag. Either remove ' +
          'it from the element, or pass a string or number value to ' +
          'keep it in the DOM. For details, see ' +
          'https://react.dev/link/attribute-behavior \n' +
          '    in div (at **)',
      ]);
    });

    /** 挂载helloWorld=something；DEV建议小写未知属性，DOM仍能以helloworld读取该值，验证诊断与HTML属性名规范化可同时发生。 */
    it('allows camelCase unknown attributes and warns', async () => {
      const el = document.createElement('div');

      const root = ReactDOMClient.createRoot(el);

      await act(() => {
        root.render(<div helloWorld="something" />);
      });
      assertConsoleErrorDev([
        'React does not recognize the `helloWorld` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom ' +
          'attribute, spell it as lowercase `helloworld` instead. ' +
          'If you accidentally passed it from a parent component, remove ' +
          'it from the DOM element.\n' +
          '    in div (at **)',
      ]);

      expect(el.firstChild.getAttribute('helloworld')).toBe('something');
    });
  });
});
