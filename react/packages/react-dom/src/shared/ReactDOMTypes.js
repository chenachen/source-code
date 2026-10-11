/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {CrossOriginString} from 'react-dom-bindings/src/shared/crossOriginStrings';

/** DNS 预取预留的选项形状；当前 API 不接受任何选项。 */
export type PrefetchDNSOptions = {};
/** 预连接公共选项。 */
export type PreconnectOptions = {
  /** 连接使用的 CORS 凭据模式。 */
  crossOrigin?: string
};
/** 公共 `preload` 选项，对应 link preload 的可表达属性。 */
export type PreloadOptions = {
  /** 资源目的类型，例如 style、script 或 image。 */
  as: string,
  /** CORS 凭据模式。 */
  crossOrigin?: string,
  /** 子资源完整性摘要。 */
  integrity?: string,
  /** 资源 MIME 类型提示。 */
  type?: string,
  /** 样式等资源的媒体查询。 */
  media?: string,
  /** 内容安全策略 nonce。 */
  nonce?: string,
  /** 浏览器抓取优先级提示。 */
  fetchPriority?: FetchPriorityEnum,
  /** 响应式图片候选集合。 */
  imageSrcSet?: string,
  /** 响应式图片尺寸提示。 */
  imageSizes?: string,
  /** 请求 referrer policy。 */
  referrerPolicy?: string,
};
/** 公共模块预加载选项。 */
export type PreloadModuleOptions = {
  /** 模块资源目的；script 会归一为默认值。 */
  as?: string,
  /** CORS 凭据模式。 */
  crossOrigin?: string,
  /** 子资源完整性摘要。 */
  integrity?: string,
  /** 内容安全策略 nonce。 */
  nonce?: string,
  /** 浏览器抓取优先级提示。 */
  fetchPriority?: FetchPriorityEnum,
};
/** 公共资源预初始化选项。 */
export type PreinitOptions = {
  /** 当前支持 style 或 script，用于选择 dispatcher 槽。 */
  as: string,
  /** 样式资源在 React 管理顺序中的优先级标签。 */
  precedence?: string,
  /** CORS 凭据模式。 */
  crossOrigin?: string,
  /** 子资源完整性摘要。 */
  integrity?: string,
  /** 内容安全策略 nonce。 */
  nonce?: string,
  /** 浏览器抓取优先级提示。 */
  fetchPriority?: FetchPriorityEnum,
};
/** 公共模块脚本预初始化选项。 */
export type PreinitModuleOptions = {
  /** 当前仅支持 script；省略时也按 script 处理。 */
  as?: string,
  /** CORS 凭据模式。 */
  crossOrigin?: string,
  /** 子资源完整性摘要。 */
  integrity?: string,
  /** 内容安全策略 nonce。 */
  nonce?: string,
  /** 浏览器抓取优先级提示。 */
  fetchPriority?: FetchPriorityEnum,
};

/** dispatcher 接受的已归一化 crossOrigin 联合。 */
export type CrossOriginEnum = '' | 'use-credentials' | CrossOriginString;
/** 浏览器 fetch priority 的公共字面量集合。 */
export type FetchPriorityEnum = 'high' | 'low' | 'auto';

/** 传给宿主 preload dispatcher 的已过滤选项。 */
export type PreloadImplOptions = {
  /** 已归一化的 CORS 模式。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 有效字符串完整性摘要。 */
  integrity?: ?string,
  /** 有效字符串 CSP nonce。 */
  nonce?: ?string,
  /** 有效字符串 MIME 类型。 */
  type?: ?string,
  /** 已过滤的抓取优先级。 */
  fetchPriority?: ?string,
  /** 已过滤的 referrer policy。 */
  referrerPolicy?: ?string,
  /** 已过滤的响应式图片候选。 */
  imageSrcSet?: ?string,
  /** 已过滤的响应式图片尺寸。 */
  imageSizes?: ?string,
  /** 已过滤的媒体查询。 */
  media?: ?string,
};
/** 传给宿主模块预加载 dispatcher 的已过滤选项。 */
export type PreloadModuleImplOptions = {
  /** 非默认模块资源目的。 */
  as?: ?string,
  /** 已归一化的 CORS 模式。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 有效字符串完整性摘要。 */
  integrity?: ?string,
  /** 有效字符串 CSP nonce。 */
  nonce?: ?string,
  /** 已过滤的抓取优先级。 */
  fetchPriority?: ?string,
};
/** 传给样式预初始化 dispatcher 的已过滤选项。 */
export type PreinitStyleOptions = {
  /** 已归一化的 CORS 模式。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 有效字符串完整性摘要。 */
  integrity?: ?string,
  /** 已过滤的抓取优先级。 */
  fetchPriority?: ?string,
};
/** 传给经典脚本预初始化 dispatcher 的已过滤选项。 */
export type PreinitScriptOptions = {
  /** 已归一化的 CORS 模式。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 有效字符串完整性摘要。 */
  integrity?: ?string,
  /** 已过滤的抓取优先级。 */
  fetchPriority?: ?string,
  /** 有效字符串 CSP nonce。 */
  nonce?: ?string,
};
/** 传给模块脚本预初始化 dispatcher 的已过滤选项。 */
export type PreinitModuleScriptOptions = {
  /** 已归一化的 CORS 模式。 */
  crossOrigin?: ?CrossOriginEnum,
  /** 有效字符串完整性摘要。 */
  integrity?: ?string,
  /** 有效字符串 CSP nonce。 */
  nonce?: ?string,
  /** 已过滤的抓取优先级。 */
  fetchPriority?: ?string,
};

/**
 * ReactDOM 公共 API 到当前 DOM renderer 的紧凑 dispatcher 协议。
 * 短字段名是发布产物契约；renderer 安装真实实现，同构阶段资源/flush 槽为空，
 * 默认表单重置槽则报告表单不受 React 管理的错误。
 */
export type HostDispatcher = {
  /** 冲刷当前同步工作；render/commit 期间无法重入时返回真，供开发态诊断。 */
  f /* flushSyncWork */: () => boolean | void,
  /** 重置由 React 管理的 form。 */
  r /* requestFormReset */: (form: HTMLFormElement) => void,
  /** 发出 DNS 预取提示。 */
  D /* prefetchDNS */: (href: string) => void,
  /** 发出源站预连接提示。 */
  C /* preconnect */: (href: string, crossOrigin?: ?CrossOriginEnum) => void,
  /** 发出通用资源 preload 提示。 */
  L /* preload */: (
    href: string,
    as: string,
    options?: ?Required<PreloadImplOptions>,
  ) => void,
  /** 发出模块资源 preload 提示。 */
  m /* preloadModule */: (
    href: string,
    options?: ?Required<PreloadModuleImplOptions>,
  ) => void,
  /** 预初始化样式资源，并参与 precedence 排序。 */
  S /* preinitStyle */: (
    href: string,
    precedence: ?string,
    options?: ?Required<PreinitStyleOptions>,
  ) => void,
  /** 预初始化经典脚本。 */
  X /* preinitScript */: (
    src: string,
    options?: ?Required<PreinitScriptOptions>,
  ) => void,
  /** 预初始化模块脚本。 */
  M /* preinitModuleScript */: (
    src: string,
    options?: ?Required<PreinitModuleScriptOptions>,
  ) => void,
};

/** 浏览器 import map 形状，用于把模块 specifier 映射到 URL。 */
export type ImportMap = {
  /** 全局 specifier 映射。 */
  imports?: {
    /** 任意模块 specifier 对应的目标 URL。 */
    [specifier: string]: string,
  },
  /** 按 URL scope 覆盖的 specifier 映射。 */
  scopes?: {
    /** 单个 scope URL 对应的局部映射表。 */
    [scope: string]: {
      /** 该 scope 内任意 specifier 对应的目标 URL。 */
      [specifier: string]: string,
    },
  },
};
