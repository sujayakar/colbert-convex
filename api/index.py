from flask import Flask, request, jsonify
from fastembed import LateInteractionTextEmbedding

app = Flask(__name__)

embedding_model = LateInteractionTextEmbedding('answerdotai/answerai-colbert-small-v1')

@app.route("/api/embed_documents", methods=['POST'])
def embed_documents():
    # Get JSON payload from request
    request_data = request.get_json()
    documents_dict = request_data.get('documents', {})
    
    # Extract text strings while keeping track of IDs
    texts = []
    id_order = []
    for doc_id, text in documents_dict.items():
        texts.append(text)
        id_order.append(doc_id)
    
    # Compute embeddings
    embeddings = embedding_model.embed(texts, parallel=0)
    
    # Create response mapping IDs to embeddings
    response = {
        doc_id: embedding.tolist() 
        for doc_id, embedding in zip(id_order, embeddings)
    }
    
    return jsonify(response)

@app.route("/api/embed_query", methods=['POST'])
def embed_query():
    request_data = request.get_json()
    query = request_data.get('query', '')
    embeddings = list(embedding_model.query_embed(query))[0]
    return jsonify(embeddings.tolist())
