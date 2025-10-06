#!/bin/bash

echo "🚀 Setting up Local RAG Chatbot..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Python dependencies for embeddings
echo "🐍 Installing Python dependencies..."
pip3 install -r "C:\Users\Kamil Czyżewski\Desktop\Projects\EVENT\chatbot\local-rag-chatbot\requirements.txt"

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama not found. Please install from https://ollama.ai/"
    echo "   Run: curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

# Pull required models
echo "🤖 Pulling required Ollama models..."
ollama pull llama3.2:3b
ollama pull mxbai-embed-large

echo "✅ Setup complete!"
echo "🏃 To start the server:"
echo "   npm start"
echo ""
echo "🌐 Then open: http://localhost:3000"
