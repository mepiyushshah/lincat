import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Groq } from 'groq-sdk';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

console.log('GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? 'Yes' : 'No');
console.log('API Key starts with:', process.env.GROQ_API_KEY?.substring(0, 10));

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
const db = new sqlite3.Database('lincat.db');

// Create SQLite tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    original_input TEXT NOT NULL,
    title TEXT,
    description TEXT,
    url TEXT,
    category_id TEXT,
    ai_description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
});

console.log('Database initialized (SQLite)');

async function extractMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    let title = $('title').text().trim() || 
                $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                'No title found';
    
    let description = $('meta[name="description"]').attr('content') || 
                      $('meta[property="og:description"]').attr('content') || 
                      $('meta[name="twitter:description"]').attr('content') || 
                      $('p').first().text().trim().substring(0, 200) || 
                      'No description available';
    
    // Clean up title and description
    title = title.substring(0, 200).trim();
    description = description.substring(0, 500).trim();
    
    return { title, description };
  } catch (error) {
    console.error('Error extracting metadata:', error.message);
    return { 
      title: 'Unable to fetch title', 
      description: 'Unable to fetch description from this URL'
    };
  }
}

async function categorizeWithLLM(input, title, description, existingCategories) {
  try {
    // Simple pattern matching first
    const lowerInput = input.toLowerCase();
    const content = `${title} ${description}`.toLowerCase();
    
    if (lowerInput.includes('youtube.com') || lowerInput.includes('youtu.be')) {
      return {
        category: "YouTube Videos",
        description: `YouTube video: ${title || 'Video content'}`,
        isNew: !existingCategories.includes("YouTube Videos")
      };
    } else if (lowerInput.includes('twitter.com') || lowerInput.includes('x.com')) {
      return {
        category: "Twitter Posts",
        description: `Twitter/X profile or post: ${title || 'Social media content'}`,
        isNew: !existingCategories.includes("Twitter Posts")
      };
    } else if (lowerInput.includes('linkedin.com')) {
      return {
        category: "LinkedIn Profiles", 
        description: `LinkedIn profile or post: ${title || 'Professional networking content'}`,
        isNew: !existingCategories.includes("LinkedIn Profiles")
      };
    } else if (lowerInput.includes('facebook.com') || lowerInput.includes('fb.com')) {
      return {
        category: "Facebook Content",
        description: `Facebook profile or post: ${title || 'Social networking content'}`,
        isNew: !existingCategories.includes("Facebook Content")
      };
    } else if (content.includes('todo') || content.includes('task') || content.includes('reminder')) {
      return {
        category: "Tasks & Reminders",
        description: `Task or reminder: ${input}`,
        isNew: !existingCategories.includes("Tasks & Reminders")
      };
    } else if (content.includes('recipe') || content.includes('cooking') || content.includes('ingredient')) {
      return {
        category: "Recipes & Cooking",
        description: `Recipe or cooking content: ${title || input}`,
        isNew: !existingCategories.includes("Recipes & Cooking")
      };
    }

    // Use Groq LLM for categorization
    const prompt = `Analyze and categorize this content:
Input: "${input}"
Title: "${title}"
Description: "${description}"

Existing categories: ${existingCategories.join(', ')}

Create a category name (2-4 words max) and brief description. 
If it fits an existing category, use that exact name.
Format: CATEGORY: [name] | DESCRIPTION: [brief description]`;

    const completion = await client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-8b-8192",
      max_tokens: 150,
      temperature: 0.3
    });

    const response = completion.choices[0]?.message?.content || '';
    const categoryMatch = response.match(/CATEGORY:\s*([^|]+)/);
    const descriptionMatch = response.match(/DESCRIPTION:\s*(.+)/);

    if (categoryMatch && descriptionMatch) {
      const category = categoryMatch[1].trim();
      const aiDescription = descriptionMatch[1].trim();
      
      return {
        category,
        description: aiDescription,
        isNew: !existingCategories.includes(category)
      };
    }

    // Fallback
    return {
      category: "General",
      description: `Content: ${title || input}`,
      isNew: !existingCategories.includes("General")
    };
    
  } catch (error) {
    console.error('LLM categorization error:', error);
    return {
      category: "General",
      description: `Content: ${title || input}`,
      isNew: !existingCategories.includes("General")
    };
  }
}

app.post('/api/categorize', async (req, res) => {
  try {
    console.log('Received categorize request');
    const { input } = req.body;
    
    if (!input || typeof input !== 'string' || input.trim() === '') {
      return res.status(400).json({ error: 'Input is required and must be a non-empty string' });
    }
    
    const isUrl = input.match(/https?:\/\/[^\s]+/);
    let title = '';
    let description = '';
    let url = '';
    
    if (isUrl) {
      url = isUrl[0];
      console.log('Processing URL:', url);
      
      try {
        const metadata = await extractMetadata(url);
        title = metadata.title;
        description = metadata.description;
      } catch (error) {
        console.error('Failed to extract metadata:', error);
        title = 'Link';
        description = url;
      }
    } else {
      title = input.substring(0, 100);
      description = input;
    }
    
    // Get existing categories
    const existingCategories = await new Promise((resolve, reject) => {
      db.all("SELECT name FROM categories", (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.name));
      });
    });
    
    const categorization = await categorizeWithLLM(input, title, description, existingCategories);
    
    let categoryId;
    if (categorization.isNew) {
      categoryId = uuidv4();
      await new Promise((resolve, reject) => {
        db.run("INSERT INTO categories (id, name) VALUES (?, ?)", 
               [categoryId, categorization.category], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const category = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM categories WHERE name = ?", [categorization.category], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      categoryId = category?.id || uuidv4();
      if (!category) {
        await new Promise((resolve, reject) => {
          db.run("INSERT INTO categories (id, name) VALUES (?, ?)", 
                 [categoryId, categorization.category], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    }
    
    const linkId = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(`INSERT INTO links (id, original_input, title, description, url, category_id, ai_description) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
             [linkId, input, title, description, url, categoryId, categorization.description], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({
      success: true,
      link: {
        id: linkId,
        originalInput: input,
        title,
        description,
        url,
        category: categorization.category,
        aiDescription: categorization.description
      }
    });
    
  } catch (error) {
    console.error('Categorization error:', error);
    res.status(500).json({ 
      error: 'Failed to categorize content', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM categories ORDER BY created_at DESC", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const categoriesWithLinks = await Promise.all(categories.map(async (category) => {
      const links = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM links WHERE category_id = ? ORDER BY created_at DESC", 
               [category.id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      return { 
        ...category, 
        link_count: links.length,
        links: links
      };
    }));
    
    res.json(categoriesWithLinks);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    const links = await new Promise((resolve, reject) => {
      db.all(`
        SELECT links.*, categories.name as category_name 
        FROM links 
        LEFT JOIN categories ON links.category_id = categories.id
        WHERE links.title LIKE ? OR links.description LIKE ? OR links.ai_description LIKE ? OR links.original_input LIKE ?
        ORDER BY links.created_at DESC
      `, [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(links);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

app.delete('/api/categories/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    
    // Delete links first
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM links WHERE category_id = ?", [categoryId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Delete category
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM categories WHERE id = ?", [categoryId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ success: true, message: 'Category and all its links deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

app.delete('/api/links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM links WHERE id = ?", [linkId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ success: true, message: 'Link deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all handler for client-side routing
app.get('*', (req, res) => {
  // Don't handle API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // For all other routes, serve the main app
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Lincat server running at http://localhost:${port}`);
});