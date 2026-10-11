/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//待办：像 some-package/src/* 这样的直接导入是不好的。请修复我。
import {getCurrentFiberOwnerNameInDevOrNull} from 'react-reconciler/src/ReactCurrentFiber';

import {getFiberCurrentPropsFromNode} from './ReactDOMComponentTree';
import {getToStringValue, toString} from './ToStringValue';
import {track, trackHydrated, updateValueIfChanged} from './inputValueTracking';
import {
  disableInputAttributeSyncing,
  enableHydrationChangeEvent,
} from 'shared/ReactFeatureFlags';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';

import type {ToStringValue} from './ToStringValue';
import escapeSelectorAttributeValueInsideDoubleQuotes from './escapeSelectorAttributeValueInsideDoubleQuotes';
import {queueChangeEvent} from '../events/ReactDOMEventReplaying';

let didWarnValueDefaultValue = false;
let didWarnCheckedDefaultChecked = false;

/**
 * input 的 value/checked 非 null 时由 React props 控制。浏览器仍先响应用户输入，
 * ChangeEventPlugin 在事件批次结束后按最终 props 恢复；handler 要保留输入，须提交新的值。
 * 未提供受控值时，用户编辑保留在 DOM，defaultValue/defaultChecked 只定义默认状态。
 */

/** 开发期警告同时提供 value/defaultValue 或 checked/defaultChecked 的受控约定冲突。 */
export function validateInputProps(element: Element, props: Object) {
  if (__DEV__) {
    //通常我们检查 undefined 和 null 的方式相同，但会明确指定两者
    //属性，可能值得警告。我们可以向任一方向移动这个
    //并且只是让传入 null 可以，或者只是检查 hasOwnProperty。
    if (
      props.checked !== undefined &&
      props.defaultChecked !== undefined &&
      !didWarnCheckedDefaultChecked
    ) {
      console.error(
        '%s contains an input of type %s with both checked and defaultChecked props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the checked prop, or the defaultChecked prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
        getCurrentFiberOwnerNameInDevOrNull() || 'A component',
        props.type,
      );
      didWarnCheckedDefaultChecked = true;
    }
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnValueDefaultValue
    ) {
      console.error(
        '%s contains an input of type %s with both value and defaultValue props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
        getCurrentFiberOwnerNameInDevOrNull() || 'A component',
        props.type,
      );
      didWarnValueDefaultValue = true;
    }
  }
}

/**
 * 由属性提交或受控状态恢复调用，把 input 的当前值与默认值同步到下一份 props。
 * 暂时清 name 断开 radio 组，先更新 type/value/defaultValue/checked，再恢复 name，避免更新中途改变同组选择。
 * number 值使用数值相等比较保留 "0.0" 等用户拼写；value/defaultValue 到 attribute 的同步受特性开关控制。
 *
 * @param lastDefaultValue - 前次 defaultValue，用于识别默认值已删除并移除 value attribute。
 */
export function updateInput(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  lastDefaultValue: ?string,
  checked: ?boolean,
  defaultChecked: ?boolean,
  type: ?string,
  name: ?string,
) {
  const node: HTMLInputElement = element as any;

  //暂时将输入与任何单选按钮断开连接。
  //在更改选中值的同时更改类型或名称
  //需要以原子方式应用。我们只能通过断开连接来确保这一点
  //在进行变异时使用这个名字，等完成后再重新应用这个名字。
  node.name = '';

  if (
    type != null &&
    typeof type !== 'function' &&
    typeof type !== 'symbol' &&
    typeof type !== 'boolean'
  ) {
    if (__DEV__) {
      checkAttributeStringCoercion(type, 'type');
    }
    node.type = type;
  } else {
    node.removeAttribute('type');
  }

  if (value != null) {
    if (type === 'number') {
      if (
        // `"" == 0`，否则已清空的字段会被错误恢复为 0。
        // $FlowFixMe[incompatible-type]
        // $FlowFixMe[invalid-compare]
        (value === 0 && node.value === '') ||
        //我们明确希望在这里尽可能强制转换为数字，以便
        // 同一个数字的其他拼写（例如编辑中的 "0.0"）不会
        // 在用户输入时被覆盖。
        // eslint-disable-next-line
        node.value != (value as any)
      ) {
        node.value = toString(getToStringValue(value));
      }
    } else if (node.value !== toString(getToStringValue(value))) {
      node.value = toString(getToStringValue(value));
    }
  } else if (type === 'submit' || type === 'reset') {
    //提交/重置输入需要完全移除该属性以避免
    //空白文本按钮。
    node.removeAttribute('value');
  }

  if (disableInputAttributeSyncing) {
    //当不同步 value 属性时，React 仅会分配一个新值
    //每当默认值 React 属性发生变化时。如果不存在，
    //React 什么也不做
    if (defaultValue != null) {
      setDefaultValue(node, getToStringValue(defaultValue));
    } else if (lastDefaultValue != null) {
      node.removeAttribute('value');
    }
  } else {
    //在同步 value 属性时，value 的值来自一系列级联
    //属性：
    //1. React 属性的值
    //2. React 的 defaultValue 属性
    //3. 否则不应该有任何变化
    if (value != null) {
      if (
        type === 'number' &&
        //如果可能的话，我们明确希望在这里强制转换为数字。
        // eslint-disable-next-line
        node.value == (value as any)
      ) {
        //node.value 可能是相同数字的不同拼写（例如
        // 0 显示为 "0.0"）。像 value setter 一样镜像用户当前看到的文本。
        //这与上面的赋值不重复：浏览器会清理无效内容
        //已将值分配给 ""，在这种情况下，我们同步下面的 React 值。
        setDefaultValue(node, getToStringValue(node.value));
      } else {
        setDefaultValue(node, getToStringValue(value));
      }
    } else if (defaultValue != null) {
      setDefaultValue(node, getToStringValue(defaultValue));
    } else if (lastDefaultValue != null) {
      node.removeAttribute('value');
    }
  }

  if (disableInputAttributeSyncing) {
    //当不同步 checked 属性时，该属性是直接的
    //可以从默认值 React 属性进行控制。它需要被
    //随着新的属性传入而更新。
    if (defaultChecked == null) {
      node.removeAttribute('checked');
    } else {
      node.defaultChecked = !!defaultChecked;
    }
  } else {
    //在同步 checked 属性时，只有在需要时才会改变
    //要被移除的，例如从复选框转换为文本输入
    if (checked == null && defaultChecked != null) {
      node.defaultChecked = !!defaultChecked;
    }
  }

  if (checked != null) {
    //即使这不是一个更改，也重要设置它以更新输入
    //使用单选按钮进行值跟踪
    //待办：确实应该更新整个单选框的输入值跟踪
    //效果中的按钮组或类似的东西（类似 #27024）
    node.checked =
      checked && typeof checked !== 'function' && typeof checked !== 'symbol';
  }

  if (
    name != null &&
    typeof name !== 'function' &&
    typeof name !== 'symbol' &&
    typeof name !== 'boolean'
  ) {
    if (__DEV__) {
      checkAttributeStringCoercion(name, 'name');
    }
    node.name = toString(getToStringValue(name));
  } else {
    node.removeAttribute('name');
  }
}

/**
 * 初始化 input 的当前值、默认值和跟踪器；value/checked 优先于对应 default props。
 * hydration 且 hydration-change 特性关闭时保留用户当前 value/checked，仍设置默认状态。
 * name 最后设置，避免 defaultChecked 的浏览器兼容写入影响已有 radio 组；submit/reset 未给 value 时保留浏览器按钮文本。
 */
export function initInput(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  checked: ?boolean,
  defaultChecked: ?boolean,
  type: ?string,
  name: ?string,
  isHydrating: boolean,
) {
  const node: HTMLInputElement = element as any;

  if (
    type != null &&
    typeof type !== 'function' &&
    typeof type !== 'symbol' &&
    typeof type !== 'boolean'
  ) {
    if (__DEV__) {
      checkAttributeStringCoercion(type, 'type');
    }
    node.type = type;
  }

  if (value != null || defaultValue != null) {
    const isButton = type === 'submit' || type === 'reset';

    //避免在提交/重置输入上设置 value 属性，因为它会覆盖
    //浏览器提供的默认值。见：#12872
    if (isButton && (value === undefined || value === null)) {
      //我们跟踪该值，以防它以后类型发生变化。
      track(element as any);
      return;
    }

    const defaultValueStr =
      defaultValue != null ? toString(getToStringValue(defaultValue)) : '';
    const initialValue =
      value != null ? toString(getToStringValue(value)) : defaultValueStr;

    //如果值已经设置，请不要分配。这可以防止用户输入文本
    //在 SSR 水合期间避免丢失。
    if (!isHydrating || enableHydrationChangeEvent) {
      if (disableInputAttributeSyncing) {
        //当不同步 value 属性时，value 属性指向
        //直接赋值给 React 属性。只有在其存在时才赋值。
        if (value != null) {
          //始终在按钮上分配，以便可以分配一个
          //将空字符串设置为清除按钮文本。
          //
          //否则，如果为空，请不要重新分配 value 属性。这个
          //可能避免 DOM 写入并阻止 Firefox (~60.0.1) 从
          //过早地将必填输入标记为无效。进行相等性比较
          //如果浏览器提供的值不是当前值
          //空字符串。
          if (isButton || toString(getToStringValue(value)) !== node.value) {
            node.value = toString(getToStringValue(value));
          }
        }
      } else {
        // value property 使用上面计算的 initialValue：
        //
        //1. 当存在时的 value React 属性
        //2. 当存在时的 defaultValue React 属性
        //3. 一个空字符串
        if (initialValue !== node.value) {
          node.value = initialValue;
        }
      }
    }

    if (disableInputAttributeSyncing) {
      //在不同步 value 属性时，分配 value 属性
      //直接来自默认值 React 属性（如果存在）
      if (defaultValue != null) {
        node.defaultValue = defaultValueStr;
      }
    } else {
      //否则，value 属性会与属性同步，
      //所以我们将 defaultValue 分配为与 value 属性相同的值
      //上述任务步骤。
      node.defaultValue = initialValue;
    }
  }

  //通常，我们只会在初次挂载时执行 `node.checked = node.checked`，除非发生此错误
  //这是为了应对 Chrome 的一个 bug，其中设置 defaultChecked 会出现问题
  //有时会影响选中值（即使在分离之后）。
  //参考：https://bugs.chromium.org/p/chromium/issues/detail?id=608416
  //我们需要暂时取消设置 name，以避免干扰单选按钮组。

  const checkedOrDefault = checked != null ? checked : defaultChecked;
  //待办：这个 'function' 或 'symbol' 检查在其他地方没有重复
  //所以这个语义是不一致的。
  const initialChecked =
    typeof checkedOrDefault !== 'function' &&
    typeof checkedOrDefault !== 'symbol' &&
    !!checkedOrDefault;

  if (isHydrating && !enableHydrationChangeEvent) {
    //将.checked与.defaultChecked分离，但保持用户输入不变
    node.checked = node.checked;
  } else {
    node.checked = !!initialChecked;
  }

  if (disableInputAttributeSyncing) {
    //仅在已定义时才分配 checked 属性。这可以节省
    //在控制 checked 属性时不需要 DOM 写入
    //(文本输入，提交/重置)
    if (defaultChecked != null) {
      node.defaultChecked = !node.defaultChecked;
      node.defaultChecked = !!defaultChecked;
    }
  } else {
    //在同步 checked 属性时，checked 属性和
    //属性使用 defaultChecked 同时分配。这使用了：
    //
    //1. 当存在时，被选中的 React 属性
    //2. 当存在时的默认选中 React 属性
    //3. 否则，假
    node.defaultChecked = !node.defaultChecked;
    node.defaultChecked = !!initialChecked;
  }

  //名称需要在最后设置，以便它可以原子地应用到已连接的单选按钮。
  if (
    name != null &&
    typeof name !== 'function' &&
    typeof name !== 'symbol' &&
    typeof name !== 'boolean'
  ) {
    if (__DEV__) {
      checkAttributeStringCoercion(name, 'name');
    }
    node.name = name;
  }
  track(element as any);
}

/** hydration change 特性路径保留当前用户值，以 props 建立 tracker 基线，差异时排队模拟变更事件。 */
export function hydrateInput(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  checked: ?boolean,
  defaultChecked: ?boolean,
): void {
  const node: HTMLInputElement = element as any;

  const defaultValueStr =
    defaultValue != null ? toString(getToStringValue(defaultValue)) : '';
  const initialValue =
    value != null ? toString(getToStringValue(value)) : defaultValueStr;

  const checkedOrDefault = checked != null ? checked : defaultChecked;
  //待办：这个 'function' 或 'symbol' 检查在其他地方没有重复
  //所以这个语义是不一致的。
  const initialChecked =
    typeof checkedOrDefault !== 'function' &&
    typeof checkedOrDefault !== 'symbol' &&
    !!checkedOrDefault;

  //从 .defaultChecked 分离 .checked，但保持用户输入不变
  node.checked = node.checked;

  const changed = trackHydrated(node as any, initialValue, initialChecked);
  if (changed) {
    //如果当前值不同，这表明用户
    //在水化之前更改了它。排队重放更改事件。
    //对于单选按钮，change 事件只会在被选中的按钮上触发。
    if (node.type !== 'radio' || node.checked) {
      queueChangeEvent(node);
    }
  }
}

/** 按最新 props 恢复 input；同名同 form 的 radio 一并恢复，再刷新全组 tracker。 */
export function restoreControlledInputState(element: Element, props: Object) {
  const rootNode: HTMLInputElement = element as any;
  updateInput(
    rootNode,
    props.value,
    props.defaultValue,
    props.defaultValue,
    props.checked,
    props.defaultChecked,
    props.type,
    props.name,
  );
  const name = props.name;
  if (props.type === 'radio' && name != null) {
    let queryRoot: Element = rootNode;

    while (queryRoot.parentNode) {
      queryRoot = queryRoot.parentNode as any as Element;
    }

    //如果 `rootNode.form` 非空，那么我们可以尝试 `form.elements`，
    //但它有时在 IE8 中表现异常。我们也可以尝试使用
    //但 `form.getElementsByName` 只会返回直接子元素，
    //并且不会包含使用 HTML5 `form=` 属性的输入。因为
    //输入甚至可能不是以表单的形式。它甚至可能不在
    //文档。因此这里使用局部的 `querySelectorAll`，确保不会
    //漏掉任何输入。
    if (__DEV__) {
      checkAttributeStringCoercion(name, 'name');
    }
    const group = queryRoot.querySelectorAll(
      'input[name="' +
        escapeSelectorAttributeValueInsideDoubleQuotes('' + name) +
        '"][type="radio"]',
    );

    for (let i = 0; i < group.length; i++) {
      const otherNode = group[i] as any as HTMLInputElement;
      if (otherNode === rootNode || otherNode.form !== rootNode.form) {
        continue;
      }
      // 如果同一 form 中同名的 radio 由不同 React 副本渲染，下面会抛错（同 #1939）。
      // 这是可接受的限制；React 同样不支持混用 React 与非 React radio。
      const otherProps: any = getFiberCurrentPropsFromNode(otherNode);

      if (!otherProps) {
        throw new Error(
          'ReactDOMInput: Mixing React and non-React radio inputs with the ' +
            'same `name` is not supported.',
        );
      }

      // 点击当前 radio 会取消其他 radio；按各自 props 恢复此前应选中的组成员。
      updateInput(
        otherNode,
        otherProps.value,
        otherProps.defaultValue,
        otherProps.defaultValue,
        otherProps.checked,
        otherProps.defaultChecked,
        otherProps.type,
        otherProps.name,
      );
    }

    //如果任何 updateInput() 调用将 .checked 设置为 true，则该组中的一个输入
    //（经常，`rootNode` 本身）可能已变为未选中
    for (let i = 0; i < group.length; i++) {
      const otherNode = group[i] as any as HTMLInputElement;
      if (otherNode.form !== rootNode.form) {
        continue;
      }
      updateValueIfChanged(otherNode);
    }
  }
}

/** 仅在默认文本不同的时候写 input.defaultValue；number 的当前拼写由 updateInput 选好后传入。 */
function setDefaultValue(node: HTMLInputElement, value: ToStringValue) {
  if (node.defaultValue !== toString(value)) {
    node.defaultValue = toString(value);
  }
}
