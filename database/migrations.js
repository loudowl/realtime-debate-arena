const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect();

// Create tables
client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password VARCHAR(100)
  );
  CREATE TABLE IF NOT EXISTS debates (
    id SERIAL PRIMARY KEY,
    topic VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`, (err) => {
  if (err) throw err;
  console.log('Database setup complete.');
  client.end();
});
