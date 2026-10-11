
# Attribution Feature

The Attribution feature extends Yjs types to provide rich metadata about content
changes, including information about who created, deleted, or formatted content.
Applications associate structure IDs with author or time metadata in `IdMap`s.
The renderer combines those mappings with the document's insertion and deletion
state; Yjs does not assign authors automatically.

## Core Concepts

### Renderer

A `renderer` renders Content (with its Attributions) to a delta. It is the
central component for the attribution feature: pass it to methods like
`toDelta()` / `getDelta()` to render content together with attribution metadata.

Different implementations of Renderer are available for different use cases:
- `AttributionsRenderer`: Adds metadata to selected ID ranges, optionally using
  an explicit set of normally visible content
- `DiffRenderer`: Highlights the differences between two Yjs documents
- `SnapshotRenderer`: Highlights the differences between two snapshots

`AttributionsRenderer` and `SnapshotRenderer` need the deleted content to remain
in the document, so set `gc: false` before deleting it. `DiffRenderer` can recover
deleted content from its baseline document. Empty attribution arrays still mark
a change: `{ delete: [] }` means a deletion with no author names supplied.

### Attributed Content

Attributed content includes standard Yjs operations enhanced with attribution metadata.
The arrays below abbreviate the `children` field of `Delta.toJSON()`; actual JSON
also includes operation `type` fields.

```javascript
// Standard content
[{ insert: 'hello world' }]

// Attributed content
[
  { insert: 'hello', attribution: { insert: ['kevin'] } },
  { insert: ' world', attribution: { insert: ['alice'] } }
]
```

### Delete Attribution

Deleted content is represented in attributed results to maintain authorship information and proper position tracking:

```javascript
// Shows deleted content with attribution
[
  { insert: 'hello ', attribution: { delete: ['kevin'] } },
  { insert: 'world' }
]
```

## API Reference

### Y.Type

In Yjs v14 all shared types (text, array, map, xml) are instances of the unified
`Y.Type`.

#### `toDelta({ renderer, deep } = {})`

Returns the delta representation (lib0/delta) of the type's content, optionally
with attribution information.

**Parameters:**
- `renderer` (optional): The renderer instance
- `deep` (optional): Render nested shared types as deltas

**Returns:**
- A `Delta` describing the content, with attribution metadata if `renderer` is provided

**Examples:**

```javascript
const ytext = ydoc.get()
// Content is inserted during collaborative editing
// The application supplies the renderer's attribution mappings

// Without attribution
const d = ytext.toDelta()
// [{ insert: 'hello world' }]

// With attribution
const attributedDelta = ytext.toDelta({ renderer })
// [
//   { insert: 'hello', attribution: { insert: ['kevin'] } },
//   { insert: ' world', attribution: { insert: ['alice'] } }
// ]
```

#### `applyDelta(delta, origin = null, { renderer } = {})`

Applies a delta (lib0/delta) on the shared type. The optional `origin` is stored
on the transaction (`transaction.origin`) and forwarded verbatim on the emitted
`'delta'` event (lib0 RDT spec), so listeners can recognize — and skip — changes
they produced themselves. When a `renderer` is provided, positions in the delta
are interpreted relative to the attributed (rendered) content.

**Parameters:**
- `delta`: The changes to apply
- `origin` (optional): Origin of the transaction that applies this delta; defaults to `null`
- `renderer` (optional): The renderer instance

**Returns:**
- `null` when no correction is needed, or a Delta that corrects operations
  rejected by the document. For example, modifying a deleted node that the
  renderer still displays returns an inverse for that nested modification.
  The consumer applies this correction to its own proposed state.

### YEvent

#### `getDelta({ renderer, deep } = {})`

Returns the changes of an event as a delta, optionally rendered with attribution
information. It describes the change from the consumer's previous rendered
state, so unchanged content is retained rather than inserted again.

**Parameters:**
- `renderer` (optional): The renderer instance
- `deep` (optional): Render child types as deltas

**Returns:**
- A `Delta` describing the changes, with attribution metadata if `renderer` is provided

## Position Adjustments

When working with attributed content, position calculations must account for deleted content that appears in the attributed representation but not in the standard representation.

The examples below use `DiffRenderer`. In this release, `SnapshotRenderer` hides
content newer than its snapshot when rendering, but `contentLength()` counts a
currently live Item in full. Index helpers can therefore count hidden future
content when using a snapshot renderer.

### Example: Position Adjustment

```javascript
// Standard content (length: 5)
ytext.toString() // "world"

// Attributed content (includes deleted content)
ytext.toDelta({ renderer })
// [
//   { insert: 'hello ', attribution: { delete: ['kevin'] } },  // positions 0-5
//   { insert: 'world' }                                         // positions 6-10
// ]

// To insert after "world":
// - Standard position: 5 (after "world")
// - Attributed position: 11 (after "world" accounting for deleted "hello ")
```

## Event Deltas

Events use the selected renderer's coordinate space, including deleted content
that the renderer continues to display.

### Event Position Adjustment

When a `renderer` is used, event positions are automatically adjusted to account for deleted content.

**Example:**

Run this example in Node.js 22 or later from this package's directory.

```javascript
import assert from 'node:assert/strict'
import * as Y from '@y/y'
import * as delta from 'lib0/delta'

const ydoc = new Y.Doc()
const ytext = ydoc.get()
ytext.insert(0, 'hello world')
const baseline = Y.cloneDoc(ydoc)
ytext.delete(0, 6)
const renderer = Y.createDiffRenderer(baseline, ydoc)
// Ordinary content: "world"; renderer view: "hello world", with a deleted prefix

ytext.observe((event, transaction) => {
  // Standard event (without attribution)
  const standardDelta = event.getDelta({ renderer: null })
  // Equivalent to delta.create().retain(5).insert('!')
  
  // Attributed event (with renderer)
  const attributedDelta = event.getDelta({ renderer })
  // Equivalent to delta.create().retain(11).insert('!', null, { insert: [] })
  assert.ok(standardDelta.equals(delta.create().retain(5).insert('!')))
  assert.ok(attributedDelta.equals(delta.create().retain(11).insert('!', null, { insert: [] })))
})
ytext.applyDelta(delta.create().retain(11).insert('!').done(), null, { renderer })
renderer.destroy()
baseline.destroy()
ydoc.destroy()
```

## Use Cases

### Authorship Visualization

Display content with visual indicators of who created each part:

```javascript
function renderWithAuthorship(ytext, renderer) {
  const attributedDelta = ytext.toDelta({ renderer })
  
  return attributedDelta.children.map(op => {
    const author = op.attribution?.insert?.[0] || 'unknown'
    const isDeleted = op.attribution?.delete
    
    return {
      content: op.insert,
      author,
      isDeleted,
      className: `author-${author} ${isDeleted ? 'deleted' : ''}`
    }
  })
}
```

### Change Tracking

Track who made specific changes to content:

```javascript
function trackChanges(ytext, renderer) {
  ytext.observe((event, transaction) => {
    const changes = event.getDelta({ renderer })
    
    changes.children.forEach(change => {
      if (change.attribution) {
        console.log(`Change by ${change.attribution.insert?.[0] || change.attribution.delete?.[0]}:`, change)
      }
    })
  })
}
```

## Best Practices

### Renderer Lifecycle

- A `DiffRenderer` belongs to a baseline/working-document pair and installs
  listeners on both documents. Call `destroy()` when that pair is no longer used.
- An `AttributionsRenderer` captures the supplied mappings at construction;
  create a new renderer after changing those mappings.
- Use the same renderer when reading a view, applying changes in its coordinates,
  and interpreting events. `type.useRenderer(renderer)` makes it the default for
  that type's APIs and maintained `delta` cache; child types have their own defaults.

## Migration Guide

### Upgrading Existing Code

To add attribution support to existing Yjs applications:

1. **Add renderer**: Create and configure a renderer
2. **Update method calls**: Add the renderer parameter to relevant method calls
3. **Handle attributed content**: Update code to handle the new attribution metadata format
4. **Adjust position calculations**: Update position calculations to account for deleted content

### Using APIs without attribution

With no renderer installed, the v14 APIs render live content and omit deleted
content. Passing `{ renderer: null }` explicitly selects this view even when
`useRenderer()` has installed a default renderer.
