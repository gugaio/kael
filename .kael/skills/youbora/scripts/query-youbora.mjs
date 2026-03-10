#!/usr/bin/env node
import "dotenv/config";
import crypto from "node:crypto";

const accountCode = process.env.KAEL_YOUBORA_ACCOUNT_CODE?.trim();
const apiKey = process.env.KAEL_YOUBORA_API_KEY?.trim();
const host = process.env.KAEL_YOUBORA_HOST?.trim() || "https://api.npaw.com";

if (!accountCode || !apiKey) {
  const missing = [
    !accountCode ? "KAEL_YOUBORA_ACCOUNT_CODE" : null,
    !apiKey ? "KAEL_YOUBORA_API_KEY" : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.error(JSON.stringify({ ok: false, error: `Missing env vars: ${missing}` }, null, 2));
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          "Usage: node query-youbora.mjs <fromDate> [toDate] [metrics] [type] [granularity]",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const fromDate = args[0]?.trim();
const rawToDate = args[1]?.trim();
const metrics = args[2]?.trim() || "views";
const type = args[3]?.trim();
const granularity = args[4]?.trim();

const isRelativeFrom = /^last\d+(hours|days)$/i.test(fromDate);
const toDate = rawToDate && rawToDate.length > 0 && !isRelativeFrom ? rawToDate : undefined;

const ttlMsRaw = Number(process.env.KAEL_YOUBORA_DATE_TOKEN_TTL_MS ?? String(365 * 24 * 60 * 60 * 1000));
const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? Math.floor(ttlMsRaw) : 365 * 24 * 60 * 60 * 1000;
const expirationTime = Date.now() + ttlMs;

const params = new URLSearchParams();
params.set("fromDate", fromDate);
if (toDate) {
  params.set("toDate", toDate);
}
if (type) {
  params.set("type", type);
}
if (granularity) {
  params.set("granularity", granularity);
}
params.set("metrics", metrics);
params.set("dateToken", String(expirationTime));

const preUrl = `/data?${params.toString()}`;
const token = crypto.createHash("md5").update(`${accountCode}${preUrl}${apiKey}`, "utf8").digest("hex");
const finalUrl = `${host}${accountCode}${preUrl}&token=${token}`;

let response;
let text = "";
try {
  response = await fetch(finalUrl);
  text = await response.text();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

let parsed;
try {
  parsed = text ? JSON.parse(text) : null;
} catch {
  parsed = null;
}

const maskedToken = `${token.slice(0, 6)}...${token.slice(-4)}`;
const safeUrl = `${host}${accountCode}${preUrl}&token=${maskedToken}`;

const output = {
  ok: response.ok,
  status: response.status,
  statusText: response.statusText,
  request: {
    fromDate,
    toDate: toDate ?? null,
    metrics,
    type: type ?? null,
    granularity: granularity ?? null,
    safeUrl,
  },
  body: parsed ?? text,
};

console.log(JSON.stringify(output, null, 2));
