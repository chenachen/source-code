/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// TODO：此文件会在构建阶段直接导入，因此不能像普通运行时模块一样处理。
//
// 该占位模块让 DevTools 能适配不同 release 间的 work tag 变化；发布新版本时还需同步
// `backend/renderer.js` 中对应 TODO。
// TODO：目前 release 脚本和运行时版本导出共用此模块。更理想的做法是在构建时注入
// 版本号，并让根目录 `ReactVersions.js` 成为唯一事实来源。
/** 当前源码快照向运行时和构建脚本暴露的 React 版本。 */
export default '19.3.0';
