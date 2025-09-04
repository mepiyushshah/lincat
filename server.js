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

const db = new sqlite3.Database('lincat.db');

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

async function extractMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 5000 // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    // Try multiple selectors for title
    let title = $('title').first().text().trim() || 
               $('meta[property="og:title"]').attr('content') || 
               $('meta[name="twitter:title"]').attr('content') ||
               $('h1').first().text().trim() ||
               '';
    
    // Clean up title
    title = title.replace(/\s+/g, ' ').trim();
    
    let description = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || 
                     $('meta[name="twitter:description"]').attr('content') ||
                     $('p').first().text().trim().substring(0, 200) ||
                     '';
    
    return { title, description };
  } catch (error) {
    console.log(`Failed to extract metadata from ${url}: ${error.message}`);
    return { title: '', description: '' };
  }
}

async function categorizeWithLLM(input, title, description, existingCategories) {
  try {
    const completion = await client.chat.completions.create({
      model: "moonshotai/kimi-k2-instruct",
      messages: [
        {
          role: "system",
          content: `You are an expert content analyst. Analyze the input and create intelligent categorization.

Existing categories: ${existingCategories.join(', ')}

Rules:
1. Use existing category if it fits well (be flexible)
2. Only create new category if content is significantly different  
3. Category names must be exactly 2 words, descriptive and broad
4. Write a clear, useful description that helps the user remember and find this content later
5. Focus on what makes this content valuable or interesting
6. Respond with JSON: {"category": "Category Name", "description": "Clear, helpful description", "isNew": true/false}

Make the description specific and useful - avoid generic phrases like "useful resources" or "miscellaneous content".`
        },
        {
          role: "user",
          content: `Categorize this content:
Original input: ${input}
Title: ${title}
Description: ${description}`
        }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result;
  } catch (error) {
    console.log('LLM categorization failed, using fallback logic');
    console.log('Error details:', error.message);
    
    // Fallback categorization logic
    const content = `${input} ${title} ${description}`.toLowerCase();
    
    // Smart keyword-based categorization with better descriptions
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('github.com') || lowerInput.includes('gitlab.com')) {
      return {
        category: "Code Repositories",
        description: `Source code repository: ${title || 'Programming project'}`,
        isNew: !existingCategories.includes("Code Repositories")
      };
    } else if (lowerInput.includes('youtube.com') || lowerInput.includes('youtu.be')) {
      return {
        category: "Video Content", 
        description: `YouTube video: ${title || 'Educational or entertainment content'}`,
        isNew: !existingCategories.includes("Video Content")
      };
    } else if (lowerInput.includes('twitter.com') || lowerInput.includes('x.com')) {
      return {
        category: "Social Media",
        description: `Twitter/X profile or post: ${title || 'Social media content'}`,
        isNew: !existingCategories.includes("Social Media")
      };
    } else if (lowerInput.includes('linkedin.com')) {
      return {
        category: "Professional Network", 
        description: `LinkedIn profile or post: ${title || 'Professional networking content'}`,
        isNew: !existingCategories.includes("Professional Network")
      };
    } else if (content.includes('todo') || content.includes('task') || content.includes('reminder')) {
      return {
        category: "Task Management",
        description: `Personal task or reminder: ${title || input.substring(0, 50)}`,
        isNew: !existingCategories.includes("Task Management")
      };
    } else if (input.startsWith('http')) {
      return {
        category: "Web Resources",
        description: `Web link: ${title || 'Online resource or article'}`,
        isNew: !existingCategories.includes("Web Resources")
      };
    } else {
      return {
        category: "Personal Notes",
        description: `Personal note: ${input.substring(0, 80)}${input.length > 80 ? '...' : ''}`,
        isNew: !existingCategories.includes("Personal Notes")
      };
    }
  }
}

app.post('/api/categorize', async (req, res) => {
  try {
    const { input } = req.body;
    
    const isUrl = input.match(/https?:\/\/[^\s]+/);
    let title = '';
    let description = '';
    let url = '';
    
    if (isUrl) {
      url = input;
      const metadata = await extractMetadata(url);
      title = metadata.title;
      description = metadata.description;
      
      // If title extraction failed, create a meaningful title from URL
      if (!title || title.trim() === '') {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace('www.', '');
        const pathParts = urlObj.pathname.split('/').filter(p => p && p !== '');
        
        if (hostname.includes('github.com') && pathParts.length >= 2) {
          title = `${pathParts[0]}/${pathParts[1]} - GitHub Repository`;
        } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
          title = `YouTube Video - ${hostname}`;
        } else if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1].replace(/[-_]/g, ' ');
          title = `${hostname} - ${lastPart}`;
        } else {
          title = `${hostname} Homepage`;
        }
      }
      
      // Clean up common title issues
      title = title.replace(/\s+/g, ' ').trim();
      if (title.length > 100) {
        title = title.substring(0, 97) + '...';
      }
    } else {
      // For non-URL content, use first meaningful words as title
      const words = input.trim().split(' ');
      title = words.slice(0, 8).join(' '); // Take first 8 words instead of character limit
      if (title.length > 60) {
        title = title.substring(0, 57) + '...';
      }
      description = input;
    }
    
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
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to categorize content' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await new Promise((resolve, reject) => {
      db.all(`SELECT c.*, COUNT(l.id) as link_count 
              FROM categories c 
              LEFT JOIN links l ON c.id = l.category_id 
              GROUP BY c.id 
              ORDER BY c.created_at DESC`, (err, rows) => {
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
      return { ...category, links };
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
      db.all(`SELECT l.*, c.name as category_name 
              FROM links l 
              JOIN categories c ON l.category_id = c.id 
              WHERE l.title LIKE ? OR l.description LIKE ? OR l.ai_description LIKE ? OR l.original_input LIKE ?
              ORDER BY l.created_at DESC`,
             [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`], (err, rows) => {
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
    
    // First delete all links in this category
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM links WHERE category_id = ?", [categoryId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Then delete the category
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Lincat server running at http://localhost:${port}`);
});