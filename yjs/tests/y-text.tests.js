import * as Y from './testHelper.js'
import * as t from 'lib0/testing'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import * as delta from 'lib0/delta'
import { createIdMapFromIdSet } from '../src/utils/ids.js'
import { AttributionsRenderer, createSnapshotRenderer } from '../src/utils/Renderer.js'

/** 测试助手中的多副本初始化与最终收敛比较入口。 */
const { init, compare } = Y

/**
 * 回归 yjs#474：连续删除、插入和块格式替换后，旧表格行格式不会泄漏到后续段落。
 *
 * https://github.com/yjs/yjs/issues/474
 * @todo Remove debug: 127.0.0.1:8080/test.html?filter=\[88/
 * @param {t.TestCase} _tc
 */
export const testDeltaBug = _tc => {
  const initialDelta = delta.create()
    .insert('\n', {
      'block-id': 'block-28eea923-9cbb-4b6f-a950-cf7fd82bc087'
    })
    .insert('\n\n\n', {
      'table-col': {
        width: '150'
      }
    })
    .insert('\n', {
      'block-id': 'block-9144be72-e528-4f91-b0b2-82d20408e9ea',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-apba4k'
      },
      row: 'row-6kv2ls',
      cell: 'cell-apba4k',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-639adacb-1516-43ed-b272-937c55669a1c',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-a8qf0r'
      },
      row: 'row-6kv2ls',
      cell: 'cell-a8qf0r',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-6302ca4a-73a3-4c25-8c1e-b542f048f1c6',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-oi9ikb'
      },
      row: 'row-6kv2ls',
      cell: 'cell-oi9ikb',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-ceeddd05-330e-4f86-8017-4a3a060c4627',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-dt6ks2'
      },
      row: 'row-d1sv2g',
      cell: 'cell-dt6ks2',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-37b19322-cb57-4e6f-8fad-0d1401cae53f',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-qah2ay'
      },
      row: 'row-d1sv2g',
      cell: 'cell-qah2ay',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-468a69b5-9332-450b-9107-381d593de249',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-fpcz5a'
      },
      row: 'row-d1sv2g',
      cell: 'cell-fpcz5a',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-26b1d252-9b2e-4808-9b29-04e76696aa3c',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-zrhylp'
      },
      row: 'row-pflz90',
      cell: 'cell-zrhylp',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-6af97ba7-8cf9-497a-9365-7075b938837b',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-s1q9nt'
      },
      row: 'row-pflz90',
      cell: 'cell-s1q9nt',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-107e273e-86bc-44fd-b0d7-41ab55aca484',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-20b0j9'
      },
      row: 'row-pflz90',
      cell: 'cell-20b0j9',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-38161f9c-6f6d-44c5-b086-54cc6490f1e3'
    })
    .insert('Content after table')
    .insert('\n', {
      'block-id': 'block-15630542-ef45-412d-9415-88f0052238ce'
    })
  const ydoc1 = new Y.Doc()
  const ytext = ydoc1.get()
  ytext.applyDelta(initialDelta)
  const addingDash = delta.create().retain(12).insert('-')
  ytext.applyDelta(addingDash)
  const addingSpace = delta.create().retain(13).insert(' ')
  ytext.applyDelta(addingSpace)
  const addingList = delta.create().retain(12).delete(2).retain(1, {
    // 清除旧表格行属性。
    'table-cell-line': null,
    // 在同一范围改为列表属性。
    list: {
      rowspan: '1',
      colspan: '1',
      row: 'row-pflz90',
      cell: 'cell-20b0j9',
      list: 'bullet'
    }
  })
  ytext.applyDelta(addingList)
  const result = ytext.toDelta()
  const expectedResult = delta.create()
    .insert('\n', { 'block-id': 'block-28eea923-9cbb-4b6f-a950-cf7fd82bc087' })
    .insert('\n\n\n', { 'table-col': { width: '150' } })
    .insert('\n', {
      'block-id': 'block-9144be72-e528-4f91-b0b2-82d20408e9ea',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-apba4k'
      },
      row: 'row-6kv2ls',
      cell: 'cell-apba4k',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-639adacb-1516-43ed-b272-937c55669a1c',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-a8qf0r'
      },
      row: 'row-6kv2ls',
      cell: 'cell-a8qf0r',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-6302ca4a-73a3-4c25-8c1e-b542f048f1c6',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-6kv2ls',
        cell: 'cell-oi9ikb'
      },
      row: 'row-6kv2ls',
      cell: 'cell-oi9ikb',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-ceeddd05-330e-4f86-8017-4a3a060c4627',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-dt6ks2'
      },
      row: 'row-d1sv2g',
      cell: 'cell-dt6ks2',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-37b19322-cb57-4e6f-8fad-0d1401cae53f',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-qah2ay'
      },
      row: 'row-d1sv2g',
      cell: 'cell-qah2ay',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-468a69b5-9332-450b-9107-381d593de249',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-d1sv2g',
        cell: 'cell-fpcz5a'
      },
      row: 'row-d1sv2g',
      cell: 'cell-fpcz5a',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-26b1d252-9b2e-4808-9b29-04e76696aa3c',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-zrhylp'
      },
      row: 'row-pflz90',
      cell: 'cell-zrhylp',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-6af97ba7-8cf9-497a-9365-7075b938837b',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-s1q9nt'
      },
      row: 'row-pflz90',
      cell: 'cell-s1q9nt',
      rowspan: '1',
      colspan: '1'
    })
    // 目标换行只保留列表属性，不得残留 `table-cell-line`。
    .insert('\n', {
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-pflz90',
        cell: 'cell-20b0j9',
        list: 'bullet'
      },
      'block-id': 'block-107e273e-86bc-44fd-b0d7-41ab55aca484',
      row: 'row-pflz90',
      cell: 'cell-20b0j9',
      rowspan: '1',
      colspan: '1'
    })
    // 后续内容也不得继承被清除的表格行属性。
    .insert('\n', {
      'block-id': 'block-38161f9c-6f6d-44c5-b086-54cc6490f1e3'
    })
    .insert('Content after table')
    .insert('\n', {
      'block-id': 'block-15630542-ef45-412d-9415-88f0052238ce'
    })
  t.compare(result, expectedResult)
}

/**
 * 回归 yjs#503：大型富文本中删除布局节点并改写块属性后，Delta 只保留目标块的新格式。
 *
 * https://github.com/yjs/yjs/issues/503
 * @param {t.TestCase} _tc
 */
export const testDeltaBug2 = _tc => {
  const initialContent = delta.create(delta.$deltaAny)
    .insert("Thomas' section")
    .insert('\n', { 'block-id': 'block-61ae80ac-a469-4eae-bac9-3b6a2c380118' })
    .insert('\n', { 'block-id': 'block-d265d93f-1cc7-40ee-bb58-8270fca2619f' })
    .insert('123')
    .insert('\n', {
      'block-id': 'block-592a7bee-76a3-4e28-9c25-7a84344f8813',
      list: { list: 'toggled', 'toggle-id': 'list-66xfft' }
    })
    .insert('456')
    .insert('\n', {
      indent: 1,
      'block-id': 'block-3ee2bd70-b97f-45b2-9115-f1e8910235b1',
      list: { list: 'toggled', 'toggle-id': 'list-6vh0t0' }
    })
    .insert('789')
    .insert('\n', {
      indent: 1,
      'block-id': 'block-78150cf3-9bb5-4dea-a6f5-0ce1d2a98b9c',
      list: { list: 'toggled', 'toggle-id': 'list-7jr0l2' }
    })
    .insert('901')
    .insert('\n', {
      indent: 1,
      'block-id': 'block-13c6416f-f522-41d5-9fd4-ce4eb1cde5ba',
      list: { list: 'toggled', 'toggle-id': 'list-7uk8qu' }
    })
    .insert([{
      slash_command: {
        id: 'doc_94zq-2436',
        sessionId: 'nkwc70p2j',
        replace: '/'
      }
    }])
    .insert('\n', { 'block-id': 'block-8a1d2bb6-23c2-4bcf-af3c-3919ffea1697' })
    .insert('\n\n\n', { 'table-col': { width: '150' } })
    .insert('\n', {
      'block-id': 'block-84ec3ea4-da6a-4e03-b430-0e5f432936a9',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-blmd4s',
        cell: 'cell-m0u5za'
      },
      row: 'row-blmd4s',
      cell: 'cell-m0u5za',
      rowspan: '1',
      colspan: '1'
    }
    )
    .insert('\n', {
      'block-id': 'block-83144ca8-aace-401e-8aa5-c05928a8ccf0',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-blmd4s',
        cell: 'cell-1v8s8t'
      },
      row: 'row-blmd4s',
      cell: 'cell-1v8s8t',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-9a493387-d27f-4b58-b2f7-731dfafda32a',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-blmd4s',
        cell: 'cell-126947'
      },
      row: 'row-blmd4s',
      cell: 'cell-126947',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-3484f86e-ae42-440f-8de6-857f0d8011ea',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-hmmljo',
        cell: 'cell-wvutl9'
      },
      row: 'row-hmmljo',
      cell: 'cell-wvutl9',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-d4e0b741-9dea-47a5-85e1-4ded0efbc89d',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-hmmljo',
        cell: 'cell-nkablr'
      },
      row: 'row-hmmljo',
      cell: 'cell-nkablr',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-352f0d5a-d1b9-422f-b136-4bacefd00b1a',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-hmmljo',
        cell: 'cell-n8xtd0'
      },
      row: 'row-hmmljo',
      cell: 'cell-n8xtd0',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-95823e57-f29c-44cf-a69d-2b4494b7144b',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ev4xwq',
        cell: 'cell-ua9bvu'
      },
      row: 'row-ev4xwq',
      cell: 'cell-ua9bvu',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-cde5c027-15d3-4780-9e76-1e1a9d97a8e8',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ev4xwq',
        cell: 'cell-7bwuvk'
      },
      row: 'row-ev4xwq',
      cell: 'cell-7bwuvk',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-11a23ed4-b04d-4e45-8065-8120889cd4a4',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ev4xwq',
        cell: 'cell-aouka5'
      },
      row: 'row-ev4xwq',
      cell: 'cell-aouka5',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', { 'block-id': 'block-15b4483c-da98-4ded-91d3-c3d6ebc82582' })
    .insert([{ divider: true }])
    .insert('\n', { 'block-id': 'block-68552c8e-b57b-4f4a-9f36-6cc1ef6b3461' })
    .insert('jklasjdf')
    .insert('\n', {
      'block-id': 'block-c8b2df7d-8ec5-4dd4-81f1-8d8efc40b1b4',
      list: { list: 'toggled', 'toggle-id': 'list-9ss39s' }
    })
    .insert('asdf')
    .insert('\n', {
      'block-id': 'block-4f252ceb-14da-49ae-8cbd-69a701d18e2a',
      list: { list: 'toggled', 'toggle-id': 'list-uvo013' }
    })
    .insert('adg')
    .insert('\n', {
      'block-id': 'block-ccb9b72e-b94d-45a0-aae4-9b0a1961c533',
      list: { list: 'toggled', 'toggle-id': 'list-k53iwe' }
    })
    .insert('asdfasdfasdf')
    .insert('\n', {
      'block-id': 'block-ccb9b72e-b94d-45a0-aae4-9b0a1961c533',
      list: { list: 'none' },
      indent: 1
    })
    .insert('asdf')
    .insert('\n', [{
      'block-id': 'block-f406f76d-f338-4261-abe7-5c9131f7f1ad',
      list: { list: 'toggled', 'toggle-id': 'list-en86ur' }
    }])
    .insert('\n', { 'block-id': 'block-be18141c-9b6b-434e-8fd0-2c214437d560' })
    .insert('\n', { 'block-id': 'block-36922db3-4af5-48a1-9ea4-0788b3b5d7cf' })
    .insert([{ table_content: true }])
    .insert(' ')
    .insert([{
      slash_command: {
        id: 'doc_94zq-2436',
        sessionId: 'hiyrt6fny',
        replace: '/'
      }
    }])
    .insert('\n', { 'block-id': 'block-9d6566a1-be55-4e20-999a-b990bc15e143' })
    .insert('\n', {
      'block-id': 'block-4b545085-114d-4d07-844c-789710ec3aab',
      layout:
        '12d887e1-d1a2-4814-a1a3-0c904e950b46_1185cd29-ef1b-45d5-8fda-51a70b704e64',
      'layout-width': '0.25'
    })
    .insert('\n', {
      'block-id': 'block-4d3f2321-33d1-470e-9b7c-d5a683570148',
      layout:
        '12d887e1-d1a2-4814-a1a3-0c904e950b46_75523ea3-c67f-4f5f-a85f-ac7c8fc0a992',
      'layout-width': '0.5'
    })
    .insert('\n', {
      'block-id': 'block-4c7ae1e6-758e-470f-8d7c-ae0325e4ee8a',
      layout:
        '12d887e1-d1a2-4814-a1a3-0c904e950b46_54c740ef-fd7b-48c6-85aa-c14e1bfc9297',
      'layout-width': '0.25'
    })
    .insert('\n', { 'block-id': 'block-2d6ff0f4-ff00-42b7-a8e2-b816463d8fb5' })
    .insert([{ divider: true }])
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n', { 'table-col': { width: '154' } })
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n', {
      'block-id': 'block-38545d56-224b-464c-b779-51fcec24dbbf',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-q0qfck',
        cell: 'cell-hmapv4'
      },
      row: 'row-q0qfck',
      cell: 'cell-hmapv4',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-d413a094-5f52-4fd4-a4aa-00774f6fdb44',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-q0qfck',
        cell: 'cell-c0czb2'
      },
      row: 'row-q0qfck',
      cell: 'cell-c0czb2',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-ff855cbc-8871-4e0a-9ba7-de0c1c2aa585',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-q0qfck',
        cell: 'cell-hcpqmm'
      },
      row: 'row-q0qfck',
      cell: 'cell-hcpqmm',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-4841e6ee-fef8-4473-bf04-f5ba62db17f0',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-etopyl',
        cell: 'cell-0io73v'
      },
      row: 'row-etopyl',
      cell: 'cell-0io73v',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-adeec631-d4fe-4f38-9d5e-e67ba068bd24',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-etopyl',
        cell: 'cell-gt2waa'
      },
      row: 'row-etopyl',
      cell: 'cell-gt2waa',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-d38a7308-c858-4ce0-b1f3-0f9092384961',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-etopyl',
        cell: 'cell-os9ksy'
      },
      row: 'row-etopyl',
      cell: 'cell-os9ksy',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-a9df6568-1838-40d1-9d16-3c073b6ce169',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-hbx9ri'
      },
      row: 'row-0jwjg3',
      cell: 'cell-hbx9ri',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-e26a0cf2-fe62-44a5-a4ca-8678a56d62f1',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-yg5m2w'
      },
      row: 'row-0jwjg3',
      cell: 'cell-yg5m2w',
      rowspan: '1',
      colspan: '1'
    })
    .insert('a')
    .insert('\n', {
      'block-id': 'block-bfbc5ac2-7417-44b9-9aa5-8e36e4095627',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('b')
    .insert('\n', {
      'block-id': 'block-f011c089-6389-47c0-8396-7477a29aa56f',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('c')
    .insert('\n', {
      'block-id': 'block-4497788d-1e02-4fd5-a80a-48b61a6185cb',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('d')
    .insert('\n', {
      'block-id': 'block-5d73a2c7-f98b-47c7-a3f5-0d8527962b02',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('e')
    .insert('\n', {
      'block-id': 'block-bfda76ee-ffdd-45db-a22e-a6707e11cf68',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('d')
    .insert('\n', {
      'block-id': 'block-35242e64-a69d-4cdb-bd85-2a93766bfab4',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('f')
    .insert('\n', {
      'block-id': 'block-8baa22c8-491b-4f1b-9502-44179d5ae744',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-0jwjg3',
        cell: 'cell-1azhl2',
        list: 'ordered'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-0jwjg3',
      cell: 'cell-1azhl2'
    })
    .insert('\n', { 'block-id': 'block-7fa64af0-6974-4205-8cee-529f8bd46852' })
    .insert([{ divider: true }])
    .insert("Brandon's Section")
    .insert('\n', {
      header: 2,
      'block-id': 'block-cf49462c-2370-48ff-969d-576cb32c39a1'
    })
    .insert('\n', { 'block-id': 'block-30ef8361-0dd6-4eee-b4eb-c9012d0e9070' })
    .insert([{
      slash_command: {
        id: 'doc_94zq-2436',
        sessionId: 'x9x08o916',
        replace: '/'
      }
    }])
    .insert('\n', { 'block-id': 'block-166ed856-cf8c-486a-9365-f499b21d91b3' })
    .insert([{ divider: true }])
    .insert('\n', {
      row: 'row-kssn15',
      rowspan: '1',
      colspan: '1',
      'block-id': 'block-e8079594-4559-4259-98bb-da5280e2a692',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-kssn15',
        cell: 'cell-qxbksf'
      },
      cell: 'cell-qxbksf'
    })
    .insert('\n', {
      'block-id': 'block-70132663-14cc-4701-b5c5-eb99e875e2bd',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-kssn15',
        cell: 'cell-lsohbx'
      },
      cell: 'cell-lsohbx',
      row: 'row-kssn15',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-47a3899c-e3c5-4a7a-a8c4-46e0ae73a4fa',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-kssn15',
        cell: 'cell-hner9k'
      },
      cell: 'cell-hner9k',
      row: 'row-kssn15',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-0f9e650a-7841-412e-b4f2-5571b6d352c2',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-juxwc0',
        cell: 'cell-ei4yqp'
      },
      cell: 'cell-ei4yqp',
      row: 'row-juxwc0',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-53a158a9-8c82-4c82-9d4e-f5298257ca43',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-juxwc0',
        cell: 'cell-25pf5x'
      },
      cell: 'cell-25pf5x',
      row: 'row-juxwc0',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-da8ba35e-ce6e-4518-8605-c51d781eb07a',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-juxwc0',
        cell: 'cell-m8reor'
      },
      cell: 'cell-m8reor',
      row: 'row-juxwc0',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-2dce37c7-2978-4127-bed0-9549781babcb',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ot4wy5',
        cell: 'cell-dinh0i'
      },
      cell: 'cell-dinh0i',
      row: 'row-ot4wy5',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-7b593f8c-4ea3-44b4-8ad9-4a0abffe759b',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ot4wy5',
        cell: 'cell-d115b2'
      },
      cell: 'cell-d115b2',
      row: 'row-ot4wy5',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-272c28e6-2bde-4477-9d99-ce35b3045895',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-ot4wy5',
        cell: 'cell-fuapvo'
      },
      cell: 'cell-fuapvo',
      row: 'row-ot4wy5',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', { 'block-id': 'block-fbf23cab-1ce9-4ede-9953-f2f8250004cf' })
    .insert('\n', { 'block-id': 'block-c3fbb8c9-495c-40b0-b0dd-f6e33dd64b1b' })
    .insert('\n', { 'block-id': 'block-3417ad09-92a3-4a43-b5db-6dbcb0f16db4' })
    .insert('\n', { 'block-id': 'block-b9eacdce-4ba3-4e66-8b69-3eace5656057' })
    .insert('Dan Gornstein')
    .insert('\n', {
      'block-id': 'block-d7c6ae0d-a17c-433e-85fd-5efc52b587fb',
      header: 1
    })
    .insert('\n', { 'block-id': 'block-814521bd-0e14-4fbf-b332-799c6452a624' })
    .insert('aaa')
    .insert('\n', {
      'block-id': 'block-6aaf4dcf-dc21-45c6-b723-afb25fe0f498',
      list: { list: 'toggled', 'toggle-id': 'list-idl93b' }
    })
    .insert('bb')
    .insert('\n', {
      indent: 1,
      'block-id': 'block-3dd75392-fa50-4bfb-ba6b-3b7d6bd3f1a1',
      list: { list: 'toggled', 'toggle-id': 'list-mrq7j2' }
    })
    .insert('ccc')
    .insert('\n', {
      'block-id': 'block-2528578b-ecda-4f74-9fd7-8741d72dc8b3',
      indent: 2,
      list: { list: 'toggled', 'toggle-id': 'list-liu7dl' }
    })
    .insert('\n', { 'block-id': 'block-18bf68c3-9ef3-4874-929c-9b6bb1a00325' })
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n', {
      'block-id': 'block-d44e74b4-b37f-48e0-b319-6327a6295a57',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-cpybie'
      },
      row: 'row-si1nah',
      cell: 'cell-cpybie',
      rowspan: '1',
      colspan: '1'
    })
    .insert('aaa')
    .insert('\n', {
      'block-id': 'block-3e545ee9-0c9a-42d7-a4d0-833edb8087f3',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-cpybie',
        list: 'toggled',
        'toggle-id': 'list-kjl2ik'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-si1nah',
      cell: 'cell-cpybie'
    })
    .insert('bb')
    .insert('\n', {
      indent: 1,
      'block-id': 'block-5f1225ad-370f-46ab-8f1e-18b277b5095f',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-cpybie',
        list: 'toggled',
        'toggle-id': 'list-eei1x5'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-si1nah',
      cell: 'cell-cpybie'
    })
    .insert('ccc')
    .insert('\n', {
      indent: 2,
      'block-id': 'block-a77fdc11-ad24-431b-9ca2-09e32db94ac2',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-cpybie',
        list: 'toggled',
        'toggle-id': 'list-30us3c'
      },
      rowspan: '1',
      colspan: '1',
      row: 'row-si1nah',
      cell: 'cell-cpybie'
    })
    .insert('\n', {
      'block-id': 'block-d44e74b4-b37f-48e0-b319-6327a6295a57',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-cpybie'
      },
      row: 'row-si1nah',
      cell: 'cell-cpybie',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-2c274c8a-757d-4892-8db8-1a7999f7ab51',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-al1z64'
      },
      row: 'row-si1nah',
      cell: 'cell-al1z64',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-85931afe-1879-471c-bb4b-89e7bd517fe9',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-si1nah',
        cell: 'cell-q186pb'
      },
      row: 'row-si1nah',
      cell: 'cell-q186pb',
      rowspan: '1',
      colspan: '1'
    })
    .insert('asdfasdfasdf')
    .insert('\n', {
      'block-id': 'block-6e0522e8-c1eb-4c07-98df-2b07c533a139',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-7x2d1o',
        cell: 'cell-6eid2t'
      },
      row: 'row-7x2d1o',
      cell: 'cell-6eid2t',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-4b3d0bd0-9175-45e9-955c-e8164f4b5376',
      row: 'row-7x2d1o',
      cell: 'cell-m1alad',
      rowspan: '1',
      colspan: '1',
      list: {
        rowspan: '1',
        colspan: '1',
        row: 'row-7x2d1o',
        cell: 'cell-m1alad',
        list: 'ordered'
      }
    })
    .insert('asdfasdfasdf')
    .insert('\n', {
      'block-id': 'block-08610089-cb05-4366-bb1e-a0787d5b11bf',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-7x2d1o',
        cell: 'cell-dm1l2p'
      },
      row: 'row-7x2d1o',
      cell: 'cell-dm1l2p',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-c22b5125-8df3-432f-bd55-5ff456e41b4e',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-o0ujua',
        cell: 'cell-82g0ca'
      },
      row: 'row-o0ujua',
      cell: 'cell-82g0ca',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-7c6320e4-acaf-4ab4-8355-c9b00408c9c1',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-o0ujua',
        cell: 'cell-wv6ozp'
      },
      row: 'row-o0ujua',
      cell: 'cell-wv6ozp',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-d1bb7bed-e69e-4807-8d20-2d28fef8d08f',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-o0ujua',
        cell: 'cell-ldt53x'
      },
      row: 'row-o0ujua',
      cell: 'cell-ldt53x',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', { 'block-id': 'block-28f28cb8-51a2-4156-acf9-2380e1349745' })
    .insert([{ divider: true }])
    .insert('\n', { 'block-id': 'block-a1193252-c0c8-47fe-b9f6-32c8b01a1619' })
    .insert('\n', { 'table-col': { width: '150' } })
    .insert('\n\n', { 'table-col': { width: '150' } })
    .insert('/This is a test.')
    .insert('\n', {
      'block-id': 'block-14188df0-a63f-4317-9a6d-91b96a7ac9fe',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5ixdvv',
        cell: 'cell-9tgyed'
      },
      row: 'row-5ixdvv',
      cell: 'cell-9tgyed',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-7e5ba2af-9903-457d-adf4-2a79be81d823',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5ixdvv',
        cell: 'cell-xc56e9'
      },
      row: 'row-5ixdvv',
      cell: 'cell-xc56e9',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-eb6cad93-caf7-4848-8adf-415255139268',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5ixdvv',
        cell: 'cell-xrze3u'
      },
      row: 'row-5ixdvv',
      cell: 'cell-xrze3u',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-5bb547a2-6f71-4624-80c7-d0e1318c81a2',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-xbzv98',
        cell: 'cell-lie0ng'
      },
      row: 'row-xbzv98',
      cell: 'cell-lie0ng',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-b506de0d-efb6-4bd7-ba8e-2186cc57903e',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-xbzv98',
        cell: 'cell-s9sow1'
      },
      row: 'row-xbzv98',
      cell: 'cell-s9sow1',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-42d2ad20-5521-40e3-a88d-fe6906176e61',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-xbzv98',
        cell: 'cell-nodtcj'
      },
      row: 'row-xbzv98',
      cell: 'cell-nodtcj',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-7d3e4216-3f68-4dd6-bc77-4a9fad4ba008',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5bqfil',
        cell: 'cell-c8c0f3'
      },
      row: 'row-5bqfil',
      cell: 'cell-c8c0f3',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-6671f221-551e-47fb-9b7d-9043b6b12cdc',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5bqfil',
        cell: 'cell-jvxxif'
      },
      row: 'row-5bqfil',
      cell: 'cell-jvxxif',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', {
      'block-id': 'block-51e3161b-0437-4fe3-ac4f-129a93a93fc3',
      'table-cell-line': {
        rowspan: '1',
        colspan: '1',
        row: 'row-5bqfil',
        cell: 'cell-rmjpze'
      },
      row: 'row-5bqfil',
      cell: 'cell-rmjpze',
      rowspan: '1',
      colspan: '1'
    })
    .insert('\n', { 'block-id': 'block-21099df0-afb2-4cd3-834d-bb37800eb06a' })
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('id')
  ytext.applyDelta(initialContent)
  const changeEvent = delta.create().retain(90).delete(4).retain(1, {
    layout: null,
    'layout-width': null,
    'block-id': 'block-9d6566a1-be55-4e20-999a-b990bc15e143'
  })
  ytext.applyDelta(changeEvent)
  const d = ytext.toDelta()
  t.compare(d.toJSON().children?.[40], {
    type: 'insert',
    insert: '\n',
    format: {
      'block-id': 'block-9d6566a1-be55-4e20-999a-b990bc15e143'
    }
  })
}

/**
 * 验证两端重叠并发格式化清理后，事件 Delta 可非最小但仍能把编辑器同步到正确状态。
 *
 * 该用例关注格式清理及结果 Delta 是否可应用，不要求操作数最少；把它应用到富文本编辑器后必须得到
 * 与 CRDT 相同的文档。
 *
 * @param {t.TestCase} tc
 */
export const testDeltaAfterConcurrentFormatting = tc => {
  const { text0, text1, testConnector } = init(tc, { users: 2 })
  text0.insert(0, 'abcde')
  testConnector.flushAllMessages()
  text0.format(0, 3, { bold: true })
  text1.format(2, 2, { bold: true })
  /**
   * @type {any}
   */
  const deltas = []
  text1.observe(event => {
    if (event.delta.children.len > 0) {
      deltas.push(event.delta)
    }
  })
  testConnector.flushAllMessages()
  t.assert(deltas.length === 1)
  t.compare(deltas[0], delta.create().retain(2, { bold: true }).retain(1).retain(1, { bold: null }).done())
}

/**
 * 验证文本插入、头尾删除、事件 Delta，以及同事务插入后删除折叠为空变化。
 *
 * @param {t.TestCase} tc
 */
export const testBasicInsertAndDelete = tc => {
  const { users, text0 } = init(tc, { users: 2 })
  let eventDelta

  text0.observe(event => {
    eventDelta = event.delta
  })

  text0.delete(0, 0)
  t.assert(true, 'Does not throw when deleting zero elements with position 0')

  text0.insert(0, 'abc')
  t.assert(text0.toString() === 'abc', 'Basic insert works')
  t.compare(eventDelta, delta.create().insert('abc'))

  text0.delete(0, 1)
  t.assert(text0.toString() === 'bc', 'Basic delete works (position 0)')
  t.compare(eventDelta, delta.create().delete(1))

  text0.delete(1, 1)
  t.assert(text0.toString() === 'b', 'Basic delete works (position 1)')
  t.compare(eventDelta, delta.create().retain(1).delete(1))

  users[0].transact(() => {
    text0.insert(0, '1')
    text0.delete(0, 1)
  })
  t.compare(eventDelta, delta.create())

  compare(users)
}

/**
 * 验证带格式插入、删除、格式清除及等价格式标记不重复写入。
 *
 * @param {t.TestCase} tc
 */
export const testBasicFormat = tc => {
  const { users, text0 } = init(tc, { users: 2 })
  let eventDelta
  text0.observe(event => {
    eventDelta = event.delta
  })
  text0.insert(0, 'abc', { bold: true })
  t.assert(text0.toString() === 'abc', 'Basic insert with attributes works')
  t.compare(text0.toDelta(), delta.create().insert('abc', { bold: true }).done())
  t.compare(eventDelta, delta.create().insert('abc', { bold: true }))
  text0.delete(0, 1)
  t.assert(text0.toString() === 'bc', 'Basic delete on formatted works (position 0)')
  t.compare(text0.toDelta(), delta.create().insert('bc', { bold: true }).done())
  t.compare(eventDelta, delta.create().delete(1))
  text0.delete(1, 1)
  t.assert(text0.toString() === 'b', 'Basic delete works (position 1)')
  t.compare(text0.toDelta(), delta.create().insert('b', { bold: true }).done())
  t.compare(eventDelta, delta.create().retain(1).delete(1))
  text0.insert(0, 'z', { bold: true })
  t.assert(text0.toString() === 'zb')
  t.compare(text0.toDelta(), delta.create().insert('zb', { bold: true }).done())
  t.compare(eventDelta, delta.create().insert('z', { bold: true }))
  // @ts-ignore
  t.assert(text0._start.right.right.right.content.str === 'b', 'Does not insert duplicate attribute marker')
  text0.insert(0, 'y')
  t.assert(text0.toString() === 'yzb')
  t.compare(text0.toDelta(), delta.create().insert('y').insert('zb', { bold: true }).done())
  t.compare(eventDelta, delta.create().insert('y'))
  text0.format(0, 2, { bold: null })
  t.assert(text0.toString() === 'yzb')
  t.compare(text0.toDelta(), delta.create().insert('yz').insert('b', { bold: true }).done())
  t.compare(eventDelta, delta.create().retain(1).retain(1, { bold: null }))
  compare(users)
}

/**
 * 验证格式值 `false` 是有效值，不会被当作未设置或 `null` 清除。
 *
 * @param {t.TestCase} tc
 */
export const testFalsyFormats = tc => {
  const { users, text0 } = init(tc, { users: 2 })
  let delta = text0.toDelta().toJSON().children
  text0.observe(event => {
    delta = event.delta.toJSON().children
  })
  text0.insert(0, 'abcde', { falsy: false })
  t.compare(text0.toDelta().toJSON().children, [{ type: 'insert', insert: 'abcde', format: { falsy: false } }])
  t.compare(delta, [{ type: 'insert', insert: 'abcde', format: { falsy: false } }])
  text0.format(1, 3, { falsy: true })
  t.compare(text0.toDelta().toJSON().children, [{ type: 'insert', insert: 'a', format: { falsy: false } }, { type: 'insert', insert: 'bcd', format: { falsy: true } }, { type: 'insert', insert: 'e', format: { falsy: false } }])
  t.compare(delta, [{ type: 'retain', retain: 1 }, { type: 'retain', retain: 3, format: { falsy: true } }])
  text0.format(2, 1, { falsy: false })
  t.compare(text0.toDelta().toJSON().children, [{ type: 'insert', insert: 'a', format: { falsy: false } }, { type: 'insert', insert: 'b', format: { falsy: true } }, { type: 'insert', insert: 'c', format: { falsy: false } }, { type: 'insert', insert: 'd', format: { falsy: true } }, { type: 'insert', insert: 'e', format: { falsy: false } }])
  t.compare(delta, [{ type: 'retain', retain: 2 }, { type: 'retain', retain: 1, format: { falsy: false } }])
  compare(users)
}

/**
 * 验证跨多行格式化可跳过换行，只作用于各文本段。
 *
 * @param {t.TestCase} _tc
 */
export const testMultilineFormat = _tc => {
  const ydoc = new Y.Doc()
  const testText = ydoc.get('test')
  testText.insert(0, 'Test\nMulti-line\nFormatting')
  const tt = delta.create()
    .retain(4, { bold: true })
    .retain(1) // 跳过换行符。
    .retain(10, { bold: true })
    .retain(1) // 跳过换行符。
    .retain(10, { bold: true })
  testText.applyDelta(tt)
  t.compare(
    testText.toDelta(),
    delta.create()
      .insert('Test', { bold: true })
      .insert('\n')
      .insert('Multi-line', { bold: true })
      .insert('\n')
      .insert('Formatting', { bold: true })
      .done()
  )
}

/**
 * 验证相同格式的空行仍保持独立 Delta 边界。
 *
 * @param {t.TestCase} _tc
 */
export const testNotMergeEmptyLinesFormat = _tc => {
  const ydoc = new Y.Doc()
  const testText = ydoc.get('test')
  testText.applyDelta(delta.create()
    .insert('Text')
    .insert('\n', { title: true })
    .insert('\nText')
    .insert('\n', { title: true }).done()
  )
  t.compare(
    testText.toDelta(),
    delta.create()
      .insert('Text')
      .insert('\n', { title: true })
      .insert('\nText')
      .insert('\n', { title: true })
      .done()
  )
}

/**
 * 验证删除带格式换行后，把格式迁移到相邻保留换行可维持最终属性。
 *
 * @param {t.TestCase} _tc
 */
export const testPreserveAttributesThroughDelete = _tc => {
  const ydoc = new Y.Doc()
  const testText = ydoc.get('test')
  testText.applyDelta(delta.create()
    .insert('Text')
    .insert('\n', { title: true })
    .insert('\n')
    .done()
  )
  testText.applyDelta(delta.create()
    .retain(4)
    .delete(1)
    .retain(1, { title: true })
  )
  t.compare(testText.toDelta(),
    delta.create()
      .insert('Text')
      .insert('\n', { title: true })
      .done()
  )
}

/**
 * 验证对象 embed 作为单个子元素往返 Delta。
 *
 * @param {t.TestCase} tc
 */
export const testGetDeltaWithEmbeds = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.applyDelta(delta.create().insert([{ linebreak: 's' }]).done())
  t.compare(text0.toDelta(),
    delta.create()
      .insert([{ linebreak: 's' }])
      .done()
  )
}

/**
 * 验证嵌套 `Y.Type` 作为 embed 深层渲染，并经同步事件携带完整子 Delta。
 *
 * @param {t.TestCase} tc
 */
export const testTypesAsEmbed = tc => {
  const { text0, text1, testConnector } = init(tc, { users: 2 })
  text0.applyDelta(delta.create()
    .insert([Y.Type.from(delta.create().setAttr('key', 'val'))])
    .done()
  )
  t.compare(/** @type {any} */ (text0).toDeltaDeep().toJSON().children, [{ type: 'insert', insert: [{ type: 'delta', attrs: { key: { type: 'insert', value: 'val' } } }] }])
  let firedEvent = false
  text1.observe(event => {
    const d = event.deltaDeep
    t.assert(d.children.len === 1)
    t.compare(d.toJSON().children?.map(x => /** @type {any} */ (x).insert), [[{ type: 'delta', attrs: { key: { type: 'insert', value: 'val' } } }]])
    firedEvent = true
  })
  testConnector.flushAllMessages()
  const dd = text1.toDeltaDeep().toJSON().children
  t.assert(dd?.length === 1)
  t.compare(/** @type {any} */ (dd?.[0]).insert[0], { type: 'delta', attrs: { key: { type: 'insert', value: 'val' } } })
  t.assert(firedEvent, 'fired the event observer containing a Type-Embed')
}

/**
 * 验证两个 Snapshot 的完整视图与差异 Renderer 正确标记插入和删除。
 *
 * @param {t.TestCase} tc
 */
export const testSnapshot = tc => {
  const { text0 } = init(tc, { users: 1 })
  const doc0 = /** @type {Y.Doc} */ (text0.doc)
  doc0.gc = false
  text0.applyDelta(delta.create().insert('abcd').done())
  const snapshot1 = Y.snapshot(doc0)
  text0.applyDelta(delta.create()
    .retain(1)
    .insert('x')
    .delete(1))
  const snapshot2 = Y.snapshot(doc0)
  text0.applyDelta(delta.create()
    .retain(2)
    .delete(3)
    .insert('x')
    .delete(1)
  )
  const state1 = text0.toDelta({ renderer: createSnapshotRenderer(snapshot1) })
  t.compare(state1, delta.create().insert('abcd').done())
  const state2 = text0.toDelta({ renderer: createSnapshotRenderer(snapshot2) })
  t.compare(state2, delta.create().insert('axcd').done())
  const state2Diff = text0.toDelta({ renderer: createSnapshotRenderer(snapshot1, snapshot2) })
  t.compare(
    state2Diff,
    delta.create()
      .insert('a')
      .insert('x', null, { insert: [] })
      .insert('b', null, { delete: [] })
      .insert('cd')
      .done()
  )
}

/**
 * 验证 Snapshot Renderer 隐藏快照之后才插入的内容。
 *
 * @param {t.TestCase} tc
 */
export const testSnapshotDeleteAfter = tc => {
  const { text0 } = init(tc, { users: 1 })
  const doc0 = /** @type {Y.Doc} */ (text0.doc)
  doc0.gc = false
  text0.applyDelta(delta.create()
    .insert('abcd')
    .done()
  )
  const snapshot1 = Y.snapshot(doc0)
  text0.applyDelta(delta.create()
    .retain(4)
    .insert('e')
    .done()
  )
  const state1 = text0.toDelta({ renderer: createSnapshotRenderer(snapshot1) })
  t.compare(state1, delta.create().insert('abcd').done())
}

/**
 * 验证格式化文本的 `toDelta()` 与期望 Delta 结构等价。
 *
 * @param {t.TestCase} tc
 */
export const testDeltaCompare = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, 'abc', { bold: true })
  t.compare(text0.toDelta(), delta.create().insert('abc', { bold: true }).done())
}

/**
 * 验证 embed 使用自身格式，左右文本仍恢复原有格式。
 *
 * @param {t.TestCase} tc
 */
export const testToDeltaEmbedAttributes = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, 'ab', { bold: true })
  text0.insert(1, [{ image: 'imageSrc.png' }], { width: 100 })
  const delta0 = text0.toDelta()
  t.compare(
    delta0,
    delta.create()
      .insert('a', { bold: true })
      .insert([{ image: 'imageSrc.png' }], { width: 100 })
      .insert('b', { bold: true })
      .done()
  )
}

/**
 * 验证无格式 embed 的 Delta 不产生空 format 字段。
 *
 * @param {t.TestCase} tc
 */
export const testToDeltaEmbedNoAttributes = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, 'ab', { bold: true })
  text0.insert(1, [{ image: 'imageSrc.png' }])
  const delta0 = text0.toDelta()
  t.compare(
    delta0,
    delta.create()
      .insert('a', { bold: true })
      .insert([{ image: 'imageSrc.png' }])
      .insert('b', { bold: true })
      .done()
    , 'toDelta does not set attributes key when no attributes are present'
  )
}

/**
 * 验证整段格式化文本删除后，冗余格式边界被清理。
 *
 * @param {t.TestCase} tc
 */
export const testFormattingRemoved = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, 'ab', { bold: true })
  text0.delete(0, 2)
  // @ts-ignore
  t.assert(Y.getTypeChildren(text0).length === 1)
}

/**
 * 验证删除中间格式段后只保留必要的左右结构边界。
 *
 * @param {t.TestCase} tc
 */
export const testFormattingRemovedInMidText = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, '1234')
  text0.insert(2, 'ab', { bold: true })
  text0.delete(2, 2)
  t.assert(Y.getTypeChildren(text0).length === 3)
}

/**
 * 回归 yjs#344：远端格式覆盖只报告真实变化键，不重发无关段落格式。
 *
 * 问题来源：https://github.com/yjs/yjs/issues/344
 *
 * @param {t.TestCase} tc
 */
export const testFormattingDeltaUnnecessaryAttributeChange = tc => {
  const { text0, text1, testConnector } = init(tc, { users: 2 })
  text0.insert(0, '\n', {
    PARAGRAPH_STYLES: 'normal',
    LIST_STYLES: 'bullet'
  })
  text0.insert(1, 'abc', {
    PARAGRAPH_STYLES: 'normal'
  })
  testConnector.flushAllMessages()
  /**
   * @type {Array<delta.Delta<any>>}
   */
  const deltas = []
  text0.observe(event => {
    deltas.push(event.delta)
  })
  text1.observe(event => {
    deltas.push(event.delta)
  })
  text1.format(0, 1, { LIST_STYLES: 'number' })
  testConnector.flushAllMessages()
  const filteredDeltas = deltas.filter(d => d.children.len > 0)
  t.assert(filteredDeltas.length === 2)
  t.compare(filteredDeltas[0], delta.create().retain(1, { LIST_STYLES: 'number' }).done())
  t.compare(filteredDeltas[0], filteredDeltas[1])
}

/**
 * 以普通字符串语义随机插入删除一万步，压力验证索引与长度维护。
 *
 * @param {t.TestCase} tc
 */
export const testInsertAndDeleteAtRandomPositions = tc => {
  const N = 10000
  const { text0 } = init(tc, { users: 1 })
  const gen = tc.prng

  // Given：先建立固定长度的普通字符串作为镜像起点。
  // let expectedResult = init
  text0.insert(0, prng.word(gen, N / 2, N / 2))

  // When：随机执行插入或删除；每步索引都取当前长度范围内。
  for (let i = 0; i < N; i++) {
    const pos = prng.uint32(gen, 0, text0.length)
    if (prng.bool(gen)) {
      const len = prng.uint32(gen, 1, 5)
      const word = prng.word(gen, 0, len)
      text0.insert(pos, word)
      // 可启用普通字符串镜像定位具体随机失败。
    } else {
      const len = prng.uint32(gen, 0, math.min(3, text0.length - pos))
      text0.delete(pos, len)
      // 可启用普通字符串镜像定位具体随机失败。
    }
  }
  // 镜像断言默认关闭，此性能用例以全过程不越界和最终长度报告为主。
  t.describe('final length', '' + text0.length)
}

/**
 * 验证连续一万次尾插后逻辑长度准确。
 *
 * @param {t.TestCase} tc
 */
export const testAppendChars = tc => {
  const N = 10000
  const { text0 } = init(tc, { users: 1 })

  // 连续尾插覆盖最佳定位路径，最终长度必须等于次数。
  for (let i = 0; i < N; i++) {
    text0.insert(text0.length, 'a')
  }
  t.assert(text0.length === N)
}

/** 大文档基准统一使用的 Item/操作数量。 */
const largeDocumentSize = 100000

/** 基准构造 Item 时复用的固定逻辑 id。 */
const id = Y.createID(0, 0)
/** 基准构造 Item 时复用的单字符 Content，避免把内容分配计入结构开销。 */
const c = new Y.ContentString('a')

/**
 * 基准测试纯 Item 分配与数组复制的理想路径开销。
 *
 * @param {t.TestCase} _tc
 */
export const testBestCase = _tc => {
  const N = largeDocumentSize
  const items = new Array(N)
  t.measureTime('time to create two million items in the best case', () => {
    const parent = /** @type {any} */ ({})
    let prevItem = null
    for (let i = 0; i < N; i++) {
      /**
       * @type {Y.Item}
       */
      const n = new Y.Item(Y.createID(0, 0), null, null, null, null, null, null, c)
      // 直接按索引赋值，避免 `push` 自身扩容策略干扰基准。
      items[i] = n
      n.right = prevItem
      n.rightOrigin = prevItem ? id : null
      n.content = c
      n.parent = parent
      prevItem = n
    }
  })
  const newArray = new Array(N)
  t.measureTime('time to copy two million items to new Array', () => {
    for (let i = 0; i < N; i++) {
      newArray[i] = items[i]
    }
  })
}

/** 若 Node 以 `--expose-gc` 启动则主动 GC，降低前后基准阶段互相污染。 */
const tryGc = () => {
  // @ts-ignore
  if (typeof global !== 'undefined' && global.gc) {
    // @ts-ignore
    global.gc()
  }
}

/**
 * 基准测试十万碎片 Item 的插入、更新编码与另一文档应用。
 *
 * @param {t.TestCase} _tc
 */
export const testLargeFragmentedDocument = _tc => {
  const itemsToInsert = largeDocumentSize
  let update = /** @type {any} */ (null)
  ;(() => {
    const doc1 = new Y.Doc()
    const text0 = doc1.get('txt')
    tryGc()
    t.measureTime(`time to insert ${itemsToInsert} items`, () => {
      doc1.transact(() => {
        for (let i = 0; i < itemsToInsert; i++) {
          text0.insert(0, '0')
        }
      })
    })
    tryGc()
    t.measureTime('time to encode document', () => {
      update = Y.encodeStateAsUpdateV2(doc1)
    })
    t.describe('Document size:', update.byteLength)
  })()
  ;(() => {
    const doc2 = new Y.Doc()
    tryGc()
    t.measureTime(`time to apply ${itemsToInsert} updates`, () => {
      Y.applyUpdateV2(doc2, update)
    })
  })()
}

/**
 * 比较十万增量的二进制合并与逐个应用到 YDoc 的开销。
 *
 * @param {t.TestCase} _tc
 */
export const testIncrementalUpdatesPerformanceOnLargeFragmentedDocument = _tc => {
  const itemsToInsert = largeDocumentSize
  const updates = /** @type {Array<Uint8Array<ArrayBuffer>>} */ ([])
  ;(() => {
    const doc1 = new Y.Doc()
    doc1.on('update', update => {
      updates.push(update)
    })
    const text0 = doc1.get('txt')
    tryGc()
    t.measureTime(`time to insert ${itemsToInsert} items`, () => {
      doc1.transact(() => {
        for (let i = 0; i < itemsToInsert; i++) {
          text0.insert(0, '0')
        }
      })
    })
    tryGc()
  })()
  ;(() => {
    t.measureTime(`time to merge ${itemsToInsert} updates (differential updates)`, () => {
      Y.mergeUpdates(updates)
    })
    tryGc()
    t.measureTime(`time to merge ${itemsToInsert} updates (ydoc updates)`, () => {
      const ydoc = new Y.Doc()
      updates.forEach(update => {
        Y.applyUpdate(ydoc, update)
      })
    })
  })()
}

/**
 * 回归 yjs#248：在 UTF-16 代理对中间插入、删除或格式化仍能编码并收敛。
 *
 * 拆分 UTF-16 代理对曾可能生成无法编码的文档。
 *
 * https://github.com/yjs/yjs/issues/248
 *
 * @param {t.TestCase} tc
 */
export const testSplitSurrogateCharacter = tc => {
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 离线会迫使发送端独立编码被拆分结构。
    text0.insert(0, '👾') // 插入一个代理对字符。
    // 在代理对中间插入不得导致编码失败。
    text0.insert(1, 'hi!')
    compare(users)
  }
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 离线会迫使发送端独立编码被拆分结构。
    text0.insert(0, '👾👾') // 插入两个代理对字符。
    // 删除范围横跨半个代理对。
    text0.delete(1, 2)
    compare(users)
  }
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 离线会迫使发送端独立编码被拆分结构。
    text0.insert(0, '👾👾') // 插入两个代理对字符。
    // 格式边界同样会切分代理对所在 ContentString。
    text0.format(1, 2, { bold: true })
    compare(users)
  }
}

/**
 * 回归 yjs#307：重复删除重建文本后搜索标记仍把并发插入定位到正确位置。
 *
 * 搜索标记回归：https://github.com/yjs/yjs/issues/307
 *
 * @param {t.TestCase} tc
 */
export const testSearchMarkerBug1 = tc => {
  const { users, text0, text1, testConnector } = init(tc, { users: 2 })

  users[0].on('update', update => {
    users[0].transact(() => {
      Y.applyUpdate(users[0], update)
    })
  })
  users[0].on('update', update => {
    users[1].transact(() => {
      Y.applyUpdate(users[1], update)
    })
  })

  text0.insert(0, 'a_a')
  testConnector.flushAllMessages()
  text0.insert(2, 's')
  testConnector.flushAllMessages()
  text1.insert(3, 'd')
  testConnector.flushAllMessages()
  text0.delete(0, 5)
  testConnector.flushAllMessages()
  text0.insert(0, 'a_a')
  testConnector.flushAllMessages()
  text0.insert(2, 's')
  testConnector.flushAllMessages()
  text1.insert(3, 'd')
  testConnector.flushAllMessages()
  t.compareStrings(text0.toString(), text1.toString())
  t.compareStrings(text0.toString(), 'a_sda')
  compare(users)
}

/**
 * 验证嵌套格式覆盖同步后，两文档渲染完全相同的分段格式。
 *
 * @param {t.TestCase} _tc
 */
export const testFormattingBug = async _tc => {
  const ydoc1 = new Y.Doc()
  const ydoc2 = new Y.Doc()
  const text1 = ydoc1.get()
  text1.insert(0, '\n\n\n')
  text1.format(0, 3, { url: 'http://example.com' })
  ydoc1.get().format(1, 1, { url: 'http://docs.yjs.dev' })
  Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1))
  const text2 = ydoc2.get()
  const expectedResult = delta.create()
    .insert('\n', { url: 'http://example.com' })
    .insert('\n', { url: 'http://docs.yjs.dev' })
    .insert('\n', { url: 'http://example.com' })
    .done()
  t.compare(text1.toDelta(), expectedResult)
  t.compare(text1.toDelta().toJSON(), text2.toDelta().toJSON())
  console.log(text1.toDelta().toJSON())
}

/**
 * 验证删除/覆盖格式不会留下影响可见 Delta 的冗余格式 Item。
 *
 * 删除格式后不应留下改变可观察结果的冗余格式 Item。
 *
 * @param {t.TestCase} _tc
 */
export const testDeleteFormatting = _tc => {
  const doc = new Y.Doc()
  const text = doc.get()
  text.insert(0, 'Attack ships on fire off the shoulder of Orion.')

  const doc2 = new Y.Doc()
  const text2 = doc2.get()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  text.format(13, 7, { bold: true })
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  text.format(16, 4, { bold: null })
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  const expected = delta.create()
    .insert('Attack ships ')
    .insert('on ', { bold: true })
    .insert('fire off the shoulder of Orion.')
    .done()
  t.compare(text.toDelta(), expected)
  t.compare(text2.toDelta(), expected)
}

/**
 * 验证富文本插入、删除、格式化与取消格式在 Renderer 下生成正确 attribution。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const ytext = ydoc.get()
  ytext.insert(0, 'Hello World!')
  let renderer = /** @type {AbstractRenderer?} */ (null)

  ydoc.on('afterTransaction', tr => {
    // renderer = new AttributionsRenderer(createIdMapFromIdSet(tr.insertSet, [new Y.Attribution('insertAt', 42), new Y.Attribution('insert', 'kevin')]), createIdMapFromIdSet(tr.deleteSet, [new Y.Attribution('delete', 'kevin')]))
    renderer = new AttributionsRenderer(Y.createContentMap(createIdMapFromIdSet(tr.insertSet, []), createIdMapFromIdSet(tr.deleteSet, [])))
  })
  t.group('insert / delete / format', () => {
    ytext.applyDelta(delta.create().retain(4, { italic: true }).retain(2).delete(5).insert('attributions').done())
    const expectedContent = delta.create().insert('Hell', { italic: true }, { format: { italic: [] } }).insert('o ').insert('World', {}, { delete: [] }).insert('attributions', {}, { insert: [] }).insert('!')
    const attributedContent = ytext.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.assert(attributedContent.equals(expectedContent))
  })
  t.group('unformat', () => {
    ytext.applyDelta(delta.create().retain(5, { italic: null }))
    const expectedContent = delta.create().insert('Hell', null, { format: { italic: [] } }).insert('o attributions!')
    const attributedContent = ytext.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.assert(attributedContent.equals(expectedContent))
  })
}

/**
 * 验证两文档 id 集差异可映射到用户 attribution，并渲染插入、删除和格式来源。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedDiffing = _tc => {
  const ydocVersion0 = new Y.Doc({ gc: false })
  ydocVersion0.clientID = 0
  ydocVersion0.get().insert(0, 'Hello World!')
  const ydoc = new Y.Doc({ gc: false })
  ydoc.clientID = 1
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocVersion0))
  const ytext = ydoc.get()
  ytext.applyDelta(delta.create().retain(4, { italic: true }).retain(2).delete(5).insert('attributions').done())
  // 收集目标文档历史上的全部插入 id。
  const insertionSet = Y.createInsertSetFromStructStore(ydoc.store, false)
  const deleteSet = Y.createDeleteSetFromStructStore(ydoc.store)
  // 排除基线版本已有 id，只留下当前版本新增部分。
  const insertionSetDiff = Y.diffIdSet(insertionSet, Y.createInsertSetFromStructStore(ydocVersion0.store, false))
  const deleteSetDiff = Y.diffIdSet(deleteSet, Y.createDeleteSetFromStructStore(ydocVersion0.store))
  // 给插入差和删除差分别附加 Bob 的来源标签。
  const attributedInsertions = createIdMapFromIdSet(insertionSetDiff, [Y.createContentAttribute('insert', 'Bob')])
  const attributedDeletions = createIdMapFromIdSet(deleteSetDiff, [Y.createContentAttribute('delete', 'Bob')])
  // AttributionsRenderer 把 id 范围到属性的映射投影到输出 Delta。
  const renderer = new AttributionsRenderer(Y.createContentMap(attributedInsertions, attributedDeletions))
  // Then：渲染结果同时保留最新内容、历史删除和三类来源。
  const attributedContent = ytext.toDelta({ renderer })
  console.log(JSON.stringify(attributedContent.toJSON(), null, 2))
  const expectedContent = delta.create().insert('Hell', { italic: true }, { format: { italic: ['Bob'] } }).insert('o ').insert('World', {}, { delete: ['Bob'] }).insert('attributions', {}, { insert: ['Bob'] }).insert('!')
  t.assert(attributedContent.equals(expectedContent))
  console.log(Y.encodeIdMap(attributedInsertions).length)
}

/**
 * 验证 `renderedContent` 可恢复 tombstone、隐藏活内容，而显式 attribution 始终优先可见。
 *
 * `renderedContent` 将“可见内容”与文档删除态、attribution 解耦：集合内 tombstone 可按普通内容恢复，
 * 集合外活内容可隐藏，而显式 attribution 即使不在集合内也始终渲染。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributionsRendererRenderedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false }) // restore requires gc:false (no rehydration of gc'd content)
  ydoc.clientID = 1
  const ytext = ydoc.get()
  ytext.insert(0, 'Hello World!')
  ytext.delete(5, 6) // delete ' World' (clock 5..10) → the visible doc is 'Hello!'
  t.compare(ytext.toDelta().toJSON(), delta.create().insert('Hello!').done().toJSON()) // sanity: default hides the deletion

  const emptyAttributions = Y.createContentMap()
  const aliveSet = Y.createInsertSetFromStructStore(ydoc.store, true) // {0..4, 11}

  t.group('restore: deleted content in renderedContent renders normally', () => {
    const renderedContent = Y.createInsertSetFromStructStore(ydoc.store, false) // all content incl. deleted
    const renderer = new AttributionsRenderer(emptyAttributions, { renderedContent })
    const expected = delta.create().insert('Hello World!')
    const rendered = ytext.toDelta({ renderer })
    t.assert(rendered.equals(expected))
  })

  t.group('hide: alive content omitted from renderedContent renders as nothing', () => {
    const hidden = Y.createIdSet()
    hidden.add(1, 1, 4) // hide 'ello' (clock 1..4)
    const renderer = new AttributionsRenderer(emptyAttributions, { renderedContent: Y.diffIdSet(aliveSet, hidden) })
    const expected = delta.create().insert('H!')
    const rendered = ytext.toDelta({ renderer })
    t.assert(rendered.equals(expected))
  })

  t.group('attributions always render, even outside renderedContent', () => {
    const deletedRange = Y.createIdSet()
    deletedRange.add(1, 5, 6) // ' World'
    const attributions = Y.createContentMap(Y.createIdMap(), createIdMapFromIdSet(deletedRange, [Y.createContentAttribute('delete', 'bob')]))
    const renderer = new AttributionsRenderer(attributions, { renderedContent: aliveSet })
    const expected = delta.create().insert('Hello').insert(' World', {}, { delete: ['bob'] }).insert('!')
    const rendered = ytext.toDelta({ renderer })
    t.assert(rendered.equals(expected))
  })
}

// 随机状态机测试。

/** 给随机文本插入添加单调前缀，便于失败时区分各次写入。 */
let charCounter = 0

/**
 * 不含格式的纯文本随机操作集合；每步用普通字符串镜像立即校验本地结果。
 *
 * @type Array<function(any,prng.PRNG):void>
 */
const textChanges = [
  /**
   * 在随机位置插入带唯一前缀的文本，并与字符串拼接镜像比较。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const insertPos = prng.int32(gen, 0, ytext.length)
    const text = charCounter++ + prng.word(gen)
    const prevText = ytext.toString()
    ytext.insert(insertPos, text)
    t.compareStrings(ytext.toString(), prevText.slice(0, insertPos) + text + prevText.slice(insertPos))
  },
  /**
   * 从随机位置删除至多两个字符，并与字符串切片镜像比较。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const contentLen = ytext.toString().length
    const insertPos = prng.int32(gen, 0, contentLen)
    const overwrite = math.min(prng.int32(gen, 0, contentLen - insertPos), 2)
    const prevText = ytext.toString()
    ytext.delete(insertPos, overwrite)
    t.compareStrings(ytext.toString(), prevText.slice(0, insertPos) + prevText.slice(insertPos + overwrite))
  }
]

/**
 * 以 5 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges5 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 5))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 30 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges30 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 30))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 40 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges40 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 40))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 50 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges50 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 50))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 70 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges70 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 70))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 90 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges90 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 90))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 300 轮纯文本随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges300 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 300))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/** 随机富文本状态机可选择的非空格式组合。 */
const marks = [
  { bold: true },
  { italic: true },
  { italic: true, color: '#888' }
]

/** 插入操作的格式候选；`undefined` 表示不带格式。 */
const marksChoices = [
  undefined,
  ...marks
]

/**
 * 覆盖文本、embed、格式和复合 Delta 的富文本随机操作集合。
 *
 * @type Array<function(any,prng.PRNG):void>
 */
const qChanges = [
  /**
   * 在随机位置插入随机文本，并随机选择无格式或一个格式组合。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const insertPos = prng.int32(gen, 0, ytext.length)
    const attrs = prng.oneOf(gen, marksChoices)
    const text = charCounter++ + prng.word(gen)
    ytext.insert(insertPos, text, attrs)
  },
  /**
   * 在随机位置插入普通图片对象或包含随机词的嵌套 Delta embed。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const insertPos = prng.int32(gen, 0, ytext.length)
    if (prng.bool(gen)) {
      ytext.insert(insertPos, [{ image: 'https://user-images.githubusercontent.com/5553757/48975307-61efb100-f06d-11e8-9177-ee895e5916e5.png' }])
    } else {
      ytext.insert(insertPos, [delta.create().insert([prng.word(gen), prng.word(gen)])])
    }
  },
  /**
   * 从随机位置删除至多两个可见元素，覆盖文本和 embed 的统一长度语义。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const contentLen = ytext.length
    const insertPos = prng.int32(gen, 0, contentLen)
    const overwrite = math.min(prng.int32(gen, 0, contentLen - insertPos), 2)
    ytext.delete(insertPos, overwrite)
  },
  /**
   * 对随机短范围应用一个非空格式组合。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const contentLen = ytext.length
    const insertPos = prng.int32(gen, 0, contentLen)
    const overwrite = math.min(prng.int32(gen, 0, contentLen - insertPos), 2)
    const format = prng.oneOf(gen, marks)
    ytext.format(insertPos, overwrite, format)
  },
  /**
   * 用单个 Delta 在随机位置插入文本及带 `code-block` 格式的换行。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const insertPos = prng.int32(gen, 0, ytext.length)
    const text = charCounter++ + prng.word(gen)
    const d = delta.create()
    d.retain(insertPos).insert(text).insert('\n', { 'code-block': true })
    ytext.applyDelta(d)
  },
  /**
   * 从随机起点组合 format、insert、delete，覆盖同一 Delta 内坐标推进。
   *
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   */
  (y, gen) => {
    const ytext = y.get('text')
    const contentLen = ytext.length
    let currentPos = math.max(0, prng.int32(gen, 0, contentLen - 1))
    const d = delta.create().retain(currentPos)
    // 最多尝试七个子操作，并始终用原内容空间推进 retain/delete 坐标。
    for (let i = 0; i < 7 && currentPos < contentLen; i++) {
      prng.oneOf(gen, [
        () => { // 格式化会消费原内容坐标。
          const retain = math.min(prng.int32(gen, 0, contentLen - currentPos), 5)
          const format = prng.oneOf(gen, marks)
          d.retain(retain, format)
          currentPos += retain
        },
        () => { // 插入不消费原内容坐标。
          const attrs = prng.oneOf(gen, marksChoices)
          const text = prng.word(gen, 1, 3)
          d.insert(text, attrs)
        },
        () => { // 删除会消费原内容坐标。
          const delLen = math.min(prng.int32(gen, 0, contentLen - currentPos), 10)
          d.delete(delLen)
          currentPos += delLen
        }
      ])()
    }
    ytext.applyDelta(d)
  }
]

/**
 * 逐对比较所有随机测试副本的深层子 Delta，证明最终可观察状态收敛。
 *
 * @param {Y.ApplyRandomTestsResult} result
 */
const checkResult = result => {
  for (let i = 1; i < result.testObjects.length; i++) {
    // t.info('length of text = ' + result.users[i - 1].get('text').length)
    const p1 = result.users[i - 1].get('text').toDeltaDeep().children
    const p2 = result.users[i].get('text').toDeltaDeep().children
    t.compare(p1, p2)
  }
  // 排查格式清理问题时可启用下列结构级断言。
  // const cleanups = Y.cleanupYTextFormatting(result.users[0].getText('text'))
  // t.assert(cleanups === 0)
  return result
}

/**
 * 基准测试默认无 Renderer 快速路径在含删除碎片文本上的 `toDelta()`。
 *
 * 删除比例越高，Renderer/内容读取器可能跳过越多不可见片段，`toDelta()` 甚至可能快于 `toString()`；
 * 该结果也可能受 JavaScript 引擎优化影响，因此这里只记录基准，不宣称复杂度保证。
 *
 * @param {t.TestCase} tc
 */
export const testRendererDefaultPerformance = tc => {
  const N = 10000
  const MaxDeletionLength = 5 // 25% chance of deletion
  const MaxInsertionLength = 5
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  for (let i = 0; i < N; i++) {
    if (prng.bool(tc.prng) && prng.bool(tc.prng) && ytext.length > 0) {
      const index = prng.int31(tc.prng, 0, ytext.length - 1)
      const len = prng.int31(tc.prng, 0, math.min(ytext.length - index, MaxDeletionLength))
      ytext.delete(index, len)
    } else {
      const index = prng.int31(tc.prng, 0, ytext.length)
      const content = prng.utf16String(tc.prng, MaxInsertionLength)
      ytext.insert(index, content)
    }
  }
  t.info(`number of changes: ${N / 1000}k`)
  t.info(`length of text: ${ytext.length}`)
  const M = 100
  t.measureTime(`original toString perf <executed ${M} times>`, () => {
    for (let i = 0; i < M; i++) {
      ytext.toString()
    }
  })
  t.measureTime(`toDelta(renderer) performance <executed ${M} times>`, () => {
    for (let i = 0; i < M; i++) {
      ytext.toDelta()
    }
  })
}

/**
 * 对比默认快速路径与空 attribution、自定义可见集 Renderer 的恢复路径性能。
 *
 * Renderer 使用空 attribution 与完整 insert set 作为 `renderedContent`。该集合也包含 tombstone id，
 * 因而会无归因地恢复全部删除；活内容仍由集合完整覆盖并走通用快速路径。基准对比默认路径与
 * `hasItem` 恢复分支、`readContent` 自定义可见集、`coveredLength` 长度计算的组合开销。
 *
 * @param {t.TestCase} tc
 */
export const testRendererAttributionsPerformance = tc => {
  const N = 10000
  const MaxDeletionLength = 5 // 25% chance of deletion
  const MaxInsertionLength = 5
  const ydoc = new Y.Doc({ gc: false }) // keep deleted content so the delete set renders real content
  const ytext = ydoc.get()
  for (let i = 0; i < N; i++) {
    if (prng.bool(tc.prng) && prng.bool(tc.prng) && ytext.length > 0) {
      const index = prng.int31(tc.prng, 0, ytext.length - 1)
      const len = prng.int31(tc.prng, 0, math.min(ytext.length - index, MaxDeletionLength))
      ytext.delete(index, len)
    } else {
      const index = prng.int31(tc.prng, 0, ytext.length)
      const content = prng.utf16String(tc.prng, MaxInsertionLength)
      ytext.insert(index, content)
    }
  }
  // 空 attribution + 完整 insert set 会覆盖 tombstone id，从而把所有删除恢复成普通可见内容。
  const insertSet = Y.createInsertSetFromStructStore(ydoc.store, false)
  // const deleteSet = Y.createDeleteSetFromStructStore(ydoc.store)
  const renderer = new AttributionsRenderer(Y.createContentMap(), { renderedContent: insertSet })
  t.info(`number of changes: ${N / 1000}k`)
  t.info(`length of visible text: ${ytext.length}`)
  const M = 10
  t.measureTime(`default renderer (fast path): toDelta() <executed ${M} times>`, () => {
    for (let i = 0; i < M; i++) {
      ytext.toDelta()
    }
  })
  t.measureTime(`AttributionsRenderer (no attributions, renderedContent = insert set): toDelta({ renderer }) <executed ${M} times>`, () => {
    for (let i = 0; i < M; i++) {
      ytext.toDelta({ renderer })
    }
  })
}

/**
 * 以 1 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges1 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, qChanges, 1))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 以 2 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges2 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, qChanges, 2))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 重复一千次两步富文本/Quill 随机操作，放大短序列格式清理回归。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges2Repeat = tc => {
  for (let i = 0; i < 1000; i++) {
    const { users } = checkResult(Y.applyRandomTests(tc, qChanges, 2))
    const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
    t.assert(cleanups === 0)
  }
}

/**
 * 以 3 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges3 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 3))
}

/**
 * 以 30 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges30 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 30))
}

/**
 * 以 40 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges40 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 40))
}

/**
 * 以 70 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges70 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 70))
}

/**
 * 以 100 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges100 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 100))
}

/**
 * 以 300 轮富文本/Quill随机操作验证多副本收敛与格式结构清理。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges300 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 300))
}
