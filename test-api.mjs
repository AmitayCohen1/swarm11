import { readFileSync } from 'fs';

console.log('🧪 Testing API Configuration...\n');

// Read .env.local
const envFile = readFileSync('.env.local', 'utf-8');
const envVars = {};
envFile.split('\n').forEach(line => {
  if (line && !line.startsWith('#')) {
    const [key, ...values] = line.split('=');
    envVars[key.trim()] = values.join('=').trim();
  }
});

// Check required env vars
const required = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'PERPLEXITY_API_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY'
];

let allGood = true;

required.forEach(key => {
  if (envVars[key]) {
    const value = envVars[key];
    const masked = value.length > 10
      ? value.substring(0, 10) + '...' + value.substring(value.length - 4)
      : '***';
    console.log(`✅ ${key}: ${masked}`);
  } else {
    console.log(`❌ ${key}: MISSING`);
    allGood = false;
  }
});

console.log('\n');

if (allGood) {
  console.log('✅ All environment variables are set!');
  console.log('\n📝 Next steps:');
  console.log('1. Make sure you restarted the dev server after adding PERPLEXITY_API_KEY');
  console.log('2. Navigate to http://localhost:3000/orchestrator');
  console.log('3. Check the terminal for any error messages');
  console.log('4. Check browser console (F12) for client-side errors');
} else {
  console.log('❌ Some environment variables are missing.');
  console.log('Please add them to .env.local and restart the server.');
}
