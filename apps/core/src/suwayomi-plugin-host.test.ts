import assert from "node:assert/strict";
import test from "node:test";

import { suwayomiProxyArguments } from "./suwayomi-plugin-host.ts";

test("translates an explicit credential-free HTTP proxy into JVM system properties", () => {
  assert.deepEqual(suwayomiProxyArguments("http://127.0.0.1:7897"), [
    "-Dhttp.proxyHost=127.0.0.1",
    "-Dhttp.proxyPort=7897",
    "-Dhttps.proxyHost=127.0.0.1",
    "-Dhttps.proxyPort=7897",
  ]);
});

test("rejects proxy URLs that could leak credentials or ambiguous routing", () => {
  assert.throws(
    () => suwayomiProxyArguments("http://user:secret@127.0.0.1:7897"),
    /credentials/i,
  );
  assert.throws(
    () => suwayomiProxyArguments("https://127.0.0.1:7897/path"),
    /HTTP proxy URL/i,
  );
});
