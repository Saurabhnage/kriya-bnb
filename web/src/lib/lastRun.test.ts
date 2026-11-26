import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLastRun } from "./server/lastRun";
import type { LoopStep } from "./client";

const steps: LoopStep[] = [
  { step: "OBSERVE", status: "ok", detail: "o" },
  { step: "EXECUTE", status: "ok", detail: "e", txHash: "0x1" },
];

test("keeper run uses its persisted steps verbatim", () => {
  const r = buildLastRun([{ ts: 10, kind: "run", runId: "run-1", source: "AGENT", title: "run", data: { steps } }]);
  assert.equal(r?.runId, "run-1");
  assert.equal(r?.source, "AGENT");
  assert.deepEqual(r?.steps, steps);
});

test("newest run wins; null when nothing ran", () => {
  assert.equal(buildLastRun([]), null);
  const r = buildLastRun(
    [
      { ts: 10, kind: "run", runId: "run-1", source: "AGENT", title: "run", data: { steps } },
      { ts: 50, kind: "run", runId: "run-2", source: "AGENT", title: "run", data: { steps: [] } },
      { ts: 90, kind: "decide", title: "preview only" },
    ],
  );
  assert.equal(r?.runId, "run-2");
});
