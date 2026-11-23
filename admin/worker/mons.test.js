import { test } from "node:test";
import assert from "node:assert/strict";
import { term } from "./mons.js";

test("term keeps a search inside its PostgREST filter", () => {
  assert.equal(term("Ana Cruz"), "Ana Cruz");
  assert.equal(term("x),stage.eq.lost,(name.ilike.*"), "x  stage.eq.lost  name.ilike.");
  assert.equal(term(null), "");
  assert.equal(term("a".repeat(200)).length, 80);
});
