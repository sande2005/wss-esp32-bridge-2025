require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const cors = require('cors');

const PORT = process.env.PORT || 10000;      // Render fournira PORT via env
const MONGO = process.env.MONGODB_URI;       // à configurer dans Render (voir plus bas)

// ---------- Mongoose schema ----------
const dataSchema = new mongoose.Schema({
  bpm: Number,
  spo2: Number,
  ts: { type: Date, default: Date.now },
  source: { type: String, default: 'esp32' }
});
const DataModel = mongoose.model('SensorData', dataSchema);

// ---------- Express app ----------
const app = express();
app.use(express.json());
app.use(cors());

// Small health route
app.get('/', (req, res) => res.send('WSS Bridge is running'));

// REST: get history (limit)
app.get('/history', async (req, res) => {
  const limit = Math.min(1000, parseInt(req.query.limit) || 100);
  try {
    const docs = await DataModel.find().sort({ ts: -1 }).limit(limit).exec();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- HTTP server + WebSocket ----------
const server = http.createServer(app);

// wss will handle secure ws from clients (Render terminates TLS)
// We'll accept connections at path '/ws'
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log('Client WSS connecté');

  ws.on('message', async (message) => {
    console.log('Reçu message:', message.toString());

    // Try parse JSON
    let parsed;
    try {
      parsed = JSON.parse(message.toString());
    } catch (e) {
      console.warn('Non JSON reçu, ignorer');
      return;
    }

    // Save to DB
    try {
      const doc = new DataModel({
        bpm: parsed.bpm,
        spo2: parsed.spo2,
        source: parsed.source || 'esp32',
        ts: parsed.ts ? new Date(parsed.ts) : undefined
      });
      await doc.save();
    } catch (err) {
      console.error('Erreur sauvegarde DB:', err.message);
    }

    // Rebroadcast to all connected clients (including dashboards/IA)
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log('Client déconnecté');
  });
});

// ---------- Connect to MongoDB and start ----------
async function start() {
  if (!MONGO) {
    console.error('MONGODB URI not set. Set MONGODB_URI in env.');
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('MongoDB connecté');
  } catch (err) {
    console.error('Erreur connexion MongoDB', err);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start();
