import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

// 1. SÉCURITÉ CORS : Autorise Claude.ai à interroger votre serveur Render
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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
    const res = await fetch(`https://api.pappers.fr/v2/recherche?api_token=${token}&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Erreur Pappers: ${err.message}` }] };
  }
});

const transports = new Map();

app.get('/sse', async (req, res) => {
  try {
    const sessionId = Math.random().toString(36).substring(7);
    
    // 2. URL ABSOLUE : Force Claude à renvoyer ses messages vers Render et non vers lui-même
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${host}`;
    
    const transport = new SSEServerTransport(`${baseUrl}/messages?id=${sessionId}`, res);
    transports.set(sessionId, transport);
    
    req.on('close', () => transports.delete(sessionId));
    await server.connect(transport);
  } catch (error) {
    console.error("Erreur critique sur /sse :", error);
    if (!res.headersSent) {
      res.status(500).send("Erreur de connexion MCP");
    }
  }
});

app.post('/messages', async (req, res) => {
  try {
    const transport = transports.get(req.query.id);
    if (transport) {
      await transport.handleMessage(req, res);
    } else {
      res.sendStatus(400);
    }
  } catch (error) {
    console.error("Erreur critique sur /messages :", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP open on port ${PORT}`));

