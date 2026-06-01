const express = require('express');
const router = express.Router();

// Mock authentication handlers
router.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  // Simulate user registration
  res.json({ message: "User registered successfully", userId: "12345" });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  // Simulate user login
  res.json({ token: "fake-jwt-token", userId: "12345" });
});

module.exports = router;
