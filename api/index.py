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

@app.route('/api/split_document', methods=['POST'])
def split_document():
    request_data = request.get_json()
    text = request_data.get('text')

    results = []
    for node in node_parser.get_nodes_from_documents([Document(doc_id='<root>', text=text)]):
        results.append({
            'text': node.text,
            'start': node.start_char_idx,
            'end': node.end_char_idx,
        })
    return jsonify(results)

@app.route("/api/embed_document", methods=['POST'])
def embed_document():
    # Get JSON payload from request
    request_data = request.get_json()
    document = request_data.get('document')
    if not document or not isinstance(document, str):
        raise ValueError('Invalid document')

    embeddings = list(embedding_model.embed([document]))[0].tolist()
    encoding = embedding_model.model.tokenize([document])[0]
    offsets = list(encoding.offsets)

    # See `colbert.py:_preprocess_onnx_input`: we insert a special marker token at offset 1.
    assert len(offsets) + 1 == len(embeddings), f"Offsets length {len(encoding.offsets)} does not match embeddings length {len(embeddings)}"
    offsets.insert(1, [0, 0])
    result = []
    for embedding, offsets in zip(embeddings, offsets):        
        result.append({
            'embedding': embedding,
            'start': offsets[0],
            'end': offsets[1],
        })

    return jsonify(result)    

@app.route("/api/embed_query", methods=['POST'])
def embed_query():
    request_data = request.get_json()
    query = request_data.get('query', '')
    embeddings = list(embedding_model.query_embed(query))[0].tolist()
    encoding = embedding_model.model.tokenize([query], is_doc=False)[0]
    offsets = list(encoding.offsets)
    assert len(offsets) + 1 == len(embeddings), f"Offsets length {len(encoding.offsets)} does not match embeddings length {len(embeddings)}"
    offsets.insert(1, [0, 0])
    result = []
    for embedding, offsets in zip(embeddings, offsets):
        result.append({
            'embedding': embedding,
            'offsets': list(offsets),
        })
    return jsonify(result)
