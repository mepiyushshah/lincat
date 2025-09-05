import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Groq } from 'groq-sdk';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
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

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

console.log('Supabase initialized:', process.env.SUPABASE_URL ? 'Yes' : 'No');

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Note: Database tables will be created directly in Supabase dashboard
// Categories table: id (text, primary), name (text), user_id (uuid, foreign key), created_at (timestamp)
// Links table: id (text, primary), original_input (text), title (text), description (text), url (text), 
//              category_id (text, foreign key), ai_description (text), user_id (uuid, foreign key), created_at (timestamp)

// Initialize SQLite for local development
const db = new sqlite3.Database('lincat.db');

// Create SQLite tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL,
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
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
});

console.log('Database connections established (SQLite + Supabase)');

// Authentication middleware
async function authenticateUser(req, res, next) {
  try {
    // Skip authentication in local development mode (when running on localhost)
    const isLocal = req.get('host')?.includes('localhost') || req.get('host')?.includes('127.0.0.1');
    if (isLocal) {
      req.user = { id: 'dev-user', email: 'dev@example.com' };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

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

app.post('/api/categorize', authenticateUser, async (req, res) => {
  try {
    console.log('Received categorize request from user:', req.user.id);
    const { input } = req.body;
    
    if (!input || typeof input !== 'string' || input.trim() === '') {
      return res.status(400).json({ error: 'Input is required and must be a non-empty string' });
    }
    
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
    
    // Get existing categories for this user
    let existingCategories;
    const isLocal = req.get('host')?.includes('localhost') || req.get('host')?.includes('127.0.0.1');
    
    if (isLocal) {
      // Use SQLite for local development
      existingCategories = await new Promise((resolve, reject) => {
        db.all("SELECT name FROM categories WHERE user_id = ?", [req.user.id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } else {
      // Use Supabase for production
      const { data } = await supabase
        .from('categories')
        .select('name')
        .eq('user_id', req.user.id);
      existingCategories = data;
    }
    
    const categoryNames = existingCategories?.map(row => row.name) || [];
    
    const categorization = await categorizeWithLLM(input, title, description, categoryNames);
    
    let categoryId;
    if (categorization.isNew) {
      categoryId = uuidv4();
      
      if (isLocal) {
        // Use SQLite for local development
        await new Promise((resolve, reject) => {
          db.run("INSERT INTO categories (id, name, user_id) VALUES (?, ?, ?)", 
                 [categoryId, categorization.category, req.user.id], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        // Use Supabase for production
        const { error } = await supabase
          .from('categories')
          .insert({
            id: categoryId,
            name: categorization.category,
            user_id: req.user.id
          });
        
        if (error) {
          console.error('Category insert error:', error);
          throw error;
        }
      }
    } else {
      if (isLocal) {
        // Use SQLite for local development
        const existingCategory = await new Promise((resolve, reject) => {
          db.get("SELECT id FROM categories WHERE name = ? AND user_id = ?", 
                 [categorization.category, req.user.id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        categoryId = existingCategory?.id || uuidv4();
        if (!existingCategory) {
          await new Promise((resolve, reject) => {
            db.run("INSERT INTO categories (id, name, user_id) VALUES (?, ?, ?)", 
                   [categoryId, categorization.category, req.user.id], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } else {
        // Use Supabase for production
        const { data: existingCategory } = await supabase
          .from('categories')
          .select('id')
          .eq('name', categorization.category)
          .eq('user_id', req.user.id)
          .single();
        
        categoryId = existingCategory?.id || uuidv4();
        if (!existingCategory) {
          const { error } = await supabase
            .from('categories')
            .insert({
              id: categoryId,
              name: categorization.category,
              user_id: req.user.id
            });
          
          if (error) {
            console.error('Category insert error:', error);
            throw error;
          }
        }
      }
    }
    
    const linkId = uuidv4();
    if (isLocal) {
      // Use SQLite for local development
      await new Promise((resolve, reject) => {
        db.run(`INSERT INTO links (id, original_input, title, description, url, category_id, ai_description, user_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
               [linkId, input, title, description, url, categoryId, categorization.description, req.user.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      // Use Supabase for production
      const { error: linkError } = await supabase
        .from('links')
        .insert({
          id: linkId,
          original_input: input,
          title,
          description,
          url,
          category_id: categoryId,
          ai_description: categorization.description,
          user_id: req.user.id
        });
      
      if (linkError) {
        console.error('Link insert error:', linkError);
        throw linkError;
      }
    }
    
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

app.get('/api/categories', authenticateUser, async (req, res) => {
  try {
    const isLocal = req.get('host')?.includes('localhost') || req.get('host')?.includes('127.0.0.1');
    let categoriesWithLinks = [];
    
    if (isLocal) {
      // Use SQLite for local development
      const categories = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM categories WHERE user_id = ? ORDER BY created_at DESC", 
               [req.user.id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      
      // Get links for each category
      categoriesWithLinks = await Promise.all(categories.map(async (category) => {
        const links = await new Promise((resolve, reject) => {
          db.all("SELECT * FROM links WHERE category_id = ? AND user_id = ? ORDER BY created_at DESC", 
                 [category.id, req.user.id], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
        
        return { 
          ...category, 
          link_count: links.length,
          links: links 
        };
      }));
    } else {
      // Use Supabase for production
      const { data: categories, error } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Categories fetch error:', error);
        throw error;
      }
      
      // Get links for each category
      categoriesWithLinks = await Promise.all((categories || []).map(async (category) => {
        const { data: links } = await supabase
          .from('links')
          .select('*')
          .eq('category_id', category.id)
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false });
        
        return { 
          ...category, 
          link_count: links?.length || 0,
          links: links || [] 
        };
      }));
    }
    
    res.json(categoriesWithLinks);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/search', authenticateUser, async (req, res) => {
  try {
    const { q } = req.query;
    const { data: links, error } = await supabase
      .from('links')
      .select(`
        *,
        categories(name)
      `)
      .eq('user_id', req.user.id)
      .or(`title.ilike.%${q}%,description.ilike.%${q}%,ai_description.ilike.%${q}%,original_input.ilike.%${q}%`)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const formattedLinks = links?.map(link => ({
      ...link,
      category_name: link.categories?.name
    })) || [];
    
    res.json(formattedLinks);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

app.delete('/api/categories/:categoryId', authenticateUser, async (req, res) => {
  try {
    const { categoryId } = req.params;
    
    // Delete category (links will be deleted automatically due to CASCADE)
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Category and all its links deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

app.delete('/api/links/:linkId', authenticateUser, async (req, res) => {
  try {
    const { linkId } = req.params;
    
    const { error } = await supabase
      .from('links')
      .delete()
      .eq('id', linkId)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Link deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Authentication endpoints
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    
    res.json({
      success: true,
      user: data.user,
      session: data.session
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) throw error;
    
    res.json({
      success: true,
      user: data.user,
      session: data.session
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/signout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await supabase.auth.signOut(token);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Signout error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Lincat server running at http://localhost:${port}`);
});