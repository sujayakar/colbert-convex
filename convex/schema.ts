import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  songs: defineTable({
    indexed: v.boolean(),

    text: v.string(),
    title: v.string(),
    artist: v.string(),
    year: v.string(),      
    views: v.number(),
  }).index("byIndexed", ["indexed"]),

  // Songs get split into chunks with llama's sentence splitter.
  chunks: defineTable({
    songId: v.id("songs"),    
    start: v.number(),
    end: v.number(),
  }).index("bySongId", ["songId"]),
  
  // Each chunk gets an embedding per word using the ColBERT model.
  chunkEmbeddings: defineTable({
    chunkId: v.id("chunks"),
    embeddingId: v.id("embeddings"),

    // These are positions within the original text.
    start: v.number(),
    end: v.number(),    
  }).index("byChunkId", ["chunkId", "embeddingId"]).index("byEmbeddingId", ["embeddingId", "chunkId"]),

  // We deduplicate embeddings by xxhash.
  embeddings: defineTable({      
    hash: v.float64(),
    embedding: v.array(v.number()),
  }).vectorIndex("embeddingVectorIndex", { vectorField: "embedding", dimensions: 96 }).index("byHash", ["hash"]),  
});
