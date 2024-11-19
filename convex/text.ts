import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api"
import { Id } from "./_generated/dataModel";

if (!process.env.EMBEDDING_API_URL) {
    throw new Error("EMBEDDING_API_URL is not set");
}

export const insert = mutation({
    args: {
        text: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("texts", {
            text: args.text,
            indexed: false,
        });
    },
});

export const deleteText = mutation({
    args: {
        textId: v.id("texts"),
    },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.textId);
        const embeddings = await ctx.db.query("textEmbeddings")
            .withIndex("byTextId", (q) => q.eq("textId", args.textId))
            .collect();
        for (const embedding of embeddings) {
            await ctx.db.delete(embedding._id);
        }
    },
});

export const indexTexts = action({
    args: {
        maxDocs: v.number(),
    },
    handler: async (ctx, args) => {
        let cursor = Number.MIN_VALUE;
        while (true) {
            const texts = await ctx.runQuery(internal.text.loadUnindexedTexts, { cursor, maxDocs: args.maxDocs });
            if (texts.length === 0) {
                break;
            }
            const url = new URL(process.env.EMBEDDING_API_URL!);
            url.pathname = "/api/embed_documents";
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    documents: Object.fromEntries(
                        texts.map(text => [text._id, text.text])
                    ) 
                }),
            });
            if (!response.ok) {
                throw new Error(`Failed to get embeddings: ${response.statusText}`);
            }
            const results = (await response.json()) as Record<Id<"texts">, number[][]>;   
            for (const [textId, embeddings] of Object.entries(results)) {
                await ctx.runMutation(internal.text.insertEmbeddings, {
                    textId: textId as Id<"texts">,
                    embeddings,
                });
            }
            cursor = texts[texts.length - 1]._creationTime;
        }
    },
});

export const insertEmbeddings = internalMutation({
    args: {
        textId: v.id("texts"),
        embeddings: v.array(v.array(v.number())),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.textId);
        if (!existing) {
            throw new Error(`Text ${args.textId} not found`);
        }
        if (existing.indexed) {
            return;
        }
        for (const embedding of args.embeddings) {
            await ctx.db.insert("textEmbeddings", {
                textId: args.textId,
                embedding: embedding,
            });            
        }
        await ctx.db.patch(args.textId, {
            indexed: true,
        });
    },
});

export const loadUnindexedTexts = internalQuery({
    args: {
        cursor: v.number(),
        maxDocs: v.number(),
    },
    handler: async (ctx, args) => {
        const query = await ctx.db.query("texts")
            .withIndex("byIndexed", (q) => q.eq("indexed", false).gt("_creationTime", args.cursor))
            .take(args.maxDocs);
        return query;
    },
});

export const runQuery = action({
    args: {
        query: v.string(),
    },
    handler: async (ctx, args) => {
        console.time("embed_query");
        const url = new URL(process.env.EMBEDDING_API_URL!);
        url.pathname = "/api/embed_query";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: args.query }),
        });
        if (!response.ok) {
            throw new Error(`Failed to get embeddings: ${response.statusText}`);
        }
        const embeddings = (await response.json()) as number[][];
        console.log(`Received ${embeddings.length} query embeddings`);
        console.timeEnd("embed_query");

        const scorePromises: Promise<Record<Id<"texts">, number>>[] = [];
        for (const embedding of embeddings) {                        
            const results = await ctx.vectorSearch("textEmbeddings", "textEmbeddingVectorIndex", {
                vector: embedding,
                limit: 256,
            });            
            scorePromises.push(ctx.runQuery(internal.text.processQueryResults, {
                results,
            }));            
        }        
        const scores: Record<Id<"texts">, number>[] = await Promise.all(scorePromises);


        const allTextIds = new Set<Id<"texts">>();
        for (const score of scores) {
            for (const textId of Object.keys(score)) {
                allTextIds.add(textId as Id<"texts">);
            }
        }
        const mergedScores: Record<Id<"texts">, number> = {};
        for (const textId of allTextIds) {            
            for (let i = 0; i < scores.length; i++) {
                const score = scores[i][textId];
                if (!score) {
                    continue;
                }
                mergedScores[textId] = (mergedScores[textId] ?? 0) + score;                
            }
        }
        const sortedScores = Object.entries(mergedScores).sort((a, b) => b[1] - a[1]);
        return sortedScores;
    },
});


export const processQueryResults = internalQuery({
    args: {
        results: v.array(v.object({
            _id: v.id("textEmbeddings"),
            _score: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        const results: Record<Id<"texts">, number> = {};
        for (const result of args.results) {
            const embedding = await ctx.db.get(result._id);
            if (!embedding) {
                throw new Error(`Embedding ${result._id} not found`);
            }
            const textId = embedding.textId;
            if (results[textId] && result._score < results[textId]) {
                continue;
            }            
            results[textId] = result._score;             
        }
        return results;        
    },
});