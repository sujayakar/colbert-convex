import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api"
import { Id } from "./_generated/dataModel";

if (!process.env.EMBEDDING_API_URL) {
    throw new Error("EMBEDDING_API_URL is not set");
}

// export const runQuery = action({
//     args: {
//         query: v.string(),

//         stage1Limit: v.optional(v.number()),
//         stage2Limit: v.optional(v.number()),
//         stage3Limit: v.optional(v.number()),
//     },
//     handler: async (ctx, args) => {
//         console.time("embed_query");
//         const url = new URL(process.env.EMBEDDING_API_URL!);
//         url.pathname = "/api/embed_query";
//         const response = await fetch(url, {
//             method: "POST",
//             headers: {
//                 "Content-Type": "application/json",
//             },
//             body: JSON.stringify({ query: args.query }),
//         });
//         if (!response.ok) {
//             throw new Error(`Failed to get embeddings: ${response.statusText}`);
//         }
//         const queryEmbeddings = (await response.json()) as { embedding: number[], offsets: number[] }[];
//         console.log(`Received ${queryEmbeddings.length} query embeddings`);
//         console.timeEnd("embed_query");
        
//         // Step 1: Take the 256 best results for each query word and approximate
//         // the MaxSim by merging the results, grouping by document, and then taking
//         // the max score for each query term. 
//         console.time("vector_search");
//         let queryResults: { _id: Id<"embeddings">, _score: number, queryIndex: number }[] = [];
//         for (let i = 0; i < queryEmbeddings.length; i++) {                        
//             const embedding = queryEmbeddings[i];                    
//             const results = await ctx.vectorSearch("embeddings", "embeddingVectorIndex", {
//                 vector: embedding.embedding,
//                 limit: 256,
//             });            
//             for (const result of results) {
//                 queryResults.push({
//                     _id: result._id,
//                     _score: result._score,
//                     queryIndex: i,
//                 });
//             }                        
//         }                
//         // Merge the results and take the top 1000.
//         queryResults.sort((a, b) => b._score - a._score);
//         console.log(`Found ${queryResults.length} candidates`);
//         queryResults = queryResults.slice(0, args.stage1Limit ?? 1000);        
//         console.timeEnd("vector_search");

//         // Step 2: Load the text ids, approximate MaxSim and take the top 50 results.
//         console.time("load_text_ids");
//         const textIds = await ctx.runQuery(internal.text.loadTextIds, {
//             queryResults,
//             maxResults: args.stage2Limit ?? 50,
//         });
//         console.timeEnd("load_text_ids");

//         // Step 2: Do full MaxSim and rerank for the top 50 results.
//         console.time("load_embeddings");
//         const allTextEmbeddings: Map<Id<"texts">, { _id: Id<"embeddings">, embedding: number[], position: { start: number, end: number } }[]> = new Map();
//         for (const { textId } of textIds) {
//             let minEmbeddingId: Id<"embeddings"> | undefined;
//             let result = [];
//             for (;;) {
//                 const embeddings = await ctx.runQuery(internal.text.loadEmbeddings, {
//                     textId,
//                     minEmbeddingId,
//                     maxResults: 16,
//                 });
//                 result.push(...embeddings);
//                 if (embeddings.length < 16) {
//                     break;
//                 }
//                 minEmbeddingId = embeddings[embeddings.length - 1]._id;
//             }                        
//             allTextEmbeddings.set(textId, result);
//         }
//         console.timeEnd("load_embeddings");

//         console.time("rerank");
//         const rerankedScores: { textId: Id<"texts">, score: number, heatMap: Record<string, number> }[] = [];
//         for (const [textId, textEmbeddings] of allTextEmbeddings.entries()) {
//             let score = 0;
//             const heatMap: Record<string, number> = {};
//             let i = -1;
//             for (const queryEmbedding of queryEmbeddings) {                
//                 i += 1;
//                 let bestMatch: null | number = null;
//                 for (const textEmbedding of textEmbeddings) {
//                     const distance = cosineDistance(queryEmbedding.embedding, textEmbedding.embedding);
//                     if (isNaN(distance)) {
//                         continue;
//                     }                
//                     if (bestMatch === null) {
//                         bestMatch = distance;
//                     } else {
//                         bestMatch = Math.max(bestMatch, distance);
//                     }
//                     const [start, end] = queryEmbedding.offsets;                                    
//                     if (start < end && textEmbedding.position.start < textEmbedding.position.end) {
//                         const key = `${start}:${end}:${textEmbedding.position.start}:${textEmbedding.position.end}`;
//                         heatMap[key] = Math.max(heatMap[key] ?? Number.MIN_VALUE, distance);
//                     }
//                 }
//                 if (bestMatch === null) {
//                     continue;
//                 }
//                 score += bestMatch;
//             }
//             rerankedScores.push({
//                 textId,
//                 score,
//                 heatMap,
//             });
//         }
//         rerankedScores.sort((a, b) => b.score - a.score);        
//         // Take the top 10 results.
//         const matches = rerankedScores.slice(0, args.stage3Limit ?? 10);
//         console.timeEnd("rerank");

//         console.time("load_texts");
//         const texts: { _id: Id<"texts">, text: string, score: number, heatMap: Record<string, number> }[] = await ctx.runQuery(internal.text.loadTexts, {
//             textIds: matches,
//         });
//         console.timeEnd("load_texts");

//         return texts;
//     },
// });

// export const loadTextIds = internalQuery({
//     args: {
//         queryResults: v.array(v.object({
//             _id: v.id("embeddings"),
//             _score: v.number(),
//             queryIndex: v.number(),
//         })),
//         maxResults: v.number(),
//     },
//     handler: async (ctx, args) => {
//         const maxScores = new Map<Id<"texts">, Map<number, number>>();
//         for (let i = 0; i < args.queryResults.length; i += 16) {
//             const batch = args.queryResults.slice(i, i + 16);
//             const textEmbeddings = await Promise.all(batch.map((r) => ctx.db.query("textEmbeddings").withIndex("byEmbeddingId", (q) => q.eq("embeddingId", r._id)).unique()));
//             for (let j = 0; j < batch.length; j++) {
//                 const textEmbedding = textEmbeddings[j];
//                 if (!textEmbedding) {
//                     throw new Error(`Text embedding ${batch[j]._id} not found`);
//                 }
//                 const score = batch[j]._score;
//                 const queryIndex = batch[j].queryIndex;
//                 const scores = maxScores.get(textEmbedding.textId) ?? new Map<number, number>();
//                 scores.set(queryIndex, Math.max(scores.get(queryIndex) ?? Number.MIN_VALUE, score));
//                 maxScores.set(textEmbedding.textId, scores);
//             }
//         }
//         const scoresByDocument = [];
//         for (const [textId, scores] of maxScores.entries()) {
//             const sum = [...scores.values()].reduce((a, b) => a + b, 0);
//             scoresByDocument.push({
//                 textId,
//                 score: sum,
//             });
//         }
//         scoresByDocument.sort((a, b) => b.score - a.score);
//         return scoresByDocument.slice(0, args.maxResults);        
//     },
// });

// export const loadEmbeddings = internalQuery({
//     args: {
//         textId: v.id("texts"),
//         minEmbeddingId: v.optional(v.id("embeddings")),
//         maxResults: v.number(),
//     },
//     handler: async (ctx, args) => {
//         const embeddings = await ctx.db.query("textEmbeddings")
//             .withIndex("byTextId", (q) => {
//                 const withTextId = q.eq("textId", args.textId);
//                 if (args.minEmbeddingId) {
//                     return withTextId.gt("embeddingId", args.minEmbeddingId);
//                 } else {
//                     return withTextId;
//                 }
//             })
//             .take(args.maxResults);            
//         const results = [];
//         const batchEmbeddings = await Promise.all(embeddings.map((e) => ctx.db.get(e.embeddingId)));
//         for (let i = 0; i < batchEmbeddings.length; i++) {
//             const embedding = batchEmbeddings[i];
//             if (!embedding) {
//                 throw new Error(`Embedding ${embeddings[i].embeddingId} not found`);
//             }
//             const position = embeddings[i].position;
//             results.push({
//                 _id: embedding._id,
//                 embedding: embedding.embedding,
//                 position,
//             });
//         }
//         return results;
//     },
// });

// export const loadTexts = internalQuery({
//     args: {
//         textIds: v.array(v.object({
//             textId: v.id("texts"),
//             score: v.number(),
//             heatMap: v.any(),
//         })),
//     },
//     returns: v.array(v.object({
//         _id: v.id("texts"),
//         text: v.string(),
//         score: v.number(),
//         heatMap: v.any(),
//     })),
//     handler: async (ctx, args) => {
//         return await Promise.all(args.textIds.map(async (match) => {
//             const r = await ctx.db.get(match.textId);
//             if (!r) {
//                 throw new Error(`Text ${match.textId} not found`);
//             }
//             return {               
//                 _id: r._id,
//                 text: r.text, 
//                 score: match.score,
//                 heatMap: match.heatMap,
//             };
//         }));
//     },
// }); 

// function cosineDistance(a: number[], b: number[]) {
//     let dotProduct = 0;
//     let aMagnitude = 0;
//     let bMagnitude = 0;
//     for (let i = 0; i < a.length; i++) {
//         dotProduct += a[i] * b[i];
//         aMagnitude += a[i] * a[i];
//         bMagnitude += b[i] * b[i];
//     }
//     return dotProduct / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
// }