# modified-utf-8

A zero-dependency ESM library that encodes and decodes Java Modified UTF-8 — the variant the JVM uses in the `.class` file format and in `DataInput`/`DataOutput` streams.

```js
import { encodeModifiedUtf8, decodeModifiedUtf8 } from './src/index.js';

const bytes = encodeModifiedUtf8('a\u0000b\u{1F600}');
// Uint8Array(11) [
//   97, 192, 128, 98,
//   237, 160, 189, 237, 184, 128
// ]
const back = decodeModifiedUtf8(bytes); // 'a\u0000b\u{1F600}'
```

## Why this exists

Standard UTF-8 and Modified UTF-8 disagree on two points that matter for data that round-trips through the JVM:

- **NUL handling.** Modified UTF-8 encodes U+0000 as the two bytes `0xC0 0x80` so payload bytes never contain a literal `0x00`. A generic UTF-8 encoder would emit a single `0x00` byte and break any reader that treats a NUL as a terminator.
- **Supplementary characters.** Modified UTF-8 encodes each half of a surrogate pair as its own three-byte sequence, producing six bytes per supplementary character. A generic UTF-8 encoder emits four bytes, which a JVM reader will reject or misread.

This library implements both rules exactly. It does not attempt to be a general-purpose UTF-8 codec.

## Edge cases

- `decodeModifiedUtf8` throws on malformed input (truncated sequences, overlong encodings, lone continuation bytes, four-byte UTF-8 lead bytes). It does not substitute U+FFFD; callers who want lenient decoding should wrap it in a try/catch.
- `encodeModifiedUtf8` accepts a JS string (UTF-16) and emits Modified UTF-8 bytes. Supplementary characters arrive as surrogate pairs and are encoded in the six-byte form.
- The decoder accepts a `Uint8Array`, a plain `Array` of integers in `[0, 255]`, or any iterable yielding such integers.

## Exports

- `encodeModifiedUtf8(string): Uint8Array`
- `decodeModifiedUtf8(Uint8Array | number[] | Iterable<number>): string`
