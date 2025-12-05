# EasyShiftHQ

A modern web application for managing restaurant profit and loss calculations with Square integration.

## Project Overview

EasyShiftHQ is a comprehensive solution that helps restaurants track and analyze their profit and loss data. It integrates with Square for real-time data synchronization and provides AI-powered insights for better business decisions.

## 📚 Documentation

- **[Architecture & Technical Guidelines](ARCHITECTURE.md)** - Detailed technical documentation, design patterns, and best practices
- **[Integration Patterns](INTEGRATIONS.md)** - Third-party integrations (banks, POS, AI), security, and performance
- **[Unit Conversions](docs/UNIT_CONVERSIONS.md)** - Recipe-to-inventory conversion system (critical for inventory accuracy)
- **[Braintrust Telemetry](docs/BRAINTRUST_TELEMETRY.md)** - AI observability and telemetry setup
- **[GitHub Copilot Instructions](.github/copilot-instructions.md)** - Guidelines for AI coding assistants

### Quick Links
- [Caching Strategy](ARCHITECTURE.md#-caching--performance-strategy)
- [Design System](ARCHITECTURE.md#-design-system-guidelines)
- [Accessibility Standards](ARCHITECTURE.md#-accessibility-standards)
- [Unit Conversion Constants](docs/UNIT_CONVERSIONS.md#-conversion-constants)
- [Bank Connections](INTEGRATIONS.md#-bank-connections)
- [POS Integrations](INTEGRATIONS.md#-pos-system-integrations)
- [AI Functionality](INTEGRATIONS.md#-ai--machine-learning)
- [AI Telemetry Setup](docs/BRAINTRUST_TELEMETRY.md#setup)
- [Edge Functions](INTEGRATIONS.md#-edge-functions-architecture)
- [Security Best Practices](INTEGRATIONS.md#-security-best-practices)

### Key Technical Principles

**Data Freshness First**: This is a real-time system where stale data causes operational issues. We use React Query with short cache times (30-60s) and NO manual caching (localStorage, etc.).

**Design System**: All styling uses semantic tokens from `index.css` - no direct colors like `bg-white` or `text-black`. Components follow consistent gradient patterns and animations.

**Accessibility**: WCAG 2.1 AA compliance with keyboard navigation, ARIA labels, focus management, and screen reader support throughout.

**Security**: Row Level Security (RLS) enforced at the database level. Client-side checks are for UX only, never for authorization.

## Architecture

### Frontend
- **Framework**: React 18+ with Vite
- **Language**: TypeScript
- **UI Components**: shadcn/ui + Tailwind CSS
- **State Management**: React Hooks
- **Routing**: React Router

### Backend
- **Platform**: Supabase
- **Functions**: Edge Functions (Deno runtime)
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth with SSO capabilities
- **File Storage**: Supabase Storage

### Integrations
- **Square & Clover** - POS system integrations via adapter pattern
- **Stripe Financial Connections** - Secure bank account linking
- **OpenRouter** - AI functionality with multi-model fallback
- **Resend** - Transactional email service
- **SCIM** - Enterprise user provisioning

## Project Structure

```
src/
├── components/     # React components
├── hooks/         # Custom React hooks
├── integrations/  # Third-party service integrations
├── lib/          # Utility functions
├── pages/        # Route components
└── services/     # Business logic services

supabase/
├── functions/    # Edge Functions
└── migrations/   # Database migrations
```

## Prerequisites

- Node.js 18+ or Bun
- Supabase account
- Square developer account
- OpenAI API key (for AI features)
- Resend API key (for emails)

## Environment Variables

### Required Variables
```bash
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_PUBLISHABLE_KEY=your_anon_key

# Square Integration
SQUARE_APPLICATION_ID=your_square_app_id
SQUARE_APPLICATION_SECRET=your_square_app_secret
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_key
ENCRYPTION_KEY=your_encryption_key

# Development Only (Optional)
SQUARE_SANDBOX_APPLICATION_ID=your_sandbox_app_id
SQUARE_SANDBOX_APPLICATION_SECRET=your_sandbox_secret
SQUARE_PERSONAL_ACCESS_TOKEN=your_personal_token

# Additional Services
RESEND_API_KEY=your_resend_key
OPENAI_API_KEY=your_openai_key
```

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/toyiyo/easyshifthq.git
   cd easyshifthq
   ```

2. Install dependencies:
   ```bash
   bun install
   # or
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in the required environment variables

4. Start the development server:
   ```bash
   bun run dev
   # or
   npm run dev
   ```

## Deployment (Coolify)

### Prerequisites
- Coolify account
- Git repository connected to Coolify
- All environment variables ready

### Configuration

1. **Build Settings**
   - Build Pack: Static
   - Base Directory: `/`
   - Pre Deployment Command: `bun install && bun run build`
   - Output Directory: `dist` (automatic)

2. **Environment Variables**
   - Add all required environment variables in Coolify's UI

3. **NGINX Configuration**
   Add the following custom NGINX configuration:
   ```nginx
   server {
       location / {
           root /usr/share/nginx/html;
           index index.html;
           try_files $uri $uri/ /index.html;
       }

       # Handle 404 errors
       error_page 404 /index.html;
       location = /404.html {
           root /usr/share/nginx/html;
           internal;
       }

       # Handle server errors (50x)
       error_page 500 502 503 504 /50x.html;
       location = /50x.html {
           root /usr/share/nginx/html;
           internal;
       }

       # Enable gzip compression
       gzip on;
       gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
   }
   ```

### Deployment Steps

1. Connect your repository in Coolify
2. Configure the deployment settings as above
3. Set up environment variables
4. Deploy the application

## Features

- **Multi-POS Support** - Square and Clover integrations with unified data model
- **Bank Integration** - Secure bank connections via Stripe Financial Connections
- **Automated P&L Calculations** - Real-time profit and loss tracking
- **AI-Powered Categorization** - Automatic transaction categorization with multi-model fallback
- **OCR & Receipt Processing** - Extract data from receipts and product images
- **Enterprise SSO Support** - SAML-based single sign-on
- **SCIM Provisioning** - Automated user management for enterprise
- **Real-time Sync** - Webhooks + polling for up-to-date data
- **Team Collaboration** - Multi-user support with role-based permissions
- **Multi-Restaurant Support** - Manage multiple locations from one account

## 🔄 CI/CD & Preview Environments

We use **Supabase Branching** with **Vercel** to provide isolated preview environments for every PR.

### How It Works

| Component | Production | PR Preview |
|-----------|------------|------------|
| **Frontend** | Vercel Production | Vercel Preview URL |
| **Database** | Supabase Production | Supabase Preview Branch |
| **Env Vars** | Production values | Auto-synced branch values |

### Supabase Branching Setup

1. **GitHub Integration**: Connected via Supabase Dashboard → Project Settings → Integrations
2. **Supabase Directory**: Set to `supabase` (contains migrations, functions, tests)
3. **Branching Mode**: "Supabase changes only" - branches created when `supabase/` files change
4. **Branch Limit**: 50 concurrent preview branches

### Vercel Integration

1. **Supabase-Vercel Integration**: Installed via Supabase marketplace
2. **Environment Variable Prefix**: `VITE_` (for Vite-based apps)
3. **Auto-sync**: Preview deployments receive branch-specific database credentials

### Environment Variables

The app uses environment variables with production fallbacks:

```typescript
// src/integrations/supabase/client.ts
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || PRODUCTION_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || PRODUCTION_KEY;
```

| Variable | Source | Fallback |
|----------|--------|----------|
| `VITE_SUPABASE_URL` | Vercel/Supabase integration | Production URL |
| `VITE_SUPABASE_ANON_KEY` | Vercel/Supabase integration | Production anon key |

This ensures the app works on:
- ✅ Vercel (production + preview with Supabase branching)
- ✅ Netlify (uses production fallback)
- ✅ Lovable (uses production fallback)
- ✅ Local development (uses `.env` or fallback)

### PR Workflow

1. **Create PR** with changes to `supabase/migrations/` or `supabase/functions/`
2. **Supabase** automatically creates a preview branch database
3. **Migrations run** on the preview branch
4. **Vercel** deploys frontend with preview branch credentials
5. **Test** on isolated environment (no production data affected)
6. **Merge** → Changes deploy to production

### GitHub Actions

Our CI pipeline (`.github/workflows/unit-tests.yml`) runs:
- **Unit Tests**: TypeScript tests with Vitest
- **Database Tests**: pgTAP tests against local Supabase
- **SonarCloud**: Code quality and security analysis
- **CodeQL**: Security vulnerability scanning

## Testing

### SQL Function Tests

The project includes comprehensive tests for all PostgreSQL database functions using pgTAP.

**Running tests locally:**
```bash
# Navigate to tests directory
cd supabase/tests

# Run all tests
./run_tests.sh
```

**Test coverage:**
- Sales and aggregation functions
- P&L calculation functions
- Inventory management functions
- Search and lookup functions
- Trigger functions
- Security and authentication functions
- Utility and maintenance functions

See [supabase/tests/README.md](supabase/tests/README.md) for detailed testing documentation.

## Financial Calculations & Formulas

### Data Model Overview

#### Data Sources
- **Revenue & Liabilities**: `unified_sales` table (consolidates Square, Clover, manual entries)
- **Costs**: `daily_pnl` table (food cost, labor cost)
- **Chart of Accounts**: `chart_of_accounts` table (account categorization)

#### Split Sale Handling
To avoid double-counting when sales are split:
1. **Exclude** parent sales that have children (identified by checking if their ID appears as a `parent_sale_id`)
2. **Include** all child splits (sales with a `parent_sale_id`)
3. **Include** unsplit sales (no `parent_sale_id`, no children)

```typescript
// Logic: Find parent IDs that have children
const parentIdsWithChildren = new Set(
  sales.filter(s => s.parent_sale_id !== null)
       .map(s => s.parent_sale_id)
);

// Filter: Keep only sales that are NOT in the parent set
const validSales = sales.filter(s => !parentIdsWithChildren.has(s.id));
```

### Monthly Performance Metrics

#### Gross Revenue
**Formula**: Sum of all sales with `item_type='sale'` AND `account_type='revenue'`

```typescript
Gross Revenue = Σ(total_price) where item_type='sale' AND account_type='revenue'
```

#### Discounts
**Formula**: Sum of absolute values for discount items

```typescript
Discounts = Σ(ABS(total_price)) where item_type='discount'
```

#### Refunds
**Formula**: Sum of absolute values for refund items

```typescript
Refunds = Σ(ABS(total_price)) where item_type='refund'
```

#### Net Revenue
**Formula**: Gross Revenue minus Discounts minus Refunds

```typescript
Net Revenue = Gross Revenue - Discounts - Refunds
```

#### Sales Tax Collected
**Formula**: Sum of liability sales with "sales" or "tax" in account subtype

```typescript
Sales Tax = Σ(total_price) where item_type='sale' 
            AND account_type='liability' 
            AND (account_subtype LIKE '%sales%' OR account_subtype LIKE '%tax%')
```

#### Tips
**Formula**: Sum of liability sales with "tip" in account subtype

```typescript
Tips = Σ(total_price) where item_type='sale' 
       AND account_type='liability' 
       AND account_subtype LIKE '%tip%'
```

#### Other Liabilities
**Formula**: Sum of liability sales not categorized as tax or tips

```typescript
Other Liabilities = Σ(total_price) where item_type='sale' 
                    AND account_type='liability' 
                    AND account_subtype NOT LIKE '%sales%' 
                    AND account_subtype NOT LIKE '%tax%'
                    AND account_subtype NOT LIKE '%tip%'
```

#### Total Collected at POS
**Formula**: Sum of all revenue and liabilities collected

```typescript
Total Collected = Gross Revenue + Sales Tax + Tips + Other Liabilities
```

#### Food Cost
**Formula**: Sum of food costs from daily P&L records

```typescript
Food Cost = Σ(daily_pnl.food_cost) for all dates in month
```

#### Labor Cost
**Formula**: Sum of labor costs from daily P&L records

```typescript
Labor Cost = Σ(daily_pnl.labor_cost) for all dates in month
```

#### Profit
**Formula**: Net Revenue minus operating costs

```typescript
Profit = Net Revenue - Food Cost - Labor Cost
```

#### Month-over-Month Change
**Formula**: Percentage change in net revenue compared to prior month

```typescript
MoM Change % = ((Current Month Net Revenue - Prior Month Net Revenue) / ABS(Prior Month Net Revenue)) × 100
```

### Example Calculation

Given sales data for October 2025:
- Sales items (revenue): $10,560.56 + $386.00 = **$10,946.56**
- Discounts: $0.00
- Refunds: $0.00
- Sales tax (liability): $1.44
- Other liabilities: $2.00

**Calculations**:
```
Gross Revenue = $10,946.56
Discounts = $0.00
Refunds = $0.00
Net Revenue = $10,946.56 - $0.00 - $0.00 = $10,946.56

Sales Tax = $1.44
Tips = $0.00
Other Liabilities = $2.00
Total Collected at POS = $10,946.56 + $1.44 + $2.00 = $10,950.00

Food Cost = $0.00
Labor Cost = $0.00
Profit = $10,946.56 - $0.00 - $0.00 = $10,946.56
```

### Key Principles

1. **No Double-Counting**: Split sales are handled by excluding parent records and including only child records
2. **Integer Math**: All calculations use integer cents to avoid floating-point errors
3. **Liability Separation**: Taxes, tips, and other liabilities are tracked separately from revenue
4. **Account-Based**: All categorization relies on the Chart of Accounts (`account_type` and `account_subtype`)
5. **Real-Time**: Data syncs via webhooks + periodic polling from POS systems

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file included in the repository.
