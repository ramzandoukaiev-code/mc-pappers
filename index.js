import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

// Configuration CORS ultra-propre
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const activeSessions = new Map();

app.get('/sse', async (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  
  // SÉCURITÉ ANTI-CRASH : On crée une instance unique par connexion 
  // pour éviter l'erreur "Already connected to a transport"
  const server = new Server(
    { name: 'pappers-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'rechercher_entreprise',
        description: 'Recherche les données d\'une entreprise française sur Pappers via son nom ou SIREN.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Nom de l\'entreprise ou SIREN' }
          },
          required: ['query']
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'rechercher_entreprise') throw new Error('Outil inconnu');
    const query = request.params.arguments?.query;
    const token = process.env.PAPPERS_API_KEY;
    
    try {
      const resPappers = await fetch(`https://api.pappers.fr/v2/recherche?api_token=${token}&q=${encodeURIComponent(query)}`);
      const data = await resPappers.json();
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Erreur Pappers: ${err.message}` }] };
    }
  });

  const host = req.get('host');
  const baseUrl = `https://${host}`;
  
  const transport = new SSEServerTransport(`${baseUrl}/messages?id=${sessionId}`, res);
  activeSessions.set(sessionId, transport);
  
  req.on('close', () => {
    activeSessions.delete(sessionId);
  });

  try {
    await server.connect(transport);
  } catch (err) {
    console.error("Erreur de transport ignorée pour éviter le crash:", err.message);
  }
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.id;
  const transport = activeSessions.get(sessionId);
  
  if (transport) {
    try {
      await transport.handleMessage(req, res);
    } catch (err) {
      console.error("Erreur message:", err.message);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(400);
  }
});

app.get('/', (req, res) => {
  res.send("Le serveur MCP Pappers est en ligne ! Connectez Claude à l'adresse /sse.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`MCP open on port ${PORT}`));
