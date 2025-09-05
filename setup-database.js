import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function setupDatabase() {
  try {
    console.log('Setting up database tables...');
    
    // Create categories table
    const { error: categoriesError } = await supabase.rpc('exec', {
      sql: `
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, user_id)
        );
      `
    });
    
    if (categoriesError && !categoriesError.message.includes('already exists')) {
      console.error('Categories table error:', categoriesError);
    } else {
      console.log('✅ Categories table created');
    }

    // Create links table
    const { error: linksError } = await supabase.rpc('exec', {
      sql: `
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
      `
    });
    
    if (linksError && !linksError.message.includes('already exists')) {
      console.error('Links table error:', linksError);
    } else {
      console.log('✅ Links table created');
    }

    // Enable Row Level Security
    await supabase.rpc('exec', {
      sql: `
        ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
        ALTER TABLE links ENABLE ROW LEVEL SECURITY;
      `
    });

    // Create RLS policies
    await supabase.rpc('exec', {
      sql: `
        CREATE POLICY "Users can only see their own categories" ON categories
          FOR ALL USING (auth.uid() = user_id);
        
        CREATE POLICY "Users can only see their own links" ON links
          FOR ALL USING (auth.uid() = user_id);
      `
    });

    console.log('✅ Row Level Security enabled');
    console.log('🎉 Database setup complete!');
    
  } catch (error) {
    console.error('Database setup error:', error);
  }
}

setupDatabase();