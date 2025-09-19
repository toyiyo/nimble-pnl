# Nimble P&L

[![Build Status](https://img.shields.io/badge/build-passing-green)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-blue)](https://reactjs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)]()

> A modern, real-time restaurant profit & loss management platform with integrated POS systems and team collaboration features.

Nimble P&L is a comprehensive financial management solution designed specifically for restaurant operations. It provides real-time P&L tracking, automated data sync from POS systems like Square, and powerful analytics to help restaurant owners and managers make data-driven decisions.

## 🚀 Features

- **Real-time P&L Tracking**: Daily profit & loss calculations with food cost, labor cost, and prime cost analysis
- **Square Integration**: Automatic sync of sales, inventory, and transaction data from Square POS
- **Team Management**: Multi-role access control with invitation system for owners, managers, chefs, and staff
- **Financial Analytics**: 7-day averages, trend analysis, and performance metrics
- **Multi-restaurant Support**: Manage multiple restaurant locations from a single dashboard
- **SSO & Enterprise Features**: SCIM provisioning and single sign-on capabilities
- **Webhook Integration**: Real-time data updates via Square webhooks
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Architecture](#-architecture)
- [API Reference](#-api-reference)
- [Development](#-development)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

## ⚡ Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- Square Developer account (for POS integration)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/toyiyo/nimble-pnl.git
   cd nimble-pnl
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:5173`

## 🔧 Installation

### Development Setup

1. **System Requirements**
   - Node.js 18+ ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
   - npm 9+
   - Git

2. **Clone and Install**
   ```bash
   git clone https://github.com/toyiyo/nimble-pnl.git
   cd nimble-pnl
   npm install
   ```

3. **Database Setup**
   - Create a new Supabase project
   - Run the migrations from `supabase/migrations/`
   - Set up Row Level Security policies

4. **Environment Configuration**
   Create a `.env` file:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
   VITE_SUPABASE_PROJECT_ID=your_project_id
   ```

### Production Setup

For production deployment, additional environment variables are required:

```env
# Square Integration
SQUARE_APPLICATION_ID=your_square_app_id
SQUARE_APPLICATION_SECRET=your_square_app_secret
SQUARE_SANDBOX_APPLICATION_ID=your_square_sandbox_app_id
SQUARE_SANDBOX_APPLICATION_SECRET=your_square_sandbox_secret

# Supabase Edge Functions
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## ⚙️ Configuration

### Supabase Configuration

The application uses Supabase for:
- User authentication and authorization
- Database operations with PostgreSQL
- Real-time subscriptions
- Edge Functions for integrations

Key configuration in `supabase/config.toml`:
```toml
project_id = "your_project_id"

[functions.square-oauth]
verify_jwt = false

[functions.square-webhooks]
verify_jwt = false
```

### Square Integration Setup

1. Create a Square Developer account
2. Create a new application
3. Configure OAuth redirect URIs:
   - Development: `http://localhost:5173/square/callback`
   - Production: `https://your-domain.com/square/callback`
4. Set up webhook endpoints for real-time data sync

## 📖 Usage

### Getting Started

1. **Create an Account**
   - Sign up with email/password or SSO
   - Create your first restaurant profile

2. **Connect Square POS**
   - Navigate to Integrations
   - Click "Connect" on Square integration
   - Authorize the application with your Square account

3. **Input Daily Data**
   - Use the dashboard to input sales, food costs, and labor costs
   - Or rely on automatic Square sync for sales data

4. **Invite Team Members**
   - Go to Team management
   - Send invitations with appropriate roles
   - Team members can view/edit based on permissions

### Dashboard Overview

The main dashboard provides:
- **Today's P&L**: Current day profit & loss summary
- **Key Metrics**: Food cost %, labor cost %, prime cost %
- **Recent Performance**: Historical data and trends
- **Quick Actions**: Data input and report generation

### Team Management

Role-based access control:
- **Owner**: Full access to all features and settings
- **Manager**: Access to P&L data and team management
- **Chef**: Access to food cost data and inventory
- **Staff**: Limited read access to performance metrics

## 🏗️ Architecture

### Technology Stack

#### Frontend
- **React 18**: Modern React with hooks and functional components
- **TypeScript**: Type-safe development with strict type checking
- **Vite**: Fast build tool and development server
- **Tailwind CSS**: Utility-first CSS framework
- **shadcn/ui**: High-quality React component library
- **React Router**: Client-side routing
- **React Query**: Server state management and caching

#### Backend
- **Supabase**: Backend-as-a-Service platform
- **PostgreSQL**: Primary database with RLS (Row Level Security)
- **Supabase Edge Functions**: Serverless functions for integrations
- **Deno**: Runtime for Edge Functions

#### External Integrations
- **Square API**: POS data synchronization
- **Square Webhooks**: Real-time data updates

### Software Patterns

#### 1. **Component Architecture**
- **Atomic Design**: UI components organized by complexity (atoms, molecules, organisms)
- **Compound Components**: Complex UI patterns like forms and modals
- **Render Props**: Flexible component composition

Example structure:
```
src/components/
├── ui/               # Atomic components (buttons, inputs, etc.)
├── forms/            # Form molecules
├── charts/           # Data visualization components
└── layout/           # Page layout organisms
```

#### 2. **State Management**
- **React Query**: Server state management with caching and synchronization
- **React Hooks**: Local component state management
- **Context API**: Global application state (auth, theme)

```typescript
// Custom hook pattern for data fetching
export function useDailyPnL(restaurantId: string | null) {
  const [pnlData, setPnlData] = useState<DailyPnL[]>([]);
  const [loading, setLoading] = useState(true);
  
  const fetchPnLData = useCallback(async () => {
    // Supabase query logic
  }, [restaurantId]);
  
  return { pnlData, loading, fetchPnLData };
}
```

#### 3. **Authentication & Authorization**
- **Row Level Security (RLS)**: Database-level access control
- **JWT Tokens**: Stateless authentication
- **Role-based Access Control**: Fine-grained permissions

```sql
-- Example RLS policy
CREATE POLICY "Users can view own restaurant data" 
ON daily_pnl 
FOR SELECT 
USING (
  auth.uid() IN (
    SELECT user_id FROM user_restaurants 
    WHERE restaurant_id = daily_pnl.restaurant_id
  )
);
```

#### 4. **API Integration Pattern**
- **Edge Functions**: Serverless integration layer
- **Webhook Handlers**: Real-time data synchronization
- **OAuth Flow**: Secure third-party authentication

```typescript
// Square OAuth integration
export async function handleSquareOAuth(action: string, restaurantId?: string) {
  const supabase = createClient();
  
  if (action === 'authorize') {
    // Generate OAuth URL and redirect
  } else if (action === 'callback') {
    // Exchange code for access token
  }
}
```

#### 5. **Data Flow Architecture**
```
Square POS → Webhooks → Edge Functions → Supabase → React Query → UI Components
     ↓
Manual Input → Form Components → API Calls → Database → Real-time Updates
```

#### 6. **Error Handling**
- **Boundary Components**: React error boundaries for graceful failures
- **Toast Notifications**: User-friendly error messages
- **Retry Logic**: Automatic retry for transient failures

### Database Schema

Key entities and relationships:

```sql
-- Core entities
restaurants (id, name, settings)
users (id, email, profile_data)
user_restaurants (user_id, restaurant_id, role)

-- Financial data
daily_pnl (restaurant_id, date, revenue, costs, calculations)
daily_sales (restaurant_id, date, source, amounts)
daily_food_costs (restaurant_id, date, categories, amounts)
daily_labor_costs (restaurant_id, date, wages, hours)

-- Integrations
square_integrations (restaurant_id, access_token, refresh_token)
square_webhooks (restaurant_id, event_type, processed_at)
```

## 🔌 API Reference

### Supabase Edge Functions

#### Authentication Functions
- `POST /functions/v1/send-team-invitation` - Send team member invitations
- `POST /functions/v1/accept-invitation` - Accept team invitations

#### Square Integration
- `POST /functions/v1/square-oauth` - Handle Square OAuth flow
- `POST /functions/v1/square-sync-data` - Manual data synchronization
- `POST /functions/v1/square-webhooks` - Process Square webhook events
- `POST /functions/v1/trigger-pnl-calculation` - Calculate P&L from raw data

#### Enterprise Features
- `POST /functions/v1/scim-v2` - SCIM user provisioning
- `POST /functions/v1/generate-scim-token` - Generate SCIM tokens

### Database Tables

Key tables accessible via Supabase client:

- `profiles` - User profile information
- `restaurants` - Restaurant details and settings  
- `daily_pnl` - Calculated daily P&L data
- `daily_sales` - Sales transaction data
- `daily_food_costs` - Food cost tracking
- `daily_labor_costs` - Labor cost and hours
- `user_restaurants` - User-restaurant relationships
- `team_invitations` - Pending team invitations

## 💻 Development

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production
npm run build:dev    # Build for development
npm run preview      # Preview production build
npm run lint         # Run ESLint

# Database
supabase start       # Start local Supabase
supabase db reset    # Reset local database
supabase functions serve  # Serve edge functions locally
```

### Code Style

The project uses:
- **ESLint**: Code linting with TypeScript rules
- **Prettier**: Code formatting (configured in ESLint)
- **TypeScript**: Strict type checking
- **Conventional Commits**: Standardized commit messages

### Testing

```bash
# Run tests (when available)
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

### Development Workflow

1. **Feature Development**
   ```bash
   git checkout -b feature/your-feature-name
   npm run dev
   # Make changes
   npm run lint
   npm run build
   ```

2. **Database Changes**
   ```bash
   supabase migration new your_migration_name
   # Edit the migration file
   supabase db push
   ```

3. **Edge Function Development**
   ```bash
   supabase functions new your-function-name
   # Edit function code
   supabase functions serve
   ```

## 🚀 Deployment

### Production Deployment

1. **Environment Setup**
   Configure production environment variables in your hosting platform

2. **Database Migration**
   ```bash
   supabase db push --linked
   ```

3. **Edge Functions Deployment**
   ```bash
   supabase functions deploy
   ```

4. **Frontend Build**
   ```bash
   npm run build
   ```

### Hosting Options

- **Vercel**: Automatic deployments from Git
- **Netlify**: Static site hosting with edge functions
- **Supabase Hosting**: Integrated with Supabase services

### Environment Variables

Required for production:
```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
SQUARE_APPLICATION_ID=
SQUARE_APPLICATION_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Discussions**: Use GitHub Discussions for questions and community support

---

Built with ❤️ for the restaurant industry
