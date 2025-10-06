Here's a complete, tailored `README.md` for your project, including local installation, model setup, and dual monitor kiosk running instructions:

***

# DataTalks 2025 AI Chatbot – Dual Touchscreen Conference Assistant

A professional event assistant chatbot for Integral Data Talks 2025. Features advanced RAG (Retrieval-Augmented Generation), user lookup (CSV/SharePoint), multi-language support, and seamless dual touchscreen kiosk operation – all running locally on Windows.

***

## Features

- LLM-powered (Qwen 2.5 via Ollama)
- Advanced RAG: HyDE, Query Expansion, Reranking
- PDF document ingestion (auto from uploads/)
- User registration, check-in, and badge management
- Live or offline user lookup (Power Automate / CSV fallback)
- Polish & English support (auto-switch UI)
- Dual screen, dual-session kiosk support (Windows)
- Professional conference UI

***

## Quickstart: Running Locally on Windows

### **1. Prerequisites**

- Windows 11 laptop, NVIDIA RTX GPU recommended
- Node.js 20.x: [nodejs.org](https://nodejs.org)
- Ollama for Windows: [ollama.com/download/windows](https://ollama.com/download/windows)
- Google Chrome browser

### **2. Project Structure**

```
project-root/
├── backend/
│   └── server.js
├── frontend/
│   └── index.html
├── data/
│   └── EventData.csv
├── uploads/
│   └── [YOUR EVENT PDFs]
├── package.json
├── package-lock.json
├── .env
└── start_dual_kiosk.bat
```

### **3. Setup Instructions**

1. **Install Node.js (if not already):**
   - Download and run Windows installer from [nodejs.org](https://nodejs.org)
   - Confirm with: `node --version`

2. **Install Ollama + Download Models:**
   - Download from [ollama.com/download/windows](https://ollama.com/download/windows), run installer.
   - Open Command Prompt and run:
     ```
     ollama pull qwen2.5:14b
     ollama pull mxbai-embed-large
     ```
     *(This may take 10-20 minutes)*

3. **Install Node Dependencies:**
   ```
   cd path\to\your\project
   npm install
   ```

4. **Configure .env File:**
   Edit and set your models and URLs:
   ```
   PORT=3000
   OLLAMA_CHAT_MODEL=qwen2.5:14b
   OLLAMA_EMBED_MODEL=mxbai-embed-large
   GET_USER_WEBHOOK_URL=https://your-power-automate-url
   UPDATE_USER_WEBHOOK_URL=https://your-power-automate-url
   # Etc for other configuration
   ```

5. **Add PDFs:**
   - Drop all event-related PDFs into the `uploads/` folder.

6. **Check user CSV:**
   - Ensure `data/EventData.csv` has current registration info.

***

## Running the Chatbot *(Dual Touchscreen Kiosk)*

### **A. Prepare Windows Dual Monitors**
1. Connect two touchscreens via USB-C/HDMI.
2. In Display Settings:
   - Identify and arrange monitors (side by side).
   - Set both to 1920×1080.
   - (Optional) Disable laptop internal display.

### **B. Start the Kiosk**

**Option 1: Double click**
- Double click `start_dual_kiosk.bat` (in root folder).

**Option 2: From command line**
```
start_dual_kiosk.bat
```

- This will:
  - Start Ollama (if not already running)
  - Start server (`node backend/server.js`)
  - Open Chrome in kiosk mode on each monitor, with a separate session

**Each touchscreen works independently – attendees can interact simultaneously.**

***

## Additional Notes

- **User lookup**: Supports both Power Automate webhooks and CSV fallback for offline operation.
- **PDF ingestion**: Server auto-processes files in `uploads/` on each boot.
- **Supported browsers**: Chrome recommended (tested kiosk mode).
- **Multi-language UI**: Polish and English selection with flags.

***

## Maintenance & Troubleshooting

- **To update PDFs**: Add new files to `uploads/` and restart server.
- **Change RAG/search config**: Edit `.env` for top_k, similarity, reranking, etc.
- **If ports are busy**: Close other Node/Chrome processes, or use Task Manager.
- **Performance tip**: For large events, use a laptop with 32GB RAM and RTX 4060/4070.

***

## Credits

- Developed for Integral Data Talks 2025
- Design and RAG workflow: DataTalks Team
- AI engine: Qwen 2.5 via Ollama

***

## License

MIT

***

**For any setup or custom UI questions, contact your DataTalks conference team.**

***

This README can be placed in your project root as `README.md`. It covers the entire process: software installation, local deployment, kiosk setup, and basic maintenance for your dual touch AI conference assistant.