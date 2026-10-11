/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 载入server-first/client-second的匹配helper，以0或1错误预算检查水合诊断，而非直接比较最终HTML。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

describe('ReactDOMServerIntegration', () => {

  /** 重置模块及诊断状态，加载React/两DOM入口供每例SSR与水合隔离。 */
  function initModules() {
    // 重置警告缓存。
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');

    // 返回当前DOM入口供helper渲染与模块重置使用。
    return {
      ReactDOMClient,
      ReactDOMServer,
    };
  }

  const {resetModules, expectMarkupMismatch, expectMarkupMatch} =
    ReactDOMServerIntegrationUtils(initModules);
  beforeEach(() => {
    resetModules();
  });

  describe('reconnecting to server markup', function () {
    let EmptyComponent;
    beforeEach(() => {
      /** 固定返回null的空复合组件，和宿主/空字符串对比最终标记。 */
      EmptyComponent = class extends React.Component {

        /** 返回null，不生成script或其它占位DOM。 */
        render() {
          return null;
        }
      };
    });

    describe('elements', function () {
      describe('reconnecting different component implementations', function () {
        let ES6ClassComponent, PureComponent, bareElement;
        beforeEach(() => {
          // 测试每种类型的组件在客户端和服务器上。
          /** 类实现返回带props.id的div，与函数/裸元素构造同HTML。 */
          ES6ClassComponent = class extends React.Component {

            /** 输出div id，不增加其它内容，使跨组件实现水合可匹配。 */
            render() {
              return <div id={this.props.id} />;
            }
          };
          /** 普通函数实现而非React.PureComponent类，输出与类相同id div。 */
          PureComponent = props => <div id={props.id} />;
          bareElement = <div id="foobarbaz" />;
        });

        /** SSR类ES6ClassComponent再以同类同id水合；helper使用0诊断预算，验证相同宿主输出匹配。 */
        it('should reconnect ES6 Class to ES6 Class', () =>
          expectMarkupMatch(
            <ES6ClassComponent id="foobarbaz" />,
            <ES6ClassComponent id="foobarbaz" />,
          ));

        /** SSR类组件→函数PureComponent，两者输出id=foobarbaz div；0预算，验证水合比较宿主标记而非服务器组件实现身份。 */
        it('should reconnect Pure Component to ES6 Class', () =>
          expectMarkupMatch(
            <ES6ClassComponent id="foobarbaz" />,
            <PureComponent id="foobarbaz" />,
          ));

        /** SSR类组件→裸div元素，同id；0预算，验证组件到宿主直写可匹配。 */
        it('should reconnect Bare Element to ES6 Class', () =>
          expectMarkupMatch(<ES6ClassComponent id="foobarbaz" />, bareElement));

        /** SSR函数→类组件，同id div；0预算，验证反向实现变化仍可认领。 */
        it('should reconnect ES6 Class to Pure Component', () =>
          expectMarkupMatch(
            <PureComponent id="foobarbaz" />,
            <ES6ClassComponent id="foobarbaz" />,
          ));

        /** SSR函数→相同函数，同id div；0预算，验证函数输出匹配。 */
        it('should reconnect Pure Component to Pure Component', () =>
          expectMarkupMatch(
            <PureComponent id="foobarbaz" />,
            <PureComponent id="foobarbaz" />,
          ));

        /** SSR函数→裸div元素，同id；0预算，验证函数到宿主直写可匹配。 */
        it('should reconnect Bare Element to Pure Component', () =>
          expectMarkupMatch(<PureComponent id="foobarbaz" />, bareElement));

        /** SSR裸div→类组件，同id；0预算，验证裸标记可被类输出认领。 */
        it('should reconnect ES6 Class to Bare Element', () =>
          expectMarkupMatch(bareElement, <ES6ClassComponent id="foobarbaz" />));

        /** SSR裸div→函数组件，同id；0预算，验证裸标记可被函数输出认领。 */
        it('should reconnect Pure Component to Bare Element', () =>
          expectMarkupMatch(bareElement, <PureComponent id="foobarbaz" />));

        /** SSR裸div→同一裸div；0预算，验证宿主元素本身可认领。 */
        it('should reconnect Bare Element to Bare Element', () =>
          expectMarkupMatch(bareElement, bareElement));
      });

      /** SSR div→客户端span；1诊断预算，验证根宿主类型不匹配。 */
      it('should error reconnecting different element types', () =>
        expectMarkupMismatch(<div />, <span />));

      /** SSR单span a→客户端span a/b两根子级；1预算，实际客户端增加根子级，验证数量错配，旧标题fewer方向相反。 */
      it('should error reconnecting fewer root children', () =>
        expectMarkupMismatch(<span key="a" />, [
          <span key="a" />,
          <span key="b" />,
        ]));

      /** SSR div id=foo→客户端无id；1预算，验证客户端缺失服务器属性。 */
      it('should error reconnecting missing attributes', () =>
        expectMarkupMismatch(<div id="foo" />, <div />));

      /** SSR无id div→客户端id=foo；1预算，验证客户端新增属性。 */
      it('should error reconnecting added attributes', () =>
        expectMarkupMismatch(<div />, <div id="foo" />));

      /** SSR id=foo→客户端bar；1预算，验证属性值差异。 */
      it('should error reconnecting different attribute values', () =>
        expectMarkupMismatch(<div id="foo" />, <div id="bar" />));

      /** SSR div内div→客户端带suppressHydrationWarning的div内span；1预算，验证父抑制不豁免子宿主类型。 */
      it('should error reconnecting different element types of children', () =>
        expectMarkupMismatch(
          <div>
            <div />
          </div>,
          <div suppressHydrationWarning={true}>
            <span />
          </div>,
        ));

      /** SSR id=foo→客户端无id且同层suppress；0预算，验证本层属性移除差异告警可抑制。 */
      it('can explicitly ignore errors reconnecting missing attributes', () =>
        expectMarkupMatch(
          <div id="foo" />,
          <div suppressHydrationWarning={true} />,
        ));

      /** SSR无id→客户端id=foo且本层suppress；0预算，验证新增属性差异抑制。 */
      it('can explicitly ignore errors reconnecting added attributes', () =>
        expectMarkupMatch(
          <div />,
          <div id="foo" suppressHydrationWarning={true} />,
        ));

      /** SSR id=foo→客户端bar且本层suppress；0预算，验证属性值差异抑制。 */
      it('can explicitly ignore errors reconnecting different attribute values', () =>
        expectMarkupMatch(
          <div id="foo" />,
          <div id="bar" suppressHydrationWarning={true} />,
        ));

      /** SSR子div id=foo→客户端子id=bar，只有父suppress；1预算，验证抑制仅本层不深入子属性。 */
      it('can not deeply ignore errors reconnecting different attribute values', () =>
        expectMarkupMismatch(
          <div>
            <div id="foo" />
          </div>,
          <div suppressHydrationWarning={true}>
            <div id="bar" />
          </div>,
        ));
    });

    describe('inline styles', function () {

      /** SSR width:1px→客户端无style；1预算，验证style attribute缺失。 */
      it('should error reconnecting missing style attribute', () =>
        expectMarkupMismatch(<div style={{width: '1px'}} />, <div />));

      /** SSR无style→客户端width:1px；1预算，验证新增style。 */
      it('should error reconnecting added style attribute', () =>
        expectMarkupMismatch(<div />, <div style={{width: '1px'}} />));

      /** SSR width:1px→客户端style空对象；1预算，验证空对象序列化不能匹配现有style。 */
      it('should error reconnecting empty style attribute', () =>
        expectMarkupMismatch(
          <div style={{width: '1px'}} />,
          <div style={{}} />,
        ));

      /** SSR空style→客户端width:1px；1预算，验证空样式变非空。 */
      it('should error reconnecting added style values', () =>
        expectMarkupMismatch(
          <div style={{}} />,
          <div style={{width: '1px'}} />,
        ));

      /** SSR width:1px→客户端2px；1预算，验证CSS文本值差异。 */
      it('should error reconnecting different style values', () =>
        expectMarkupMismatch(
          <div style={{width: '1px'}} />,
          <div style={{width: '2px'}} />,
        ));

      /** SSR width字符串1px/height数字2→客户端width数字1/height字符串2px；0预算，验证单位规范化后同HTML style。 */
      it('should reconnect number and string versions of a number', () =>
        expectMarkupMatch(
          <div style={{width: '1px', height: 2}} />,
          <div style={{width: 1, height: '2px'}} />,
        ));

      /** SSR width再fontSize→客户端fontSize再width，同数值；1预算，验证style序列化顺序影响字符串匹配。 */
      it('should error reconnecting reordered style values', () =>
        expectMarkupMismatch(
          <div style={{width: '1px', fontSize: '2px'}} />,
          <div style={{fontSize: '2px', width: '1px'}} />,
        ));

      /** SSR空style→客户端width:1px且suppress；0预算，验证同层样式新增诊断抑制。 */
      it('can explicitly ignore errors reconnecting added style values', () =>
        expectMarkupMatch(
          <div style={{}} />,
          <div style={{width: '1px'}} suppressHydrationWarning={true} />,
        ));

      /** SSR width1px→客户端2px且suppress；0预算，验证同层样式值诊断抑制。 */
      it('can explicitly ignore reconnecting different style values', () =>
        expectMarkupMatch(
          <div style={{width: '1px'}} />,
          <div style={{width: '2px'}} suppressHydrationWarning={true} />,
        ));
    });

    describe('text nodes', function () {

      /** SSR Text→客户端Other Text；1预算，验证文本不匹配。 */
      it('should error reconnecting different text', () =>
        expectMarkupMismatch(<div>Text</div>, <div>Other Text</div>));

      /** SSR数值2→客户端文字2；0预算，验证渲染后同文字无需类型相同。 */
      it('should reconnect a div with a number and string version of number', () =>
        expectMarkupMatch(<div>{2}</div>, <div>2</div>));

      /** SSR数值2→客户端数值3；1预算，验证数值文本变化。 */
      it('should error reconnecting different numbers', () =>
        expectMarkupMismatch(<div>{2}</div>, <div>{3}</div>));

      /** SSR数值2→客户端字符串3；1预算，验证最终文本不同而非仅JS类型不同。 */
      it('should error reconnecting different number from text', () =>
        expectMarkupMismatch(<div>{2}</div>, <div>3</div>));

      /** SSR相邻Text1/Text2→客户端Text1/Text3；1预算，验证独立文本片段差异。 */
      it('should error reconnecting different text in two code blocks', () =>
        expectMarkupMismatch(
          <div>
            {'Text1'}
            {'Text2'}
          </div>,
          <div>
            {'Text1'}
            {'Text3'}
          </div>,
        ));

      /** SSR Text→客户端Other Text且suppress；0预算，验证同层直接文本差异抑制。 */
      it('can explicitly ignore reconnecting different text', () =>
        expectMarkupMatch(
          <div>Text</div>,
          <div suppressHydrationWarning={true}>Other Text</div>,
        ));

      /** 两边div均suppress，相邻Text1/Text2→Text1/Text3；0预算，验证直接多个文本片段差异同样抑制。 */
      it('can explicitly ignore reconnecting different text in two code blocks', () =>
        expectMarkupMatch(
          <div suppressHydrationWarning={true}>
            {'Text1'}
            {'Text2'}
          </div>,
          <div suppressHydrationWarning={true}>
            {'Text1'}
            {'Text3'}
          </div>,
        ));
    });

    describe('element trees and children', function () {

      /** SSR div有子div→客户端空div；1预算，验证缺失子元素。 */
      it('should error reconnecting missing children', () =>
        expectMarkupMismatch(
          <div>
            <div />
          </div>,
          <div />,
        ));

      /** SSR空div→客户端有子div；1预算，验证新增子元素。 */
      it('should error reconnecting added children', () =>
        expectMarkupMismatch(
          <div />,
          <div>
            <div />
          </div>,
        ));

      /** SSR一子div→客户端两子div；1预算，验证客户端增加同类型子级。 */
      it('should error reconnecting more children', () =>
        expectMarkupMismatch(
          <div>
            <div />
          </div>,
          <div>
            <div />
            <div />
          </div>,
        ));

      /** SSR两子div→客户端一子div；1预算，验证客户端减少子级。 */
      it('should error reconnecting fewer children', () =>
        expectMarkupMismatch(
          <div>
            <div />
            <div />
          </div>,
          <div>
            <div />
          </div>,
        ));

      /** SSR div/span→客户端span/div；1预算，验证子级宿主顺序错配。 */
      it('should error reconnecting reordered children', () =>
        expectMarkupMismatch(
          <div>
            <div />
            <span />
          </div>,
          <div>
            <span />
            <div />
          </div>,
        ));

      /** SSR两子div间无文字→客户端有六空格Text；1预算，验证额外空白也是子节点。 */
      it('should error reconnecting a div with children separated by whitespace on the client', () =>
        expectMarkupMismatch(
          <div id="parent">
            <div id="child1" />
            <div id="child2" />
          </div>,
          // prettier-ignore
          <div id="parent"><div id="child1" />      <div id="child2" /></div>,
        ));

      /** SSR两子div间六空格→客户端无空白；1预算，验证服务端额外空白不能被忽略。 */
      it('should error reconnecting a div with children separated by different whitespace on the server', () =>
        expectMarkupMismatch(
          // prettier-ignore
          <div id="parent"><div id="child1" />      <div id="child2" /></div>,
          <div id="parent">
            <div id="child1" />
            <div id="child2" />
          </div>,
        ));

      /** SSR两子div间一空格→客户端六空格；1预算，验证不同空白文本值。 */
      it('should error reconnecting a div with children separated by different whitespace', () =>
        expectMarkupMismatch(
          <div id="parent">
            <div id="child1" /> <div id="child2" />
          </div>,
          // prettier-ignore
          <div id="parent"><div id="child1" />      <div id="child2" /></div>,
        ));

      /** SSR div内span→客户端EmptyComponent返回null；1预算，验证空复合输出与宿主节点不同。 */
      it('can distinguish an empty component from a dom node', () =>
        expectMarkupMismatch(
          <div>
            <span />
          </div>,
          <div>
            <EmptyComponent />
          </div>,
        ));

      /** SSR div内EmptyComponent→客户端空字符串；0预算，两者均无DOM子节点，验证空输出最终标记匹配。 */
      it('can distinguish an empty component from an empty text component', () =>
        expectMarkupMatch(
          <div>
            <EmptyComponent />
          </div>,
          <div>{''}</div>,
        ));

      /** SSR一子div→客户端两子div且父suppress；1预算，验证抑制不允许结构新增。 */
      it('can not ignore reconnecting more children', () =>
        expectMarkupMismatch(
          <div>
            <div />
          </div>,
          <div suppressHydrationWarning={true}>
            <div />
            <div />
          </div>,
        ));

      /** SSR两子div→客户端一子div且父suppress；1预算，验证抑制不允许结构删减。 */
      it('can not ignore reconnecting fewer children', () =>
        expectMarkupMismatch(
          <div>
            <div />
            <div />
          </div>,
          <div suppressHydrationWarning={true}>
            <div />
          </div>,
        ));

      /** 两边父suppress，SSR div/span→客户端span/div；1预算，验证结构顺序不能靠抑制匹配。 */
      it('can not ignore reconnecting reordered children', () =>
        expectMarkupMismatch(
          <div suppressHydrationWarning={true}>
            <div />
            <span />
          </div>,
          <div suppressHydrationWarning={true}>
            <span />
            <div />
          </div>,
        ));

      /** 两边最外父suppress，内层div的div/span→span/div；1预算，验证结构错配也不会深层豁免。 */
      it('can not deeply ignore reconnecting reordered children', () =>
        expectMarkupMismatch(
          <div suppressHydrationWarning={true}>
            <div>
              <div />
              <span />
            </div>
          </div>,
          <div suppressHydrationWarning={true}>
            <div>
              <span />
              <div />
            </div>
          </div>,
        ));
    });

    // 标记不匹配：misc

    /** SSR rawHTML span id=child1→客户端child2；1预算，验证解析后的innerHTML差异。 */
    it('should error reconnecting a div with different dangerouslySetInnerHTML', () =>
      expectMarkupMismatch(
        <div dangerouslySetInnerHTML={{__html: "<span id='child1'/>"}} />,
        <div dangerouslySetInnerHTML={{__html: "<span id='child2'/>"}} />,
      ));

    /** SSR rawHTML文字foo→客户端bar；1预算，验证危险HTML直接文本差异。 */
    it('should error reconnecting a div with different text dangerouslySetInnerHTML', () =>
      expectMarkupMismatch(
        <div dangerouslySetInnerHTML={{__html: 'foo'}} />,
        <div dangerouslySetInnerHTML={{__html: 'bar'}} />,
      ));

    /** SSR rawHTML数值10→客户端20；1预算，验证字符串化后的rawHTML差异。 */
    it('should error reconnecting a div with different number dangerouslySetInnerHTML', () =>
      expectMarkupMismatch(
        <div dangerouslySetInnerHTML={{__html: 10}} />,
        <div dangerouslySetInnerHTML={{__html: 20}} />,
      ));

    /** SSR rawHTML对象toString=hi→客户端另对象bye；1预算，验证rawHTML比较转换结果而非对象身份。 */
    it('should error reconnecting a div with different object dangerouslySetInnerHTML', () =>
      expectMarkupMismatch(
        <div
          dangerouslySetInnerHTML={{
            __html: {

              /** 服务器rawHTML对象显式转换为hi，与客户端bye制造innerHTML差异。 */
              toString() {
                return 'hi';
              },
            },
          }}
        />,
        <div
          dangerouslySetInnerHTML={{
            __html: {

              /** 客户端rawHTML对象显式转换为bye，不同于服务器hi。 */
              toString() {
                return 'bye';
              },
            },
          }}
        />,
      ));

    /** SSR rawHTML child1→客户端child2且本层suppress；0预算，验证同层innerHTML差异告警抑制。本组helper主要使用日志预算，没有另逐例对比最终DOM。 */
    it('can explicitly ignore reconnecting a div with different dangerouslySetInnerHTML', () =>
      expectMarkupMatch(
        <div dangerouslySetInnerHTML={{__html: "<span id='child1'/>"}} />,
        <div
          dangerouslySetInnerHTML={{__html: "<span id='child2'/>"}}
          suppressHydrationWarning={true}
        />,
      ));
  });
});
