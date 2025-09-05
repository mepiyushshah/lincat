// Supabase client for frontend
const { createClient } = supabase;

const supabaseClient = createClient(
  'https://iuvjjpkqwrqklvuazspq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1dmpqcGtxd3Jxa2x2dWF6c3BxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTM2MDYsImV4cCI6MjA3MjYyOTYwNn0.M4KSkE8OXKWZsNC4AXwB8phtwiZXBuQy4teFSRK2MzA'
);

// Auth state management
let currentUser = null;
let authToken = null;

// Check if user is logged in on page load
async function checkAuthState() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  
  if (session) {
    currentUser = session.user;
    authToken = session.access_token;
    showAppInterface();
  } else {
    showAuthInterface();
  }
}

// Show authentication interface
function showAuthInterface() {
  document.getElementById('search-view').style.display = 'none';
  document.getElementById('categories-view').style.display = 'none';
  document.getElementById('auth-view').style.display = 'flex';
}

// Show main app interface
function showAppInterface() {
  document.getElementById('auth-view').style.display = 'none';
  document.getElementById('search-view').style.display = 'flex';
  document.getElementById('categories-view').style.display = 'none';
  
  // Update UI with user info
  if (currentUser) {
    document.getElementById('user-email').textContent = currentUser.email;
  }
}

// Sign up function
async function signUp(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) throw error;

    if (data.user) {
      alert('Check your email for verification link!');
      showSignIn();
    }
  } catch (error) {
    console.error('Signup error:', error);
    alert('Error: ' + error.message);
  }
}

// Sign in function
async function signIn(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    currentUser = data.user;
    authToken = data.session.access_token;
    showAppInterface();
  } catch (error) {
    console.error('Signin error:', error);
    alert('Error: ' + error.message);
  }
}

// Sign out function
async function signOut() {
  try {
    await supabaseClient.auth.signOut();
    currentUser = null;
    authToken = null;
    showAuthInterface();
  } catch (error) {
    console.error('Signout error:', error);
  }
}

// Toggle between sign in and sign up
function showSignUp() {
  document.getElementById('signin-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'block';
}

function showSignIn() {
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('signin-form').style.display = 'block';
}

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', checkAuthState);