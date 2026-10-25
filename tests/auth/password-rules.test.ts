import { expect, test } from "vitest";
import { passwordProblem } from "@/server/auth/password";

test("tahmin edilebilir uzun parolalar reddedilir", () => {
  for (const pw of [
    "Galatasaray1905!",
    "Parola2024!!",
    "qwerty12345",
    "05551112233",
    "abcabcabcabc",
    "Fenerbahçe1907",
    "1907Fenerbahce",
    "Ayakkabı2026",
    "Password123!",
    "aaaaabbbbbb",
  ]) {
    expect(passwordProblem(pw), pw).not.toBeNull();
  }
});

test("güçlü parolalar kabul edilir", () => {
  for (const pw of ["Kuvvetli-Parola-42", "mavi bisiklet yokuşu", "Tr7#kL9!pQ2z", "Yeni-Guclu-Parola-7", "Baska-Guclu-Parola-8"]) {
    expect(passwordProblem(pw), pw).toBeNull();
  }
});
