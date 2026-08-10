/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import {requestPostPaintCallback} from './ReactFiberConfig';

/** 是否已有一次 HostConfig post-paint 回调在途，用于合并同帧请求。 */
let postPaintCallbackScheduled = false;
/** 等待下一次 paint 完成时间的回调队列。 */
let callbacks: Array<any | ((endTime: number) => void)> = [];

/** 把回调合并到唯一的 post-paint host 请求中，并在 flush 后一次性释放队列引用。 */
export function schedulePostPaintCallback(callback: (endTime: number) => void) {
  callbacks.push(callback);
  if (!postPaintCallbackScheduled) {
    postPaintCallbackScheduled = true;
    requestPostPaintCallback(endTime => {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i](endTime);
      }
      postPaintCallbackScheduled = false;
      callbacks = [];
    });
  }
}
