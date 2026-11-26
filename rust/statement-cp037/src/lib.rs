//! One N-API call per statement; preserve raw JavaScript UTF-16 code units.
#![deny(unsafe_code)]

use napi::bindgen_prelude::Utf16String;
use napi_derive::napi;

mod port;

#[napi(js_name = "decodeCp037")]
pub fn decode_cp037(input: Utf16String) -> Utf16String {
    port::decode_cp037(&input).into()
}
