
# 🚀 SETUP INSTRUCTIONS - DataTalks 2025 Chatbot

## 📁 FILES OVERVIEW:
- **server.js** - Main server with SharePoint integration
- **package.json** - Dependencies and scripts  
- **index.html** - Complete chatbot frontend
- **README.md** - Documentation

## ⚙️ QUICK SETUP:

### 1. Install Dependencies (1 minute)
```bash
npm install
```

### 2. Configure Webhook URLs (2 minutes)
In `server.js`, replace these URLs:
```javascript
const GET_USER_WEBHOOK_URL = 'YOUR_GET_USER_WEBHOOK_URL_HERE';
const UPDATE_USER_WEBHOOK_URL = 'YOUR_UPDATE_USER_WEBHOOK_URL_HERE';
```

### 3. Create Frontend Folder
```bash
mkdir frontend
# Then put index.html inside frontend/ folder
```

### 4. Start Server (30 seconds)
```bash
npm start
```

### 5. Test (30 seconds)
- Open: http://localhost:3000
- Try: jkowalski@gmail2.com (mock mode)

## 🔗 POWER AUTOMATE WEBHOOKS:

### Webhook 1: GET_USER_WEBHOOK_URL
From the flow you just created:
- HTTP trigger with {"contact": "string"}
- Returns user data from SharePoint

### Webhook 2: UPDATE_USER_WEBHOOK_URL  
From your existing flow:
- HTTP trigger with {"email": "string", "phone": "string"}
- Updates "online" column to 1

## 🎯 RESULT:
Complete chatbot with:
✅ SharePoint integration
✅ Real-time check-in
✅ Bilingual support
✅ Mock mode for testing

## 🆘 NEED HELP?
The chatbot runs in mock mode until you configure webhooks!
Test user: jkowalski@gmail2.com or 666777888
