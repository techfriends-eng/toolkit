import assert from "node:assert/strict";
import test from "node:test";
import { singleFlight } from "./single-flight.ts";

test("пока вызов идёт, повторный не запускает второй", async () => {
  let calls = 0;
  let release: (value: number) => void = () => {};
  const run = singleFlight(() => {
    calls += 1;
    return new Promise<number>((resolve) => {
      release = resolve;
    });
  });
  const first = run();
  const second = run();
  assert.equal(calls, 1);
  release(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
});

test("после завершения, в том числе с ошибкой, следующий вызов идёт заново", async () => {
  let calls = 0;
  const run = singleFlight(async () => {
    calls += 1;
    if (calls === 1) throw new Error("сбой сети");
    return calls;
  });
  await assert.rejects(run(), /сбой сети/);
  assert.equal(await run(), 2);
});
