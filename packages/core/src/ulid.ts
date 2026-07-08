// Application-side id generation — see docs/SPEC.md#primary-keys. SQLite has
// no native ULID/UUID generator, and a plain UUIDv4 sorts randomly, which
// defeats the "id order reflects creation order" property collections rely
// on for e.g. cursor-free pagination stability. Crockford base32, 10
// timestamp characters (ms since epoch) + 16 random characters, 26 total.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(time: number): string {
  let mutableTime = time
  let str = ''
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = mutableTime % ENCODING_LEN
    str = ENCODING[mod] + str
    mutableTime = (mutableTime - mod) / ENCODING_LEN
  }
  return str
}

function encodeRandom(): string {
  let str = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[Math.floor(Math.random() * ENCODING_LEN)]
  }
  return str
}

/** 26-character, lexicographically-sortable-by-creation-time id. */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom()
}
