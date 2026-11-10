# FAQ answer-quality evaluation

`run.mjs` compares the deployed Cobot research behavior with one generic public-entry-point discovery instruction. The production prompt and 50-round limit are unchanged. Questions and scenarios for all 11 Wiki FAQ cases are in `questions.json`; the initial repeated experiment scores Q3/Q4 using `rubrics.json`. `reference-answers.json` is evaluator-only, imported from Wiki's FAQ (implementation baseline `6dce67ef9a4214708b8da1631ac1ebed352648f9`). Check references against the evaluated source snapshot, since prose is not authoritative.

## Isolation and execution

Prepare a disposable snapshot of the Wiki workspace, excluding the developer FAQ answer key, prior session state, and evaluation results. Keep the original workspace untouched. The seed must not contain this evaluation directory. Copy **only** `run.mjs` and `questions.json` to a host directory outside all agent workspaces. Never copy the rubrics, reference answers, reviews, or results into the workspace. The runner also whitelists `id`/`question` fields before constructing requests.

On the Orca host, use its service credential file to mint a token without printing credentials:

```sh
node run.mjs run --questions questions.json --ids 3,4 --repeats 3 \
  --pod <disposable-seed-pod> --client wiki \
  --source <source-manifest-sha256> --out /tmp/faq-eval-results
```

Alternatively supply `ORCA_EVAL_TOKEN` in the environment. `--url` defaults to `http://127.0.0.1:2644`; Node HTTP requests bypass environment proxy settings. `--model` defaults to `deepseek-v4-flash`. Each request uses Cobot, `yolo`, and a fresh readonly fork. The host controls the round limit; verify the deployed build and record its hashes separately. No runtime files are patched by this runner. Delete the disposable seed after all runs finish.

Each question has three baseline and three discovery runs, interleaved with reversed ordering on alternate pairs. With an odd repeat count first-position counts differ by one per question and balance across Q3/Q4. This is descriptive, not a randomized or blinded statistical trial. Only the instruction suffix differs. The manifest preserves prompts/schedule, and results preserve final answers, calls, elapsed time, and raw protocol events. Public events do not expose model rounds or full tool outputs; do not infer rounds from call counts. Use a fresh output directory per execution. Empty final answers, missing terminal events, errors, and timeouts fail execution; timeouts trigger cancellation. The default per-stream deadline is 12 minutes.

## Comparing backends

Use `--backend cursor --model composer-2.5 --agent agent --variant baseline` to run only the shared baseline instruction with Cursor. `--backend` defaults to `cobot`, and `--variant` defaults to `both`; `baseline` and `discovery` select a single variant. The service client or supplied session token must allow the chosen backend. The manifest records the backend, model, agent, and source fingerprint.

Orca's Cursor adapter does not expose the Cobot 50-round cap. The runner records `roundLimit: null` for other backends rather than claiming equivalent limits. The same run timeout still applies. Comparing Cursor/Composer with Cobot/DeepSeek changes both harness and model, including their built-in instructions and tool interfaces; it does not isolate either factor. Tool-call counts also reflect different tool interfaces.

## Review before comparison

Review each answer against the snapshot implementation and the predeclared rubric. `reviews.json` is an array of:

```json
[{
  "id": "q3-baseline-1",
  "criteria": {
    "direct_search": { "met": true, "quote": "exact substring of answer" },
    "passages": { "met": false, "reason": "required passage selection omitted" }
  },
  "incorrectClaims": [],
  "citationSupport": "supported",
  "unnecessaryDetail": "low",
  "notes": "source files/lines checked and citation defects"
}]
```

Include **every** criterion. `incorrectClaims` lists substantive false claims, even outside the rubric. Citation support is `supported`, `partial`, or `unsupported` based on checking that key claims are backed by the cited implementation; path existence alone is insufficient. Unnecessary detail is `low`, `medium`, or `high` based on irrelevant material. A missing review stays `UNREVIEWED`. A pass requires successful nonempty execution, all facts, no substantive false claims, and supported citations. The citation audit checks file hashes and exact line excerpts against the snapshot. It does not establish that the excerpt supports the claim. Quote validation guards review provenance, not semantic correctness. This is human review, not an automated truth judge.

```sh
node eval/faq/run.mjs audit --out /path/to/results --source /path/to/source-snapshot
node eval/faq/run.mjs report --out /path/to/results --rubrics eval/faq/rubrics.json
bun test test/faq-eval-e2e.test.ts
```

Acceptance gate, set before live execution: prefer discovery only if required-fact coverage improves overall without lower coverage for either question, without more substantive incorrect claims for either question, and without worse citation support or execution failures. Compare pass rates first, coverage/errors next, and calls/time last. A tiny sample cannot establish a reliable effect; only consider a production change after a wider FAQ regression check. An inconclusive or worse candidate remains experimental.
