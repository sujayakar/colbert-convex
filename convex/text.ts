import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api"
import { Id } from "./_generated/dataModel";

if (!process.env.EMBEDDING_API_URL) {
    throw new Error("EMBEDDING_API_URL is not set");
}

export const insert = mutation({
    args: {
        text: v.string(),
        title: v.string(),
        artist: v.string(),
        year: v.string(),
        views: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("texts", {
            text: args.text,
            title: args.title,
            artist: args.artist,
            year: args.year,
            views: args.views,
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
            await ctx.db.delete(embedding.embeddingId);
            await ctx.db.delete(embedding._id);
        }
    },
});

export const indexTexts = action({
    args: {
        maxDocs: v.number(),
        timeoutSeconds: v.number(),
    },
    handler: async (ctx, args) => {
        const deadline = Date.now() + args.timeoutSeconds * 1000;
        let cursor = Number.MIN_VALUE;
        while (Date.now() < deadline) {
            const texts = await ctx.runQuery(internal.text.loadUnindexedTexts, { cursor, maxDocs: args.maxDocs });
            if (texts.length === 0) {
                return;
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
                for (let i = 0; i < embeddings.length; i += 16) {
                    const batch = embeddings.slice(i, i + 16);
                    await ctx.runMutation(internal.text.appendEmbeddings, {
                        textId: textId as Id<"texts">,
                        embeddings: batch,
                    });
                }
                await ctx.runMutation(internal.text.finishEmbeddings, {
                    textId: textId as Id<"texts">,
                });
            }
            cursor = texts[texts.length - 1]._creationTime;
        }
        await ctx.scheduler.runAfter(0, api.text.indexTexts, {
            maxDocs: args.maxDocs,
            timeoutSeconds: args.timeoutSeconds,
        });
    },    
});

export const appendEmbeddings = internalMutation({
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
            const embeddingId = await ctx.db.insert("embeddings", {
                embedding,
            });
            await ctx.db.insert("textEmbeddings", {
                textId: args.textId,
                embeddingId,
            });            
        }        
    },
});

export const finishEmbeddings = internalMutation({
    args: {
        textId: v.id("texts"),
    },
    handler: async (ctx, args) => {
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

        stage1Limit: v.optional(v.number()),
        stage2Limit: v.optional(v.number()),
        stage3Limit: v.optional(v.number()),
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
        const queryEmbeddings = (await response.json()) as number[][];
        console.log(`Received ${queryEmbeddings.length} query embeddings`);
        console.timeEnd("embed_query");
        
        // Step 1: Take the 256 best results for each query word and approximate
        // the MaxSim by merging the results, grouping by document, and then taking
        // the max score for each query term. 
        console.time("vector_search");
        let queryResults: { _id: Id<"embeddings">, _score: number, queryIndex: number }[] = [];
        for (let i = 0; i < queryEmbeddings.length; i++) {                        
            const embedding = queryEmbeddings[i];
            const results = await ctx.vectorSearch("embeddings", "embeddingVectorIndex", {
                vector: embedding,
                limit: 256,
            });            
            for (const result of results) {
                queryResults.push({
                    _id: result._id,
                    _score: result._score,
                    queryIndex: i,
                });
            }                        
        }                
        // Merge the results and take the top 1000.
        queryResults.sort((a, b) => b._score - a._score);
        console.log(`Found ${queryResults.length} candidates`);
        queryResults = queryResults.slice(0, args.stage1Limit ?? 1000);        
        console.timeEnd("vector_search");

        // Step 2: Load the text ids, approximate MaxSim and take the top 50 results.
        console.time("load_text_ids");
        const textIds = await ctx.runQuery(internal.text.loadTextIds, {
            queryResults,
            maxResults: args.stage2Limit ?? 50,
        });
        console.timeEnd("load_text_ids");

        // Step 2: Do full MaxSim and rerank for the top 50 results.
        console.time("load_embeddings");
        const allTextEmbeddings: Map<Id<"texts">, number[][]> = new Map();
        for (const { textId } of textIds) {
            let minEmbeddingId: Id<"embeddings"> | undefined;
            let result = [];
            for (;;) {
                const embeddings = await ctx.runQuery(internal.text.loadEmbeddings, {
                    textId,
                    minEmbeddingId,
                    maxResults: 16,
                });
                result.push(...embeddings.map((e) => e.embedding));
                if (embeddings.length < 16) {
                    break;
                }
                minEmbeddingId = embeddings[embeddings.length - 1]._id;
            }                        
            allTextEmbeddings.set(textId, result);
        }
        console.timeEnd("load_embeddings");

        console.time("rerank");
        const rerankedScores: { textId: Id<"texts">, score: number }[] = [];
        for (const [textId, textEmbeddings] of allTextEmbeddings.entries()) {
            let score = 0;
            for (const queryEmbedding of queryEmbeddings) {
                let bestMatch: null | number = null;
                for (const textEmbedding of textEmbeddings) {
                    const distance = cosineDistance(queryEmbedding, textEmbedding);
                    if (isNaN(distance)) {
                        continue;
                    }                
                    if (bestMatch === null) {
                        bestMatch = distance;
                    } else {
                        bestMatch = Math.max(bestMatch, distance);
                    }
                }
                if (bestMatch === null) {
                    continue;
                }
                score += bestMatch;
            }
            rerankedScores.push({
                textId,
                score,
            });
        }
        rerankedScores.sort((a, b) => b.score - a.score);        
        // Take the top 10 results.
        const matches = rerankedScores.slice(0, args.stage3Limit ?? 10);
        console.timeEnd("rerank");

        console.time("load_texts");
        const texts: { _id: Id<"texts">, text: string, score: number }[] = await ctx.runQuery(internal.text.loadTexts, {
            textIds: matches,
        });
        console.timeEnd("load_texts");

        return texts;
    },
});

export const loadTextIds = internalQuery({
    args: {
        queryResults: v.array(v.object({
            _id: v.id("embeddings"),
            _score: v.number(),
            queryIndex: v.number(),
        })),
        maxResults: v.number(),
    },
    handler: async (ctx, args) => {
        const maxScores = new Map<Id<"texts">, Map<number, number>>();
        for (let i = 0; i < args.queryResults.length; i += 16) {
            const batch = args.queryResults.slice(i, i + 16);
            const textEmbeddings = await Promise.all(batch.map((r) => ctx.db.query("textEmbeddings").withIndex("byEmbeddingId", (q) => q.eq("embeddingId", r._id)).unique()));
            for (let j = 0; j < batch.length; j++) {
                const textEmbedding = textEmbeddings[j];
                if (!textEmbedding) {
                    throw new Error(`Text embedding ${batch[j]._id} not found`);
                }
                const score = batch[j]._score;
                const queryIndex = batch[j].queryIndex;
                const scores = maxScores.get(textEmbedding.textId) ?? new Map<number, number>();
                scores.set(queryIndex, Math.max(scores.get(queryIndex) ?? Number.MIN_VALUE, score));
                maxScores.set(textEmbedding.textId, scores);
            }
        }
        const scoresByDocument = [];
        for (const [textId, scores] of maxScores.entries()) {
            const sum = [...scores.values()].reduce((a, b) => a + b, 0);
            scoresByDocument.push({
                textId,
                score: sum,
            });
        }
        scoresByDocument.sort((a, b) => b.score - a.score);
        return scoresByDocument.slice(0, args.maxResults);        
    },
});

export const loadEmbeddings = internalQuery({
    args: {
        textId: v.id("texts"),
        minEmbeddingId: v.optional(v.id("embeddings")),
        maxResults: v.number(),
    },
    handler: async (ctx, args) => {
        const embeddings = await ctx.db.query("textEmbeddings")
            .withIndex("byTextId", (q) => {
                const withTextId = q.eq("textId", args.textId);
                if (args.minEmbeddingId) {
                    return withTextId.gt("embeddingId", args.minEmbeddingId);
                } else {
                    return withTextId;
                }
            })
            .take(args.maxResults);            
        const results = [];
        const batchEmbeddings = await Promise.all(embeddings.map((e) => ctx.db.get(e.embeddingId)));
        for (const embedding of batchEmbeddings) {
            if (!embedding) {
                throw new Error(`Embedding not found`);
            }
            results.push(embedding);
        }
        return results;
    },
});

export const loadTexts = internalQuery({
    args: {
        textIds: v.array(v.object({
            textId: v.id("texts"),
            score: v.number(),
        })),
    },
    returns: v.array(v.object({
        _id: v.id("texts"),
        text: v.string(),
        score: v.number(),
    })),
    handler: async (ctx, args) => {
        return await Promise.all(args.textIds.map(async (match) => {
            const r = await ctx.db.get(match.textId);
            if (!r) {
                throw new Error(`Text ${match.textId} not found`);
            }
            return {               
                _id: r._id,
                text: r.text, 
                score: match.score,
            };
        }));
    },
}); 

function cosineDistance(a: number[], b: number[]) {
    let dotProduct = 0;
    let aMagnitude = 0;
    let bMagnitude = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        aMagnitude += a[i] * a[i];
        bMagnitude += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}