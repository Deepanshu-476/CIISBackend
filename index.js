require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Example API route (prefix /api rakhna hai to Nginx me /api/ proxy already set hai)
app.get('/api/hello', (req, res) => {
  res.json({ msg: 'Hello from backend' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
