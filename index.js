require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());


app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});


app.get('/api/hello', (req, res) => {
  res.json({ msg: 'Hello from backend' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  void 0;
});
