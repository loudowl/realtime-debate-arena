const express = require('express');
const router = express.Router();

// Mock debate handlers
router.get('/', (req, res) => {
  // Simulate fetching debates
  res.json({ debates: [{ id: "1", topic: "Climate Change", participants: ["user1", "user2"], status: "ongoing" }] });
});

router.post('/', (req, res) => {
  const { topic } = req.body;
  // Simulate creating a new debate
  res.json({ message: "Debate created successfully", debateId: "1" });
});

module.exports = router;
