// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();

// Middleware setup
app.use(cors());
app.use(bodyParser.json());

// Import routes
const authRoutes = require('./routes/auth');
const debateRoutes = require('./routes/debates');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/debates', debateRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
