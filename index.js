import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

const server = new Server(
  { name: 'pappers-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'rechercher_entreprise',
      description: 'Recherche les données d\'une entreprise française sur Pappers (SIRET, dirigeants, adresse) via son nom ou SIREN.',
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
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
});

const transports = new Map();

app.get('/sse', async (req, res) => {
  const sessionId = Math.random().toString(36).substring(7);
  const transport = new SSEServerTransport(`/messages?id=${sessionId}`, res);
  transports.set(sessionId, transport);
  req.on('close', () => transports.delete(sessionId));
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const transport = transports.get(req.query.id);
  if (transport) {
    await transport.handleMessage(req, res);
  } else {
    res.sendStatus(400);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP open on port ${PORT}`));

