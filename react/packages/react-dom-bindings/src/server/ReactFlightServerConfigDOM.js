/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  CrossOriginEnum,
  PreloadImplOptions,
  PreloadModuleImplOptions,
  PreinitStyleOptions,
  PreinitScriptOptions,
  PreinitModuleScriptOptions,
} from 'react-dom/src/shared/ReactDOMTypes';

// 此模块会注册宿主 dispatcher，因此即使未直接使用导出也必须导入。
import {preload, preloadModule} from './ReactDOMFlightServerHostDispatcher';

import {getCrossOriginString} from '../shared/crossOriginStrings';

/**
 * 用 0 表示未显式指定 precedence：编码比 undefined 更小且无歧义，也避免为区分
 * 另一种 tuple 形状在更多位置执行类型检查。
 */
type UnspecifiedPrecedence = 0;

/** Flight 资源提示代码到其紧凑线模型的静态映射。 */
// prettier-ignore
type TypeMap = {
  /** prefetchDNS(href) 的地址模型。 */
  'D': /* 地址 */ string,
  /** preconnect(href, options) 的字符串或带跨域选项 tuple。 */
  'C':
    | /* 地址 */ string
    | [/* 地址 */ string, CrossOriginEnum],
  /** preload(href, as, options) 的二元或三元 tuple。 */
  'L':
    | [/* 地址 */ string, /* 资源类型 */ string]
    | [/* 地址 */ string, /* 资源类型 */ string, PreloadImplOptions],
  /** preloadModule 的地址或带选项 tuple。 */
  'm':
    | /* 地址 */ string
    | [/* 地址 */ string, PreloadModuleImplOptions],
  /** preinitStyle 的地址、precedence 与可选配置模型。 */
  'S':
    | /* 地址 */ string
    | [/* 地址 */ string, /* 优先级 */ string]
    | [/* 地址 */ string, /* 优先级 */ string | UnspecifiedPrecedence, PreinitStyleOptions],
  /** preinitScript 的地址或带选项 tuple。 */
  'X':
    | /* 地址 */ string
    | [/* 地址 */ string, PreinitScriptOptions],
  /** preinitModuleScript 的地址或带选项 tuple。 */
  'M':
    | /* 地址 */ string
    | [/* 地址 */ string, PreinitModuleScriptOptions],
}

/** 所有合法 Flight 资源提示代码。 */
export type HintCode = $Keys<TypeMap>;
/** 根据提示代码选择对应的线模型。 */
export type HintModel<T: HintCode> = TypeMap[T];

/** 单个 Flight 请求内已经发出的提示去重键集合。 */
export type Hints = Set<string>;

/** 为新 Flight 请求创建空的提示去重集合。 */
export function createHints(): Hints {
  return new Set();
}

/** 默认格式上下文：既不处于 noscript，也不处于 picture。 */
const NO_SCOPE = /*         */ 0b000000;
/** 表示当前祖先链包含 noscript，禁止资源提示。 */
const NOSCRIPT_SCOPE = /*   */ 0b000001;
/** 表示当前祖先链包含 picture，避免为内部 img 独立预载。 */
const PICTURE_SCOPE = /*    */ 0b000010;

/** 用位掩码编码的 Flight DOM 格式上下文。 */
export opaque type FormatContext = number;

/** 创建根级无作用域格式上下文。 */
export function createRootFormatContext(): FormatContext {
  return NO_SCOPE;
}

/**
 * 在 Flight 遍历到 img 时按与 Fizz `pushImg` 相同的条件提前发出图片 preload。
 * 排除 lazy/低优先级、picture/noscript 作用域及 data URI，避免无效或重复预载。
 */
function processImg(props: Object, formatContext: FormatContext): void {
  // 该条件必须与 ReactFizzConfigDOM 的 pushImg 保持镜像。
  const pictureOrNoScriptTagInScope =
    formatContext & (PICTURE_SCOPE | NOSCRIPT_SCOPE);
  const {src, srcSet} = props;
  if (
    props.loading !== 'lazy' &&
    (src || srcSet) &&
    (typeof src === 'string' || src == null) &&
    (typeof srcSet === 'string' || srcSet == null) &&
    props.fetchPriority !== 'low' &&
    !pictureOrNoScriptTagInScope &&
    // data URI 已内嵌内容，不应额外 preload。
    !(
      typeof src === 'string' &&
      src[4] === ':' &&
      (src[0] === 'd' || src[0] === 'D') &&
      (src[1] === 'a' || src[1] === 'A') &&
      (src[2] === 't' || src[2] === 'T') &&
      (src[3] === 'a' || src[3] === 'A')
    ) &&
    !(
      typeof srcSet === 'string' &&
      srcSet[4] === ':' &&
      (srcSet[0] === 'd' || srcSet[0] === 'D') &&
      (srcSet[1] === 'a' || srcSet[1] === 'A') &&
      (srcSet[2] === 't' || srcSet[2] === 'T') &&
      (srcSet[3] === 'a' || srcSet[3] === 'A')
    )
  ) {
    // 这是可能阻塞显示的 suspensey 图片，应尽早 preload 以优化可恢复状态加载。
    const sizes = typeof props.sizes === 'string' ? props.sizes : undefined;

    const crossOrigin = getCrossOriginString(props.crossOrigin);

    preload(
      // preload API 要求 href，但 imageSrcSet 存在时会优先；Fizz/Fiber 也会因 Safari
      // 缺陷移除 href，所以这里的空字符串不会真正出现在 DOM。
      src || '',
      'image',
      {
        imageSrcSet: srcSet,
        imageSizes: sizes,
        crossOrigin: crossOrigin,
        integrity: props.integrity,
        type: props.type,
        fetchPriority: props.fetchPriority,
        referrerPolicy: props.referrerPolicy,
      },
    );
  }
}

/** 仅在noscript作用域外、无itemProp且rel/href为非空字符串时处理资源link；preload保留as及图片/媒体选项，modulepreload走模块提示，stylesheet先发style preload，不创建DOM或声明preinit样式。 */
function processLink(props: Object, formatContext: FormatContext): void {
  const noscriptTagInScope = formatContext & NOSCRIPT_SCOPE;
  const rel = props.rel;
  const href = props.href;
  if (
    noscriptTagInScope ||
    props.itemProp != null ||
    typeof rel !== 'string' ||
    typeof href !== 'string' ||
    href === ''
  ) {
    // noscript 内或缺少有效配置的资源不应预载。
    return;
  }

  switch (rel) {
    case 'preload': {
      preload(href, props.as, {
        crossOrigin: props.crossOrigin,
        integrity: props.integrity,
        nonce: props.nonce,
        type: props.type,
        fetchPriority: props.fetchPriority,
        referrerPolicy: props.referrerPolicy,
        imageSrcSet: props.imageSrcSet,
        imageSizes: props.imageSizes,
        media: props.media,
      });
      return;
    }
    case 'modulepreload': {
      preloadModule(href, {
        as: props.as,
        crossOrigin: props.crossOrigin,
        integrity: props.integrity,
        nonce: props.nonce,
      });
      return;
    }
    case 'stylesheet': {
      preload(href, 'style', {
        crossOrigin: props.crossOrigin,
        integrity: props.integrity,
        nonce: props.nonce,
        type: props.type,
        fetchPriority: props.fetchPriority,
        referrerPolicy: props.referrerPolicy,
        media: props.media,
      });
      return;
    }
  }
}

/**
 * 处理子元素的资源副作用并推进 picture/noscript 位掩码作用域。
 * 其他标签继承父上下文，img/link只发提示而不改变上下文。
 * parentContext是祖先作用域；picture/noscript进入子级时按位OR，返回值由上游递归保存/恢复，
 * 此模块没有全局作用域栈，也不会在兄弟访问时永久累积位。
 */
export function getChildFormatContext(
  parentContext: FormatContext,
  type: string,
  props: Object,
): FormatContext {
  switch (type) {
    case 'img':
      processImg(props, parentContext);
      return parentContext;
    case 'link':
      processLink(props, parentContext);
      return parentContext;
    case 'picture':
      return parentContext | PICTURE_SCOPE;
    case 'noscript':
      return parentContext | NOSCRIPT_SCOPE;
    default:
      return parentContext;
  }
}
