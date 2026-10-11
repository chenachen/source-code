/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;

let act;

describe('SyntheticKeyboardEvent', () => {
  let container;
  let root;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');

    act = require('internal-test-utils').act;

    // 将根容器挂body，并在afterEach卸载根/移容器，统一原生事件传播环境。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
    container = null;
  });

  describe('KeyboardEvent interface', () => {
    describe('charCode', () => {
      describe('when event is `keypress`', () => {
        describe('when charCode is present in nativeEvent', () => {
          /** input onKeyPress读取charCode，原生keypress(charCode0,keyCode13)；合成13，验证Enter从keyCode补偿。 */
          it('when charCode is 0 and keyCode is 13, returns 13', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 0,
                keyCode: 13,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(13);
          });

          /** keypress仅charCode32、无keyCode；合成32，验证可打印边界直接保留。本例只测试32，标题的更大范围由实现条件支持而非逐值枚举。 */
          it('when charCode is 32 or bigger and keyCode is missing, returns charCode', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 32,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(32);
          });

          /** keypress仅charCode13；合成13，验证Enter作为控制字符例外。 */
          it('when charCode is 13 and keyCode is missing, returns charCode', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 13,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(13);
          });

          // 过滤非打印字符的 keypress：charCode 小于 32 时忽略，Enter 的 13 例外；本用例验证该归一化条件。
          /** keypress charCode31且无keyCode；onKeyPress零次，验证归一化为0后SimpleEventPlugin过滤非打印事件。 */
          it('when charCode is smaller than 32 but is not 13, and keyCode is missing, ignores keypress', async () => {
            let called = false;
            await act(() => {
              root.render(
                <input
                  onKeyPress={() => {
                    called = true;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 31,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(called).toBe(false);
          });

          /** keypress charCode10；合成13，验证换行字符兼容映射为Enter。 */
          it('when charCode is 10, returns 13', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 10,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(13);
          });

          /** keypress charCode10且ctrlKey=true；仍13，验证Ctrl修饰不改变该映射。 */
          it('when charCode is 10 and ctrl is pressed, returns 13', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                charCode: 10,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(13);
          });
        });

        // TODO：这似乎仅针对 IE8；该规范化逻辑或许可以删除。
        describe('when charCode is not present in nativeEvent', () => {
          let charCodeDescriptor;

          beforeEach(() => {
            charCodeDescriptor = Object.getOwnPropertyDescriptor(
              KeyboardEvent.prototype,
              'charCode',
            );
            delete KeyboardEvent.prototype.charCode;
          });

          afterEach(() => {
            // 别忘了为其他测试恢复。
            Object.defineProperty(
              KeyboardEvent.prototype,
              'charCode',
              charCodeDescriptor,
            );
            charCodeDescriptor = null;
          });

          /** 此子组先删除KeyboardEvent.prototype.charCode并after恢复descriptor；keypress keyCode32得到合成charCode32，验证旧浏览器字段缺失回退。 */
          it('when keyCode is 32 or bigger, returns keyCode', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                keyCode: 32,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(32);
          });

          /** 同缺charCode原型环境，keypress keyCode13；合成13，验证缺字段时Enter兼容。 */
          it('when keyCode is 13, returns 13', async () => {
            let charCode = null;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    charCode = e.charCode;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                keyCode: 13,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(charCode).toBe(13);
          });

          /** 同缺charCode环境，keypress keyCode31；handler零次，验证回退后仍过滤非打印值。 */
          it('when keyCode is smaller than 32 and is not 13, ignores keypress', async () => {
            let called = false;
            await act(() => {
              root.render(
                <input
                  onKeyPress={e => {
                    called = true;
                  }}
                />,
              );
            });
            container.firstChild.dispatchEvent(
              new KeyboardEvent('keypress', {
                keyCode: 31,
                bubbles: true,
                cancelable: true,
              }),
            );
            expect(called).toBe(false);
          });
        });
      });

      describe('when event is not `keypress`', () => {
        /** keydown/keyup的key=Del而非keypress；两次合成charCode均0，验证字符码只适用于keypress。 */
        it('returns 0', async () => {
          let charCodeDown = null;
          let charCodeUp = null;
          await act(() => {
            root.render(
              <input
                onKeyDown={e => {
                  charCodeDown = e.charCode;
                }}
                onKeyUp={e => {
                  charCodeUp = e.charCode;
                }}
              />,
            );
          });
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Del',
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: 'Del',
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(charCodeDown).toBe(0);
          expect(charCodeUp).toBe(0);
        });
      });

      /** keydown原生charCode31、无keyCode；onKeyDown确实执行并读取0，验证非keypress总置charCode0而非过滤事件。 */
      it('when charCode is smaller than 32 but is not 13, and keyCode is missing, charCode is 0', async () => {
        let charCode = null;
        await act(() => {
          root.render(
            <input
              onKeyDown={e => {
                charCode = e.charCode;
              }}
            />,
          );
        });
        container.firstChild.dispatchEvent(
          new KeyboardEvent('keydown', {
            charCode: 31,
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(charCode).toBe(0);
      });
    });

    describe('keyCode', () => {
      describe('when event is `keydown` or `keyup`', () => {
        /** keydown/keyup原生keyCode40；两次合成keyCode均40，验证按键码直接保留。 */
        it('returns a passed keyCode', async () => {
          let keyCodeDown = null;
          let keyCodeUp = null;
          await act(() => {
            root.render(
              <input
                onKeyDown={e => {
                  keyCodeDown = e.keyCode;
                }}
                onKeyUp={e => {
                  keyCodeUp = e.keyCode;
                }}
              />,
            );
          });
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keydown', {
              keyCode: 40,
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keyup', {
              keyCode: 40,
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(keyCodeDown).toBe(40);
          expect(keyCodeUp).toBe(40);
        });
      });

      describe('when event is `keypress`', () => {
        /** keypress原生charCode65；合成keyCode0，验证keypress不提供keydown式键码。 */
        it('returns 0', async () => {
          let keyCode = null;
          await act(() => {
            root.render(
              <input
                onKeyPress={e => {
                  keyCode = e.keyCode;
                }}
              />,
            );
          });
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keypress', {
              charCode: 65,
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(keyCode).toBe(0);
        });
      });
    });

    describe('which', () => {
      describe('when event is `keypress`', () => {
        /** keypress三输入0+Enter keyCode、32、13；三个监听均which===charCode且calls3，验证which使用归一化字符码。 */
        it('is consistent with `charCode`', async () => {
          let calls = 0;
          await act(() => {
            root.render(
              <input
                onKeyPress={e => {
                  expect(e.which).toBe(e.charCode);
                  calls++;
                }}
              />,
            );
          });
          // 尝试不同的组合来自其他测试。
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keypress', {
              charCode: 0,
              keyCode: 13,
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keypress', {
              charCode: 32,
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keypress', {
              charCode: 13,
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(calls).toBe(3);
        });
      });

      describe('when event is `keydown` or `keyup`', () => {
        /** keydown/keyup共五种Del/charCode31/keyCode40输入；每次which===keyCode且calls5，验证which随事件类型切到键码。 */
        it('is consistent with `keyCode`', async () => {
          let calls = 0;
          await act(() => {
            root.render(
              <input
                onKeyDown={e => {
                  expect(e.which).toBe(e.keyCode);
                  calls++;
                }}
                onKeyUp={e => {
                  expect(e.which).toBe(e.keyCode);
                  calls++;
                }}
              />,
            );
          });
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Del',
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keydown', {
              charCode: 31,
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keydown', {
              keyCode: 40,
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: 'Del',
              bubbles: true,
              cancelable: true,
            }),
          );
          container.firstChild.dispatchEvent(
            new KeyboardEvent('keyup', {
              keyCode: 40,
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(calls).toBe(5);
        });
      });
    });

    describe('code', () => {
      /** keydown/keyup/keypress均原生code=KeyQ，keypress附charCode113使其可提取；三次合成code原样KeyQ，验证物理键code透传。 */
      it('returns code on `keydown`, `keyup` and `keypress`', async () => {
        let codeDown = null;
        let codeUp = null;
        let codePress = null;
        await act(() => {
          root.render(
            <input
              onKeyDown={e => {
                codeDown = e.code;
              }}
              onKeyUp={e => {
                codeUp = e.code;
              }}
              onKeyPress={e => {
                codePress = e.code;
              }}
            />,
          );
        });
        container.firstChild.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyQ',
            bubbles: true,
            cancelable: true,
          }),
        );
        container.firstChild.dispatchEvent(
          new KeyboardEvent('keyup', {
            code: 'KeyQ',
            bubbles: true,
            cancelable: true,
          }),
        );
        container.firstChild.dispatchEvent(
          new KeyboardEvent('keypress', {
            code: 'KeyQ',
            charCode: 113,
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(codeDown).toBe('KeyQ');
        expect(codeUp).toBe('KeyQ');
        expect(codePress).toBe('KeyQ');
      });
    });
  });

  describe('EventInterface', () => {
    /** keydown/keyup/keypress各一次可取消事件；handler检查preventDefault与stopPropagation前false后true、总3次，验证KeyboardEvent继承合成基础标志。 */
    it('is able to `preventDefault` and `stopPropagation`', async () => {
      let expectedCount = 0;
      /** 分别检查合成默认阻止/传播停止谓词由false变true并计事件次数；共享于down/up/press，确保三类都使用基础SyntheticEvent协议。 */
      const eventHandler = event => {
        expect(event.isDefaultPrevented()).toBe(false);
        event.preventDefault();
        expect(event.isDefaultPrevented()).toBe(true);

        expect(event.isPropagationStopped()).toBe(false);
        event.stopPropagation();
        expect(event.isPropagationStopped()).toBe(true);
        expectedCount++;
      };
      await act(() => {
        root.render(
          <div
            onKeyDown={eventHandler}
            onKeyUp={eventHandler}
            onKeyPress={eventHandler}
          />,
        );
      });

      container.firstChild.dispatchEvent(
        new KeyboardEvent('keydown', {
          keyCode: 40,
          bubbles: true,
          cancelable: true,
        }),
      );
      container.firstChild.dispatchEvent(
        new KeyboardEvent('keyup', {
          keyCode: 40,
          bubbles: true,
          cancelable: true,
        }),
      );
      container.firstChild.dispatchEvent(
        new KeyboardEvent('keypress', {
          charCode: 40,
          keyCode: 40,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(expectedCount).toBe(3);
    });
  });
});
