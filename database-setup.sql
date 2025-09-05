-- Lincat SaaS Database Setup
-- Run this in your Supabase SQL Editor

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, user_id)
);

-- Create links table  
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  original_input TEXT NOT NULL,
  title TEXT,
  description TEXT,
  url TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  ai_description TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for categories
CREATE POLICY "Users can manage their own categories" ON categories
  FOR ALL USING (auth.uid() = user_id);

-- Create RLS policies for links
CREATE POLICY "Users can manage their own links" ON links
  FOR ALL USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON categories TO authenticated;
GRANT ALL ON links TO authenticated;