# IdSets and IdMaps

`IdSet` is a data structure (formerly `DeleteSet`) that allows us to efficiently
represent ranges of ids in Yjs (all content is identifyable by ids).

`IdMap` is a new data structure that allows us to efficiently map ids to
attributes. It can be efficiently encoded.

We can perform all usual set operations on `IdMap`s and `IdSet`s: diff, merge,
intersect.

# Attribution of content

In order to implement a Google Docs-like versioning feature, we want to be able
to attribute content with additional information (who created the change,
when was this change created, ..).

When we click on a version in Google Docs, we might get annotated changes like
this:

```
# If Bob appends "world" to the previous version "hello "
[{ insert: 'hello ' }, { insert: 'world', attribution: { insert: ['Bob'] } }]
# If Bob deletes "world" from the previous version "hello world"
[{ insert: 'hello ' }, { insert: 'world', attribution: { delete: ['Bob'] } }]
```

In Yjs, we can now "attribute" changes with additional information. When we
render content using `toDelta({ renderer })`, Yjs will render
the unattributed live content as-is and attach metadata to attributed content,
including preserved deletions. `toString()` returns ordinary live text and does
not accept a renderer. As all changes in Yjs are identifiable by IDs, we
can use `IdMap`s to map changes to "attributions". For example, we could
attribute deletions and insertions of a change and render them:

Run this example in Node.js 22 or later from this package's directory.

```js
import assert from 'node:assert/strict'
import * as Y from '@y/y'
import * as delta from 'lib0/delta'

// We create some initial content "Hello World!". Then we create another
// document that will have a bunch of changes (make "Hell" italic, replace "World"
// with "attributions").
const ydocVersion0 = new Y.Doc({ gc: false })
ydocVersion0.get().insert(0, 'Hello World!')
const ydoc = new Y.Doc({ gc: false })
Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocVersion0))
const ytext = ydoc.get()
ytext.applyDelta(delta.create().retain(4, { italic: true }).retain(2).delete(5).insert('attributions').done())
// this represents all insertions of ydoc
const insertionSet = Y.createInsertSetFromStructStore(ydoc.store, false)
const deleteSet = Y.createDeleteSetFromStructStore(ydoc.store)
// exclude the changes from `ydocVersion0`
const insertionSetDiff = Y.diffIdSet(insertionSet, Y.createInsertSetFromStructStore(ydocVersion0.store, false))
const deleteSetDiff = Y.diffIdSet(deleteSet, Y.createDeleteSetFromStructStore(ydocVersion0.store))
// assign attributes to the diff
const attributedInsertions = Y.createIdMapFromIdSet(insertionSetDiff, [Y.createContentAttribute('insert', 'Bob')])
const attributedDeletions = Y.createIdMapFromIdSet(deleteSetDiff, [Y.createContentAttribute('delete', 'Bob')])
// Both mappings form one ContentMap. Empty ranges remain ordinary live content;
// attributed deleted ranges are also displayed, using the content preserved by gc:false.
const attributions = Y.createContentMap(attributedInsertions, attributedDeletions)
const renderer = Y.createAttributionsRenderer(attributions)
// we render the attributed content with the renderer
const attributedContent = ytext.toDelta({ renderer })
console.log(JSON.stringify(attributedContent.toJSON(), null, 2))
const expectedContent = delta.create().insert('Hell', { italic: true }, { format: { italic: ['Bob'] } }).insert('o ').insert('World', {}, { delete: ['Bob'] }).insert('attributions', {}, { insert: ['Bob'] }).insert('!')
assert.ok(attributedContent.equals(expectedContent))

// this is how the output would look like
const output = {
  "type": "delta",
  "children": [
    {
      "type": "insert",
      "insert": "Hell",
      "format": {
        "italic": true
      },
      "attribution": {              // no "insert" attribution: the insertion "Hell" is not attributed to anyone
        "format": {
          "italic": [               // the formatting attribute "italic" was added by Bob
            "Bob"
          ]
        }
      }
    },
    {
      "type": "insert",
      "insert": "o "                // the insertion "o " has no attributions
    },
    {
      "type": "insert",
      "insert": "World",
      "attribution": {              // the insertion "World" was deleted by Bob
        "delete": [
          "Bob"
        ]
      }
    },
    {
      "type": "insert",
      "insert": "attributions",     // the insertion "attributions" was inserted by Bob
      "attribution": {
        "insert": [
          "Bob"
        ]
      }
    },
    {
      "type": "insert",
      "insert": "!"                 // the insertion "!" has no attributions
    }
  ]
}
assert.deepEqual(attributedContent.toJSON(), output)
renderer.destroy()
ydoc.destroy()
ydocVersion0.destroy()
```

We get a similar output to Google Docs: Insertions, Deletions, and changes to
formatting (attributes) are clearly associated to users. It will be the job of
the editor to render those changes with background-color etc..

Deletion metadata can name multiple users:

```js
const multiAuthorDeletions = Y.createIdMapFromIdSet(deleteSetDiff, [Y.createContentAttribute('delete', 'Bob'), Y.createContentAttribute('delete', 'OpenAI o3')])
```

The attributed output is a display state: deleted text still appears as an
`insert` with delete metadata. To calculate ordinary insert/delete operations,
compare the two documents' unrendered deltas with `delta.diff(previous, next)`.

`AbstractRenderer` is the abstract base class for renderers, which map
attributions onto content. It is possible to highlight arbitrary content with
this approach.

`Y.encodeContentMap(attributions)` serializes both mappings. Each map stores
contiguous ID ranges and writes each shared attribute definition once, then uses
references to it. The byte length depends on the client IDs, ranges, and attribute values.
