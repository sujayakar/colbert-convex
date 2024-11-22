import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  texts: defineTable({
    title: v.string(),
    artist: v.string(),
    year: v.string(),
    text: v.string(),    
    indexed: v.boolean(),
    views: v.number(),
  }).index("byIndexed", ["indexed"]),

  textEmbeddings: defineTable({
    textId: v.id("texts"),
    embeddingId: v.id("embeddings"),
  }).index("byTextId", ["textId", "embeddingId"]).index("byEmbeddingId", ["embeddingId"]),

  embeddings: defineTable({      
    embedding: v.array(v.number()),
  }).vectorIndex("embeddingVectorIndex", { vectorField: "embedding", dimensions: 96 }),  
});
