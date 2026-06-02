import { AntlrExtractor, withExtractor } from "@plurnk/plurnk-mimetypes";
import type { ExtractionVisitor } from "@plurnk/plurnk-mimetypes";
import { CharStream, CommonTokenStream } from "antlr4ng";
import { RedisLexer } from "./generated/RedisLexer.ts";
import { RedisParser } from "./generated/RedisParser.ts";
import { RedisParserVisitor } from "./generated/RedisParserVisitor.ts";

// text/x-redis-cli handler. ANTLR grammar from grammars-v4/redis.
//
// Parser entry rule: root → commands? EOF
//
// Redis CLI scripts are imperative command sequences, not declarative
// source files. There is no traditional "declaration" surface. What's
// most useful for outline reasoning is the set of KEYS the script
// touches — every command operates on a key, and the union of touched
// keys gives the agent a sense of what state the session manages.
//
// We extract unique keys by walking the parse tree for any context whose
// class name ends in "KeyNameContext" (string/list/set/sortedSet/hash/
// stream/etc.) and surface each as a field, deduped by name.
export default class TextRedis extends AntlrExtractor {
    protected parseTree(content: string): unknown {
        const lexer = new RedisLexer(CharStream.fromString(content));
        const tokens = new CommonTokenStream(lexer);
        const parser = new RedisParser(tokens);
        parser.removeErrorListeners();
        return parser.root();
    }

    protected createVisitor(): ExtractionVisitor {
        return new TextRedisVisitor() as unknown as ExtractionVisitor;
    }
}

class TextRedisVisitor extends withExtractor(RedisParserVisitor) {
    #emittedKeys = new Set<string>();

    visitCommand = (ctx: any): null => {
        if (this.inBody) return null;
        // Walk this command's subtree for any *KeyNameContext nodes.
        const keys = findKeyNames(ctx);
        for (const k of keys) {
            const text = (k as { getText?: () => string }).getText?.();
            if (!text) continue;
            const name = unquote(text);
            if (this.#emittedKeys.has(name)) continue;
            this.#emittedKeys.add(name);
            this.addSymbol("field", name, k as any);
        }
        return null;
    };
}

// Walk a subtree DFS, collecting every context whose class name ends with
// "KeyNameContext". The grammar has many shapes (StringKeyNameContext,
// HashKeyNameContext, ListKeyNameContext, etc.) — matching on suffix
// covers all variants.
function findKeyNames(root: unknown): unknown[] {
    const out: unknown[] = [];
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const node = stack.pop() as {
            constructor?: { name?: string };
            getChildCount?: () => number;
            getChild?: (i: number) => unknown;
        };
        if (!node) continue;
        const className = node.constructor?.name ?? "";
        if (className.endsWith("KeyNameContext")) out.push(node);
        const count = node.getChildCount?.() ?? 0;
        for (let i = 0; i < count; i += 1) stack.push(node.getChild?.(i));
    }
    return out;
}

function unquote(s: string): string {
    if (s.length >= 2) {
        const first = s[0];
        const last = s[s.length - 1];
        if (first === '"' && last === '"') return s.slice(1, -1);
        if (first === "'" && last === "'") return s.slice(1, -1);
    }
    return s;
}
