import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseFormEncoded,
  percentEncode,
  signOauth1,
  signatureBaseString,
} from "./oauth1.ts";

describe("oauth1", () => {
  it("matches the RFC 5849 photo-print signature", () => {
    // https://www.rfc-editor.org/rfc/rfc5849#section-3.4.1
    const params = {
      oauth_consumer_key: "dpf43f3p2l4k3l03",
      oauth_token: "nnch734d00sl2jdk",
      oauth_nonce: "kllo9940pd9333jh",
      oauth_timestamp: "1191242096",
      oauth_signature_method: "HMAC-SHA1",
      oauth_version: "1.0",
      file: "vacation.jpg",
      size: "original",
    };
    const base = signatureBaseString({
      method: "GET",
      url: "http://photos.example.net/photos",
      params,
    });
    assert.equal(
      base,
      "GET&http%3A%2F%2Fphotos.example.net%2Fphotos&file%3Dvacation.jpg%26oauth_consumer_key%3Ddpf43f3p2l4k3l03%26oauth_nonce%3Dkllo9940pd9333jh%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1191242096%26oauth_token%3Dnnch734d00sl2jdk%26oauth_version%3D1.0%26size%3Doriginal",
    );
    const sig = signOauth1({
      method: "GET",
      url: "http://photos.example.net/photos",
      params,
      consumerSecret: "kd94hf93k423kf44",
      tokenSecret: "pfkkdhi9sl3r4s00",
    });
    assert.equal(sig, "tR3+Ty81lMeYAr/Fid0kMTYa/WM=");
  });

  it("percent-encodes reserved characters", () => {
    assert.equal(percentEncode("a b"), "a%20b");
    assert.equal(percentEncode("a+b"), "a%2Bb");
  });

  it("parses form-encoded OAuth replies", () => {
    const got = parseFormEncoded(
      "oauth_token=abc&oauth_token_secret=s%2Fcret&oauth_callback_confirmed=true",
    );
    assert.equal(got.oauth_token, "abc");
    assert.equal(got.oauth_token_secret, "s/cret");
    assert.equal(got.oauth_callback_confirmed, "true");
  });
});
