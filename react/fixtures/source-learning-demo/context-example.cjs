'use strict';
/** 将 DOM 与 render 次数不符报告为测试失败。 */
const assert = require('node:assert/strict');

/**
 * 在稳定 memo child 下比较同一引用 A 与等字段新引用 B 的 Context 通知行为。
 * 本例独立使用 act；主教程 #demo 不使用 act 或 flushSync；finally 卸载并恢复环境。
 */
module.exports = async function contextExample() {
  const {createContext, createElement, memo, useContext, act} = require('react');
  const {createRoot} = require('react-dom/client');
  const Context = createContext({label: 'default'});
  const A = Object.freeze({label: 'A'});
  const B = Object.freeze({label: 'A'});
  let renders = 0;
  /** 只读取 Context 并累计 render 次数，排除 props 与内部 state 变化干扰。 */
  const Consumer = memo(function Consumer() {
    renders++;
    return createElement('span', null, useContext(Context).label);
  });
  const child = createElement(Consumer);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(createElement(Context, {value: A}, child)));
    assert.equal(container.textContent, 'A');
    assert.equal(renders, 1);
    await act(async () => root.render(createElement(Context, {value: A}, child)));
    assert.equal(container.textContent, 'A');
    assert.equal(renders, 1, 'same Object.is value does not invalidate the memo consumer');
    await act(async () => root.render(createElement(Context, {value: B}, child)));
    assert.equal(container.textContent, 'A');
    assert.equal(renders, 2, 'new reference invalidates context even when label is equal');
    console.log('PASS Context: frozen A initial renders=1; same A renders=1; equal-field new B renders=2; DOM stays A');
  } finally {
    await act(async () => root.unmount());
    assert.equal(container.childNodes.length, 0);
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
};
