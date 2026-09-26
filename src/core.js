/**
 * Encode a UTF-16 code unit sequence into Java Modified UTF-8 bytes
 * and decode those bytes back to UTF-16.
 *
 * Modified UTF-8 is the format the JVM uses for strings in the
 * `.class` file format and in `DataInput`/`DataOutput` streams. It
 * differs from standard UTF-8 in two ways that this library exists
 * to handle:
 *
 * 1. The NUL character (U+0000) is encoded as the two bytes 0xC0 0x80
 *    so that a C string-style routine that scans for a single 0x00
 *    byte never sees a NUL inside the payload. This lets JVM class
 *    files store the string length up front while still allowing a
 *    real NUL to round-trip.
 * 2. Supplementary characters (those above the BMP, U+10000 and up)
 *    are encoded as a single four-byte UTF-8 sequence, then the
 *    surrogate-pair half of that sequence is re-encoded as if each
 *    surrogate code unit were a separate character. The net effect is
 *    six bytes per supplementary character. We preserve this exactly;
 *    a naive UTF-8 encoder would emit four bytes and corrupt data that
 *    round-trips through a real JVM.
 */

const EOS = Symbol('eos');

/**
 * Reads UTF-16 code units from a String. Strings in JS are UTF-16,
 * so this is the natural input. Supplementary characters arrive
 * as surrogate pairs, which we pass through unit by unit so the
 * encoder can apply the Modified UTF-8 supplementary rule itself.
 */
class Utf16Reader {
    constructor(s) {
        this.s = s;
        this.i = 0;
    }
    next() {
        if (this.i >= this.s.length) return EOS;
        return this.s.charCodeAt(this.i++);
    }
}

/**
 * Reads bytes from a Uint8Array. Returns EOS at the end so callers
 * can treat `undefined`/end-of-input uniformly.
 */
class ByteReader {
    constructor(bytes) {
        this.bytes = bytes;
        this.i = 0;
    }
    next() {
        if (this.i >= this.bytes.length) return EOS;
        return this.bytes[this.i++];
    }
    back() {
        if (this.i <= 0) {
            throw new Error('ByteReader.back() underflow: cannot push back before start');
        }
        this.i -= 1;
    }
}

function isHighSurrogate(u) {
    return u >= 0xD800 && u <= 0xDBFF;
}

function isLowSurrogate(u) {
    return u >= 0xDC00 && u <= 0xDFFF;
}

function pushBytes(out, ...bs) {
    for (const b of bs) {
        if (b < 0 || b > 0xFF) {
            throw new Error(`internal: byte out of range: ${b}`);
        }
        out.push(b);
    }
}

/**
 * Encodes a JS string into Java Modified UTF-8 bytes.
 *
 * @param {string} s
 * @returns {Uint8Array}
 */
export function encodeModifiedUtf8(s) {
    if (typeof s !== 'string') {
        throw new TypeError('encodeModifiedUtf8: expected a string');
    }
    const reader = new Utf16Reader(s);
    const out = [];
    for (;;) {
        const u = reader.next();
        if (u === EOS) break;
        if (u < 0x80) {
            // ASCII fast path, but NUL gets the two-byte form.
            if (u === 0) {
                pushBytes(out, 0xC0, 0x80);
            } else {
                pushBytes(out, u);
            }
        } else if (u < 0x800) {
            pushBytes(out, 0xC0 | (u >> 6), 0x80 | (u & 0x3F));
        } else if (u >= 0xD800 && u <= 0xDFFF) {
            // Surrogates are emitted using the six-byte form required
            // by Modified UTF-8: UTF-8-encode each surrogate code unit
            // as if it were a standalone character.
            pushBytes(out, 0xED, 0xA0 | ((u >> 6) & 0x3F), 0x80 | (u & 0x3F));
        } else {
            pushBytes(out, 0xE0 | (u >> 12), 0x80 | ((u >> 6) & 0x3F), 0x80 | (u & 0x3F));
        }
    }
    return new Uint8Array(out);
}

/**
 * Reads one Modified UTF-8 encoded character (1, 2, 3, or 6 bytes)
 * starting at the reader's current position and returns the UTF-16
 * code units that represent it.
 */
function decodeOne(reader) {
    const b0 = reader.next();
    if (b0 === EOS) return EOS;
    if (b0 < 0x80) {
        return [b0];
    }
    if ((b0 & 0xE0) === 0xC0) {
        const b1 = reader.next();
        if (b1 === EOS || (b1 & 0xC0) !== 0x80) {
            throw new Error('modified-utf-8: truncated or invalid 2-byte sequence');
        }
        const cp = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
        if (cp === 0) {
            return [0];
        }
        if (cp < 0x80) {
            throw new Error('modified-utf-8: overlong 2-byte sequence');
        }
        if (cp >= 0xD800 && cp <= 0xDFFF) {
            return [cp];
        }
        return [cp];
    }
    if ((b0 & 0xF0) === 0xE0) {
        const b1 = reader.next();
        const b2 = reader.next();
        if (b1 === EOS || b2 === EOS || (b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80) {
            throw new Error('modified-utf-8: truncated or invalid 3-byte sequence');
        }
        const cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F);
        if (cp < 0x800) {
            throw new Error('modified-utf-8: overlong 3-byte sequence');
        }
        if (cp >= 0xD800 && cp <= 0xDFFF) {
            return [cp];
        }
        return [cp];
    }
    throw new Error(`modified-utf-8: unexpected leading byte 0x${b0.toString(16)}`);
}

/**
 * Decodes Java Modified UTF-8 bytes into a JS string.
 *
 * Throws on malformed input rather than silently substituting the
 * U+FFFD replacement character: callers who want lenient decoding
 * can wrap this in a try/catch.
 *
 * @param {Uint8Array|number[]} bytes
 * @returns {string}
 */
export function decodeModifiedUtf8(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        if (Array.isArray(bytes)) {
            for (let i = 0; i < bytes.length; i++) {
                const v = bytes[i];
                if (typeof v !== 'number' || v < 0 || v > 255 || !Number.isInteger(v)) {
                    throw new TypeError('decodeModifiedUtf8: array elements must be integers 0-255');
                }
            }
            bytes = new Uint8Array(bytes);
        } else if (bytes && typeof bytes.length === 'number' && typeof bytes[Symbol.iterator] === 'function') {
            const arr = Array.from(bytes);
            for (const v of arr) {
                if (typeof v !== 'number' || v < 0 || v > 255 || !Number.isInteger(v)) {
                    throw new TypeError('decodeModifiedUtf8: iterable must yield integers 0-255');
                }
            }
            bytes = new Uint8Array(arr);
        } else {
            throw new TypeError('decodeModifiedUtf8: expected Uint8Array, array, or byte iterable');
        }
    }
    const reader = new ByteReader(bytes);
    const units = [];
    for (;;) {
        const result = decodeOne(reader);
        if (result === EOS) break;
        for (const u of result) {
            units.push(u);
        }
    }
    return String.fromCharCode(...units);
}
