# M&A IT Onboarding AI System

> CI nudge: trivial change to trigger latest pipeline run.

An AI-powered system that creates dynamic decision trees for M&A IT infrastructure onboarding through intelligent discovery conversations.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Azure](https://img.shields.io/badge/Azure-Static%20Web%20Apps-blue)
![React](https://img.shields.io/badge/React-18.2-61DAFB)
![OpenAI](https://img.shields.io/badge/Azure%20OpenAI-GPT--4-green)

## 🚀 Features

- **AI-Driven Discovery**: Intelligent conversational interface guides through infrastructure discovery
- **Dynamic Decision Trees**: Real-time visualization of migration tasks and dependencies
- **Smart Task Generation**: AI automatically creates actionable tasks based on discovery
- **Risk Assessment**: Identifies and highlights potential risks and blockers
- **ConnectWise Integration**: Direct ticket creation in ConnectWise PSA
- **Export Capabilities**: JSON, PDF, and project plan exports
- **Real-time Collaboration**: Multiple users can work on the same discovery session

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  React Frontend │────▶│ Azure Functions │────▶│  Azure OpenAI   │
│   (Static Web)  │     │   (Serverless)  │     │    (GPT-4)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                        │
         ▼                       ▼                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Azure SignalR  │     │  Azure Cosmos   │     │  Blob Storage   │
│   (Real-time)   │     │    (Sessions)   │     │   (Exports)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📋 Prerequisites

- Azure Subscription
- Node.js 18+ and npm
- Azure CLI
- GitHub account (for CI/CD)
- ConnectWise PSA (optional)

## 🚀 Quick Start

### Option 1: Automated Deployment (PowerShell)

```powershell
# Clone the repository
git clone https://github.com/YOUR_ORG/ma-onboarding-ai.git
cd ma-onboarding-ai

# Run deployment script
./Deploy-MAOnboarding.ps1 -ResourceGroupName "rg-ma-onboarding" -Location "eastus"
```

### Option 2: Manual Deployment

1. **Deploy Azure Resources:**
```bash
az group create --name rg-ma-onboarding --location eastus
az deployment group create \
  --resource-group rg-ma-onboarding \
  --template-file azure-deploy.json
```

2. **Install Dependencies:**
```bash
npm install
cd api && npm install
```

3. **Configure Environment:**
Create `api/local.settings.json` and `.env.local` with your Azure resource credentials

4. **Run Locally:**
```bash
# Terminal 1 - API
cd api && func start

# Terminal 2 - Frontend
npm start
```

## 🎯 Usage

### Starting a Discovery Session

1. Navigate to the application URL
2. The AI assistant will guide you through discovery phases:
   - Infrastructure
   - Applications
   - Data Systems
   - Security
   - Communications

### Understanding the Decision Tree

- **Node Colors:**
  - 🔵 Blue: Active/In Progress
  - 🟢 Green: Completed
  - 🟡 Yellow: Pending
  - 🔴 Red: Risk/Blocker

- **Edge Types:**
  - Solid line: Hard dependency
  - Dashed line: Can run in parallel
  - Red line: Risk path

### Generating Execution Plans

1. Complete discovery phases
2. Click "Generate Plan"
3. Review the generated decision tree
4. Export or create tickets

## 🔧 Configuration

### Customizing Discovery Questions

Edit `src/components/ChatInterface.js`:

```javascript
const discoveryQuestions = {
  infrastructure: [
    "Your custom questions here..."
  ]
};
```

### AI Behavior Tuning

Modify `api/discovery-process.js`:

```javascript
function getSystemPrompt() {
  return `Your custom AI instructions...`;
}
```

### ConnectWise Integration

Add ConnectWise credentials to GitHub Secrets:
- `CONNECTWISE_URL`
- `CONNECTWISE_COMPANY`
- `CONNECTWISE_PUBLIC_KEY`
- `CONNECTWISE_PRIVATE_KEY`

## 📊 Cost Estimates

- **Azure Static Web Apps**: ~$9/month (Standard tier)
- **Azure OpenAI**: ~$0.03 per 1K tokens
- **Cosmos DB**: ~$25/month (400 RU/s)
- **SignalR**: ~$50/month (Standard)
- **Storage**: ~$1/month

**Estimated Total**: ~$85-100/month

## 🛠️ Development

### Project Structure
```
ma-onboarding-ai/
├── src/                    # React frontend
│   ├── App.js             # Main application
│   └── components/        # React components
├── api/                   # Azure Functions
│   ├── discovery-process.js
│   └── plan-generate.js
├── azure-deploy.json      # ARM template
└── staticwebapp.config.json
```

### Adding New Features

1. **New Discovery Category:**
   - Add to `discoveryQuestions` object
   - Update `completionCriteria` 
   - Add node generation logic

2. **Custom Integrations:**
   - Create new Azure Function in `/api`
   - Add webhook endpoints
   - Update frontend to call new APIs

## 🔒 Security

- Enable Azure AD authentication for production
- Use managed identities for service connections
- Implement API rate limiting
- Regular security audits
- Encrypt sensitive data at rest

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📞 Support

- Create GitHub Issue for bugs/features
- Internal team: Contact IT Operations
- Documentation: See `/docs` folder

## 🎉 Acknowledgments

- Built with Azure AI and Static Web Apps
- React Flow for visualization
- ConnectWise for PSA integration

---

**Built by SAX Technology Advisors IT Operations Team**
# Trigger deployment
