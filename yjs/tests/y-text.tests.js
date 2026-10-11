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
 * 长 Delta 已写入表格换行、单元格格式和表格后的普通段落；在第 12 个位置插入连字符与空格，再删除二者并把目标换行 table-cell-line 改为 list。完整结果与 expectedResult 相等，目标其他键保留，后续段落无表格格式泄漏。
 * 回归 yjs#474。
 *
 * https://github.com/yjs/yjs/issues/474
 *
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
    // 目标换行把 `table-cell-line` 替换为 `list`，保留 `block-id`、`row` 等其他属性。
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
 * 长文档 Delta 含文本、embed、列表、表格和带 layout 的换行；retain 90 后删除 4，再清除下一换行的 layout/layout-width 并更新 block-id。输出 children[40] 是仅带指定 block-id 的换行。
 * 回归 yjs#503；只比较这个目标 op，不比较整份长文档。
 *
 * https://github.com/yjs/yjs/issues/503
 *
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
 * 两端已同步 abcde；text0 给 abc 加粗，text1 并发给 cd 加粗，随后观察 text1 并同步。text1 恰收到一个非空事件：给 ab 加粗、retain c、取消 d 加粗。
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
 * 两端空文本中 text0 注册事件捕获；先做零长度删除，再插入 abc、分别删除首尾字符，最后同事务插入再删除 1。文本依次为 abc/bc/b，事件对应 insert/delete/retain+delete；最后净变化为空且副本收敛。
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
 * 空文本注册事件捕获；插入加粗 abc、删除两侧、前插同格式 z 和无格式 y，再取消 yz 的加粗。内容及事件 Delta 匹配各阶段分段，内部链位置断言检查同格式插入未多写格式标记。
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
 * 空文本注册事件捕获；插入 falsy=false 的 abcde，再改 bcd 为 true、c 改回 false。完整视图保留 false 值，事件分别只对目标范围发格式 retain，最终副本收敛。
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
 * 文本已有 Test、Multi-line、Formatting 三行；带 bold 的 retain 覆盖每行文字，无格式 retain 越过两个换行。完整 Delta 中三段文字加粗，两个换行仍无格式。
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
 * 空文本准备一个含两处 title 换行的 Delta，中间是无格式换行和 Text；应用后再读取完整 Delta。四个格式区间与输入相同，带 title 的两处换行没有跨普通文本合并。
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
 * 文本为 Text、带 title 的换行、普通换行；删除第一个换行并显式给剩余换行设置 title。最终是 Text 加一个带 title 的换行。
 * 格式迁移由输入 retain(format) 明确要求，并非 delete 自动搬迁。
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
 * 单端空文本；应用一个 linebreak 对象的数组 insert。toDelta 返回同一单元素数组 insert。
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
 * 两个空文本副本；第一端插入由 key=val Delta 构造的子类型，再同步给已注册 observer 的第二端。两端深层输出含完整子 Delta，远端事件也包含该子状态且确实触发。
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
 * 关闭 GC 的文本先写 abcd 并记录 snapshot1，再以 x 替换 b 记录 snapshot2；继续编辑后，用两个 Snapshot Renderer 及其差异视图读取。历史状态仍分别为 abcd、axcd；差异视图把 x 标 insert、b 标 delete，其余 acd 无归因。
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
 * 关闭 GC 的文本已有 abcd 并记录快照；快照后尾插 e，再用旧快照 Renderer 读取。历史视图仍为 abcd，隐藏后来插入的 e。
 * 此用例未执行删除。
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
 * 单端文本为空；插入加粗 abc 并读取 toDelta。完整结果等于带 bold 的一次 abc insert。
 *
 * @param {t.TestCase} tc
 */
export const testDeltaCompare = tc => {
  const { text0 } = init(tc, { users: 1 })
  text0.insert(0, 'abc', { bold: true })
  t.compare(text0.toDelta(), delta.create().insert('abc', { bold: true }).done())
}

/**
 * 文本已有加粗 ab；在 a 与 b 之间插入带 width=100 的图片对象。图片仅带自身 width，左右 a/b 仍带 bold。
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
 * 文本已有加粗 ab；在中间插入无格式图片对象。图片 op 没有 format 字段，左右文字恢复 bold。
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
 * 文本为加粗 ab；删除全部文字并完成默认 GC 及事务清理。getTypeChildren 返回一个 Item：格式与内容墓碑已合并。
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
 * 普通 1234 中间插入加粗 ab；删除 ab 并完成事务清理。结构链合计三个 Item：左右活文字与中间墓碑。
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
 * 两端已同步带段落/列表格式的换行和后续 abc；text1 只把换行 LIST_STYLES 改为 number 后同步。本地与远端恰有两个非空 Delta，均只 retain 一个换行并修改 LIST_STYLES。
 * 回归 yjs#344；无关 PARAGRAPH_STYLES 不重发。
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
 * 单端文本先插入五千字符；一万轮按当前长度选择插入或最多删除三字符。所有操作应正常返回，最后只记录存活长度。
 * 没有独立字符串镜像或最终内容断言。
 *
 * @param {t.TestCase} tc
 */
export const testInsertAndDeleteAtRandomPositions = tc => {
  const N = 10000
  const { text0 } = init(tc, { users: 1 })
  const gen = tc.prng

  // 先插入五千字符，再用每一步的当前长度选择后续位置。
  text0.insert(0, prng.word(gen, N / 2, N / 2))

  // When：随机执行插入或删除；每步索引都取当前长度范围内。
  for (let i = 0; i < N; i++) {
    const pos = prng.uint32(gen, 0, text0.length)
    if (prng.bool(gen)) {
      const len = prng.uint32(gen, 1, 5)
      const word = prng.word(gen, 0, len)
      text0.insert(pos, word)
    } else {
      const len = prng.uint32(gen, 0, math.min(3, text0.length - pos))
      text0.delete(pos, len)
    }
  }
  // 这里报告最终长度，不与独立字符串镜像比较。
  t.describe('final length', '' + text0.length)
}

/**
 * 单端文本为空；一万次在当前 length 插入 a。最终 length 恰为一万。
 *
 * @param {t.TestCase} tc
 */
export const testAppendChars = tc => {
  const N = 10000
  const { text0 } = init(tc, { users: 1 })

  // 每次都用当前长度作为插入位置，最终长度应等于次数。
  for (let i = 0; i < N; i++) {
    text0.insert(text0.length, 'a')
  }
  t.assert(text0.length === N)
}

/** 大文档基准统一使用的 Item/操作数量。 */
const largeDocumentSize = 100000

/** 基准构造 Item 链时给 `rightOrigin` 复用的固定 id。 */
const id = Y.createID(0, 0)
/** 基准构造 Item 时复用的单字符 Content，避免把内容分配计入结构开销。 */
const c = new Y.ContentString('a')

/**
 * 预分配十万个槽位，复用单字符 Content 和固定 ID；计时构造未集成 Item 链并按索引复制到新数组。记录分配/复制耗时。
 * 不校验 CRDT 集成或数据内容；计时标签仍保留历史 two million，实际数量为十万。
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
 * 两个新文档为空；第一文档单事务头插十万字符，编码一次 V2 完整更新并应用到第二文档。记录插入、编码、更新应用耗时及字节大小。
 * 没有远端内容断言；应用的是一次更新，不是十万个 update。
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
 * 新文档监听 update 并准备空更新数组；一个外层事务头插十万字符，再分别 mergeUpdates 和应用到新文档。记录单次 update 的合并与应用耗时。
 * 不比较合并后的字节或重建内容。
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
 * 三组各自建立两端文本并断开第二端，首组写一个代理对、另两组写两个；分别在代理对中间插入、跨半对删除、跨半对格式化。compare 重连后检查编码可应用、两端内容与结构收敛。
 * ContentString.splice 将被切开的半代理对替换为 U+FFFD，保持 UTF-16 时钟长度；没有单独断言替换字符。
 *
 * https://github.com/yjs/yjs/issues/248
 *
 * @param {t.TestCase} tc
 */
export const testSplitSurrogateCharacter = tc => {
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 暂停副本同步，最后由 compare 重连并应用更新。
    text0.insert(0, '👾') // 插入一个代理对字符。
    // 在代理对中间插入不得导致编码失败。
    text0.insert(1, 'hi!')
    compare(users)
  }
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 暂停副本同步，最后由 compare 重连并应用更新。
    text0.insert(0, '👾👾') // 插入两个代理对字符。
    // 删除范围横跨半个代理对。
    text0.delete(1, 2)
    compare(users)
  }
  {
    const { users, text0 } = init(tc, { users: 2 })
    users[1].disconnect() // 暂停副本同步，最后由 compare 重连并应用更新。
    text0.insert(0, '👾👾') // 插入两个代理对字符。
    // 格式边界同样会切分代理对所在 ContentString。
    text0.format(1, 2, { bold: true })
    compare(users)
  }
}

/**
 * 两端空文本，update listener 会在来源端及另一端重放更新；两次构造 a_a 并交错插入 s/d，中间删完整段。两端文本均为 a_sda，最终 compare 检查结构收敛。
 * 回归 yjs#307；本用例没有直接调用 get/findMarker 或断言缓存条目。
 *
 * 历史场景来源：https://github.com/yjs/yjs/issues/307
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
 * 第一文档有三个换行，第二文档为空；整段设 example URL，再把中间换行改为 docs URL，编码同步。第一端三个 URL 区间匹配预期，第二端完整 Delta JSON 与之相同。
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
 * 两端已同步 Attack ships on fire... 文本；给 on fire 加粗并同步，再仅取消 fire 的加粗并同步。两端都只在 on 加空格的范围保留 bold，其余文本无 bold。
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
 * 关闭 GC 的文本已有 Hello World!，每次事务后只用本轮 ID 集建 Renderer；首轮给 Hell 加 italic、删除 World、插入 attributions；次轮取消前五字符 italic。首轮显示三类归因及 World 墓碑；次轮仅给原 Hell 标取消格式来源，旧删除不再显示。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const ytext = ydoc.get()
  ytext.insert(0, 'Hello World!')
  let renderer = /** @type {AbstractRenderer?} */ (null)

  ydoc.on('afterTransaction', tr => {
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
 * client0 基线为 Hello World!，client1 已复制它且均关闭 GC；client1 格式化 Hell、删除 World 并插入 attributions，再对两文档 ID 集差映射 Bob。输出保留 World 删除内容，并分别为格式、删除、插入标 Bob。
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
 * 关闭 GC 的文本 Hello World! 已删除空格加 World，普通视图为 Hello!；三组分别把全部 ID、部分活 ID、含 delete 归因的 ID 交给 renderedContent 视图。依次恢复 Hello World!、隐藏 ello 得 H!、以 bob 删除归因显示旧 World。
 * 显式归因片段即使不在 renderedContent 内也继续可见。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributionsRendererRenderedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false }) // 保留删除内容，Renderer 才能恢复原字符串。
  ydoc.clientID = 1
  const ytext = ydoc.get()
  ytext.insert(0, 'Hello World!')
  ytext.delete(5, 6) // 删除 ` World`，对应 clock 5..10；默认视图剩下 `Hello!`。
  t.compare(ytext.toDelta().toJSON(), delta.create().insert('Hello!').done().toJSON())

  const emptyAttributions = Y.createContentMap()
  const aliveSet = Y.createInsertSetFromStructStore(ydoc.store, true) // {0..4, 11}

  t.group('restore: deleted content in renderedContent renders normally', () => {
    const renderedContent = Y.createInsertSetFromStructStore(ydoc.store, false) // 包含存活内容和墓碑 id。
    const renderer = new AttributionsRenderer(emptyAttributions, { renderedContent })
    const expected = delta.create().insert('Hello World!')
    const rendered = ytext.toDelta({ renderer })
    t.assert(rendered.equals(expected))
  })

  t.group('hide: alive content omitted from renderedContent renders as nothing', () => {
    const hidden = Y.createIdSet()
    hidden.add(1, 1, 4) // 从正常显示集合中排除 `ello`，对应 clock 1..4。
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
 * 随机驱动建立五个空文本副本；交错执行 5 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges5 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 5))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 30 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges30 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 30))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 40 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges40 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 40))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 50 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges50 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 50))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 70 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges70 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 70))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 90 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateTextChanges90 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, textChanges, 90))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 300 轮纯文本插入/删除及消息投递和连线动作。每步与字符串镜像比较；结束比较副本深层内容，再确认额外格式清理计数为 0。
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
 * 每个回调从当前用户的文本状态生成合法坐标，应用后不做本地镜像比较；驱动 compare 和 checkResult 检查最终收敛。
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
 * 对随机驱动返回的五个原始副本，逐对比较深层子 Delta，并原样返回 fixture。
 * 驱动已先执行 compare，包含由合并 update 重建的副本和结构检查；这里补充子 Delta 比较。
 *
 * @param {Y.ApplyRandomTestsResult} result - applyRandomTests 已同步并比较过的 fixture。
 * @return {Y.ApplyRandomTestsResult} 同一 fixture，供包装用例继续检查格式清理。
 */
const checkResult = result => {
  for (let i = 1; i < result.testObjects.length; i++) {
    // t.info('length of text = ' + result.users[i - 1].get('text').length)
    const p1 = result.users[i - 1].get('text').toDeltaDeep().children
    const p2 = result.users[i].get('text').toDeltaDeep().children
    t.compare(p1, p2)
  }
  // 停用的结构级检查草稿；当前 checkResult 不执行它，显式清理断言只在部分包装用例中运行。
  // const cleanups = Y.cleanupYTextFormatting(result.users[0].get('text'))
  // t.assert(cleanups === 0)
  return result
}

/**
 * 空文档以一万轮随机插入/删除构造带墓碑的文本；分别计时一百次 toString 与默认 toDelta。记录两条路径耗时。
 * toString 经 toArray/toDelta 再拼接；没有性能阈值或输出等价性断言。
 *
 * @param {t.TestCase} tc
 */
export const testRendererDefaultPerformance = tc => {
  const N = 10000
  const MaxDeletionLength = 5 // 非空文本时两个独立 bool 同时为 true 才尝试删除，概率约 25%；长度也可为 0。
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
 * 关闭 GC 的空文档经过一万轮随机编辑，保留删除字符串；以空归因及完整历史 insertSet 建恢复 Renderer，再各计时十次默认/恢复 toDelta。记录包含额外墓碑输出的恢复路径开销。
 * 活内容仍走未接管快路径；不声称纯计时只比较包装成本或证明性能门槛。
 *
 * @param {t.TestCase} tc
 */
export const testRendererAttributionsPerformance = tc => {
  const N = 10000
  const MaxDeletionLength = 5 // 非空文本时两个独立 bool 同时为 true 才尝试删除，概率约 25%；长度也可为 0。
  const MaxInsertionLength = 5
  const ydoc = new Y.Doc({ gc: false }) // 保留删除内容，恢复集合才有原字符串可渲染。
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
 * 随机驱动建立五个空文本副本；交错执行 1 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛，并断言额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges1 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, qChanges, 1))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 随机驱动建立五个空文本副本；交错执行 2 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛，并断言额外格式清理计数为 0。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges2 = tc => {
  const { users } = checkResult(Y.applyRandomTests(tc, qChanges, 2))
  const cleanups = Y.cleanupYTextFormatting(users[0].get('text'))
  t.assert(cleanups === 0)
}

/**
 * 每轮重新建立五个空文本副本，连续使用测试 PRNG；重复一千轮，每轮执行两步富文本操作与随机网络交错。各轮内容和结构收敛，并且额外格式清理计数都为 0。
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
 * 随机驱动建立五个空文本副本；交错执行 3 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges3 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 3))
}

/**
 * 随机驱动建立五个空文本副本；交错执行 30 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges30 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 30))
}

/**
 * 随机驱动建立五个空文本副本；交错执行 40 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges40 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 40))
}

/**
 * 随机驱动建立五个空文本副本；交错执行 70 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges70 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 70))
}

/**
 * 随机驱动建立五个空文本副本；交错执行 100 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges100 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 100))
}

/**
 * 随机驱动建立五个空文本副本；交错执行 300 轮文本/embed/格式及复合 Delta 与网络动作。compare 与 checkResult 检查内容、结构和深层子 Delta 收敛。
 * 没有在此包装函数启用额外格式清理断言。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateQuillChanges300 = tc => {
  checkResult(Y.applyRandomTests(tc, qChanges, 300))
}
