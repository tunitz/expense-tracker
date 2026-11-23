# Statement CP037 decoder

This N-API addon decodes a whole statement in one call, preserving JavaScript's
UTF-16 code-unit semantics (including lone surrogates). PDF extraction, bank
parsing, and the decision to decode remain in TypeScript.

From the repository root:

```sh
crate=rust/statement-cp037
rust-anything build "$crate"
bun test src/server/parsers/statement-encoding.test.ts

node --input-type=module - > /tmp/expense-cp037-inputs.jsonl <<'JS'
const bytes = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join('');
const marker = '\xe2\xa3\x81\xa3\x85\x94\x85\x95\xa3';
for (const input of [bytes, { $utf16: [0xd800, 0, 0xdcff] }, marker, ('SAMPLE COFFEE 💳 ' + marker).repeat(500)]) {
  console.log(JSON.stringify({ fn: 'decodeCp037', args: [input] }));
}
JS
rust-anything record "$crate" --count 200 --inputs /tmp/expense-cp037-inputs.jsonl
rust-anything gate "$crate"
rust-anything bench "$crate"
```

The app uses TypeScript when the addon is absent or when
`EXPENSE_CP037_MODE=js` is set. `bun run dev` and `bun run start` build the
addon with Cargo; the Docker image also includes it.
