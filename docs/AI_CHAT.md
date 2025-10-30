# AI Chat Agent

An intelligent assistant for restaurant management that helps with operations, analytics, and navigation.

## Features

### Smart Conversation
- **Streaming responses**: Real-time streaming from AI models
- **Context-aware**: Understands your restaurant and user role
- **Multi-model fallback**: Free models first, paid models as backup
- **Tool execution**: Can perform actions and fetch live data

### Available Tools

#### For All Users (Viewer, Manager, Owner)
- **Navigate**: Direct navigation to app sections
- **Get KPIs**: Key performance indicators for any period
- **Inventory Status**: Current inventory value and low stock items
- **Recipe Analytics**: Recipe costs, margins, and profitability
- **Sales Summary**: Sales data with period-over-period comparisons

#### For Managers & Owners
- **Generate Report**: Create financial and operational reports in various formats

#### For Owners Only
- **AI Insights**: Get AI-powered business recommendations

## Architecture

### Backend (Supabase Edge Functions)

#### `ai-chat-stream`
Streaming chat endpoint that:
- Authenticates users and validates restaurant access
- Calls OpenRouter API with system prompt and tools
- Streams responses using Server-Sent Events (SSE)
- Handles tool calls and responses

#### `ai-execute-tool`
Tool execution endpoint that:
- Validates user permissions (role-based access)
- Executes tools with restaurant-scoped queries
- Returns structured results for the chat

### Frontend

#### Hook: `useAiChat`
Custom React hook that:
- Manages message state
- Handles streaming responses
- Executes tools when requested by AI
- Provides abort/retry functionality

#### Components
- **AiChat**: Main chat interface with input, messages, and quick actions
- **ChatMessage**: Individual message bubble with proper formatting

## Usage

### Quick Actions
Predefined prompts to get started:
- "Show me the key metrics for this month"
- "What is my current inventory status?"
- "Show me items that are low in stock"
- "Which recipes are most profitable?"
- "Summarize sales for this week"

### Example Queries
```
"What were my sales yesterday?"
"Show me low stock items"
"Which recipes have the best margins?"
"Navigate to inventory"
"Generate a monthly P&L report for September"
```

## Security

- **Authentication**: All requests require valid Supabase auth token
- **Authorization**: User must have access to the restaurant
- **Row Level Security**: All database queries respect RLS policies
- **Role-based tools**: Tools are filtered by user role (viewer/manager/owner)
- **Input validation**: Tool arguments are validated before execution

## Model Configuration

### Free Models (Default)
1. Llama 4 Maverick Free
2. Gemma 3 27B Free

### Paid Fallbacks
1. Gemini Flash 1.5
2. Claude 3 Haiku
3. GPT-4o Mini

Models are selected via OpenRouter based on availability and cost.

## Development

### Adding New Tools

1. **Define the tool** in `supabase/functions/_shared/tools-registry.ts`:
```typescript
{
  name: 'my_new_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' }
    },
    required: ['param1']
  }
}
```

2. **Implement execution** in `supabase/functions/ai-execute-tool/index.ts`:
```typescript
case 'my_new_tool':
  result = await executeMyNewTool(args, restaurant_id, supabase);
  break;
```

3. **Add permission check** if needed:
```typescript
if (userRole !== 'owner') {
  throw new Error('Permission denied');
}
```

### Testing

1. **Local Development**:
   - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`
   - Set `OPENROUTER_API_KEY` in Supabase Edge Function secrets
   - Run `npm run dev`

2. **Edge Function Testing**:
   ```bash
   supabase functions deploy ai-chat-stream
   supabase functions deploy ai-execute-tool
   ```

## Future Enhancements

- [ ] Report generation tools (PDF, CSV export)
- [ ] SQL query tool (with allowlisting for safety)
- [ ] Trend analysis and forecasting
- [ ] Recipe suggestions based on margins
- [ ] Cost optimization recommendations
- [ ] Anomaly detection alerts
- [ ] Multi-restaurant comparisons
- [ ] Voice input/output
- [ ] Conversation history persistence
