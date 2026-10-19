import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";

test("HTTP flow: upload → filters → note → diagnosis → export → persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fieldwork-test-"));
  const app = createApp({ directory });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let datasetId;
  try {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
    const upload = await fetch(`${base}/api/datasets`, {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
        "X-File-Name": encodeURIComponent("真实结构测试.csv"),
      },
      body: "sku,warehouse,stock\n001,East,10\n002,West,0\n003,West,5",
    });
    assert.equal(upload.status, 201);
    const data = await upload.json();
    datasetId = data.id;
    assert.equal(data.demo, false);
    assert.equal(data.rowCount, 3);
    assert.equal(data.name, "真实结构测试.csv");
    const url = `${base}/api/datasets/${data.id}`;
    const sum = await (
      await fetch(`${url}/summary?metric=stock&filter=warehouse&value=West`)
    ).json();
    assert.equal(sum.total, 5);
    assert.equal(sum.count, 2);
    assert.equal(sum.average, 2.5);
    const note = await fetch(`${url}/rows/2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "跟进中", note: "补货待确认" }),
    });
    assert.equal(note.status, 200);
    const result = await (
      await fetch(`${url}/diagnostics?ruleField=stock&op=lte&threshold=0`)
    ).json();
    assert.equal(result.matched, 1);
    assert.equal(result.rows[0].note.note, "补货待确认");
    const exportResponse = await fetch(
      `${url}/export?ruleField=stock&op=lte&threshold=0`,
    );
    const output = parse(await exportResponse.text(), {
      bom: true,
      columns: true,
    });
    assert.equal(output.length, 1);
    assert.equal(output[0].sku, "002");
    assert.equal(output[0].__备注, "补货待确认");
    assert.equal(
      (
        await fetch(`${url}/rows/99`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "已完成", note: "" }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${url}/rows/1`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "invalid", note: "" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${url}/rows/1`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.com",
          },
          body: JSON.stringify({ status: "已完成", note: "" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/datasets`, {
          method: "POST",
          body: "a,a\n1,2",
        })
      ).status,
      400,
    );
    assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.store.close();
  }
  try {
    const reopened = createStore(directory);
    assert.equal(reopened.get(datasetId).rows[1].stock, "0");
    assert.equal(reopened.notes(datasetId)["2"].note, "补货待确认");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
