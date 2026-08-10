/*!
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * React 测试使用的 TypeScript 声明文件。
 *
 * 这里并非正式、完整的公共类型定义，只提供单元测试所需的最小表面。
 */

/** 测试运行器注入的全局对象占位声明。 */
declare let global: any;

declare module 'react' {
  /** 供 TypeScript 类组件测试继承的最小 React.Component 声明。 */
  export class Component {
    /** 当前组件属性。 */
    props: any;
    /** 当前组件状态。 */
    state: any;
    /** 当前旧版上下文值。 */
    context: any;
    /** 类构造器名称。 */
    static name: string;
    /** 用属性与可选旧版上下文构造组件实例。 */
    constructor(props?, context?);
    /** 合并部分状态，并可在提交后执行回调。 */
    setState(partial : any, callback ?: any) : void;
    /** 无状态变化地强制安排更新，并可在提交后执行回调。 */
    forceUpdate(callback ?: any) : void;
  }
  /** 旧测试依赖的 PropTypes 占位导出。 */
  export let PropTypes : any;
  /** 创建测试所需的 ReactElement。 */
  export function createElement(tag : any, props ?: any, ...children : any[]) : any
  /** 创建可变 ref 容器。 */
  export function createRef(): any;
}
