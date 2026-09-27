import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeModifiedUtf8, decodeModifiedUtf8 } from '../src/index.js';

function bytes(...bs) {
    return new Uint8Array(bs);
}

function expectBytes(actual, expected) {
    assert.equal(actual.length, expected.length, 'byte length mismatch');
    for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i], expected[i], `byte ${i}: got ${actual[i]}, expected ${expected[i]}`);
    }
}

function roundTrip(s) {
    const encoded = encodeModifiedUtf8(s);
    const decoded = decodeModifiedUtf8(encoded);
    assert.equal(decoded, s, `round-trip failed for ${JSON.stringify(s)}`);
}

test('ASCII round-trips and uses one byte per character', () => {
    expectBytes(encodeModifiedUtf8('Hello'), bytes(0x48, 0x65, 0x6C, 0x6C, 0x6F));
    roundTrip('Hello');
});

test('empty string encodes to zero bytes', () => {
    expectBytes(encodeModifiedUtf8(''), bytes());
    assert.equal(decodeModifiedUtf8(new Uint8Array(0)), '');
});

test('NUL is encoded as 0xC0 0x80, not as a single 0x00', () => {
    expectBytes(encodeModifiedUtf8('\u0000'), bytes(0xC0, 0x80));
    expectBytes(encodeModifiedUtf8('a\u0000b'), bytes(0x61, 0xC0, 0x80, 0x62));
    roundTrip('\u0000');
    roundTrip('a\u0000b');
});

test('two-byte BMP characters encode correctly', () => {
    // U+00E9 LATIN SMALL LETTER E WITH ACUTE
    expectBytes(encodeModifiedUtf8('\u00E9'), bytes(0xC3, 0xA9));
    roundTrip('caf\u00E9');
});

test('three-byte BMP characters encode correctly', () => {
    // U+4E2D 中
    expectBytes(encodeModifiedUtf8('\u4E2D'), bytes(0xE4, 0xB8, 0xAD));
    roundTrip('中');
});

test('supplementary character is emitted as six bytes (two 3-byte surrogate blocks)', () => {
    // U+1F600 GRINNING FACE: surrogate pair D83D DE00.
    expectBytes(
        encodeModifiedUtf8('\u{1F600}'),
        bytes(0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80)
    );
    roundTrip('\u{1F600}');
});

test('a string with mixed BMP and supplementary characters round-trips', () => {
    const s = 'A\u00E9中\u0000\u{1F600}Z';
    roundTrip(s);
});

test('decoding a plain 0x00 byte yields U+0000', () => {
    assert.equal(decodeModifiedUtf8(bytes(0x00)), '\u0000');
});

test('decoding accepts a plain array of byte values', () => {
    assert.equal(decodeModifiedUtf8([0x48, 0x69]), 'Hi');
});

test('decoding rejects truncated 2-byte sequences', () => {
    assert.throws(() => decodeModifiedUtf8(bytes(0xC3)), /truncated or invalid 2-byte sequence/);
});

test('decoding rejects a lone trailing continuation byte', () => {
    assert.throws(() => decodeModifiedUtf8(bytes(0x80)), /unexpected leading byte/);
});

test('decoding rejects overlong 2-byte encodings', () => {
    // 0xC0 0x80 is the canonical NUL and is allowed; but 0xC1 0xBF
    // decodes to cp 0x5F, which is < 0x80 and therefore overlong.
    assert.throws(() => decodeModifiedUtf8(bytes(0xC1, 0xBF)), /overlong 2-byte sequence/);
});

test('decoding rejects overlong 3-byte encodings', () => {
    // 0xE0 0x80 0xAF would decode to U+002F, a two-byte value
    // smuggled into three bytes.
    assert.throws(() => decodeModifiedUtf8(bytes(0xE0, 0x80, 0xAF)), /overlong 3-byte sequence/);
});

test('encodeModifiedUtf8 rejects non-string input', () => {
    assert.throws(() => encodeModifiedUtf8(42), TypeError);
    assert.throws(() => encodeModifiedUtf8(null), TypeError);
});

test('decodeModifiedUtf8 rejects non-byte input', () => {
    assert.throws(() => decodeModifiedUtf8('hello'), TypeError);
    assert.throws(() => decodeModifiedUtf8([300]), TypeError);
    assert.throws(() => decodeModifiedUtf8([1.5]), TypeError);
});

test('decoding rejects a leading 0xF4 byte (four-byte UTF-8 is not valid Modified UTF-8)', () => {
    assert.throws(() => decodeModifiedUtf8(bytes(0xF4, 0x80, 0x80, 0x80)), /unexpected leading byte/);
});
