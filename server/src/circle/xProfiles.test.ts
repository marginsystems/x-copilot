import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseXUsers, parseXUsersByResponse } from "./xProfiles.ts";

const AT = "2026-09-30T00:00:00.000Z";

await describe("parseXUsersByResponse", async () => {
  await it("maps users/by data to profiles with the 400x400 avatar crop", () => {
    const profiles = parseXUsersByResponse(
      {
        data: [
          {
            id: "11",
            username: "Alice",
            name: " Alice A ",
            profile_image_url: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
          },
          { id: "12", username: "bob", name: "", profile_image_url: "http://insecure/x_normal.png" },
          { id: "13", username: "not a handle!", name: "Bad" },
          "garbage",
        ],
        errors: [{ value: "gone", detail: "Could not find user" }],
      },
      AT,
    );
    assert.deepEqual(profiles, [
      {
        authorKey: "alice",
        handle: "Alice",
        name: "Alice A",
        avatarUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
        updatedAt: AT,
      },
      { authorKey: "bob", handle: "bob", name: null, avatarUrl: null, updatedAt: AT },
    ]);
  });

  await it("returns nothing for an error-only or malformed body", () => {
    assert.deepEqual(parseXUsersByResponse({ errors: [{ detail: "nope" }] }, AT), []);
    assert.deepEqual(parseXUsersByResponse(null, AT), []);
  });

  await it("keeps numeric X ids for includes.users lookups", () => {
    const users = parseXUsers([{ id: "42", username: "carol" }, { id: "x", username: "dan" }], AT);
    assert.deepEqual(users.map((u) => [u.id, u.handle]), [["42", "carol"], [null, "dan"]]);
  });
});
