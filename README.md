# Lincat - Intelligent Link Categorization

A beautiful, Apple-inspired web application that automatically categorizes your links and content using AI.

## Features

- 🎯 **Intelligent Categorization**: Uses Groq LLM to automatically categorize links and content
- 🍎 **Apple-Style Design**: Clean, elegant interface inspired by Apple's design principles  
- 🔍 **Smart Search**: Find your saved content instantly
- 📱 **Responsive**: Works perfectly on desktop and mobile
- ⚡ **Fast**: Quick categorization and retrieval
- 🗂️ **Dynamic Categories**: Creates categories as needed, keeps them broad until they get too specific

## Setup

1. **Clone or download this project**

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your Groq API key:**
   - Copy `.env.example` to `.env`
   - Add your Groq API key: `GROQ_API_KEY=gsk_your_key_here`
   - Get a free API key at [Groq Console](https://console.groq.com/)

4. **Start the application:**
   ```bash
   npm run dev
   ```

5. **Open your browser to:** `http://localhost:3000`

## How to Use

1. **Add Content**: Paste any link or type content into the search bar
2. **Auto-Categorization**: AI analyzes and categorizes your content
3. **Browse Categories**: View your organized content in beautiful card layouts  
4. **Search**: Find anything quickly using the search functionality
5. **View Details**: Click any card to see full details in an elegant modal

## Technical Details

- **Backend**: Node.js with Express
- **AI**: Groq LLM (Mixtral-8x7B) for categorization
- **Database**: SQLite for local storage
- **Frontend**: Vanilla JavaScript with Tailwind CSS
- **Design**: Apple-inspired interface with glass morphism effects

## API Endpoints

- `POST /api/categorize` - Categorize new content
- `GET /api/categories` - Get all categories with links
- `GET /api/search?q=query` - Search across all content

The app intelligently determines whether content fits existing categories or needs a new one, keeping category names to exactly 2 words and focusing on broad categorization until things become too niche.