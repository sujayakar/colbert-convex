import collections
from flask import Flask, request, jsonify
from fastembed import LateInteractionTextEmbedding
from llama_index.core.text_splitter import SentenceSplitter
from llama_index.core import Document

app = Flask(__name__)

embedding_model = LateInteractionTextEmbedding('answerdotai/answerai-colbert-small-v1')

chunk_size = 256
chunk_overlap = min(chunk_size / 4, min(chunk_size / 2, 64))
node_parser = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

@app.route("/api/embed_documents", methods=['POST'])
def embed_documents():
    # Get JSON payload from request
    request_data = request.get_json()
    documents_dict = request_data.get('documents', {})

    # Extract text strings while keeping track of IDs
    texts = []
    id_order = []
    for doc_id, text in documents_dict.items():        
        doc = Document(doc_id=doc_id, text=text)
        for node in node_parser.get_nodes_from_documents([doc]):        
            texts.append(node.text)
            id_order.append(doc_id)
    
    # Compute embeddings
    embeddings = embedding_model.embed(texts, parallel=0)
    
    # Create response mapping IDs to embeddings
    result = collections.defaultdict(list)
    for doc_id, text_embeddings in zip(id_order, embeddings):
        for text_embedding in text_embeddings.tolist():
            result[doc_id].append(text_embedding)

    return jsonify(result)    

@app.route("/api/embed_query", methods=['POST'])
def embed_query():
    request_data = request.get_json()
    query = request_data.get('query', '')
    embeddings = list(embedding_model.query_embed(query))[0]
    return jsonify(embeddings.tolist())
