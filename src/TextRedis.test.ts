import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextRedis from "./TextRedis.ts";

const metadata = {
    mimetype: "text/x-redis-cli",
    glyph: "🔴",
    extensions: [".redis", ".rdb"] as const,
};

describe("TextRedis — instantiation", () => {
    it("instantiates with metadata", () => {
        const h = new TextRedis(metadata);
        assert.equal(h.mimetype, "text/x-redis-cli");
        assert.equal(h.glyph, "🔴");
    });
});

describe("TextRedis — extract", () => {
    it("extracts keys from SET commands", () => {
        const h = new TextRedis(metadata);
        const src = [
            "SET counter 0",
            "SET greeting hello",
        ].join("\n");
        const syms = h.extractRaw(src);
        const c = syms.find((s) => s.name === "counter");
        assert.ok(c);
        assert.equal(c.kind, "field");
        assert.ok(syms.find((s) => s.name === "greeting"));
    });

    it("extracts keys from HSET (hash) commands", () => {
        const h = new TextRedis(metadata);
        const src = "HSET config theme dark";
        const syms = h.extractRaw(src);
        assert.ok(syms.find((s) => s.name === "config"));
    });

    it("extracts keys from LPUSH/RPUSH (list) commands", () => {
        const h = new TextRedis(metadata);
        const src = [
            "LPUSH queue alice",
            "RPUSH queue bob",
        ].join("\n");
        const syms = h.extractRaw(src);
        assert.ok(syms.find((s) => s.name === "queue"));
    });

    it("extracts keys from SADD (set) commands", () => {
        const h = new TextRedis(metadata);
        const src = "SADD tags red green blue";
        const syms = h.extractRaw(src);
        assert.ok(syms.find((s) => s.name === "tags"));
    });

    it("extracts keys from read-only commands too (GET, etc.)", () => {
        const h = new TextRedis(metadata);
        const src = [
            "SET answer 42",
            "GET answer",
        ].join("\n");
        const syms = h.extractRaw(src);
        const answers = syms.filter((s) => s.name === "answer");
        assert.equal(answers.length, 1, "deduped across SET + GET");
    });

    it("dedupes the same key across many commands", () => {
        const h = new TextRedis(metadata);
        const src = [
            "SET visits 0",
            "INCR visits",
            "INCR visits",
            "GET visits",
        ].join("\n");
        const syms = h.extractRaw(src);
        const v = syms.filter((s) => s.name === "visits");
        assert.equal(v.length, 1);
    });

    it("returns empty array for empty input", () => {
        const h = new TextRedis(metadata);
        assert.deepEqual(h.extractRaw(""), []);
    });

    it("does not throw on malformed source", () => {
        const h = new TextRedis(metadata);
        assert.doesNotThrow(() => h.extractRaw("@@ bogus"));
        assert.doesNotThrow(() => h.extractRaw("SET"));
    });
});

describe("TextRedis — framework integration", () => {
    it("renders extracted hierarchy via format()", () => {
        const h = new TextRedis(metadata);
        const out = h.symbolsRaw("SET answer 42");
        assert.ok(out.includes("field answer"));
    });

    it("inherits jsonpath query against the symbol outline", async () => {
        const h = new TextRedis(metadata);
        const src = "SET counter 0";
        const c = await h.query(src, "jsonpath", "$.counter");
        assert.equal(c.length, 1);
    });
});

// Real-world smoke against a representative Redis CLI session — caching
// + counters + leaderboard, the canonical Redis use cases in CI/dev.
describe("TextRedis — real-world smoke (cache + counters + leaderboard)", () => {
    const SRC = [
        "SET cache:user:1 alice",
        "SET cache:user:2 bob",
        "SET cache:user:3 charlie",
        "EXPIRE cache:user:1 3600",
        "",
        "INCR counter:visits",
        "INCR counter:errors",
        "",
        "ZADD leaderboard 100 alice",
        "ZADD leaderboard 200 bob",
        "ZADD leaderboard 150 charlie",
        "",
        "HSET session:abc user_id 1",
        "HSET session:abc role admin",
        "",
        "SADD active_users alice bob charlie",
        "",
        "LPUSH job_queue task1",
        "RPUSH job_queue task2",
    ].join("\n");

    it("surfaces all unique keys touched in the script", () => {
        const h = new TextRedis(metadata);
        const syms = h.extractRaw(SRC);
        const names = new Set(syms.map((s) => s.name));

        assert.ok(names.has("cache:user:1"));
        assert.ok(names.has("cache:user:2"));
        assert.ok(names.has("cache:user:3"));
        assert.ok(names.has("counter:visits"));
        assert.ok(names.has("counter:errors"));
        assert.ok(names.has("leaderboard"));
        assert.ok(names.has("session:abc"));
        assert.ok(names.has("active_users"));
        assert.ok(names.has("job_queue"));
    });

    it("dedupes leaderboard, session:abc, job_queue (multiple ops each)", () => {
        const h = new TextRedis(metadata);
        const syms = h.extractRaw(SRC);
        const lb = syms.filter((s) => s.name === "leaderboard");
        assert.equal(lb.length, 1);
        const sess = syms.filter((s) => s.name === "session:abc");
        assert.equal(sess.length, 1);
        const jq = syms.filter((s) => s.name === "job_queue");
        assert.equal(jq.length, 1);
    });
});
