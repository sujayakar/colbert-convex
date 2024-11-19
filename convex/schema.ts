import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  texts: defineTable({
    text: v.string(),    
    indexed: v.boolean(),
  }).index("byIndexed", ["indexed"]),

  textEmbeddings: defineTable({
    textId: v.id("texts"),
    embedding: v.array(v.number()),
  }).vectorIndex("textEmbeddingVectorIndex", { vectorField: "embedding", dimensions: 96 }).index("byTextId", ["textId"]),  
});
