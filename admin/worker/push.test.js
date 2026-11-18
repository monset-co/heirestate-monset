import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, b64u, unb64u } from "./push.js";

// RFC 8291, Appendix A: the worked example, byte for byte
test("a push message is encrypted exactly as the Web Push standard's example", async () => {
  const asPub = unb64u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const jwk = { kty: "EC", crv: "P-256", x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)), ext: true };
  const alg = { name: "ECDH", namedCurve: "P-256" };
  const local = {
    publicKey: await crypto.subtle.importKey("jwk", jwk, alg, true, []),
    privateKey: await crypto.subtle.importKey("jwk", { ...jwk, d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" }, alg, false, ["deriveBits"]),
  };
  const sub = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  const out = await encrypt(sub, "When I grow up, I want to be a watermelon", local, unb64u("DGv6ra1nlYgDCS1FRnbzlw"));
  assert.equal(
    b64u(out),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  );
});
