
const express = require('express');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const csv = require('csv-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// ============================================================================
// POWER AUTOMATE WEBHOOK CONFIGURATION  
// ============================================================================
const GET_USER_WEBHOOK_URL = process.env.GET_USER_WEBHOOK_URL || '';
const UPDATE_USER_WEBHOOK_URL = process.env.UPDATE_USER_WEBHOOK_URL || '';


// Load event data from CSV on startup
let eventData = [];

function loadEventDataFromCSV() {
    return new Promise((resolve, reject) => {
        const csvPath = 'data/EventData.csv';

        // Check if file exists
        if (!fs.existsSync(csvPath)) {
            return reject(new Error('CSV file not found - will use Power Automate only'));
        }

        const results = [];
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (data) => {
                results.push({
                    name: data.Name,
                    surname: data.Surname,
                    jobTitle: data['Job tittle'],
                    company: data.Company,
                    email: data.Email,
                    phone: data.Phone,
                    conferenceType: data['Conference/Workshop'],
                    badgePrinted: data.Badge_Printed === 'True',
                    sessions: {
                        MDM: data.MDM === '1',
                        DG: data.DG === '1',
                        'AI Agents': data['AI Agents'] === '1',
                        AIStudio: data.AIStudio === '1',
                        'Knowledge Graph': data['Knowledge Graph'] === '1',
                        Mendix: data.Mendix === '1'
                    }
                });
            })
            .on('end', () => {
                console.log(`✅ Loaded ${results.length} guests from EventData.csv`);
                resolve(results);
            })
            .on('error', reject);
    });
}

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Initialize SQLite database for document storage
const dbPath = 'data/documents.db';
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

const db = new sqlite3.Database(dbPath);
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT,
        content TEXT,
        chunks TEXT,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        chunk_text TEXT,
        embedding TEXT,
        chunk_index INTEGER,
        FOREIGN KEY(document_id) REFERENCES documents(id)
    )`);
});

// IMPROVED OLLAMA API CALLS WITH STREAMING SUPPORT
async function callOllama(endpoint, data) {
    const fetch = (await import('node-fetch')).default;
    try {
        const response = await fetch(`http://localhost:11434/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const text = await response.text();

        // Handle streaming responses
        if (text.includes('\n')) {
            const lines = text.trim().split('\n').filter(line => line.trim());
            const lastLine = lines[lines.length - 1];
            return JSON.parse(lastLine);
        } else {
            return JSON.parse(text);
        }
    } catch (error) {
        console.error('Ollama API error:', error);
        throw error;
    }
}

// TOPIC EXTRACTION FOR SEMANTIC CHUNKING
function extractTopics(text) {
    const topicKeywords = {
        'speakers': ['speaker', 'presenter', 'talk', 'presentation', 'prelegent', 'wykład', 'prezentacja'],
        'schedule': ['time', 'agenda', 'program', 'when', 'czas', 'harmonogram', 'kiedy', 'godzina'],
        'location': ['where', 'venue', 'address', 'place', 'gdzie', 'miejsce', 'adres', 'lokalizacja', 'browary'],
        'registration': ['register', 'badge', 'check-in', 'rejestracja', 'identyfikator', 'odbiór'],
        'workshops': ['workshop', 'training', 'warsztat', 'szkolenie', 'warsztaty'],
        'networking': ['networking', 'cocktail', 'break', 'przerwa', 'spotkanie', 'koktajl']
    };

    const lowerText = text.toLowerCase();
    const foundTopics = [];

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
        const score = keywords.reduce((count, keyword) => {
            return count + (lowerText.includes(keyword) ? 1 : 0);
        }, 0);

        if (score > 0) {
            foundTopics.push({ topic, score });
        }
    }

    return foundTopics
        .sort((a, b) => b.score - a.score)
        .map(item => item.topic);
}

// ADVANCED SEMANTIC CHUNKING
function semanticChunkText(text, maxChunkSize = 800, overlap = 150) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const chunks = [];
    let currentChunk = '';
    let currentTopic = '';

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();

        // Detect topics based on keywords
        const topics = extractTopics(sentence);
        const newTopic = topics[0] || 'general';

        // Start new chunk if topic changes significantly or size limit reached
        const shouldSplit = (newTopic !== currentTopic && currentChunk.length > 200) || 
                           (currentChunk.length + sentence.length > maxChunkSize);

        if (shouldSplit && currentChunk.trim()) {
            chunks.push({
                text: currentChunk.trim(),
                topic: currentTopic,
                position: chunks.length,
                length: currentChunk.length
            });

            // Create overlap from previous chunk
            const words = currentChunk.split(' ');
            const overlapWords = Math.min(Math.floor(overlap / 10), words.length);
            currentChunk = words.slice(-overlapWords).join(' ') + ' ' + sentence;
            currentTopic = newTopic;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
            if (!currentTopic) currentTopic = newTopic;
        }
    }

    // Add final chunk
    if (currentChunk.trim()) {
        chunks.push({
            text: currentChunk.trim(),
            topic: currentTopic,
            position: chunks.length,
            length: currentChunk.length
        });
    }

    console.log(`📊 Semantic chunking: ${chunks.length} chunks, topics: ${[...new Set(chunks.map(c => c.topic))].join(', ')}`);
    return chunks.map(chunk => chunk.text); // Return text array for compatibility
}

// Generate embeddings using Ollama
async function generateEmbeddings(textChunks, documentId) {
    const embeddings = [];

    console.log(`🔄 Generating embeddings for ${textChunks.length} chunks...`);

    for (let i = 0; i < textChunks.length; i++) {
        try {
            const response = await callOllama('embed', {
                model: 'mxbai-embed-large',
                input: textChunks[i]
            });

            const embeddingId = uuidv4();
            embeddings.push({
                id: embeddingId,
                document_id: documentId,
                chunk_text: textChunks[i],
                embedding: JSON.stringify(response.embeddings[0]),
                chunk_index: i
            });

            // Progress indicator
            if ((i + 1) % 5 === 0) {
                console.log(`📊 Processed ${i + 1}/${textChunks.length} chunks`);
            }
        } catch (error) {
            console.error(`❌ Error generating embedding for chunk ${i}:`, error);
        }
    }

    return embeddings;
}

// Calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

// HYDE - HYPOTHETICAL DOCUMENT EMBEDDING
async function generateHyDE(query, language = 'en') {
    try {
        const hydePrompt = language === 'pl' 
            ? `Wygeneruj szczegółową, faktyczną odpowiedź na to pytanie o wydarzenie DataTalks 2025 w Browary Warszawskie: ${query}

Odpowiedz w stylu dokumentu informacyjnego, zawierając konkretne szczegóły o:
- Lokalizacji (Browary Warszawskie, ul. Grzybowska 58/60, Warszawa)
- Czasie (21-22 października 2025)  
- Prelegentach i tematach
- Agendzie i harmonogramie
- Rejestracji i identyfikatorach

Odpowiedź:`
            : `Generate a detailed, factual answer to this question about DataTalks 2025 event at Browary Warszawskie: ${query}

Answer in the style of an informational document, including specific details about:
- Location (Browary Warszawskie, ul. Grzybowska 58/60, Warsaw)
- Time (October 21-22, 2025)
- Speakers and topics  
- Agenda and schedule
- Registration and badges

Answer:`;

        console.log('🔮 Generating HyDE hypothetical document...');

        const response = await callOllama('generate', {
            model: process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b',
            prompt: hydePrompt,
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 200,
                top_p: 0.8
            }
        });

        const hypotheticalDoc = response.response;
        console.log(`✅ HyDE generated: ${hypotheticalDoc.length} chars`);
        return hypotheticalDoc;

    } catch (error) {
        console.error('❌ HyDE generation failed:', error);
        return query; // Fallback to original query
    }
}

// QUERY EXPANSION
async function expandQuery(originalQuery, language = 'en') {
    try {
        const expansionPrompt = language === 'pl' 
            ? `Rozszerz to pytanie o wydarzenie DataTalks 2025 o powiązane terminy i synonimy. Zwróć listę 3-5 powiązanych fraz oddzielonych przecinkami:

Oryginalne pytanie: ${originalQuery}

Powiązane frazy:`
            : `Expand this DataTalks 2025 event question with related terms and synonyms. Return a list of 3-5 related phrases separated by commas:

Original question: ${originalQuery}

Related phrases:`;

        console.log('🔍 Expanding query with related terms...');

        const response = await callOllama('generate', {
            model: process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b',
            prompt: expansionPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                num_predict: 80,
                top_p: 0.9
            }
        });

        const expandedText = response.response;
        const expandedQueries = [
            originalQuery,
            ...expandedText.split(/[,;\n]/)
                .map(s => s.trim())
                .filter(s => s.length > 5 && s.length < 100)
                .slice(0, 4)
        ];

        console.log(`✅ Query expanded to ${expandedQueries.length} variations`);
        return expandedQueries;

    } catch (error) {
        console.error('❌ Query expansion failed:', error);
        return [originalQuery];
    }
}

// DOCUMENT RERANKING
async function rerankDocuments(query, documents, language = 'en') {
    if (documents.length === 0) return documents;

    try {
        console.log(`📊 Reranking ${documents.length} documents...`);

        const rerankingPrompts = documents.map((doc, index) => {
            const prompt = language === 'pl' 
                ? `Oceń jak dobrze ten tekst odpowiada na pytanie "${query}".

Tekst: ${doc.chunk_text.substring(0, 400)}...

Oceń na skali 1-10 (tylko cyfra):`
                : `Rate how well this text answers the question "${query}".

Text: ${doc.chunk_text.substring(0, 400)}...

Rate 1-10 (number only):`;

            return { index, prompt, doc };
        });

        // Process reranking in batches to avoid overwhelming the model
        const batchSize = 3;
        const scores = [];

        for (let i = 0; i < rerankingPrompts.length; i += batchSize) {
            const batch = rerankingPrompts.slice(i, i + batchSize);

            const batchScores = await Promise.all(
                batch.map(async (item) => {
                    try {
                        const response = await callOllama('generate', {
                            model: process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b',
                            prompt: item.prompt,
                            stream: false,
                            options: {
                                temperature: 0.1,
                                num_predict: 5
                            }
                        });

                        const scoreText = response.response.trim();
                        const score = parseInt(scoreText.match(/\d+/)?.[0] || '5');
                        return { 
                            index: item.index, 
                            score: Math.max(1, Math.min(10, score)),
                            doc: item.doc
                        };

                    } catch (error) {
                        console.error(`Reranking error for doc ${item.index}:`, error);
                        return { index: item.index, score: 5, doc: item.doc };
                    }
                })
            );

            scores.push(...batchScores);

            // Small delay between batches
            if (i + batchSize < rerankingPrompts.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Sort by score and return documents
        const reranked = scores
            .sort((a, b) => b.score - a.score)
            .map(item => ({
                ...item.doc,
                rerank_score: item.score
            }));

        console.log(`✅ Reranking complete. Top scores: ${reranked.slice(0, 3).map(d => d.rerank_score).join(', ')}`);
        return reranked;

    } catch (error) {
        console.error('❌ Document reranking failed:', error);
        return documents; // Return original order on failure
    }
}

// BASIC SEARCH FALLBACK
async function findSimilarDocumentsBasic(query, topK = 3) {
    try {
        const queryResponse = await callOllama('embed', {
            model: 'mxbai-embed-large',
            input: query
        });

        const queryEmbedding = queryResponse.embeddings[0];

        return new Promise((resolve, reject) => {
            db.all(`SELECT e.*, d.filename FROM embeddings e 
                    JOIN documents d ON e.document_id = d.id`, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const similarities = rows.map(row => {
                    const embedding = JSON.parse(row.embedding);
                    const similarity = cosineSimilarity(queryEmbedding, embedding);
                    return { ...row, similarity: similarity };
                });

                const topResults = similarities
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, topK);

                resolve(topResults);
            });
        });
    } catch (error) {
        console.error('Basic search error:', error);
        return [];
    }
}

// ADVANCED SIMILAR DOCUMENTS WITH HYDE + EXPANSION
async function findSimilarDocuments(query, topK = 8, language = 'en') {
    try {
        console.log(`🔍 Advanced search for: "${query}"`);

        const useHyDE = process.env.RAG_USE_HYDE === 'true';
        const useExpansion = process.env.RAG_USE_QUERY_EXPANSION === 'true';

        let searchQueries = [query];
        let hydeDoc = null;

        // Step 1: Query Expansion
        if (useExpansion) {
            searchQueries = await expandQuery(query, language);
        }

        // Step 2: HyDE Generation
        if (useHyDE) {
            hydeDoc = await generateHyDE(query, language);
            searchQueries.push(hydeDoc);
        }

        console.log(`🔍 Searching with ${searchQueries.length} query variations`);

        // Step 3: Search with all query variations
        const allResults = [];

        for (const searchQuery of searchQueries) {
            try {
                // Generate embedding for this query
                const queryResponse = await callOllama('embed', {
                    model: 'mxbai-embed-large',
                    input: searchQuery
                });

                const queryEmbedding = queryResponse.embeddings[0];

                // Search database
                const results = await new Promise((resolve, reject) => {
                    db.all(`SELECT e.*, d.filename FROM embeddings e 
                            JOIN documents d ON e.document_id = d.id`, (err, rows) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (rows.length === 0) {
                            resolve([]);
                            return;
                        }

                        const similarities = rows.map(row => {
                            try {
                                const embedding = JSON.parse(row.embedding);
                                const similarity = cosineSimilarity(queryEmbedding, embedding);
                                return {
                                    ...row,
                                    similarity: similarity,
                                    query_used: searchQuery
                                };
                            } catch (e) {
                                return {
                                    ...row,
                                    similarity: 0,
                                    query_used: searchQuery
                                };
                            }
                        });

                        resolve(similarities);
                    });
                });

                allResults.push(...results);

            } catch (error) {
                console.error(`Search error for query "${searchQuery}":`, error);
            }
        }

        // Step 4: Deduplicate and merge results
        const uniqueResults = [];
        const seenIds = new Set();

        for (const result of allResults) {
            if (!seenIds.has(result.id)) {
                seenIds.add(result.id);
                uniqueResults.push(result);
            } else {
                // If we've seen this document, keep the one with higher similarity
                const existingIndex = uniqueResults.findIndex(r => r.id === result.id);
                if (existingIndex >= 0 && result.similarity > uniqueResults[existingIndex].similarity) {
                    uniqueResults[existingIndex] = result;
                }
            }
        }

        // Step 5: Initial ranking by similarity
        const similarityThreshold = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.6;
        const filteredResults = uniqueResults
            .filter(result => result.similarity >= similarityThreshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK * 2); // Get more for reranking

        console.log(`📋 Found ${filteredResults.length} documents above similarity threshold ${similarityThreshold}`);

        // Step 6: Reranking (if enabled)
        const useReranking = process.env.RAG_USE_RERANKING === 'true';
        let finalResults = filteredResults;

        if (useReranking && filteredResults.length > 0) {
            finalResults = await rerankDocuments(query, filteredResults, language);
        }

        // Return top results
        const topResults = finalResults.slice(0, topK);

        console.log(`✅ Advanced search complete: ${topResults.length} final results`);
        return topResults;

    } catch (error) {
        console.error('❌ Advanced search failed:', error);
        // Fallback to basic search
        return findSimilarDocumentsBasic(query, topK);
    }
}

// Process PDFs from uploads folder on startup
async function processPDFsFromUploads() {
    const uploadsDir = 'uploads';

    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir);
        console.log('📁 Created uploads directory');
        return;
    }

    const files = fs.readdirSync(uploadsDir).filter(file => file.toLowerCase().endsWith('.pdf'));

    if (files.length === 0) {
        console.log('📄 No PDFs found in uploads directory');
        return;
    }

    console.log(`📚 Processing ${files.length} PDFs from uploads directory...`);

    for (const filename of files) {
        try {
            const filePath = path.join(uploadsDir, filename);

            // Check if already processed
            const existing = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM documents WHERE filename = ?', [filename], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (existing) {
                console.log(`⏭️  ${filename} already processed, skipping`);
                continue;
            }

            console.log(`🔄 Processing ${filename}...`);

            const documentId = uuidv4();

            // Extract text from PDF
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);

            // Clean and chunk text using semantic chunking
            const cleanText = pdfData.text.replace(/\s+/g, ' ').trim();
            const chunks = semanticChunkText(cleanText, 800, 150);

            if (chunks.length === 0) {
                console.log(`⚠️  No text content found in ${filename}`);
                continue;
            }

            // Store document in database
            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO documents (id, filename, content, chunks) VALUES (?, ?, ?, ?)`,
                    [documentId, filename, cleanText, JSON.stringify(chunks)], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });

            // Generate and store embeddings
            const embeddings = await generateEmbeddings(chunks, documentId);

            const stmt = db.prepare(`INSERT INTO embeddings (id, document_id, chunk_text, embedding, chunk_index) VALUES (?, ?, ?, ?, ?)`);
            for (const embedding of embeddings) {
                stmt.run([embedding.id, embedding.document_id, embedding.chunk_text, embedding.embedding, embedding.chunk_index]);
            }
            stmt.finalize();

            console.log(`✅ Processed ${filename} - ${chunks.length} chunks, ${embeddings.length} embeddings`);

        } catch (error) {
            console.error(`❌ Error processing ${filename}:`, error);
        }
    }

    console.log('🎉 PDF processing complete!');
}

// ADVANCED RAG CHAT ENDPOINT
app.post('/api/chat', async (req, res) => {
    try {
        const { question, language = 'en', userContext } = req.body;

        console.log(`💬 Advanced RAG request: "${question}" (${language})`);
        const startTime = Date.now();

        // Step 1: Advanced document retrieval
        const topK = parseInt(process.env.RAG_TOP_K) || 8;
        const similarDocs = await findSimilarDocuments(question, topK, language);

        if (similarDocs.length === 0) {
            return res.json({
                success: true,
                answer: language === 'pl' 
                    ? 'Przepraszam, nie znalazłem odpowiednich informacji w dokumentach. Czy możesz zadać pytanie inaczej?'
                    : 'Sorry, I could not find relevant information in the documents. Could you rephrase your question?',
                sources: [],
                documentsUsed: 0,
                method: 'Advanced RAG - No documents found'
            });
        }

        console.log(`📋 Using ${similarDocs.length} documents for context`);

        // Step 2: Build user context
        let contextInfo = '';
        if (userContext && userContext.email) {
            const user = eventData.find(u => u.email.toLowerCase() === userContext.email.toLowerCase());
            if (user) {
                const registeredSessions = Object.entries(user.sessions)
                    .filter(([session, registered]) => registered)
                    .map(([session, _]) => session);

                contextInfo = language === 'pl' 
                    ? `Informacje o użytkowniku: ${user.name} ${user.surname} z firmy ${user.company}
Typ uczestnictwa: ${user.conferenceType}
Zarejestrowane sesje: ${registeredSessions.length > 0 ? registeredSessions.join(', ') : 'Główna konferencja'}
Status identyfikatora: ${user.badgePrinted ? 'Wydrukowany' : 'Nie wydrukowany'}`
                    : `User Information: ${user.name} ${user.surname} from ${user.company}
Conference Type: ${user.conferenceType}
Registered Sessions: ${registeredSessions.length > 0 ? registeredSessions.join(', ') : 'Main conference'}
Badge Status: ${user.badgePrinted ? 'Printed' : 'Not printed'}`;
            }
        }

        // Step 3: Build enhanced document context
        const documentContext = similarDocs.slice(0, 5).map((doc, index) => {
            const relevanceScore = (doc.similarity * 100).toFixed(1);
            const rerankScore = doc.rerank_score ? ` (Quality: ${doc.rerank_score}/10)` : '';

            return `[Source ${index + 1}] ${doc.filename} - ${relevanceScore}% match${rerankScore}:
${doc.chunk_text}`;
        }).join('\n\n---\n\n');

        // Step 4: Enhanced system prompt
        const systemPrompt = language === 'pl' 
            ? `Jesteś ekspertem AI dla wydarzenia DataTalks 2025 w Browary Warszawskie, Warszawa.

TWOJA ROLA:
- Odpowiadaj profesjonalnie i konkretnie w języku polskim
- Używaj tylko informacji z podanych źródeł
- Jeśli informacji brak w źródłach, powiedz to jasno
- Podawaj praktyczne, użyteczne odpowiedzi
- Zawsze wspominaj konkretne źródła w odpowiedzi

KONTEKST WYDARZENIA:
- Nazwa: DataTalks 2025
- Miejsce: Browary Warszawskie, ul. Grzybowska 58/60, Warszawa
- Data: 21-22 października 2025
- Poniedziałek: Konferencja (8:30-18:00)
- Wtorek: Warsztaty (kontakt z organizatorami)`
            : `You are an AI expert for the DataTalks 2025 event at Browary Warszawskie, Warsaw.

YOUR ROLE:
- Answer professionally and specifically in English
- Use only information from the provided sources
- If information is missing from sources, state this clearly
- Provide practical, actionable answers
- Always mention specific sources in your response

EVENT CONTEXT:
- Name: DataTalks 2025
- Venue: Browary Warszawskie, ul. Grzybowska 58/60, Warsaw
- Date: October 21-22, 2025
- Monday: Conference (8:30-18:00)
- Tuesday: Workshops (contact organizers)`;

        // Step 5: Build complete prompt
        const fullPrompt = `${systemPrompt}

${contextInfo ? `USER CONTEXT:\n${contextInfo}\n\n` : ''}RELEVANT SOURCES:
${documentContext}

QUESTION: ${question}

ANSWER (be specific and cite sources):`;

        // Step 6: Generate response with advanced model
        console.log('🤖 Generating advanced response...');
        const response = await callOllama('generate', {
            model: process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b',
            prompt: fullPrompt,
            stream: false,
            options: {
                temperature: 0.7,
                top_k: 40,
                top_p: 0.9,
                num_predict: 500,
                repeat_penalty: 1.1,
                stop: ['USER:', 'QUESTION:', 'SOURCES:', 'CONTEXT:']
            }
        });

        // Step 7: Process response
        const answer = response.response.trim();
        const sources = [...new Set(similarDocs.map(doc => doc.filename))];
        const avgRelevance = similarDocs.reduce((sum, doc) => sum + doc.similarity, 0) / similarDocs.length;
        const processingTime = Date.now() - startTime;

        console.log(`✅ Advanced response generated in ${processingTime}ms`);

        res.json({
            success: true,
            answer: answer,
            sources: sources,
            documentsUsed: similarDocs.length,
            relevanceScore: avgRelevance,
            method: 'Advanced RAG (HyDE + Expansion + Reranking)',
            processingTime: processingTime,
            topSimilarities: similarDocs.slice(0, 3).map(doc => ({
                filename: doc.filename,
                similarity: (doc.similarity * 100).toFixed(1) + '%',
                rerankScore: doc.rerank_score || 'N/A'
            }))
        });

    } catch (error) {
        console.error('❌ Advanced RAG chat error:', error);
        res.status(500).json({
            success: false,
            message: 'Advanced RAG processing failed. Please try again.',
            error: error.message
        });
    }
});

// Get user info - Power Automate (SharePoint) with CSV fallback
app.post('/api/user-lookup', async (req, res) => {
    const { contact } = req.body;

    // Try Power Automate first if configured
    if (GET_USER_WEBHOOK_URL && GET_USER_WEBHOOK_URL.startsWith('https://')) {
        try {
            console.log(`🔍 Looking up user via Power Automate: ${contact}`);
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(GET_USER_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact: contact })
            });

            const result = await response.json();

            if (result.success && result.user) {
                console.log(`✅ User found in SharePoint`);

                const user = {
                    name: result.user.Name,
                    surname: result.user.Surname,
                    jobTitle: result.user['Job_x0020_tittle'] || result.user['Job tittle'],
                    company: result.user.Company,
                    email: result.user.Email,
                    phone: result.user.Phone,
                    conferenceType: result.user['Conference_x002f_Workshop'] || result.user['Conference/Workshop'],
                    badgePrinted: result.user.Badge_Printed === 'True' || result.user.Badge_Printed === true,
                    online: result.user.online === 1 || result.user.on_place === 1,
                    sessions: {
                        MDM: result.user.MDM === '1',
                        DG: result.user.DG === '1',
                        'AI Agents': result.user['AI_x0020_Agents'] === '1' || result.user['AI Agents'] === '1',
                        AIStudio: result.user.AIStudio === '1',
                        'Knowledge Graph': result.user['Knowledge_x0020_Graph'] === '1' || result.user['Knowledge Graph'] === '1',
                        Mendix: result.user.Mendix === '1'
                    }
                };

                return res.json({ success: true, user: user });
            }
        } catch (error) {
            console.error('⚠️ SharePoint lookup failed, falling back to CSV:', error.message);
        }
    }

    // Fallback to CSV
    console.log(`🔍 Looking up user in local CSV: ${contact}`);
    const user = eventData.find(u =>
        u.email.toLowerCase() === contact.toLowerCase() ||
        u.phone === contact.replace(/\s+/g, '')
    );

    if (user) {
        console.log(`✅ User found in CSV`);
        res.json({ success: true, user: user });
    } else {
        console.log(`❌ User not found`);
        res.json({ success: false, message: 'User not found' });
    }
});

// Update user online status via Power Automate
app.post('/api/user-confirm', async (req, res) => {
    const { email, phone } = req.body;

    if (!UPDATE_USER_WEBHOOK_URL || !UPDATE_USER_WEBHOOK_URL.startsWith('https://')) {
        return res.json({ success: false, message: 'Power Automate not configured' });
    }

    try {
        console.log(`📡 Updating online status in SharePoint for: ${email || phone}`);
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(UPDATE_USER_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, phone: phone })
        });

        if (response.ok) {
            console.log(`✅ Successfully updated online status in SharePoint`);
            res.json({ success: true, message: 'User marked as online in SharePoint' });
        } else {
            const errorText = await response.text();
            console.error(`❌ Power Automate returned status ${response.status}: ${errorText}`);
            res.status(response.status).json({ 
                success: false, 
                message: `Power Automate error: ${response.status}`
            });
        }
    } catch (error) {
        console.error('❌ SharePoint update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
    db.get("SELECT COUNT(*) as doc_count FROM documents", (err, docRow) => {
        if (err) {
            res.status(500).json({ status: 'error', message: err.message });
        } else {
            db.get("SELECT COUNT(*) as embed_count FROM embeddings", (err2, embedRow) => {
                if (err2) {
                    res.status(500).json({ status: 'error', message: err2.message });
                } else {
                    res.json({
                        status: 'healthy',
                        guestsLoaded: eventData.length,
                        documentsLoaded: docRow.doc_count,
                        embeddingsStored: embedRow.embed_count,
                        timestamp: new Date().toISOString(),
                        ragMethod: process.env.RAG_METHOD || 'basic',
                        model: process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b',
                        ollama: 'Check http://localhost:11434 for Ollama status'
                    });
                }
            });
        }
    });
});

// Startup sequence
async function startServer() {
    try {
        console.log('🚀 Starting Advanced RAG Chatbot...');

        // Load event data from CSV (OPTIONAL - fallback if Power Automate fails)
        try {
            eventData = await loadEventDataFromCSV();
            console.log(`✅ CSV loaded: ${eventData.length} users available for fallback`);
        } catch (csvError) {
            console.warn('⚠️  CSV file not found - using ONLY Power Automate/SharePoint');
            console.warn('   Make sure GET_USER_WEBHOOK_URL is configured in .env');
            eventData = []; // Empty - will use Power Automate only
        }

        // Process PDFs from uploads folder (OPTIONAL - for RAG)
        try {
            await processPDFsFromUploads();
        } catch (pdfError) {
            console.warn('⚠️  No PDFs found - RAG will work with empty knowledge base');
        }

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`\n🎉 Advanced RAG Server ready!`);
            console.log(`📱 Frontend: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
            console.log(`👥 Users in CSV fallback: ${eventData.length}`);
            console.log(`🔗 Power Automate: ${GET_USER_WEBHOOK_URL ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`📚 Document chunks ready for RAG queries`);
            console.log(`\n✨ Ready for DataTalks 2025! ✨\n`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
